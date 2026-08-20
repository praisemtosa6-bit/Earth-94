import { neon } from '@neondatabase/serverless'
import { Buffer } from 'node:buffer'
import process from 'node:process'

const WORLD_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
const CLIENT_ID_PATTERN = /^[a-zA-Z0-9-]{8,100}$/
const LEASE_DURATION_MS = 15_000
const MAX_SNAPSHOT_BYTES = 4_000_000

const sendJson = (response, status, payload) => {
  response.setHeader('Cache-Control', 'no-store, max-age=0')
  response.status(status).json(payload)
}

const publicSnapshot = (snapshot, revision) => {
  const result = { ...snapshot, revision: Number(revision) }
  delete result._sync
  return result
}

const getController = (snapshot, clientId) => {
  const leaseExpiresAt = snapshot?._sync?.leaseExpiresAt ?? null
  const leaseActive = leaseExpiresAt && Date.parse(leaseExpiresAt) > Date.now()
  return {
    isController: Boolean(leaseActive && snapshot?._sync?.controllerId === clientId),
    leaseExpiresAt,
  }
}

const getClientId = (request) => {
  const raw = request.headers['x-earth-client-id']
  return Array.isArray(raw) ? raw[0] : raw
}

const readBody = (request) => {
  if (typeof request.body === 'string') return JSON.parse(request.body)
  return request.body
}

export default async function handler(request, response) {
  const worldId = Array.isArray(request.query.worldId) ? request.query.worldId[0] : request.query.worldId
  const clientId = getClientId(request)

  if (!WORLD_ID_PATTERN.test(worldId ?? '')) {
    return sendJson(response, 400, { error: 'Invalid world ID.' })
  }
  if (!CLIENT_ID_PATTERN.test(clientId ?? '')) {
    return sendJson(response, 400, { error: 'A valid client ID is required.' })
  }
  if (!process.env.DATABASE_URL) {
    return sendJson(response, 503, { error: 'World database is not configured.' })
  }

  const sql = neon(process.env.DATABASE_URL)

  try {
    if (request.method === 'GET') {
      const rows = await sql`
        SELECT revision, snapshot, updated_at
        FROM earth_worlds
        WHERE id = ${worldId}
        LIMIT 1
      `
      const row = rows[0]
      if (!row) return sendJson(response, 404, { error: 'World not found.' })

      return sendJson(response, 200, {
        revision: Number(row.revision),
        snapshot: publicSnapshot(row.snapshot, row.revision),
        updatedAt: row.updated_at,
        ...getController(row.snapshot, clientId),
      })
    }

    if (request.method === 'PUT') {
      let body
      try {
        body = readBody(request)
      } catch {
        return sendJson(response, 400, { error: 'Request body must be valid JSON.' })
      }

      const expectedRevision = Number(body?.expectedRevision)
      const snapshot = body?.snapshot
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        return sendJson(response, 400, { error: 'Expected revision must be a non-negative integer.' })
      }
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        return sendJson(response, 400, { error: 'A world snapshot is required.' })
      }
      if (snapshot.worldId && snapshot.worldId !== worldId) {
        return sendJson(response, 400, { error: 'Snapshot world ID does not match the route.' })
      }
      if (!Array.isArray(snapshot.world) || !Array.isArray(snapshot.agents)) {
        return sendJson(response, 400, { error: 'Snapshot is missing world or agent data.' })
      }

      const leaseExpiresAt = new Date(Date.now() + LEASE_DURATION_MS).toISOString()
      const nextRevision = expectedRevision + 1
      const storedSnapshot = JSON.stringify({
        ...snapshot,
        worldId,
        revision: nextRevision,
        _sync: { controllerId: clientId, leaseExpiresAt },
      })
      if (Buffer.byteLength(storedSnapshot, 'utf8') > MAX_SNAPSHOT_BYTES) {
        return sendJson(response, 413, { error: 'World snapshot is too large.' })
      }

      const rows = await sql`
        WITH updated AS (
          UPDATE earth_worlds
          SET revision = revision + 1,
              snapshot = ${storedSnapshot}::jsonb,
              updated_at = now()
          WHERE id = ${worldId}
            AND revision = ${expectedRevision}
            AND (
              snapshot #>> '{_sync,controllerId}' = ${clientId}
              OR COALESCE(
                NULLIF(snapshot #>> '{_sync,leaseExpiresAt}', '')::timestamptz,
                '-infinity'::timestamptz
              ) <= now()
            )
          RETURNING revision, snapshot, updated_at
        ), inserted AS (
          INSERT INTO earth_worlds (id, revision, snapshot, updated_at)
          SELECT ${worldId}, 1, ${storedSnapshot}::jsonb, now()
          WHERE ${expectedRevision} = 0
            AND NOT EXISTS (SELECT 1 FROM updated)
          ON CONFLICT (id) DO NOTHING
          RETURNING revision, snapshot, updated_at
        )
        SELECT * FROM updated
        UNION ALL
        SELECT * FROM inserted
        LIMIT 1
      `

      const saved = rows[0]
      if (saved) {
        return sendJson(response, 200, {
          revision: Number(saved.revision),
          updatedAt: saved.updated_at,
          isController: true,
          leaseExpiresAt,
        })
      }

      const currentRows = await sql`
        SELECT revision, snapshot, updated_at
        FROM earth_worlds
        WHERE id = ${worldId}
        LIMIT 1
      `
      const current = currentRows[0]
      if (!current) return sendJson(response, 409, { error: 'World changed while saving.' })

      const controller = getController(current.snapshot, clientId)
      return sendJson(response, Number(current.revision) === expectedRevision ? 423 : 409, {
        revision: Number(current.revision),
        snapshot: publicSnapshot(current.snapshot, current.revision),
        updatedAt: current.updated_at,
        ...controller,
      })
    }

    response.setHeader('Allow', 'GET, PUT')
    return sendJson(response, 405, { error: 'Method not allowed.' })
  } catch (error) {
    console.error('Earth 94 world API failed.', error)
    return sendJson(response, 500, { error: 'World database request failed.' })
  }
}

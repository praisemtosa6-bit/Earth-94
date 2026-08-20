import { WORLD_SIZE } from './constants'
import { normalizeEconomicAgent, normalizeEconomy } from './economy'
import { migrateLegacyAgentAge, migrateLifeCalendar, normalizeLifecycleAgent } from './lifecycle'
import { ensureAgentIdentities, getAgentName } from './names'
import { normalizePredators } from './predators'
import { SubstrateManager } from './substrateManager'
import { ensureCoastalEconomy, removeRoads } from './world'

const STORAGE_KEY = 'earth-94-simulation-v1'
const CLIENT_ID_KEY = 'earth-94-client-id'
const SNAPSHOT_VERSION = 7
const DEFAULT_WORLD_ID = 'earth-94-main'

const getRemoteBaseUrl = () => {
  const configuredUrl = (import.meta.env.VITE_WORLD_API_URL ?? '').trim()
  if (configuredUrl) return configuredUrl.replace(/\/$/, '')
  return import.meta.env.PROD ? '/api' : ''
}

let fallbackClientId

export const getPersistenceClientId = () => {
  if (typeof window === 'undefined') return 'server-renderer'
  try {
    const existing = window.sessionStorage.getItem(CLIENT_ID_KEY)
    if (existing) return existing
    const created = window.crypto?.randomUUID?.() ?? `earth-${Date.now()}-${Math.random().toString(36).slice(2)}`
    window.sessionStorage.setItem(CLIENT_ID_KEY, created)
    return created
  } catch {
    fallbackClientId ??= `earth-${Date.now()}-${Math.random().toString(36).slice(2)}`
    return fallbackClientId
  }
}

export const isRemotePersistenceConfigured = () => Boolean(getRemoteBaseUrl())

export const createSnapshot = (state) => ({
  version: SNAPSHOT_VERSION,
  worldId: state.worldId ?? DEFAULT_WORLD_ID,
  revision: state.revision ?? 0,
  savedAt: new Date().toISOString(),
  tick: state.tick,
  calendar: migrateLifeCalendar(state.calendar, state.tick),
  world: state.world,
  agents: state.agents,
  predators: state.predators ?? [],
  archive: state.archive ?? [],
  economy: normalizeEconomy(state.economy),
  metrics: state.metrics,
  substrate: {
    moisture: Array.from(state.substrate.moisture),
    vegetation: Array.from(state.substrate.vegetation),
    dataTrace: Array.from(state.substrate.dataTrace),
    wisdomTrace: Array.from(state.substrate.wisdomTrace),
    tickCounter: state.substrate.tickCounter,
  },
})

export const hydrateSnapshot = (snapshot) => {
  if (![1, 2, 3, 4, 5, 6, SNAPSHOT_VERSION].includes(snapshot?.version) || !Array.isArray(snapshot.world) || !Array.isArray(snapshot.agents)) {
    return null
  }

  const substrate = new SubstrateManager(WORLD_SIZE)
  if (snapshot.substrate) {
    substrate.moisture = Float32Array.from(snapshot.substrate.moisture ?? substrate.moisture)
    substrate.vegetation = Float32Array.from(snapshot.substrate.vegetation ?? substrate.vegetation)
    substrate.dataTrace = Float32Array.from(snapshot.substrate.dataTrace ?? substrate.dataTrace)
    substrate.wisdomTrace = Float32Array.from(snapshot.substrate.wisdomTrace ?? substrate.wisdomTrace)
    substrate.tickCounter = snapshot.substrate.tickCounter ?? 0
    substrate.sanitize()
    substrate.lastUpdateTime = performance.now()
  }

  const needsAgeMigration = snapshot.calendar?.agesRebased !== true
  const agents = ensureAgentIdentities(snapshot.agents).map((agent) => {
    const economicAgent = normalizeEconomicAgent(agent)
    const ageAdjustedAgent = needsAgeMigration
      ? migrateLegacyAgentAge(economicAgent, snapshot.tick ?? 0)
      : economicAgent
    return normalizeLifecycleAgent(ageAdjustedAgent, snapshot.tick ?? 0)
  })
  const agentNames = new Map(agents.map((agent) => [agent.id, getAgentName(agent)]))
  const archive = (snapshot.archive ?? []).map((artifact) => ({
    ...artifact,
    authorName: artifact.authorName ?? agentNames.get(artifact.authorId) ?? artifact.authorId,
  }))

  const world = removeRoads(ensureCoastalEconomy(snapshot.world))

  return {
    worldId: snapshot.worldId ?? DEFAULT_WORLD_ID,
    revision: snapshot.revision ?? 0,
    tick: snapshot.tick ?? 0,
    calendar: { ...migrateLifeCalendar(snapshot.calendar, snapshot.tick ?? 0), agesRebased: true },
    world,
    agents,
    predators: normalizePredators(snapshot.predators, world),
    archive,
    economy: normalizeEconomy(snapshot.economy),
    substrate,
    metrics: snapshot.metrics ?? { highestCortisol: 0, events: [] },
  }
}

export const saveSimulation = (state) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(createSnapshot(state)))
  } catch (error) {
    console.warn('Could not persist the Earth 94 simulation.', error)
  }
}

export const loadSimulation = () => {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? hydrateSnapshot(JSON.parse(raw)) : null
  } catch (error) {
    console.warn('Could not restore the Earth 94 simulation.', error)
    return null
  }
}

export const loadRemoteSimulation = async (worldId = DEFAULT_WORLD_ID, clientId = getPersistenceClientId()) => {
  const baseUrl = getRemoteBaseUrl()
  if (!baseUrl) return null
  const response = await fetch(`${baseUrl}/worlds/${encodeURIComponent(worldId)}`, {
    headers: {
      Accept: 'application/json',
      'X-Earth-Client-Id': clientId,
    },
    cache: 'no-store',
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`World load failed with status ${response.status}`)
  const payload = await response.json()
  const state = hydrateSnapshot(payload.snapshot ?? payload)
  return state ? {
    state,
    isController: payload.isController === true,
    leaseExpiresAt: payload.leaseExpiresAt ?? null,
  } : null
}

export const saveRemoteSimulation = async (state, clientId = getPersistenceClientId()) => {
  const baseUrl = getRemoteBaseUrl()
  if (!baseUrl) return { status: 'local' }
  const snapshot = createSnapshot(state)
  const response = await fetch(`${baseUrl}/worlds/${encodeURIComponent(snapshot.worldId)}`, {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Earth-Client-Id': clientId,
    },
    body: JSON.stringify({
      expectedRevision: snapshot.revision,
      snapshot,
    }),
  })
  const payload = response.status === 204 ? {} : await response.json().catch(() => ({}))
  if (response.status === 409 || response.status === 423) {
    return {
      status: 'conflict',
      state: hydrateSnapshot(payload.snapshot ?? payload.currentSnapshot),
      isController: payload.isController === true,
      leaseExpiresAt: payload.leaseExpiresAt ?? null,
    }
  }
  if (!response.ok) throw new Error(`World save failed with status ${response.status}`)
  return {
    status: 'saved',
    revision: payload.revision ?? snapshot.revision + 1,
    isController: payload.isController !== false,
    leaseExpiresAt: payload.leaseExpiresAt ?? null,
  }
}

export const clearSimulation = () => {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(STORAGE_KEY)
}

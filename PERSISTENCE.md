# Earth 94 persistence contract

Earth 94 stores one authoritative, versioned world snapshot in Neon Postgres. The deployed Vite client talks to the same-origin Vercel API at `/api`; browser storage is only a local recovery cache.

## Storage model

A single database record is enough to begin:

| Column | Type | Purpose |
| --- | --- | --- |
| `id` | text, primary key | Stable world ID, currently `earth-94-main` |
| `revision` | bigint | Optimistic-lock revision |
| `snapshot` | JSON/JSONB | Complete versioned simulation snapshot |
| `updated_at` | timestamp | Last successful save |

The snapshot includes agents, names, genealogy, life stages, the synchronized calendar, learned memories, writings, wallets, fish inventories, household budgets, open market orders, price history, world tiles, nocturnal predators, society metrics, substrate state, and the simulation tick. Version-1 through version-6 saves are migrated to version 7 when loaded; crocodiles are added to legacy worlds and legacy road tiles are restored to ordinary land.

## HTTP API

### Load the continuing world

`GET /api/worlds/:worldId`

- Return `200` with either the snapshot directly or `{ "snapshot": <snapshot> }`.
- Return `404` when the world has not been created yet.

### Atomically save the world

`PUT /api/worlds/:worldId`

Request:

```json
{
  "expectedRevision": 12,
  "snapshot": {
    "version": 6,
    "worldId": "earth-94-main",
    "revision": 12
  }
}
```

The server must update the row only when its current revision equals `expectedRevision`, then increment the revision and return:

```json
{ "revision": 13 }
```

When no row exists yet, an `expectedRevision` of `0` creates revision `1`.

When another client saved first, return `409` with the current database snapshot:

```json
{ "snapshot": { "version": 6, "revision": 13 } }
```

This prevents an older browser tab from silently overwriting a newer world. Every request also carries a per-tab client ID. The API grants a short renewable controller lease to one browser: that browser advances and saves the simulation, while all other browsers poll and display the authoritative snapshot. If the controller disappears, an observing browser can claim the expired lease and continue the world.

`DATABASE_URL` is server-only. It must be configured in Vercel and must never use the `VITE_` prefix.

## A world that runs while nobody is watching

Database persistence preserves the latest state, but a browser simulation stops when every browser closes. To make Earth 94 continue in real time after deployment, run `runTick` in a single scheduled server worker, save through the same revision contract, and let browsers act as viewers/controllers. Only one worker should own ticking for a world at a time.

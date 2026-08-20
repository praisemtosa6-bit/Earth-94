# Earth 94 persistence contract

Earth 94 always saves a complete, versioned world snapshot in the browser. In a deployed build, set `VITE_WORLD_API_URL` to also synchronize that snapshot with a persistent database through the API below.

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

`GET /worlds/:worldId`

- Return `200` with either the snapshot directly or `{ "snapshot": <snapshot> }`.
- Return `404` when the world has not been created yet.

### Atomically save the world

`PUT /worlds/:worldId`

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

This prevents an older browser tab from silently overwriting a newer world. Authentication and write authorization should be enforced by the API, not embedded in Vite environment variables.

## A world that runs while nobody is watching

Database persistence preserves the latest state, but a browser simulation stops when every browser closes. To make Earth 94 continue in real time after deployment, run `runTick` in a single scheduled server worker, save through the same revision contract, and let browsers act as viewers/controllers. Only one worker should own ticking for a world at a time.

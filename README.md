# Earth 94

An evolving society simulation with autonomous agents, homeostatic needs, memory, learning, families, hierarchy, construction, cultural knowledge, written archives, daily shelter routines, and nocturnal wildlife.

People calculate when they must leave work to reach shelter before sunset, sleep indoors overnight, and return outside after dawn. Crocodiles emerge from shoreline dens at 10:00 PM, hunt exposed people until 4:00 AM, and then retreat to the water.

## Development

```bash
npm install
npm run dev
```

The deployed simulation uses the same-origin Vercel API and Neon Postgres as one shared, persistent world. One browser owns a short simulation lease while other browsers spectate the same database snapshot; ownership transfers automatically when the active browser leaves. Browser storage remains only as a recovery cache.

For local development, copy `.env.example` and provide `DATABASE_URL` through a Vercel-compatible development environment. See [PERSISTENCE.md](./PERSISTENCE.md) for the synchronization model.

## Checks

```bash
npm run lint
npm run build
```

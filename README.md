# Earth 94

An evolving society simulation with autonomous agents, homeostatic needs, memory, learning, families, hierarchy, construction, cultural knowledge, written archives, daily shelter routines, and nocturnal wildlife.

People calculate when they must leave work to reach shelter before sunset, sleep indoors overnight, and return outside after dawn. Crocodiles emerge from shoreline dens at 10:00 PM, hunt exposed people until 4:00 AM, and then retreat to the water.

## Development

```bash
npm install
npm run dev
```

The simulation saves automatically in the browser. To connect a deployed build to a shared persistent world, copy `.env.example`, set `VITE_WORLD_API_URL`, and implement the small versioned API described in [PERSISTENCE.md](./PERSISTENCE.md).

## Checks

```bash
npm run lint
npm run build
```

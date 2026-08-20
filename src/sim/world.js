import { TILE_TYPES, WORLD_SIZE } from './constants'
import { fbm } from './utils/noise'

const isWater = (tile) => tile?.type === 'water' && tile?.structure !== 'well'

const touchesWater = (world, tile) => {
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if ((dx !== 0 || dy !== 0) && isWater(getTileAt(world, tile.x + dx, tile.y + dy))) return true
    }
  }
  return false
}

export const ensureCoastalEconomy = (world) => {
  if (!Array.isArray(world) || world.length === 0) return world
  const hasBeaches = world.some((tile) => tile.type === 'beach')
  const alreadyReady = hasBeaches &&
    world.some((tile) => tile.structure === 'dock') &&
    world.every((tile) => (
      (tile.type !== 'beach' || (
        tile.fishCapacity !== undefined &&
        tile.fishStock !== undefined &&
        tile.affordances?.some((affordance) => affordance.tag === 'FISH')
      )) &&
      (tile.structure !== 'shop' || tile.affordances?.some((affordance) => affordance.tag === 'MARKET_FISH')) &&
      (tile.structure !== 'dock' || tile.affordances?.some((affordance) => affordance.tag === 'MARKET_FISH'))
    ))
  if (alreadyReady) return world

  let nextWorld = world.map((tile) => ({ ...tile, affordances: [...(tile.affordances ?? [])] }))

  if (!hasBeaches) {
    nextWorld = nextWorld.map((tile) => {
      const canBecomeBeach =
        tile.type !== 'water' &&
        !tile.structure &&
        tile.height >= 0.25 &&
        tile.height <= 0.62 &&
        touchesWater(nextWorld, tile)
      if (!canBecomeBeach) return tile
      const fishCapacity = 6 + Math.floor(((tile.moisture ?? 0.5) + tile.richness) * 5)
      return {
        ...tile,
        type: 'beach',
        richness: 1,
        fishCapacity,
        fishStock: fishCapacity,
        decorType: null,
        decorCount: 0,
        affordances: [{ tag: 'FISH', drive: 'enterprise', value: 52 }],
      }
    })
  }

  nextWorld = nextWorld.map((tile) => {
    if (tile.type === 'beach') {
      const fishCapacity = tile.fishCapacity ?? 10
      const fishStock = Math.min(fishCapacity, tile.fishStock ?? fishCapacity)
      const marketAffordance = tile.structure === 'dock'
        ? [{ tag: 'MARKET_FISH', drive: 'enterprise', value: 48 }]
        : []
      return {
        ...tile,
        fishCapacity,
        fishStock,
        richness: 1,
        affordances: [
          { tag: 'FISH', drive: 'enterprise', value: 52 },
          ...marketAffordance,
        ],
      }
    }
    if (tile.structure === 'shop') {
      return {
        ...tile,
        affordances: [{ tag: 'MARKET_FISH', drive: 'enterprise', value: 48 }],
      }
    }
    return tile
  })

  if (!nextWorld.some((tile) => tile.structure === 'dock')) {
    const center = WORLD_SIZE / 2
    const dockTile = nextWorld
      .filter((tile) => tile.type === 'beach' && !tile.structure)
      .sort((a, b) => (
        Math.abs(a.x - center) + Math.abs(a.y - center)
      ) - (
        Math.abs(b.x - center) + Math.abs(b.y - center)
      ))[0]
    if (dockTile) {
      const index = getTileIndex(dockTile.x, dockTile.y)
      nextWorld[index] = {
        ...dockTile,
        structure: 'dock',
        affordances: [
          { tag: 'FISH', drive: 'enterprise', value: 52 },
          { tag: 'MARKET_FISH', drive: 'enterprise', value: 60 },
        ],
      }
    }
  }

  return nextWorld
}

export const createWorld = () => {
  const world = []
  const seedHeight = Math.random() * 1000
  const seedMoisture = Math.random() * 1000
  const seedFault = Math.random() * 1000

  // Find Inaccessibility Pole
  const startX = Math.floor(WORLD_SIZE / 2);
  const startY = Math.floor(WORLD_SIZE / 2);
  let maxDist = -1;
  let poleX = 0, poleY = 0;

  for (let y = 0; y < WORLD_SIZE; y += 1) {
    for (let x = 0; x < WORLD_SIZE; x += 1) {
      // 1. Noise Layers
      const nx = x / 14.0, ny = y / 14.0;
      let height = (fbm(nx + seedHeight, ny + seedHeight, 4) + 1) / 2;
      let moisture = (fbm(nx + seedMoisture, ny + seedMoisture, 2) + 1) / 2;
      
      // Fault Lines (Ridges)
      const fault = Math.abs(fbm(nx * 2 + seedFault, ny * 2 + seedFault, 1));

      let type = 'empty', richness = 0.45, decorType = null, decorCount = 0, structure = null, affordances = [];
      let isAnomalous = false;

      // 2. Boundary & Biome Logic
      const isBoundary = x === 0 || y === 0 || x === WORLD_SIZE - 1 || y === WORLD_SIZE - 1;
      
      if (isBoundary) {
        type = 'water'; height = -0.1;
      } else if (height < 0.25) {
        type = 'water'; affordances = [{ tag: 'HYDRATE', drive: 'thirst', value: 20 }];
      } else if (height > 0.8 || fault < 0.05) {
        type = 'stone'; richness = 0.8; affordances = [{ tag: 'GATHER_STONE', drive: 'greed', value: 15 }];
      } else if (moisture > 0.65) {
        type = 'food'; richness = 0.9; affordances = [{ tag: 'CONSUME', drive: 'hunger', value: 30 }];
      } else if (moisture < 0.35 && height > 0.4) {
        type = 'wood'; decorType = 'tree'; decorCount = 1; affordances = [{ tag: 'GATHER_WOOD', drive: 'greed', value: 10 }];
      }

      // 3. Glitch Zones (Pattern Break)
      if (!isBoundary && height > 0.5 && height < 0.6 && moisture < 0.2) {
        const glitchNoise = Math.random();
        if (glitchNoise < 0.02) {
          isAnomalous = true;
          type = 'empty'; richness = 1.0;
        }
      }

      // Tracking Inaccessibility Pole
      const d = Math.sqrt((x - startX)**2 + (y - startY)**2);
      if (d > maxDist && !isBoundary && type !== 'water') {
        maxDist = d; poleX = x; poleY = y;
      }

      world.push({
        x, y, height, moisture, isAnomalous,
        type: TILE_TYPES.includes(type) ? type : 'empty',
        controllerId: null, richness, decorType, decorCount, structure, affordances,
      })
    }
  }

  // Inject Geothermal Vent at Inaccessibility Pole
  const poleIdx = poleY * WORLD_SIZE + poleX;
  world[poleIdx].structure = 'monolith';
  world[poleIdx].type = 'empty';
  world[poleIdx].richness = 5.0; // "High-Density Energy"
  world[poleIdx].affordances = [{ tag: 'TAP_ENERGY', drive: 'exhaustion', value: 100 }];

  // Central Starting House
  const startIdx = startY * WORLD_SIZE + startX;
  world[startIdx].structure = 'house';
  world[startIdx].type = 'empty';
  world[startIdx].affordances = [{ tag: 'SHELTER', drive: 'exhaustion', value: 60 }];

  // --- NEW: Starting Civilization (Central Square) ---
  // Add a shop near the center
  const shopIdx = getTileIndex(startX + 2, startY);
  world[shopIdx].structure = 'shop';
  world[shopIdx].type = 'shop';
  world[shopIdx].affordances = [{ tag: 'TRADE', drive: 'greed', value: 80 }];

  // Add a central well so the first settlement is survivable.
  const wellIdx = getTileIndex(startX - 2, startY);
  world[wellIdx].structure = 'well';
  world[wellIdx].type = 'water';
  world[wellIdx].height = 0.22;
  world[wellIdx].richness = 1.0;
  world[wellIdx].affordances = [{ tag: 'HYDRATE', drive: 'thirst', value: 45 }];

  return ensureCoastalEconomy(world)
}

export const removeRoads = (world) => world.map((tile) => {
  if (tile.type !== 'road' && tile.structure !== 'road') return tile
  const { ownerId: _ownerId, builtAt: _builtAt, ...landTile } = tile
  return {
    ...landTile,
    type: 'empty',
    structure: null,
    affordances: [],
    richness: Math.max(0.12, tile.richness ?? 0),
  }
})

export const getTileIndex = (x, y) => y * WORLD_SIZE + x
export const getTileAt = (world, x, y) => {
  if (x < 0 || y < 0 || x >= WORLD_SIZE || y >= WORLD_SIZE) return null;
  return world[getTileIndex(x, y)];
}

export const regenerateWorld = (world, elapsedTicks = 1) =>
  world.map((tile) => ({
    ...tile,
    richness: tile.structure === 'monolith'
      ? 5.0
      : Math.min(1.0, tile.richness + (0.005 + (tile.type === 'food' ? 0.005 : 0)) * elapsedTicks),
    fishStock: tile.type === 'beach'
      ? Math.min(tile.fishCapacity ?? 10, (tile.fishStock ?? tile.fishCapacity ?? 10) + 0.006 * elapsedTicks)
      : tile.fishStock,
  }))

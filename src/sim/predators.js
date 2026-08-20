import { WORLD_SIZE } from './constants'
import { getDayProgress, isNightTime } from './lifecycle'
import { getTileAt } from './world'
import { getAgentName } from './names'

export const CROCODILE_COUNT = 3

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const distanceBetween = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))
const DIRECTIONS = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
]

const adjacentTiles = (world, tile, type) => {
  const matches = []
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue
      const neighbor = getTileAt(world, tile.x + dx, tile.y + dy)
      if (neighbor?.type === type) matches.push(neighbor)
    }
  }
  return matches
}

const chooseDenTiles = (world, count) => {
  const shorelineWater = world.filter((tile) => (
    tile.type === 'water' && adjacentTiles(world, tile, 'beach').length > 0
  ))
  const candidates = shorelineWater.length > 0
    ? shorelineWater
    : world.filter((tile) => tile.type === 'water')
  if (candidates.length === 0) return []

  return Array.from({ length: Math.min(count, candidates.length) }, (_, index) => {
    const candidateIndex = Math.floor(((index + 0.5) / Math.min(count, candidates.length)) * candidates.length)
    return candidates[Math.min(candidates.length - 1, candidateIndex)]
  })
}

const nearestBeach = (world, den) => {
  const adjacent = adjacentTiles(world, den, 'beach')
  if (adjacent.length > 0) return adjacent[0]
  return world
    .filter((tile) => tile.type === 'beach')
    .sort((a, b) => distanceBetween(a, den) - distanceBetween(b, den))[0] ?? den
}

export const createPredators = (world, count = CROCODILE_COUNT) => (
  chooseDenTiles(world, count).map((den, index) => {
    const shore = nearestBeach(world, den)
    return {
      id: `CROC-${index + 1}`,
      species: 'crocodile',
      x: den.x,
      y: den.y,
      den: { x: den.x, y: den.y },
      shore: { x: shore.x, y: shore.y },
      state: 'IN_WATER',
      targetId: null,
      lastAttackTick: Number.NEGATIVE_INFINITY,
      facing: { dx: 0, dy: 1 },
    }
  })
)

export const normalizePredators = (predators, world) => {
  if (!Array.isArray(predators) || predators.length === 0) return createPredators(world)
  return predators.map((predator, index) => {
    const denTile = getTileAt(world, predator.den?.x, predator.den?.y)
    const fallback = chooseDenTiles(world, CROCODILE_COUNT)[index % CROCODILE_COUNT]
    const den = denTile?.type === 'water' ? predator.den : fallback ?? predator.den ?? { x: 0, y: 0 }
    const shore = predator.shore ?? nearestBeach(world, den)
    return {
      id: predator.id ?? `CROC-${index + 1}`,
      species: 'crocodile',
      x: clamp(predator.x ?? den.x, 0, WORLD_SIZE - 1),
      y: clamp(predator.y ?? den.y, 0, WORLD_SIZE - 1),
      den: { x: den.x, y: den.y },
      shore: { x: shore.x, y: shore.y },
      state: predator.state ?? 'IN_WATER',
      targetId: predator.targetId ?? null,
      lastAttackTick: predator.lastAttackTick ?? Number.NEGATIVE_INFINITY,
      facing: predator.facing ?? { dx: 0, dy: 1 },
    }
  })
}

const canCrocodileEnter = (tile) => Boolean(tile && tile.structure !== 'house')

const stepToward = (predator, target, world) => {
  let best = { x: predator.x, y: predator.y, distance: distanceBetween(predator, target) }
  for (const [dx, dy] of DIRECTIONS) {
    const x = clamp(predator.x + dx, 0, WORLD_SIZE - 1)
    const y = clamp(predator.y + dy, 0, WORLD_SIZE - 1)
    const tile = getTileAt(world, x, y)
    if (!canCrocodileEnter(tile)) continue
    const distance = distanceBetween({ x, y }, target)
    if (distance < best.distance) best = { x, y, distance }
  }
  return {
    ...predator,
    x: best.x,
    y: best.y,
    facing: { dx: Math.sign(best.x - predator.x), dy: Math.sign(best.y - predator.y) },
  }
}

const patrolShore = (predator, world, tick, index) => {
  if (getTileAt(world, predator.x, predator.y)?.type === 'water') {
    return { ...stepToward(predator, predator.shore, world), state: 'EMERGING', targetId: null }
  }

  const direction = DIRECTIONS[(Math.floor(tick / 3) + index * 3) % DIRECTIONS.length]
  const x = clamp(predator.x + direction[0], 0, WORLD_SIZE - 1)
  const y = clamp(predator.y + direction[1], 0, WORLD_SIZE - 1)
  const tile = getTileAt(world, x, y)
  if (
    canCrocodileEnter(tile) &&
    tile.type !== 'water' &&
    distanceBetween({ x, y }, predator.shore) <= 6
  ) {
    return {
      ...predator,
      x,
      y,
      state: 'PROWLING',
      targetId: null,
      facing: { dx: direction[0], dy: direction[1] },
    }
  }
  return { ...stepToward(predator, predator.shore, world), state: 'PROWLING', targetId: null }
}

const retreatToWater = (predator, world) => {
  let next = stepToward(predator, predator.den, world)
  if (distanceBetween(next, predator.den) > 0) next = stepToward(next, predator.den, world)
  const reachedDen = distanceBetween(next, predator.den) === 0
  return {
    ...next,
    state: reachedDen ? 'IN_WATER' : 'RETREATING',
    targetId: null,
  }
}

export const runPredators = (predators, agents, world, tick, calendar) => {
  const night = isNightTime(tick, calendar)
  const wasNight = isNightTime(tick - 1, calendar)
  const nextAgents = agents.map((agent) => ({
    ...agent,
    chemistry: { ...agent.chemistry },
    lifecycle: { ...agent.lifecycle },
  }))
  const byId = new Map(nextAgents.map((agent) => [agent.id, agent]))
  const events = []
  let attacks = 0
  const claimedTargets = new Set()

  const nextPredators = normalizePredators(predators, world).map((original, index) => {
    if (!night) return retreatToWater(original, world)

    const exposed = nextAgents
      .filter((agent) => agent.health > 0 && !agent.indoors)
      .map((agent) => ({ agent, distance: distanceBetween(original, agent) }))
      .sort((a, b) => (
        (claimedTargets.has(a.agent.id) ? 1000 : 0) + a.distance
      ) - (
        (claimedTargets.has(b.agent.id) ? 1000 : 0) + b.distance
      ))
    const target = exposed[0]?.agent
    if (!target) return patrolShore(original, world, tick, index)

    claimedTargets.add(target.id)
    let predator = stepToward(original, target, world)
    predator = { ...predator, state: 'HUNTING', targetId: target.id }
    const currentTarget = byId.get(target.id)
    if (
      currentTarget &&
      !currentTarget.indoors &&
      distanceBetween(predator, currentTarget) <= 1 &&
      tick - predator.lastAttackTick >= 9
    ) {
      const damage = 18 + ((tick + index * 7) % 9)
      currentTarget.health = Math.max(0, currentTarget.health - damage)
      currentTarget.chemistry.cortisol = 1
      currentTarget.state = 'FLEEING_CROCODILE'
      currentTarget.monologue = currentTarget.health <= 0
        ? 'The crocodile reached me before I could reach shelter.'
        : 'A crocodile is on the shore. I have to reach shelter now.'
      currentTarget.lifecycle = {
        ...currentTarget.lifecycle,
        lastPredatorAttackTick: tick,
        causeOfDeath: currentTarget.health <= 0 ? 'crocodile attack' : currentTarget.lifecycle?.causeOfDeath ?? null,
      }
      predator.lastAttackTick = tick
      attacks += 1
      events.push(`Tick ${tick}: ${getAgentName(currentTarget)} was attacked by a crocodile while exposed after dark`)
    }
    return predator
  })

  if (night && !wasNight) events.unshift(`Tick ${tick}: Night fell and ${nextPredators.length} crocodiles emerged from the water`)
  if (!night && wasNight) events.unshift(`Tick ${tick}: Dawn broke and the crocodiles retreated toward the water`)

  return {
    predators: nextPredators,
    agents: nextAgents.map((agent) => byId.get(agent.id) ?? agent),
    events,
    attacks,
    night,
    dayProgress: getDayProgress(tick, calendar),
  }
}

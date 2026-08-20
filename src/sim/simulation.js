import { AGENT_COUNT, WORLD_SIZE, HOUSE_COST, SHOP_COST } from './constants'
import { createAgents, createOffspring } from './agents'
import { createEconomyState, normalizeEconomicAgent, runFishMarket } from './economy'
import { ensureAgentIdentities, getAgentName } from './names'
import { createPredators, normalizePredators, runPredators } from './predators'
import { createWorld, ensureCoastalEconomy, getTileAt, regenerateWorld, removeRoads } from './world'
import { SubstrateManager } from './substrateManager'
import {
  assignHierarchy,
  formHouseholds,
  getCarryingCapacity,
  getHouseholdCount,
} from './society'
import {
  exchangeWrittenKnowledge,
  maybeAuthorArtifact,
  pruneArchive,
} from './archive'
import {
  createLocalThought,
  getKnowledgeScore,
  normalizeMemory,
  recallBelievedStimuli,
  recordEpisode,
  shareKnowledge,
  updatePerceptionMemory,
} from './brain'
import {
  TICKS_PER_YEAR,
  YEARS_PER_TICK,
  canPursueActionAtAge,
  createLifeCalendar,
  getDayProgress,
  getLifeStage,
  isNightTime,
  migrateLifeCalendar,
  normalizeLifecycleAgent,
} from './lifecycle'

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const ONE_SHOT_ACTIONS = new Set([
  'BUILD_HOUSE',
  'BUILD_SHOP',
  'GATHER_STONE',
  'GATHER_WOOD',
  'FISH',
  'MARKET_FISH',
  'SOCIALIZE',
  'TRADE',
  'EXPLORE',
])

const getTileKey = (x, y) => `${x},${y}`

const stablePairOffset = (idA, idB, range) => {
  const text = [idA, idB].sort().join(':')
  let hash = 0
  for (let index = 0; index < text.length; index += 1) hash = (hash * 33 + text.charCodeAt(index)) >>> 0
  return hash % range
}

const indexAgentsByTile = (agents) => {
  const index = new Map()
  for (const agent of agents) {
    const key = getTileKey(agent.x, agent.y)
    const occupants = index.get(key) ?? []
    occupants.push(agent)
    index.set(key, occupants)
  }
  return index
}

const sameHome = (agentA, agentB) => (
  agentA.home && agentB.home && agentA.home.x === agentB.home.x && agentA.home.y === agentB.home.y
)

const findNightShelter = (agent, world, agentsById, houses) => {
  const householdHomes = [
    agent.home,
    agentsById.get(agent.family?.partnerId)?.home,
    ...(agent.family?.parentIds ?? []).map((id) => agentsById.get(id)?.home),
  ].filter(Boolean)
  const householdShelter = householdHomes.find((home) => getTileAt(world, home.x, home.y)?.structure === 'house')
  if (householdShelter) return { x: householdShelter.x, y: householdShelter.y, kind: 'home' }

  const nearest = houses
    .slice()
    .sort((a, b) => (
      Math.max(Math.abs(agent.x - a.x), Math.abs(agent.y - a.y))
      - Math.max(Math.abs(agent.x - b.x), Math.abs(agent.y - b.y))
    ))[0]
  return nearest ? { x: nearest.x, y: nearest.y, kind: 'shared shelter' } : null
}

const runGenerationalTeaching = (agents, tick) => {
  if (tick <= 0) return { agents, events: [], familyTeachings: 0, elderTeachings: 0 }
  const byId = new Map(agents.map((agent) => [agent.id, agent]))
  const events = []
  let familyTeachings = 0
  let elderTeachings = 0

  if (tick % 160 === 0) {
    for (const originalChild of agents.filter((agent) => agent.age < 18)) {
      const child = byId.get(originalChild.id)
      const parents = (child.family?.parentIds ?? []).map((id) => byId.get(id)).filter(Boolean)
      const teacher = parents
        .filter((parent) => sameHome(parent, child) || Math.max(Math.abs(parent.x - child.x), Math.abs(parent.y - child.y)) <= 8)
        .sort((a, b) => getKnowledgeScore(b) - getKnowledgeScore(a))[0]
      if (!teacher) continue
      const taughtChild = shareKnowledge(child, teacher, tick)
      taughtChild.relationships = {
        ...taughtChild.relationships,
        [teacher.id]: Math.min(1, (taughtChild.relationships?.[teacher.id] ?? 0.7) + 0.03),
      }
      taughtChild.lifecycle = { ...taughtChild.lifecycle, lastFamilyTeachingTick: tick }
      taughtChild.state = 'LEARNING_FROM_FAMILY'
      taughtChild.monologue = `${getAgentName(teacher)} is teaching me what our family has learned.`
      byId.set(child.id, taughtChild)
      familyTeachings += 1
      if (tick % 800 === 0) events.push(`Tick ${tick}: ${getAgentName(teacher)} passed family knowledge to ${getAgentName(child)}`)
    }
  }

  if (tick % 320 === 0) {
    const elders = agents.filter((agent) => agent.age >= 60).sort((a, b) => getKnowledgeScore(b) - getKnowledgeScore(a))
    const taughtThisTick = new Set()
    for (const elder of elders) {
      const candidates = agents
        .filter((agent) => agent.id !== elder.id && agent.age >= 12 && agent.age < 60 && !taughtThisTick.has(agent.id))
        .map((agent) => ({
          agent,
          kin: (elder.family?.childrenIds ?? []).includes(agent.id) || (agent.family?.parentIds ?? []).includes(elder.id) ? 1 : 0,
          relationship: elder.relationships?.[agent.id] ?? agent.relationships?.[elder.id] ?? 0,
          distance: Math.max(Math.abs(elder.x - agent.x), Math.abs(elder.y - agent.y)),
        }))
        .filter((entry) => entry.kin || entry.relationship >= 0.3 || entry.distance <= 6)
        .sort((a, b) => (b.kin * 2 + b.relationship - b.distance * 0.03) - (a.kin * 2 + a.relationship - a.distance * 0.03))
      const receiver = candidates[0]?.agent
      if (!receiver) continue
      const currentReceiver = byId.get(receiver.id)
      const taughtReceiver = shareKnowledge(currentReceiver, elder, tick)
      taughtReceiver.lifecycle = { ...taughtReceiver.lifecycle, lastElderTeachingTick: tick }
      byId.set(receiver.id, taughtReceiver)
      taughtThisTick.add(receiver.id)
      elderTeachings += 1
      if (tick % 960 === 0) events.push(`Tick ${tick}: elder ${getAgentName(elder)} entrusted knowledge to ${getAgentName(receiver)}`)
    }
  }

  return { agents: agents.map((agent) => byId.get(agent.id)), events, familyTeachings, elderTeachings }
}

const settleDeaths = (agents, world, economy, tick) => {
  const deceased = agents.filter((agent) => agent.health <= 0)
  if (deceased.length === 0) return { agents, world, economy, events: [], inheritances: 0, widowhoods: 0 }
  const living = agents.filter((agent) => agent.health > 0).map((agent) => ({
    ...agent,
    resources: { ...agent.resources },
    family: { ...agent.family },
    lifecycle: { ...agent.lifecycle },
  }))
  const byId = new Map(living.map((agent) => [agent.id, agent]))
  let nextWorld = world
  let nextEconomy = { ...economy }
  const events = []
  let inheritances = 0
  let widowhoods = 0

  for (const person of deceased) {
    const heirIds = [
      person.family?.partnerId,
      ...(person.family?.childrenIds ?? []),
      ...(person.family?.parentIds ?? []),
    ].filter((id, index, ids) => id && byId.has(id) && ids.indexOf(id) === index)
    const heirs = heirIds.map((id) => byId.get(id))

    if (heirs.length > 0) {
      for (const heir of heirs) {
        const inheritedResources = Object.fromEntries(Object.entries(person.resources).map(([key, value]) => [key, value / heirs.length]))
        heir.resources = Object.fromEntries(Object.keys({ ...heir.resources, ...inheritedResources }).map((key) => [
          key,
          (heir.resources[key] ?? 0) + (inheritedResources[key] ?? 0),
        ]))
        heir.lifecycle = {
          ...heir.lifecycle,
          inheritedFromIds: [...new Set([...(heir.lifecycle?.inheritedFromIds ?? []), person.id])],
        }
        inheritances += 1
      }
      events.push(`Tick ${tick}: ${getAgentName(person)} died; their estate passed to ${heirs.map(getAgentName).join(' and ')}`)
    } else {
      nextEconomy.marketTreasury = (nextEconomy.marketTreasury ?? 0) + (person.resources.coins ?? 0)
      nextEconomy.spoiledFish = (nextEconomy.spoiledFish ?? 0) + (person.resources.fish ?? 0)
      events.push(`Tick ${tick}: ${getAgentName(person)} died without a living heir; their coins entered the public treasury`)
    }

    const survivingPartner = person.family?.partnerId ? byId.get(person.family.partnerId) : null
    if (survivingPartner) {
      survivingPartner.family = { ...survivingPartner.family, partnerId: null, expectingBirthTick: null }
      survivingPartner.lifecycle = {
        ...survivingPartner.lifecycle,
        widowedAt: tick,
        formerPartnerIds: [...new Set([...(survivingPartner.lifecycle?.formerPartnerIds ?? []), person.id])],
      }
      survivingPartner.state = 'GRIEVING'
      survivingPartner.monologue = `${getAgentName(person)} is gone. Their memory remains part of how I understand this world.`
      widowhoods += 1
    }

    const inheritedOwner = heirs[0] ?? null
    nextWorld = nextWorld.map((tile) => {
      if (tile.ownerId !== person.id) return tile
      const inheritedTile = { ...tile, ownerId: inheritedOwner?.id ?? null }
      if (inheritedOwner && tile.structure === 'house') inheritedOwner.home = { x: tile.x, y: tile.y, builtAt: tile.builtAt }
      return inheritedTile
    })
  }

  return { agents: living, world: nextWorld, economy: nextEconomy, events, inheritances, widowhoods }
}

// --- The Cognitive Engine Modules ---

// 1. Thalamus (Perception)
const performSensoryScan = (agent, world, agentsByTile, tick) => {
  const stimuli = []
  const observedTileKeys = new Set()
  const actionCounts = agent.memory?.actionCounts ?? {}
  const lastActions = agent.memory?.lastActions ?? {}
  const homeTile = agent.home ? getTileAt(world, agent.home.x, agent.home.y) : null
  const hasHome = homeTile?.structure === 'house'
  const needsHouseholdHome = !hasHome || (
    agent.age >= 18 &&
    agent.family?.partnerId &&
    homeTile.ownerId !== agent.id &&
    homeTile.ownerId !== agent.family.partnerId
  )
  // Height bonus: Advantage of being on a hill (1 + floor(height * 4))
  const heightBonus = Math.floor((agent.height ?? 0.5) * 5)
  const range = agent.visionRange + heightBonus
  
  // High cortisol reduces tunnel vision slightly, but not as much as before
  const effectiveR = Math.max(2, Math.floor(range * (1 - (agent.chemistry.cortisol * 0.2))));
  
  for (let dy = -effectiveR; dy <= effectiveR; dy++) {
    for (let dx = -effectiveR; dx <= effectiveR; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > effectiveR * 1.5) continue;
      
      const px = agent.x + dx;
      const py = agent.y + dy;
      if (px >= 0 && px < WORLD_SIZE && py >= 0 && py < WORLD_SIZE) {
            const tile = getTileAt(world, px, py);
            if (tile) {
               observedTileKeys.add(getTileKey(px, py));
               const agentsAtTile = (agentsByTile.get(getTileKey(px, py)) ?? []).filter(a => a.id !== agent.id);
               const isOccupied = agentsAtTile.length > 0;
               // Normal Affordances
               if (tile.richness > 0.05 && tile.affordances && tile.affordances.length > 0) {
                  for (const affordance of tile.affordances) {
                     const lastActionTick = lastActions[affordance.tag] ?? Number.NEGATIVE_INFINITY
                     const cooldown = affordance.tag === 'FISH' ? 18 : affordance.tag === 'MARKET_FISH' ? 80 : 0
                     if ((affordance.tag !== 'FISH' || agent.age >= 12) && lastActionTick + cooldown <= tick) {
                        stimuli.push({ x: px, y: py, type: tile.type, height: tile.height, affordance });
                     }
                  }
               }
               // "Building" Affordance: If agent has materials, can build on empty/land tiles
               if (
                 !isOccupied &&
                 needsHouseholdHome &&
                 agent.age >= 16 &&
                 agent.resources.materials >= HOUSE_COST &&
                 ((lastActions.BUILD_HOUSE ?? Number.NEGATIVE_INFINITY) + 200 <= tick) &&
                 (tile.type === 'empty' || tile.type === 'stone' || tile.type === 'wood') &&
                 !tile.structure
               ) {
                  stimuli.push({ 
                    x: px, y: py, type: tile.type, 
                    affordance: { tag: 'BUILD_HOUSE', drive: 'housing', value: 85, urgentHousing: true }
                  });
               }
               // "Shop" Affordance: Higher cost, provides trade location
               if (
                 !isOccupied &&
                 agent.age >= 18 &&
                 (actionCounts.BUILD_SHOP ?? 0) < 1 &&
                 agent.resources.materials >= SHOP_COST &&
                 agent.resources.food >= 8 &&
                 tile.type === 'empty' &&
                 !tile.structure
               ) {
                  stimuli.push({
                     x: px, y: py, type: tile.type,
                     affordance: { tag: 'BUILD_SHOP', drive: 'greed', value: 30 }
                  });
               }
               // Detect Other Agents
               if (agent.drives.isolation > 0.25 || (agent.age >= 18 && !agent.family?.partnerId)) {
                  for (const other of agentsAtTile) {
                     const relationship = agent.relationships?.[other.id] ?? 0
                     const partnerBonus = agent.family?.partnerId === other.id ? 35 : 0
                     const statusBonus = clamp((other.status?.score ?? 0) * 0.2, 0, 18)
                     stimuli.push({
                        x: px, y: py, type: 'agent', targetId: other.id,
                        affordance: { tag: 'SOCIALIZE', drive: 'isolation', value: 30 + relationship * 25 + partnerBonus + statusBonus }
                     });
                  }
               }
            }
      }
    }
  }
  return { stimuli, observedTileKeys };
}

// 2. Amygdala/Striatum (Valuation Scorer)
const scoreUtility = (agent, affordance, distance, targetHeight, dayProgress, world, beliefConfidence = 1) => {
   let driveWeight = 0.1; // Baseline curiosity
   
   if (affordance.drive === 'hunger') driveWeight = agent.drives.hunger; // 0 to 1
   else if (affordance.drive === 'thirst') driveWeight = agent.drives.thirst;
   else if (affordance.drive === 'greed') driveWeight = agent.dna.greed * (1 - clamp(agent.resources.materials / 30, 0, 1));
   else if (affordance.drive === 'exhaustion') driveWeight = agent.drives.exhaustion;
   else if (affordance.drive === 'isolation') driveWeight = agent.drives.isolation;
   else if (affordance.drive === 'curiosity') driveWeight = 0.25 + agent.dna.curiosity * 0.75;
   else if (affordance.drive === 'housing') driveWeight = affordance.urgentHousing ? 1 : agent.home ? 0.05 : 1;
   else if (affordance.drive === 'enterprise') {
      driveWeight = Math.max(agent.drives.hunger * 0.8, agent.dna.greed * 0.55 + agent.dna.intelligence * 0.2)
   }
   
   // Utility = (Drive x Weight) + Affordance Value - Distance Cost - Slope Penalty
   // High Cortisol causes higher perceived distance cost (stress avoidance)
   const distanceCost = distance * (2 + (agent.chemistry.cortisol * 2)); 
   
   // Circadian Rhythm: At night, agents value shelter much more
   const isNight = dayProgress < 0.25 || dayProgress >= 0.75;
   const isDawn = dayProgress >= 0.25 && dayProgress < 0.34;

   let utility = (driveWeight * affordance.value);
   // Reinforcement memory nudges choices toward actions that worked for this agent.
   utility += clamp(agent.memory?.actionValues?.[affordance.tag] ?? 0, -6, 6) * 4;
   const survivalPressure = Math.max(agent.drives.hunger, agent.drives.thirst, agent.drives.exhaustion);

   if (isNight) {
      if (affordance.tag === 'SHELTER') utility *= 3.0; // Seek bed at night
      else utility *= 0.5; // Less likely to forage in the dark
   } else if (isDawn) {
      // Extra drive in the morning to get to work
      if (affordance.tag !== 'SHELTER') utility *= 1.5;
   }

   if (affordance.tag === 'HYDRATE' && agent.drives.thirst > 0.45) {
      utility += (agent.drives.thirst - 0.45) * 160;
   }

   if (affordance.tag === 'CONSUME' && agent.drives.hunger > 0.5) {
      utility += (agent.drives.hunger - 0.5) * 120;
   }

   if (affordance.tag === 'SHELTER' && agent.drives.exhaustion > 0.65) {
      utility += (agent.drives.exhaustion - 0.65) * 100;
   }

   if (survivalPressure > 0.55 && (affordance.tag.startsWith('BUILD_') || affordance.tag === 'SOCIALIZE' || affordance.tag === 'MARKET_FISH')) {
      const housingException = affordance.tag === 'BUILD_HOUSE' && affordance.urgentHousing
      utility -= survivalPressure * (housingException ? 30 : 120);
   }

   if (affordance.tag === 'EXPLORE') {
      utility += 25 + (agent.dna.curiosity + agent.dna.intelligence) * 20;
   }

   if (affordance.tag === 'BUILD_HOUSE' && affordance.urgentHousing) {
      utility += 45 + agent.dna.intelligence * 15;
   }

   if (affordance.tag === 'BUILD_SHOP' && (agent.resources.food < 8 || agent.resources.materials < SHOP_COST + 6)) {
      utility -= 45;
   }

   if (affordance.tag === 'FISH') {
      utility += (7 - clamp(agent.resources.fish, 0, 7)) * 5
      if (agent.age < 12 || agent.resources.fish >= 10) utility -= 120
   }

   if (affordance.tag === 'MARKET_FISH') {
      const hasSurplus = agent.resources.fish > 2
      const needsFish = agent.resources.fish < 3 && (agent.drives.hunger > 0.38 || agent.resources.food < 3) && agent.resources.coins > 0
      utility += hasSurplus ? 65 + agent.dna.greed * 20 : needsFish ? 55 + agent.drives.hunger * 55 : -90
   }

   // --- NEW: Shelter Satiation ---
   // If agent is well-rested, the house becomes unattractive
   if (affordance.tag === 'SHELTER' && agent.drives.exhaustion < 0.2) {
      utility -= 50; 
   }

   // --- NEW: Community Bonus ---
   // Agents prefer building near other structures (Homes, Shops)
   if (affordance.tag === 'BUILD_HOUSE' || affordance.tag === 'BUILD_SHOP') {
      let structureCount = 0;
      for (let dy = -2; dy <= 2; dy++) {
         for (let dx = -2; dx <= 2; dx++) {
            const nearTile = getTileAt(world, agent.x + dx, agent.y + dy);
            if (nearTile?.structure) structureCount++;
         }
      }
      utility += structureCount * 5; // Preference for building near others
   }

   // Slope Penalty: Reduced from 20 to 10 to prevent traps
   // Also, ignore slope penalty if we are currently at a very low height (trying to get out of water)
   const currentHeight = agent.height ?? 0.5;
   const slopePenalty = currentHeight < 0.2 ? 0 : Math.abs(targetHeight - currentHeight) * 10;
   
   // Water Avoidance: Unless thirsty, water tiles have a negative utility
   const waterPenalty = (affordance.tag !== 'HYDRATE' && targetHeight < 0.25) ? 15 : 0;

   // Preserve short-term commitment to the locally selected strategic goal.
   if (agent.strategicGoal && affordance.tag.includes(agent.strategicGoal.type)) {
      utility += (agent.strategicGoal.priority || 1.0) * 50; // Give a massive boost to the plan
   }

   const uncertaintyCost = (1 - beliefConfidence) * 28;
   utility -= (distanceCost + slopePenalty + waterPenalty + uncertaintyCost);
   return utility;
}

const getExplorationStimulus = (agent, tick, emergencyAction = null) => {
  const survivalPressure = Math.max(agent.drives.hunger, agent.drives.thirst, agent.drives.exhaustion)
  if (!emergencyAction && (survivalPressure > 0.48 || agent.drives.isolation > 0.7)) return null

  const memory = agent.memory?.exploration
  const needsNewTarget =
    !memory ||
    tick >= (memory.arriveBy ?? 0) ||
    (agent.x === memory.x && agent.y === memory.y)

  if (!needsNewTarget) {
    return {
      x: memory.x,
      y: memory.y,
      type: 'empty',
      affordance: {
        tag: 'EXPLORE',
        drive: emergencyAction === 'HYDRATE' ? 'thirst' : emergencyAction === 'CONSUME' ? 'hunger' : 'curiosity',
        value: emergencyAction ? 90 : 45,
      },
      source: 'memory',
      searchingFor: emergencyAction,
    }
  }

  const angle = ((tick * 0.017) + agent.dna.curiosity * Math.PI * 2 + agent.dna.intelligence * 1.7) % (Math.PI * 2)
  const radius = 5 + Math.floor(agent.dna.curiosity * 8)
  const x = clamp(Math.round(agent.x + Math.cos(angle) * radius), 1, WORLD_SIZE - 2)
  const y = clamp(Math.round(agent.y + Math.sin(angle) * radius), 1, WORLD_SIZE - 2)

  return {
    x,
    y,
    type: 'empty',
    affordance: {
      tag: 'EXPLORE',
      drive: emergencyAction === 'HYDRATE' ? 'thirst' : emergencyAction === 'CONSUME' ? 'hunger' : 'curiosity',
      value: emergencyAction ? 90 : 45,
    },
    arriveBy: tick + 80,
    searchingFor: emergencyAction,
  }
}

const isTargetSatisfied = (agent, affordance) => {
  if (!affordance) return true
  if (ONE_SHOT_ACTIONS.has(affordance.tag)) return false
  if (affordance.tag === 'HYDRATE') return agent.drives.thirst < 0.25
  if (affordance.tag === 'CONSUME') return agent.drives.hunger < 0.35
  if (affordance.tag === 'SHELTER' || affordance.tag === 'TAP_ENERGY') return agent.drives.exhaustion < 0.25
  return false
}

const canExecuteTarget = (agent, target, tile, agentsByTile) => {
  if (!tile || !target?.affordance) return false

  switch (target.affordance.tag) {
    case 'BUILD_HOUSE':
      return agent.age >= 16 && !tile.structure && agent.resources.materials >= HOUSE_COST
    case 'BUILD_SHOP':
      return agent.age >= 18 && !tile.structure && tile.type === 'empty' && agent.resources.materials >= SHOP_COST && agent.resources.food >= 8
    case 'SOCIALIZE':
      return (agentsByTile.get(getTileKey(target.x, target.y)) ?? []).some(other => other.id === target.targetId && other.health > 0)
    case 'FISH':
      return tile.type === 'beach' && agent.age >= 12 && (tile.fishStock ?? 0) >= 1 && agent.resources.fish < 10
    case 'MARKET_FISH':
      return agent.age >= 14 && (tile.structure === 'dock' || tile.structure === 'shop') && (
        agent.resources.fish > 2 ||
        (agent.resources.fish < 3 && agent.resources.coins > 0 && (agent.drives.hunger > 0.38 || agent.resources.food < 3))
      )
    case 'EXPLORE':
      return true
    default:
      return tile.richness > 0.05 && tile.affordances?.some(affordance => affordance.tag === target.affordance.tag)
  }
}

const calculateActionReward = (before, after, action) => {
  const beforePressure = before.drives.hunger + before.drives.thirst + before.drives.exhaustion + before.drives.isolation
  const afterPressure = after.drives.hunger + after.drives.thirst + after.drives.exhaustion + after.drives.isolation
  const relief = (beforePressure - afterPressure) * 8
  const dopamine = (after.chemistry.dopamine - before.chemistry.dopamine) * 4
  const productiveBonus = action.startsWith('BUILD_') ? 3 : action.startsWith('GATHER_') ? 2 : 0
  return clamp(1 + relief + dopamine + productiveBonus, -10, 10)
}

const chooseStepToward = (agent, target, world) => {
  const dirs = [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ]
  let bestStep = { dx: 0, dy: 0 }
  let bestScore = Number.POSITIVE_INFINITY

  for (const [dx, dy] of dirs) {
    const x = clamp(agent.x + dx, 0, WORLD_SIZE - 1)
    const y = clamp(agent.y + dy, 0, WORLD_SIZE - 1)
    const tile = getTileAt(world, x, y)
    if (!tile) continue

    const isTarget = x === target.x && y === target.y
    const isEdge = x === 0 || y === 0 || x === WORLD_SIZE - 1 || y === WORLD_SIZE - 1
    if (isEdge && tile.type === 'water') continue
    if (!isTarget && tile.type === 'water' && target.affordance.tag !== 'HYDRATE') continue

    const distance = Math.max(Math.abs(target.x - x), Math.abs(target.y - y))
    const heightDiff = Math.max(0, (tile.height ?? 0.5) - (agent.height ?? 0.5))
    const waterPenalty = tile.type === 'water' && target.affordance.tag !== 'HYDRATE' ? 10 : 0
    const score = distance + heightDiff * 5 + waterPenalty

    if (score < bestScore) {
      bestScore = score
      bestStep = { dx, dy }
    }
  }

  return bestStep
}

// Apply Affordances (Environment Acting on Agent)
const applyAffordance = (agent, affordance, tile) => {
  const nextAgent = { ...agent, chemistry: { ...agent.chemistry }, drives: { ...agent.drives }, resources: { ...agent.resources } };
  
  if (affordance.tag === 'CONSUME') {
     nextAgent.drives.hunger = clamp(nextAgent.drives.hunger - 0.7, 0, 1); // More filling
     nextAgent.resources.food += 2; // Gain food units to store for mating
     nextAgent.chemistry.dopamine = clamp(nextAgent.chemistry.dopamine + 0.3, 0, 1);
     nextAgent.chemistry.cortisol = clamp(nextAgent.chemistry.cortisol - 0.1, 0, 1);
  } 
  else if (affordance.tag === 'HYDRATE') {
     nextAgent.drives.thirst = clamp(nextAgent.drives.thirst - 0.7, 0, 1);
     nextAgent.chemistry.cortisol = clamp(nextAgent.chemistry.cortisol - 0.1, 0, 1);
  }
  else if (affordance.tag === 'GATHER_STONE' || affordance.tag === 'GATHER_WOOD') {
     nextAgent.resources.materials += 2; // Increased from 1
     nextAgent.drives.exhaustion = clamp(nextAgent.drives.exhaustion + 0.04, 0, 1);
     nextAgent.chemistry.dopamine = clamp(nextAgent.chemistry.dopamine + 0.1, 0, 1);
  }
  else if (affordance.tag === 'FISH') {
     const practice = nextAgent.memory?.actionCounts?.FISH ?? 0
     const skillBonus = Math.floor(practice / 8)
     const aptitudeBonus = Math.random() < (nextAgent.dna.intelligence * 0.35 + nextAgent.dna.curiosity * 0.2) ? 1 : 0
     const catchSize = Math.min(Math.floor(tile?.fishStock ?? 0), 1 + Math.min(2, skillBonus) + aptitudeBonus)
     nextAgent.resources.fish += catchSize
     nextAgent.economic = {
       ...nextAgent.economic,
       fishCaught: (nextAgent.economic?.fishCaught ?? 0) + catchSize,
     }
     nextAgent.lastCatch = catchSize
     nextAgent.drives.exhaustion = clamp(nextAgent.drives.exhaustion + 0.06, 0, 1)
     nextAgent.chemistry.dopamine = clamp(nextAgent.chemistry.dopamine + 0.08 + catchSize * 0.03, 0, 1)
  }
  else if (affordance.tag === 'SHELTER') {
     nextAgent.drives.exhaustion = clamp(nextAgent.drives.exhaustion - 0.4, 0, 1);
     nextAgent.chemistry.cortisol = clamp(nextAgent.chemistry.cortisol - 0.3, 0, 1);
  }
  else if (affordance.tag === 'TAP_ENERGY') {
     nextAgent.drives.exhaustion = clamp(nextAgent.drives.exhaustion - 0.8, 0, 1);
     nextAgent.chemistry.dopamine = clamp(nextAgent.chemistry.dopamine + 0.4, 0, 1);
     nextAgent.chemistry.cortisol = clamp(nextAgent.chemistry.cortisol - 0.2, 0, 1);
  }
  else if (affordance.tag === 'BUILD_HOUSE') {
     nextAgent.resources.materials -= HOUSE_COST;
     nextAgent.drives.exhaustion = clamp(nextAgent.drives.exhaustion + 0.1, 0, 1);
     nextAgent.justBuilt = 'house'; 
  }
  else if (affordance.tag === 'BUILD_SHOP') {
     nextAgent.resources.materials -= SHOP_COST;
     nextAgent.drives.exhaustion = clamp(nextAgent.drives.exhaustion + 0.2, 0, 1);
     nextAgent.justBuilt = 'shop';
  }
  else if (affordance.tag === 'MARKET_FISH') {
     nextAgent.marketIntent = 'fish'
     nextAgent.chemistry.dopamine = clamp(nextAgent.chemistry.dopamine + 0.04, 0, 1)
  }
  else if (affordance.tag === 'SOCIALIZE') {
     nextAgent.drives.isolation = clamp(nextAgent.drives.isolation - 0.5, 0, 1);
     nextAgent.chemistry.oxytocin = clamp(nextAgent.chemistry.oxytocin + 0.2, 0, 1);
     nextAgent.chemistry.dopamine = clamp(nextAgent.chemistry.dopamine + 0.1, 0, 1);
  }
  return nextAgent;
}

export const createInitialState = () => {
  const world = createWorld()

  return {
    worldId: 'earth-94-main',
    revision: 0,
    tick: 0,
    calendar: createLifeCalendar(),
    world,
    agents: createAgents(AGENT_COUNT, world),
    predators: createPredators(world),
    archive: [],
    economy: createEconomyState(),
    substrate: new SubstrateManager(WORLD_SIZE),
    metrics: {
      highestCortisol: 0,
      events: ['Local cognitive simulation initialized', 'Persistent episodic learning active', 'Civilization era: Island settlement established'],
      totalBirths: 0,
      totalDeaths: 0,
      totalMatings: 0,
      birthsThisTick: 0,
      deathsThisTick: 0,
      households: 0,
      carryingCapacity: AGENT_COUNT + 4,
      leaderId: null,
      familyTeachings: 0,
      elderTeachings: 0,
      inheritances: 0,
      widowhoods: 0,
      predatorAttacks: 0,
    },
  }
}

export const runTick = (state) => {
  const shouldRegenerateWorld = state.tick === 0 || state.tick % 10 === 0
  const coastalWorld = ensureCoastalEconomy(removeRoads(state.world))
  let nextWorld = shouldRegenerateWorld
    ? regenerateWorld(coastalWorld, state.tick === 0 ? 1 : 10)
    : coastalWorld.slice()
  const agents = ensureAgentIdentities(state.agents.length > 0 ? state.agents : createAgents(AGENT_COUNT, nextWorld))
    .map((agent) => normalizeLifecycleAgent(normalizeEconomicAgent(agent), state.tick))
  const agentsByTile = indexAgentsByTile(agents)
  const agentsByIdAtStart = new Map(agents.map((agent) => [agent.id, agent]))
  const houses = nextWorld.filter((tile) => tile.structure === 'house')
  const calendar = migrateLifeCalendar(state.calendar, state.tick)
  const dayProgress = getDayProgress(state.tick, calendar)
  const nightNow = isNightTime(state.tick, calendar)
  const ticksPerDay = calendar.ticksPerYear / 365
  const daylightTicksUntilSunset = dayProgress >= 0.25 && dayProgress < 0.75
    ? (0.75 - dayProgress) * ticksPerDay
    : 0
  const socialInteractions = []
  let nextArchive = state.archive ?? []
  const archiveEvents = []
  let fishCaughtThisTick = 0
  let spoiledFishThisTick = 0
  
  const cognitiveAgents = agents.map((agent) => {
    let nextAgent = {
      ...agent,
      resources: { ...agent.resources },
      relationships: { ...agent.relationships },
      drives: { ...agent.drives },
      chemistry: { ...agent.chemistry },
      memory: normalizeMemory(agent.memory),
      economic: { ...agent.economic },
      marketIntent: null,
      lastCatch: 0,
      indoors: false,
      ticksSinceEvaluation: agent.ticksSinceEvaluation + 1,
    };
    const currentTile = getTileAt(nextWorld, nextAgent.x, nextAgent.y);
    if (nextAgent.home && getTileAt(nextWorld, nextAgent.home.x, nextAgent.home.y)?.structure !== 'house') {
       nextAgent.home = null;
    }
    
    // Background Homeostasis Shifts (Every Tick)
    nextAgent.drives.hunger = clamp(nextAgent.drives.hunger + 0.00045, 0, 1);
    nextAgent.drives.thirst = clamp(nextAgent.drives.thirst + 0.00045, 0, 1);
    nextAgent.drives.exhaustion = clamp(nextAgent.drives.exhaustion + 0.00025, 0, 1);
    nextAgent.drives.isolation = clamp(nextAgent.drives.isolation + 0.00035, 0, 1);

    if (nextAgent.drives.hunger > 0.62 && nextAgent.resources.fish >= 1) {
       nextAgent.resources.fish -= 1;
       nextAgent.drives.hunger = clamp(nextAgent.drives.hunger - 0.48, 0, 1);
       nextAgent.chemistry.cortisol = clamp(nextAgent.chemistry.cortisol - 0.1, 0, 1);
       nextAgent.chemistry.dopamine = clamp(nextAgent.chemistry.dopamine + 0.08, 0, 1);
    } else if (nextAgent.drives.hunger > 0.72 && nextAgent.resources.food > 0) {
       nextAgent.resources.food -= 1;
       nextAgent.drives.hunger = clamp(nextAgent.drives.hunger - 0.35, 0, 1);
       nextAgent.chemistry.cortisol = clamp(nextAgent.chemistry.cortisol - 0.08, 0, 1);
       nextAgent.chemistry.dopamine = clamp(nextAgent.chemistry.dopamine + 0.05, 0, 1);
    }

    if (state.tick > 0 && state.tick % 240 === 0 && nextAgent.resources.fish > 0) {
       const spoiled = Math.min(nextAgent.resources.fish, Math.max(0.25, nextAgent.resources.fish * 0.15))
       nextAgent.resources.fish = Math.max(0, nextAgent.resources.fish - spoiled)
       spoiledFishThisTick += spoiled
    }
    
    // Cortisol penalty (Survival Pressure)
    if (nextAgent.drives.hunger > 0.8 || nextAgent.drives.thirst > 0.8 || nextAgent.drives.exhaustion > 0.8) {
       nextAgent.chemistry.cortisol = clamp(nextAgent.chemistry.cortisol + 0.004, 0, 1);
    } else {
       nextAgent.chemistry.cortisol = clamp(nextAgent.chemistry.cortisol - 0.005, 0, 1);
    }
    
    // Health decay if stressed to the max
    if (nextAgent.chemistry.cortisol >= 1.0 || nextAgent.drives.hunger >= 1 || nextAgent.drives.thirst >= 1) {
       const unmetNeedDamage = (nextAgent.drives.hunger >= 1 ? 0.12 : 0) + (nextAgent.drives.thirst >= 1 ? 0.18 : 0)
       nextAgent.health = clamp(nextAgent.health - 0.08 - unmetNeedDamage, 0, 100);
    } else if (nextAgent.drives.hunger < 0.5 && nextAgent.drives.thirst < 0.5 && nextAgent.drives.exhaustion < 0.5 && nextAgent.health < 100) {
       nextAgent.health = clamp(nextAgent.health + 0.2, 0, 100);
    }
    
    // Dopamine natural decay
    nextAgent.chemistry.dopamine = clamp(nextAgent.chemistry.dopamine - 0.005, 0, 1);

    // Critical survival needs interrupt lower-priority plans immediately.
    const emergencyAction = nextAgent.drives.thirst > 0.68
      ? 'HYDRATE'
      : nextAgent.drives.hunger > 0.72
        ? 'CONSUME'
        : nextAgent.drives.exhaustion > 0.85
          ? 'SHELTER'
          : null;
    if (emergencyAction && nextAgent.attentionTarget?.affordance.tag !== emergencyAction) {
       nextAgent.attentionTarget = null;
       nextAgent.strategicGoal = null;
       nextAgent.state = 'THINKING';
    }

    if (
      nextAgent.attentionTarget &&
      !ONE_SHOT_ACTIONS.has(nextAgent.attentionTarget.affordance.tag) &&
      isTargetSatisfied(nextAgent, nextAgent.attentionTarget.affordance)
    ) {
       nextAgent.attentionTarget = null;
       nextAgent.strategicGoal = null;
       nextAgent.state = 'THINKING';
    }

    const nightShelter = findNightShelter(nextAgent, nextWorld, agentsByIdAtStart, houses)
    const shelterDistance = nightShelter
      ? Math.max(Math.abs(nextAgent.x - nightShelter.x), Math.abs(nextAgent.y - nightShelter.y))
      : Number.POSITIVE_INFINITY
    const shouldReturnBeforeDark = Boolean(
      nightShelter &&
      dayProgress >= 0.25 &&
      dayProgress < 0.75 &&
      shelterDistance + 2 >= daylightTicksUntilSunset
    )
    const nightRoutineActive = nightNow || shouldReturnBeforeDark

    // --- SYSTEM 2 (Deliberate Thinking) ---
    const involuntaryTrigger = !nextAgent.attentionTarget;
    if (nextAgent.ticksSinceEvaluation >= nextAgent.cognitiveInertia || involuntaryTrigger) {
       nextAgent.ticksSinceEvaluation = 0;
       nextAgent.surprised = involuntaryTrigger;
       
       // Surprise leading to AWAKENING if on a Glitch
       if (involuntaryTrigger && currentTile?.isAnomalous) {
          nextAgent.isAwoken = true;
          nextAgent.surpriseThreshold = 0.95; // Harder to rattle a sage
       }

       // Perception Layer
       const perception = performSensoryScan(nextAgent, nextWorld, agentsByTile, state.tick);
       nextAgent = updatePerceptionMemory(nextAgent, perception.stimuli, perception.observedTileKeys, state.tick);
       const rememberedStimuli = recallBelievedStimuli(nextAgent, state.tick);
       const visibleKeys = new Set(perception.stimuli.map(stimulus => `${stimulus.x},${stimulus.y}:${stimulus.affordance.tag}`));
       const recalledStimuli = rememberedStimuli.filter(stimulus => !visibleKeys.has(`${stimulus.x},${stimulus.y}:${stimulus.affordance.tag}`));
       const explorationStimulus = getExplorationStimulus(nextAgent, state.tick, emergencyAction);
       let stimuli = [...perception.stimuli, ...recalledStimuli];
       if (explorationStimulus) {
          stimuli.push(explorationStimulus);
       }
       stimuli = stimuli.filter((stimulus) => canPursueActionAtAge(nextAgent.age, stimulus.affordance.tag));
       if (emergencyAction && stimuli.some(stimulus => stimulus.affordance.tag === emergencyAction)) {
          stimuli = stimuli.filter(stimulus => stimulus.affordance.tag === emergencyAction);
       }
       
       let bestStimulus = null;
       let maxUtility = 0;
       
       for (const stimulus of stimuli) {
          const dist = Math.sqrt((stimulus.x - nextAgent.x)**2 + (stimulus.y - nextAgent.y)**2);
          const targetTile = stimulus.source === 'belief' ? null : getTileAt(nextWorld, stimulus.x, stimulus.y);
          const targetHeight = stimulus.height ?? targetTile?.height ?? nextAgent.height ?? 0.5;
          const util = scoreUtility(
             nextAgent,
             stimulus.affordance,
             dist,
             targetHeight,
             dayProgress,
             nextWorld,
             stimulus.beliefConfidence ?? 1,
          );
          if (util > maxUtility) {
             maxUtility = util;
             bestStimulus = stimulus;
          }
       }
       
       if (bestStimulus) {
          if (bestStimulus.affordance.tag === 'EXPLORE') {
             nextAgent.memory = {
                ...nextAgent.memory,
                exploration: {
                   x: bestStimulus.x,
                   y: bestStimulus.y,
                   arriveBy: bestStimulus.arriveBy ?? state.tick + 80,
                },
             };
          }
          nextAgent.attentionTarget = bestStimulus;
          nextAgent.strategicGoal = {
             type: bestStimulus.affordance.tag,
             priority: clamp(maxUtility / 50, 0.5, 3),
             selectedAt: state.tick,
          };
          nextAgent.monologue = createLocalThought(nextAgent, bestStimulus, state.tick);
          nextAgent.state = `PURSUING_${bestStimulus.affordance.tag}`;
       } else {
          nextAgent.attentionTarget = null;
          nextAgent.strategicGoal = null;
          nextAgent.monologue = createLocalThought(nextAgent, null, state.tick);
          nextAgent.state = 'MIND_WANDERING';
       }
    }

    // Darkness is a hard safety interrupt. It replaces work and exploration with
    // a route to the agent's household home or, if necessary, the nearest house.
    if (nightRoutineActive) {
       nextAgent.strategicGoal = null
       if (nightShelter) {
          nextAgent.attentionTarget = {
             x: nightShelter.x,
             y: nightShelter.y,
             type: 'house',
             shelterKind: nightShelter.kind,
             affordance: { tag: 'SHELTER', drive: 'exhaustion', value: 200 },
          }
          nextAgent.state = shelterDistance === 0
             ? (nightNow ? 'SLEEPING' : 'WAITING_AT_HOME')
             : (nightNow ? 'FLEEING_TO_SHELTER' : 'RETURNING_HOME')
          nextAgent.monologue = shelterDistance === 0
             ? (nightNow ? 'I am safely inside for the night.' : 'Darkness is close. I will stay near the house.')
             : `The light is fading. I need to reach ${nightShelter.kind} before dark.`
       } else {
          nextAgent.attentionTarget = null
          nextAgent.state = nightNow ? 'SHELTERLESS_AT_NIGHT' : 'SEEKING_SHELTER'
          nextAgent.monologue = 'Darkness is coming and I have nowhere safe to sleep.'
          nextAgent.chemistry.cortisol = clamp(nextAgent.chemistry.cortisol + 0.01, 0, 1)
       }
    }

    // --- SYSTEM 1 (Reactive Action) ---
    let step = { dx: 0, dy: 0 };
    
    if (nextAgent.attentionTarget) {
       // Executing trajectory
       let target = nextAgent.attentionTarget;
       if (target.affordance.tag === 'SOCIALIZE' && target.targetId) {
          const partner = agents.find(other => other.id === target.targetId && other.health > 0);
          if (partner) {
             target = { ...target, x: partner.x, y: partner.y };
             nextAgent.attentionTarget = target;
          }
       }
       step = chooseStepToward(nextAgent, target, nextWorld);
       
       // Check if reached destination
       const targetDistance = Math.max(Math.abs(nextAgent.x - target.x), Math.abs(nextAgent.y - target.y));
       const reachedTarget = targetDistance === 0 || (target.affordance.tag === 'SOCIALIZE' && targetDistance <= 1);
       if (reachedTarget) {
          // INTERACT (Trigger Affordance)
          const tileIndex = target.y * WORLD_SIZE + target.x;
          let tile = getTileAt(nextWorld, target.x, target.y);
          if (canExecuteTarget(nextAgent, target, tile, agentsByTile)) {
             tile = { ...tile, affordances: [...(tile.affordances ?? [])] };
             nextWorld[tileIndex] = tile;
             const beforeAction = nextAgent;
             // Environment applies effects to agent
             nextAgent = applyAffordance(nextAgent, target.affordance, tile);

             if (target.affordance.tag === 'FISH') {
                const caught = nextAgent.lastCatch ?? 0
                tile.fishStock = Math.max(0, (tile.fishStock ?? 0) - caught)
                fishCaughtThisTick += caught
             }
             
             // Handle Social Interaction
             if (target.affordance.tag === 'SOCIALIZE' && target.targetId) {
                const partnerId = target.targetId;
                const currentRel = nextAgent.relationships[partnerId] || 0;
                nextAgent.relationships[partnerId] = Math.min(1, currentRel + 0.1);
                socialInteractions.push({ initiatorId: nextAgent.id, partnerId });
             }

             // Handle Building Structure creation
             if (nextAgent.justBuilt === 'house') {
                tile.structure = 'house';
                tile.type = 'empty';
                tile.ownerId = nextAgent.id;
                tile.builtAt = state.tick;
                tile.affordances = [{ tag: 'SHELTER', drive: 'exhaustion', value: 60 }];
                nextAgent.home = { x: target.x, y: target.y, builtAt: state.tick };
                nextAgent.justBuilt = false;
             } else if (nextAgent.justBuilt === 'shop') {
                tile.structure = 'shop';
                tile.type = 'shop'; // Specifically for roads to connect?
                tile.affordances = [{ tag: 'MARKET_FISH', drive: 'enterprise', value: 48 }];
                nextAgent.justBuilt = false;
             }

             // Drain tile richness (Skip for permanent structures like houses)
             if (!tile.structure && target.affordance.tag !== 'FISH') {
                tile.richness = Math.max(0, tile.richness - 0.15);
             }
             
             if (tile.richness <= 0.1 && !tile.structure) {
                // System 2 surprise trigger: the target is low quality now
                nextAgent.attentionTarget = null;
                nextAgent.state = 'THINKING';
             }

             const reward = calculateActionReward(beforeAction, nextAgent, target.affordance.tag);
             nextAgent = recordEpisode(nextAgent, {
                tick: state.tick,
                action: target.affordance.tag,
                x: target.x,
                y: target.y,
                outcome: 'success',
                reward,
             });

             if (ONE_SHOT_ACTIONS.has(target.affordance.tag) || isTargetSatisfied(nextAgent, target.affordance)) {
                nextAgent.attentionTarget = null;
                nextAgent.strategicGoal = null;
                nextAgent.state = 'THINKING';
             }
          } else {
             // The world changed before arrival. Remember the failure and re-plan.
             nextAgent = recordEpisode(nextAgent, {
                tick: state.tick,
                action: target.affordance.tag,
                x: target.x,
                y: target.y,
                outcome: 'failed',
                reward: -3,
             });
             nextAgent.attentionTarget = null;
             nextAgent.strategicGoal = null;
             nextAgent.state = 'THINKING';
          }
       }
     } else if (!nightRoutineActive && nextAgent.age >= 6) {
        // --- STIGMERGY (Collective Sniffing) ---
        // If wandering, follow the data gradient left by others
        const dirs = [[1,0], [-1,0], [0,1], [0,-1], [1,1], [1,-1], [-1,1], [-1,-1]];
        let bestDir = { dx: 0, dy: 0 };
        let maxData = state.substrate.getValue(nextAgent.x, nextAgent.y).data;

        for (const [dx, dy] of dirs) {
           const val = state.substrate.getValue(nextAgent.x + dx, nextAgent.y + dy).data;
           if (val > maxData) {
              maxData = val;
              bestDir = { dx, dy };
           }
        }
        
        if (bestDir.dx !== 0 || bestDir.dy !== 0) {
           step = bestDir;
        } else {
           step.dx = Math.floor(Math.random() * 3) - 1; 
           step.dy = Math.floor(Math.random() * 3) - 1; 
        }
        
        if (step.dx !== 0 || step.dy !== 0) {
           nextAgent.state = 'EXPLORING_AREA';
        }
     }
    
    // Apply Movement & Boundary Check
    const oldHeight = nextAgent.height ?? 0.5;
    const nextX = clamp(nextAgent.x + step.dx, 0, WORLD_SIZE - 1);
    const nextY = clamp(nextAgent.y + step.dy, 0, WORLD_SIZE - 1);
    
    // Boundary Check: Cant enter deep water at map edges
    const nextTile = getTileAt(nextWorld, nextX, nextY);
    const isEdge = nextX === 0 || nextY === 0 || nextX === WORLD_SIZE - 1 || nextY === WORLD_SIZE - 1;
    const isWalkable = !(isEdge && nextTile?.type === 'water');
    
    if (isWalkable) {
       nextAgent.x = nextX;
       nextAgent.y = nextY;
    }

    // Sync agent height with terrain
    const finalTile = getTileAt(nextWorld, nextAgent.x, nextAgent.y);
    nextAgent.height = finalTile?.height ?? 0.5;
    const reachedNightShelter = Boolean(
      nightShelter &&
      nextAgent.x === nightShelter.x &&
      nextAgent.y === nightShelter.y &&
      finalTile?.structure === 'house'
    )
    nextAgent.indoors = nightNow && reachedNightShelter
    if (reachedNightShelter && nightRoutineActive) {
       nextAgent.attentionTarget = null
       nextAgent.strategicGoal = null
       nextAgent.drives.exhaustion = clamp(nextAgent.drives.exhaustion - (nightNow ? 0.035 : 0.012), 0, 1)
       nextAgent.chemistry.cortisol = clamp(nextAgent.chemistry.cortisol - 0.012, 0, 1)
       nextAgent.state = nightNow ? 'SLEEPING' : 'WAITING_AT_HOME'
       nextAgent.monologue = nightNow
         ? 'I am safely inside for the night.'
         : 'Darkness is close. I will stay near the house.'
    } else if (nightNow && nightShelter) {
       nextAgent.state = 'FLEEING_TO_SHELTER'
       nextAgent.chemistry.cortisol = clamp(nextAgent.chemistry.cortisol + 0.006, 0, 1)
    }
    
    const previousLifeStage = getLifeStage(nextAgent.age)
    nextAgent.age += YEARS_PER_TICK;
    const currentLifeStage = getLifeStage(nextAgent.age)
    nextAgent.lifeStage = currentLifeStage.key
    if (previousLifeStage.key !== currentLifeStage.key) {
       archiveEvents.push(`Tick ${state.tick}: ${getAgentName(nextAgent)} entered the ${currentLifeStage.label.toLowerCase()} stage`)
       nextAgent.monologue = `I am entering a new stage of life: ${currentLifeStage.label.toLowerCase()}.`
    }
    
    // Mortality rises gradually in later elderhood.
    if (nextAgent.age > 85) {
       nextAgent.health = Math.max(0, nextAgent.health - (0.002 + (nextAgent.age - 85) * 0.0005));
    }
    
    // --- STIGMERGIC WRITING ---
    // Write success back to the earth
    if (nextAgent.attentionTarget) {
       state.substrate.writeData(nextAgent.x, nextAgent.y, 0.2);
       if (nextAgent.isAwoken) {
          state.substrate.writeWisdom(nextAgent.x, nextAgent.y, 0.1);
       }
    }

    // --- TEACHING RECEPTION ---
    const localWisdom = state.substrate.getValue(nextAgent.x, nextAgent.y).wisdom;
    if (localWisdom > 0.1 && !nextAgent.isAwoken) {
       nextAgent.surpriseThreshold = 0.95; // Temporarily "Educated"
    } else if (!nextAgent.isAwoken) {
       nextAgent.surpriseThreshold = 0.8;
    }

    // Distance/Slope cost exertion
    if (step.dx !== 0 || step.dy !== 0) {
       const baseCost = (step.dx !== 0 && step.dy !== 0) ? 1.41 : 1.0;
       const heightDiff = nextAgent.height - oldHeight;
       let slopePenalty = Math.max(0, heightDiff) * 15.0; // Extreme penalty for uphill
       
       // Falling Logic: Dropping fast from a height
       if (heightDiff < -0.3) {
          nextAgent.health = Math.max(0, nextAgent.health - Math.abs(heightDiff) * 10); // Fall damage
          nextAgent.chemistry.cortisol = clamp(nextAgent.chemistry.cortisol + 0.3, 0, 1); // Scary!
          nextAgent.chemistry.dopamine = clamp(nextAgent.chemistry.dopamine + 0.1, 0, 1); // Thrilling?
       }

       // Glitch Physics: Anomalous tiles invert slope cost (climbing gives energy)
       if (finalTile?.isAnomalous) slopePenalty *= -2.0;

       const waterPenalty = finalTile?.type === 'water' ? 2.0 : 0.0;
       
       nextAgent.drives.exhaustion = clamp(nextAgent.drives.exhaustion + (0.005 * (baseCost + slopePenalty + waterPenalty)), 0, 1);
    }
    
    // Detected Dopamine Spikes for visual pulses
    nextAgent.dopamineSpike = (nextAgent.chemistry.dopamine - nextAgent.lastDopamine) > 0.05;
    nextAgent.lastDopamine = nextAgent.chemistry.dopamine;

    return nextAgent;
  })

  // Successful conversations affect both participants and exchange learned maps/action values.
  const agentsById = new Map(cognitiveAgents.map(agent => [agent.id, agent]))
  for (const { initiatorId, partnerId } of socialInteractions) {
    const initiator = agentsById.get(initiatorId)
    const partner = agentsById.get(partnerId)
    if (!initiator || !partner) continue

    let nextInitiator = shareKnowledge(initiator, partner, state.tick)
    let nextPartner = shareKnowledge({
      ...partner,
      relationships: {
        ...partner.relationships,
        [initiatorId]: Math.min(1, (partner.relationships[initiatorId] ?? 0) + 0.1),
      },
      drives: {
        ...partner.drives,
        isolation: clamp(partner.drives.isolation - 0.3, 0, 1),
      },
      chemistry: {
        ...partner.chemistry,
        oxytocin: clamp(partner.chemistry.oxytocin + 0.15, 0, 1),
      },
    }, initiator, state.tick)

    const writtenExchange = exchangeWrittenKnowledge(nextInitiator, nextPartner, nextArchive, state.tick)
    nextInitiator = writtenExchange.agentA
    nextPartner = writtenExchange.agentB
    if (writtenExchange.artifacts.length > 0) {
      nextArchive = pruneArchive([...nextArchive, ...writtenExchange.artifacts])
      for (const artifact of writtenExchange.artifacts) {
        archiveEvents.push(`Tick ${state.tick}: ${artifact.authorName ?? artifact.authorId} created a generation ${artifact.generation} retelling`)
      }
    }

    agentsById.set(initiatorId, nextInitiator)
    agentsById.set(partnerId, nextPartner)
  }
  let learnedAgents = cognitiveAgents.map(agent => agentsById.get(agent.id) ?? agent)

  const teachingResult = runGenerationalTeaching(learnedAgents, state.tick)
  learnedAgents = teachingResult.agents
  archiveEvents.push(...teachingResult.events)

  learnedAgents = learnedAgents.map(agent => {
    const authorship = maybeAuthorArtifact(agent, nextArchive, state.tick)
    if (authorship.artifact) {
      nextArchive = pruneArchive([...nextArchive, authorship.artifact])
      archiveEvents.push(`Tick ${state.tick}: ${getAgentName(agent)} wrote “${authorship.artifact.title}”`)
    }
    return authorship.agent
  })

  const marketResult = runFishMarket(learnedAgents, state.economy, state.tick)
  learnedAgents = marketResult.agents
  const nextEconomy = {
    ...marketResult.economy,
    totalFishCaught: marketResult.economy.totalFishCaught + fishCaughtThisTick,
    spoiledFish: marketResult.economy.spoiledFish + spoiledFishThisTick,
  }

  // Competence, practiced skills, reputation, and relationships determine social rank.
  learnedAgents = assignHierarchy(learnedAgents, state.tick)
  const householdResult = formHouseholds(learnedAgents, state.tick)
  learnedAgents = householdResult.agents

  const predatorResult = runPredators(
    normalizePredators(state.predators, nextWorld),
    learnedAgents,
    nextWorld,
    state.tick,
    calendar,
  )
  learnedAgents = predatorResult.agents

  const peakCortisol = Math.max(...learnedAgents.map(a => a.chemistry.cortisol));
  const fishingEvents = fishCaughtThisTick >= 2
    ? [`Tick ${state.tick}: Fishers landed ${fishCaughtThisTick} fish from the island coast`]
    : []
  const events = [...state.metrics.events, ...archiveEvents, ...marketResult.events, ...fishingEvents, ...householdResult.events, ...predatorResult.events];
  for (const agent of learnedAgents) {
    const episode = agent.memory?.episodes?.[agent.memory.episodes.length - 1]
    if (episode?.tick !== state.tick || episode.outcome !== 'success') continue
    if (episode.action.startsWith('BUILD_')) {
      events.push(`Tick ${state.tick}: ${getAgentName(agent)} completed ${episode.action.replace('BUILD_', '').toLowerCase()}`)
    }
  }
  if (peakCortisol > 0.9 && state.tick % 50 === 0) {
    events.push(`Tick ${state.tick}: Severe systemic stress detected`);
  }

  // Update Substrate Memory based on Day/Night intensity
  const sunAngle = (dayProgress * Math.PI * 2) - (Math.PI / 2);
  const currentSunIntensity = Math.max(0, Math.sin(sunAngle));
  if (state.tick % 4 === 0) {
    state.substrate.update(performance.now(), currentSunIntensity);
  }

  // --- HOUSEHOLDS, MATING, BIRTH & DEATH ---
  const deathSettlement = settleDeaths(learnedAgents, nextWorld, nextEconomy, state.tick)
  let finalAgents = deathSettlement.agents;
  nextWorld = deathSettlement.world
  const settledEconomy = deathSettlement.economy
  events.push(...deathSettlement.events)
  const newbornAgents = [];
  const deathsThisTick = learnedAgents.length - finalAgents.length
  const carryingCapacity = getCarryingCapacity(nextWorld)
  const finalAgentsById = new Map(finalAgents.map(agent => [agent.id, agent]))
  const processedPairs = new Set()
  let matingsThisTick = 0

  for (const agent of finalAgents) {
    const partner = agent.family?.partnerId ? finalAgentsById.get(agent.family.partnerId) : null
    if (!partner) continue
    const pairKey = [agent.id, partner.id].sort().join(':')
    if (processedPairs.has(pairKey)) continue
    processedPairs.add(pairKey)

    const home = agent.home ?? partner.home
    const hasHome = home && getTileAt(nextWorld, home.x, home.y)?.structure === 'house'
    const healthyPair =
      agent.age >= 18 && partner.age >= 18 && agent.age <= 50 && partner.age <= 50 &&
      agent.health > 60 && partner.health > 60 &&
      agent.drives.hunger < 0.8 && partner.drives.hunger < 0.8 &&
      agent.drives.thirst < 0.8 && partner.drives.thirst < 0.8
    const combinedFood = agent.resources.food + partner.resources.food
    const provisioned = combinedFood >= 8
    const populationAllowsGrowth = finalAgents.length + newbornAgents.length < carryingCapacity
    const expectingBirthTick = agent.family.expectingBirthTick ?? partner.family.expectingBirthTick

    if (
      !expectingBirthTick && hasHome && healthyPair && provisioned && populationAllowsGrowth &&
      state.tick >= (agent.family.nextMatingTick ?? 0)
    ) {
      const birthTick = state.tick + Math.round(TICKS_PER_YEAR * 0.75)
      agent.family = { ...agent.family, lastMatingTick: state.tick, expectingBirthTick: birthTick }
      partner.family = { ...partner.family, lastMatingTick: state.tick, expectingBirthTick: birthTick }
      agent.state = 'BONDING_WITH_PARTNER'
      partner.state = 'BONDING_WITH_PARTNER'
      agent.monologue = `${getAgentName(partner)} and I may bring a new life into our household.`
      partner.monologue = `${getAgentName(agent)} and I may bring a new life into our household.`
      matingsThisTick += 1
      events.push(`Tick ${state.tick}: ${getAgentName(agent)} and ${getAgentName(partner)} mated; their household is expecting a child`)
      continue
    }

    if (!expectingBirthTick || state.tick < expectingBirthTick || !populationAllowsGrowth) continue
    if (!hasHome || !healthyPair || !provisioned) {
      const retryTick = state.tick + 80
      agent.family = { ...agent.family, expectingBirthTick: retryTick }
      partner.family = { ...partner.family, expectingBirthTick: retryTick }
      continue
    }

    const baby = createOffspring(agent, partner, `A-${state.tick}-${newbornAgents.length + 1}`, state.tick)
    if (home) {
      baby.x = home.x
      baby.y = home.y
      baby.home = { ...home }
      baby.height = getTileAt(nextWorld, home.x, home.y)?.height ?? baby.height
    }
    newbornAgents.push(baby)
    const agentFoodCost = 8 * (agent.resources.food / combinedFood)
    const partnerFoodCost = 8 - agentFoodCost
    agent.resources.food = Math.max(0, agent.resources.food - agentFoodCost)
    partner.resources.food = Math.max(0, partner.resources.food - partnerFoodCost)
    agent.relationships = { ...agent.relationships, [baby.id]: 1 }
    partner.relationships = { ...partner.relationships, [baby.id]: 1 }
    const nextMatingTick = state.tick + 900 + stablePairOffset(agent.id, partner.id, 500)
    agent.family = {
      ...agent.family,
      childrenIds: [...new Set([...agent.family.childrenIds, baby.id])],
      lastBirthTick: state.tick,
      nextMatingTick,
      expectingBirthTick: null,
    }
    partner.family = {
      ...partner.family,
      childrenIds: [...new Set([...partner.family.childrenIds, baby.id])],
      lastBirthTick: state.tick,
      nextMatingTick,
      expectingBirthTick: null,
    }
    agent.state = 'CARING_FOR_NEWBORN'
    partner.state = 'CARING_FOR_NEWBORN'
    agent.monologue = `${getAgentName(baby)} has joined our household. Survival now means caring for more than myself.`
    partner.monologue = `${getAgentName(baby)} has joined our household. Survival now means caring for more than myself.`
    events.push(`Tick ${state.tick}: ${getAgentName(baby)} was born to ${getAgentName(agent)} and ${getAgentName(partner)}`)
  }

  const totalBirths = (state.metrics.totalBirths ?? 0) + newbornAgents.length
  const totalDeaths = (state.metrics.totalDeaths ?? 0) + deathsThisTick
  const totalMatings = (state.metrics.totalMatings ?? 0) + matingsThisTick
  const nextAgents = [...finalAgents, ...newbornAgents]

  return {
    worldId: state.worldId ?? 'earth-94-main',
    revision: state.revision ?? 0,
    tick: state.tick + 1,
    calendar: migrateLifeCalendar(state.calendar, state.tick),
    world: nextWorld,
    agents: nextAgents,
    predators: predatorResult.predators,
    archive: nextArchive,
    economy: settledEconomy,
    substrate: state.substrate, // Persist mycelium
    metrics: {
      ...state.metrics,
      highestCortisol: peakCortisol,
      events: events.slice(-14),
      totalBirths,
      totalDeaths,
      totalMatings,
      birthsThisTick: newbornAgents.length,
      deathsThisTick,
      households: getHouseholdCount(nextAgents),
      carryingCapacity,
      leaderId: nextAgents.find(agent => agent.status?.rank === 1)?.id ?? null,
      familyTeachings: (state.metrics.familyTeachings ?? 0) + teachingResult.familyTeachings,
      elderTeachings: (state.metrics.elderTeachings ?? 0) + teachingResult.elderTeachings,
      inheritances: (state.metrics.inheritances ?? 0) + deathSettlement.inheritances,
      widowhoods: (state.metrics.widowhoods ?? 0) + deathSettlement.widowhoods,
      predatorAttacks: (state.metrics.predatorAttacks ?? 0) + predatorResult.attacks,
    }
  }
}

export const getClosestAgent = (state, pixelX, pixelY, canvasSize = 700) => {
  const tileSize = canvasSize / WORLD_SIZE
  const x = pixelX / tileSize
  const y = pixelY / tileSize
  let best = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const agent of state.agents) {
    const dx = agent.x - x
    const dy = agent.y - y
    const distance = Math.sqrt(dx * dx + dy * dy)
    if (distance < bestDistance) {
      bestDistance = distance
      best = agent
    }
  }
  return bestDistance <= 2.5 ? best : null
}

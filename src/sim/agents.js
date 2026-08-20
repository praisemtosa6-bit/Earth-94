import { TRAITS, WORLD_SIZE } from './constants'
import { TICKS_PER_YEAR, getLifeStage } from './lifecycle'
import { createChildIdentity, createFounderIdentity } from './names'

const randomTraitSet = () => {
  const dna = {}
  for (const trait of TRAITS) {
    dna[trait] = Math.random()
  }
  return dna
}

const findStartingPosition = (world, index) => {
  const center = Math.floor(WORLD_SIZE / 2)
  const candidates = []

  for (let radius = 0; radius <= 7; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue
        const x = center + dx
        const y = center + dy
        const tile = world?.[y * WORLD_SIZE + x]
        if (tile && tile.type !== 'water' && tile.height >= 0.25) {
          candidates.push({ x, y })
        }
      }
    }
  }

  return candidates[index % Math.max(1, candidates.length)] ?? { x: center, y: center }
}

const createSurvivalMemory = () => ({
  food: null,
  water: null,
  shelter: null,
})

const createCognitiveMemory = () => ({
  sequences: [],
  survival: createSurvivalMemory(),
  exploration: null,
  workingMemory: [],
  beliefs: { locations: {} },
  episodes: [],
  semanticFacts: {},
  actionValues: {},
  actionCounts: {},
  lastActions: {},
  knownAgents: {},
  culturalBeliefs: {},
  thoughts: [],
  writings: [],
  readArtifacts: [],
  lastWritten: Number.NEGATIVE_INFINITY,
  lastRetelling: Number.NEGATIVE_INFINITY,
  originWritten: false,
})

export const createAgents = (count, world = null) =>
  Array.from({ length: count }, (_, index) => {
    const dna = randomTraitSet()
    const spawn = findStartingPosition(world, index)
    const id = `A-${index + 1}`
    const identity = createFounderIdentity(id, index)
    const age = 18 + Math.floor(Math.random() * 28)
    return {
      id,
      ...identity,
      x: spawn.x,
      y: spawn.y,
      dna,
      health: 100,
      age,
      bornAtTick: -age * TICKS_PER_YEAR,
      lifeStage: getLifeStage(age).key,
      lifecycle: {
        widowedAt: null,
        formerPartnerIds: [],
        inheritedFromIds: [],
        lastFamilyTeachingTick: null,
        lastElderTeachingTick: null,
      },
      resources: { food: 20, materials: 20, fish: 0, coins: 24 },
      economic: { fishCaught: 0, fishSold: 0, fishBought: 0, coinsEarned: 0, coinsSpent: 0, trades: 0 },
      relationships: {},
      home: null,
      family: {
        parentIds: [],
        partnerId: null,
        childrenIds: [],
        partneredAt: null,
        lastBirthTick: Number.NEGATIVE_INFINITY,
        lastMatingTick: null,
        nextMatingTick: null,
        expectingBirthTick: null,
      },
      status: {
        score: 0,
        reputation: 0,
        rank: null,
        tier: 'Citizen',
        role: 'Unproven',
        dominantSkill: null,
        skills: {},
        updatedAt: 0,
      },
      
      // Homeostatic Drives
      drives: {
        hunger: Math.random() * 0.5,
        thirst: Math.random() * 0.5,
        exhaustion: Math.random() * 0.5,
        isolation: Math.random() * 0.5,
        greed: 0.1, // Greed can just be a base trait
      },
      
      // Neurochemistry
      chemistry: {
        dopamine: 0.5,
        cortisol: 0.2, // Stress
        oxytocin: 0.5, // Social binding
      },
      
      // Cognitive Engine Parameters
      state: 'MIND_WANDERING',
      cognitiveInertia: Math.floor(4 + (1 - dna.intelligence) * 8 + (1 - dna.curiosity) * 5),
      ticksSinceEvaluation: 0,
      visionRange: 7 + Math.floor(dna.intelligence * 5 + Math.random() * 3),
      
      // Bounded spatial, episodic, reinforcement, and social memory
      memory: createCognitiveMemory(),
      attentionTarget: null,
      surprised: false,
      isAwoken: false,
      surpriseThreshold: 0.8, // Levels required to trigger System 2 or Epiphany
      lastDopamine: 0.5,
      monologue: "Just a humble settler...",
      strategicGoal: null,
    }
  })

export const createOffspring = (parentA, parentB, id, bornAtTick = 0) => {
  const dna = {}
  for (const trait of TRAITS) {
    // 50/50 mix with a slight chance of mutation (+/- 0.05)
    const base = Math.random() > 0.5 ? parentA.dna[trait] : parentB.dna[trait]
    dna[trait] = Math.max(0, Math.min(1, base + (Math.random() * 0.1 - 0.05)))
  }
  const identity = createChildIdentity(id, parentA, parentB)

  return {
    id,
    ...identity,
    x: parentA.x,
    y: parentA.y,
    dna,
    health: 100,
    age: 0,
    bornAtTick,
    lifeStage: 'infant',
    lifecycle: {
      widowedAt: null,
      formerPartnerIds: [],
      inheritedFromIds: [],
      lastFamilyTeachingTick: null,
      lastElderTeachingTick: null,
    },
    resources: { food: 0, materials: 10, fish: 0, coins: 0 },
    economic: { fishCaught: 0, fishSold: 0, fishBought: 0, coinsEarned: 0, coinsSpent: 0, trades: 0 },
    relationships: { [parentA.id]: 1, [parentB.id]: 1 },
    home: parentA.home ?? parentB.home ?? null,
    family: {
      parentIds: [parentA.id, parentB.id],
      partnerId: null,
      childrenIds: [],
      partneredAt: null,
      lastBirthTick: Number.NEGATIVE_INFINITY,
      lastMatingTick: null,
      nextMatingTick: null,
      expectingBirthTick: null,
    },
    status: {
      score: 0,
      reputation: 0,
      rank: null,
      tier: 'Youth',
      role: 'Apprentice',
      dominantSkill: null,
      skills: {},
      updatedAt: 0,
    },
    drives: {
      hunger: 0.2,
      thirst: 0.2,
      exhaustion: 0.2,
      isolation: 0,
      greed: 0.1,
    },
    chemistry: {
      dopamine: 0.8,
      cortisol: 0.1,
      oxytocin: 1.0,
    },
    state: 'MIND_WANDERING',
    cognitiveInertia: Math.floor(4 + (1 - dna.intelligence) * 8 + (1 - dna.curiosity) * 5),
    ticksSinceEvaluation: 0,
    visionRange: 5 + Math.floor(dna.intelligence * 5 + Math.random() * 3),
    memory: createCognitiveMemory(),
    attentionTarget: null,
    surprised: false,
    isAwoken: false,
    surpriseThreshold: 0.8,
    lastDopamine: 0.8,
    monologue: 'Everything is new, but I can learn from what happens next.',
    strategicGoal: null,
  }
}

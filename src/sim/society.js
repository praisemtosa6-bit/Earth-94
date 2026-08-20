import { AGENT_COUNT } from './constants'
import { getKnowledgeScore } from './brain'
import { getLifeStage } from './lifecycle'
import { getAgentName } from './names'

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const actionCount = (agent, action) => agent.memory?.actionCounts?.[action] ?? 0

const getSkillProfile = (agent) => ({
  builder:
    actionCount(agent, 'BUILD_HOUSE') * 5 +
    actionCount(agent, 'BUILD_SHOP') * 4,
  provider:
    actionCount(agent, 'GATHER_WOOD') * 1.5 +
    actionCount(agent, 'GATHER_STONE') * 1.5 +
    actionCount(agent, 'CONSUME') * 0.15 +
    actionCount(agent, 'HYDRATE') * 0.1,
  fisher:
    actionCount(agent, 'FISH') * 2.5 +
    (agent.economic?.fishCaught ?? 0) * 0.8,
  merchant:
    actionCount(agent, 'MARKET_FISH') * 0.4 +
    (agent.economic?.trades ?? 0) * 2 +
    Math.log1p(agent.economic?.coinsEarned ?? 0) * 2,
  scholar: getKnowledgeScore(agent) * 0.9 + agent.dna.intelligence * 12,
  diplomat:
    Object.keys(agent.relationships ?? {}).length * 4 +
    actionCount(agent, 'SOCIALIZE') * 2 +
    agent.dna.charisma * 10 +
    agent.dna.empathy * 8,
  explorer: actionCount(agent, 'EXPLORE') * 0.2 + agent.dna.curiosity * 10,
})

const ROLE_NAMES = {
  builder: 'Builder',
  provider: 'Provider',
  fisher: 'Fisher',
  merchant: 'Merchant',
  scholar: 'Scholar',
  diplomat: 'Diplomat',
  explorer: 'Scout',
}

export const normalizeFamily = (agent) => ({
  parentIds: agent.family?.parentIds ?? [],
  partnerId: agent.family?.partnerId ?? null,
  childrenIds: agent.family?.childrenIds ?? [],
  partneredAt: agent.family?.partneredAt ?? null,
  lastBirthTick: agent.family?.lastBirthTick ?? Number.NEGATIVE_INFINITY,
  lastMatingTick: agent.family?.lastMatingTick ?? null,
  nextMatingTick: agent.family?.nextMatingTick ?? agent.family?.nextBirthTick ?? null,
  expectingBirthTick: agent.family?.expectingBirthTick ?? null,
})

const getPrestige = (agent, skills) => {
  const skillValues = Object.values(skills)
  const totalPractice = skillValues.reduce((sum, value) => sum + value, 0)
  const strongestSkill = Math.max(...skillValues)
  const relationshipValues = Object.values(agent.relationships ?? {})
  const socialTrust = relationshipValues.length
    ? relationshipValues.reduce((sum, value) => sum + value, 0) / relationshipValues.length
    : 0
  const experience = clamp(agent.age / 55, 0, 1) * 10
  const competence = Math.log1p(totalPractice) * 5 + Math.log1p(strongestSkill) * 3
  const character = (agent.dna.intelligence + agent.dna.charisma + agent.dna.empathy) * 5
  const economicStanding = Math.log1p(agent.resources?.coins ?? 0) * 1.4
  const reputation = (agent.status?.reputation ?? 0) * 0.92 + competence * 0.08
  return {
    score: clamp(competence + character + experience + socialTrust * 10 + economicStanding, 0, 100),
    reputation: clamp(reputation, 0, 100),
  }
}

export const assignHierarchy = (agents, tick) => {
  const evaluated = agents.map((agent) => {
    const family = normalizeFamily(agent)
    const skills = getSkillProfile(agent)
    const dominantSkill = Object.entries(skills).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'provider'
    const prestige = getPrestige(agent, skills)
    return {
      agent: { ...agent, family },
      skills,
      dominantSkill,
      ...prestige,
    }
  })
  const adults = evaluated
    .filter(entry => entry.agent.age >= 18)
    .sort((a, b) => (b.score + b.reputation * 0.25) - (a.score + a.reputation * 0.25))
  const adultRank = new Map(adults.map((entry, index) => [entry.agent.id, index + 1]))
  const councilSize = Math.max(1, Math.ceil(adults.length * 0.2))

  return evaluated.map((entry) => {
    const rank = adultRank.get(entry.agent.id) ?? null
    const lifeStage = getLifeStage(entry.agent.age)
    const tier = entry.agent.age < 18
      ? lifeStage.label
      : rank === 1
        ? 'Steward'
        : rank <= councilSize
          ? 'Council'
          : entry.score >= 42
            ? 'Specialist'
            : 'Citizen'
    return {
      ...entry.agent,
      lifeStage: lifeStage.key,
      status: {
        score: clamp(entry.score + entry.reputation * 0.25, 0, 100),
        reputation: entry.reputation,
        rank,
        tier,
        role: entry.agent.age < 3 ? 'Dependent' : entry.agent.age < 12 ? 'Learner' : entry.agent.age < 18 ? 'Apprentice' : ROLE_NAMES[entry.dominantSkill],
        dominantSkill: entry.dominantSkill,
        skills: entry.skills,
        updatedAt: tick,
      },
    }
  })
}

const pairHash = (idA, idB) => {
  const text = [idA, idB].sort().join(':')
  let hash = 0
  for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) >>> 0
  return hash
}

const isCloseFamily = (agentA, agentB) => {
  const familyA = normalizeFamily(agentA)
  const familyB = normalizeFamily(agentB)
  if (familyA.parentIds.includes(agentB.id) || familyB.parentIds.includes(agentA.id)) return true
  return familyA.parentIds.some(parentId => familyB.parentIds.includes(parentId))
}

const compatibilityScore = (agentA, agentB) => {
  const relationship = ((agentA.relationships?.[agentB.id] ?? 0) + (agentB.relationships?.[agentA.id] ?? 0)) / 2
  const empathy = (agentA.dna.empathy + agentB.dna.empathy) / 2
  const charisma = (agentA.dna.charisma + agentB.dna.charisma) / 2
  const traitSimilarity = 1 - (
    Math.abs(agentA.dna.curiosity - agentB.dna.curiosity) +
    Math.abs(agentA.dna.aggression - agentB.dna.aggression) +
    Math.abs(agentA.dna.greed - agentB.dna.greed)
  ) / 3
  return relationship * 0.55 + empathy * 0.15 + charisma * 0.1 + traitSimilarity * 0.2
}

export const formHouseholds = (agents, tick) => {
  const livingIds = new Set(agents.map(agent => agent.id))
  const normalized = agents.map(agent => {
    const family = normalizeFamily(agent)
    return {
      ...agent,
      family: {
        ...family,
        partnerId: family.partnerId && livingIds.has(family.partnerId) ? family.partnerId : null,
      },
    }
  })
  const byId = new Map(normalized.map(agent => [agent.id, agent]))
  const candidates = []

  for (let indexA = 0; indexA < normalized.length; indexA += 1) {
    const agentA = normalized[indexA]
    if (agentA.age < 18 || agentA.age > 75 || agentA.family.partnerId) continue
    for (let indexB = indexA + 1; indexB < normalized.length; indexB += 1) {
      const agentB = normalized[indexB]
      if (agentB.age < 18 || agentB.age > 75 || agentB.family.partnerId || isCloseFamily(agentA, agentB)) continue
      const relationship = Math.max(agentA.relationships?.[agentB.id] ?? 0, agentB.relationships?.[agentA.id] ?? 0)
      const distance = Math.max(Math.abs(agentA.x - agentB.x), Math.abs(agentA.y - agentB.y))
      const compatibility = compatibilityScore(agentA, agentB)
      if (relationship < 0.3 || compatibility < 0.42 || distance > Math.max(agentA.visionRange, agentB.visionRange)) continue
      candidates.push({ agentA, agentB, compatibility })
    }
  }

  candidates.sort((a, b) => b.compatibility - a.compatibility)
  const matched = new Set()
  const events = []
  for (const candidate of candidates) {
    if (matched.has(candidate.agentA.id) || matched.has(candidate.agentB.id)) continue
    const agentA = byId.get(candidate.agentA.id)
    const agentB = byId.get(candidate.agentB.id)
    if (agentA.family.partnerId || agentB.family.partnerId) continue
    const nextMatingTick = tick + 260 + (pairHash(agentA.id, agentB.id) % 260)
    const sharedHome = agentA.home ?? agentB.home ?? null
    agentA.family = { ...agentA.family, partnerId: agentB.id, partneredAt: tick, nextMatingTick }
    agentB.family = { ...agentB.family, partnerId: agentA.id, partneredAt: tick, nextMatingTick }
    if (sharedHome) {
      agentA.home = { ...sharedHome }
      agentB.home = { ...sharedHome }
    }
    agentA.relationships = { ...agentA.relationships, [agentB.id]: Math.max(0.6, agentA.relationships[agentB.id] ?? 0) }
    agentB.relationships = { ...agentB.relationships, [agentA.id]: Math.max(0.6, agentB.relationships[agentA.id] ?? 0) }
    agentA.monologue = `I have formed a household with ${getAgentName(agentB)}. Our future is now partly shared.`
    agentB.monologue = `I have formed a household with ${getAgentName(agentA)}. Our future is now partly shared.`
    matched.add(agentA.id)
    matched.add(agentB.id)
    events.push(`Tick ${tick}: ${getAgentName(agentA)} and ${getAgentName(agentB)} formed a household`)
  }
  return { agents: normalized.map(agent => byId.get(agent.id)), events }
}

export const getCarryingCapacity = (world) => {
  const houses = world.filter(tile => tile.structure === 'house').length
  const foodSites = world.filter(tile => tile.type === 'food' && tile.richness > 0.2).length
  const productiveBeaches = world.filter(tile => tile.type === 'beach' && (tile.fishStock ?? 0) >= 2).length
  return clamp(Math.max(AGENT_COUNT + 4, houses * 3 + Math.floor(foodSites / 20) + Math.floor(productiveBeaches / 24)), AGENT_COUNT + 4, 80)
}

export const getHouseholdCount = (agents) => {
  const pairs = new Set()
  for (const agent of agents) {
    if (!agent.family?.partnerId) continue
    pairs.add([agent.id, agent.family.partnerId].sort().join(':'))
  }
  return pairs.size
}

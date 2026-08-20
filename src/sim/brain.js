const MAX_EPISODES = 40
const MAX_SEQUENCES = 24
const MAX_WORKING_MEMORY = 16
const MAX_LOCATION_BELIEFS = 64
const MAX_NEW_BELIEFS_PER_SCAN = 32
const MAX_HELD_THOUGHTS = 24

const PERSISTENT_LOCATION_TAGS = new Set([
  'CONSUME',
  'HYDRATE',
  'SHELTER',
  'GATHER_STONE',
  'GATHER_WOOD',
  'FISH',
  'MARKET_FISH',
  'TAP_ENERGY',
])

const SURVIVAL_KEYS = {
  CONSUME: 'food',
  FISH: 'food',
  HYDRATE: 'water',
  SHELTER: 'shelter',
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const locationKey = (x, y, action) => `${x},${y}:${action}`
const tileKey = (x, y) => `${x},${y}`

const getEffectiveConfidence = (belief, tick) => {
  const age = Math.max(0, tick - (belief.lastObserved ?? belief.lastShared ?? tick))
  const durable = belief.action === 'HYDRATE' || belief.action === 'SHELTER' || belief.action === 'MARKET_FISH'
  const halfLife = durable ? 30000 : 12000
  return clamp((belief.confidence ?? 0.5) * Math.exp(-age / halfLife), 0, 1)
}

const migrateLegacyBeliefs = (memory) => {
  const locations = {}
  for (const remembered of Object.values(memory?.survival ?? {})) {
    if (!remembered?.affordance?.tag) continue
    const action = remembered.affordance.tag
    locations[locationKey(remembered.x, remembered.y, action)] = {
      x: remembered.x,
      y: remembered.y,
      type: remembered.type,
      action,
      affordance: remembered.affordance,
      confidence: 0.75,
      salience: 5,
      expectedValue: remembered.affordance.value,
      lastObserved: remembered.lastSeen ?? 0,
      observations: 1,
      successes: 0,
      failures: 0,
      source: remembered.learnedFrom ?? 'self',
    }
  }
  return locations
}

export const normalizeMemory = (memory = {}) => ({
  sequences: memory.sequences ?? [],
  survival: {
    food: null,
    water: null,
    shelter: null,
    ...(memory.survival ?? {}),
  },
  exploration: memory.exploration ?? null,
  workingMemory: memory.workingMemory ?? [],
  beliefs: {
    locations: memory.beliefs?.locations ?? migrateLegacyBeliefs(memory),
  },
  episodes: memory.episodes ?? [],
  semanticFacts: memory.semanticFacts ?? {},
  actionValues: memory.actionValues ?? {},
  actionCounts: memory.actionCounts ?? {},
  lastActions: memory.lastActions ?? {},
  knownAgents: memory.knownAgents ?? {},
  culturalBeliefs: memory.culturalBeliefs ?? {},
  thoughts: memory.thoughts ?? [],
  writings: memory.writings ?? [],
  readArtifacts: memory.readArtifacts ?? [],
  lastWritten: memory.lastWritten ?? Number.NEGATIVE_INFINITY,
  lastRetelling: memory.lastRetelling ?? Number.NEGATIVE_INFINITY,
  originWritten: memory.originWritten ?? false,
})

const THOUGHT_DIRECTIVES = [
  { action: 'HYDRATE', words: ['water', 'drink', 'thirst', 'river', 'lake'] },
  { action: 'CONSUME', words: ['food', 'eat', 'hunger', 'fruit', 'crop'] },
  { action: 'SHELTER', words: ['rest', 'sleep', 'shelter', 'home', 'house'] },
  { action: 'EXPLORE', words: ['explore', 'search', 'discover', 'wander', 'travel'] },
  { action: 'SOCIALIZE', words: ['friend', 'social', 'talk', 'together', 'help', 'trust'] },
  { action: 'GATHER_WOOD', words: ['wood', 'tree', 'timber'] },
  { action: 'GATHER_STONE', words: ['stone', 'rock', 'mineral'] },
  { action: 'BUILD_HOUSE', words: ['build house', 'build a house'] },
  { action: 'BUILD_SHOP', words: ['shop', 'market', 'commerce'] },
  { action: 'FISH', words: ['fish', 'fishing', 'beach', 'catch'] },
  { action: 'MARKET_FISH', words: ['trade', 'exchange', 'barter', 'market', 'sell fish', 'buy fish'] },
]

const inferThoughtDirective = (text) => {
  const normalized = text.toLowerCase()
  const match = THOUGHT_DIRECTIVES.find(({ words }) => words.some(word => normalized.includes(word)))
  if (!match) return null
  const isWarning = ['avoid', 'danger', 'dangerous', 'poison', 'never', "don't", 'do not', 'bad'].some(word => normalized.includes(word))
  return { action: match.action, polarity: isWarning ? -1 : 1 }
}

export const implantThought = (agent, text, tick, confidence = 0.95) => {
  const cleanText = text.trim().replaceAll(/\s+/g, ' ').slice(0, 280)
  if (!cleanText) return agent
  const memory = normalizeMemory(agent.memory)
  const normalizedText = cleanText.toLowerCase()
  const existing = memory.thoughts.find(thought => thought.text.toLowerCase() === normalizedText)
  const directive = inferThoughtDirective(cleanText)
  const boundedConfidence = clamp(confidence, 0.1, 1)
  const thought = existing
    ? {
        ...existing,
        confidence: clamp(existing.confidence + 0.12, 0, 1),
        salience: clamp((existing.salience ?? 6) + 2, 1, 12),
        repetitions: (existing.repetitions ?? 1) + 1,
        lastRecalled: tick,
        directive: directive ?? existing.directive,
      }
    : {
        id: `T-${agent.id}-${tick}-${memory.thoughts.length + 1}`,
        text: cleanText,
        confidence: boundedConfidence,
        salience: 10,
        source: 'observer',
        originSource: 'observer',
        createdAt: tick,
        lastRecalled: tick,
        repetitions: 1,
        transmission: 0,
        directive,
      }
  const thoughts = [
    ...memory.thoughts.filter(item => item.id !== thought.id),
    thought,
  ].slice(-MAX_HELD_THOUGHTS)
  const actionValues = { ...memory.actionValues }
  if (directive) {
    actionValues[directive.action] = clamp(
      (actionValues[directive.action] ?? 0) + directive.polarity * boundedConfidence * 2.5,
      -10,
      10,
    )
  }
  const beliefKey = `observer-thought|believes|${cleanText.toLowerCase()}`
  const culturalBeliefs = Object.fromEntries(
    Object.entries({
      ...memory.culturalBeliefs,
      [beliefKey]: {
        kind: 'thought',
        subject: agent.id,
        predicate: 'believes',
        object: cleanText,
        confidence: thought.confidence,
        epistemic: 'implanted',
        sourceAuthorId: 'observer',
        learnedAt: tick,
      },
    })
      .sort(([, a], [, b]) => (b.confidence ?? 0) - (a.confidence ?? 0))
      .slice(0, 80),
  )
  const nextMemory = appendWorkingMemory({
    ...memory,
    thoughts,
    actionValues,
    culturalBeliefs,
  }, {
    tick,
    type: 'implanted-thought',
    thoughtId: thought.id,
    text: cleanText,
    salience: 10,
  })
  return {
    ...agent,
    memory: nextMemory,
    monologue: `A thought appears in my mind: “${cleanText}”`,
    surprised: true,
  }
}

export const forgetThought = (agent, thoughtId, tick) => {
  const memory = normalizeMemory(agent.memory)
  const thought = memory.thoughts.find(item => item.id === thoughtId)
  if (!thought) return agent
  const culturalBeliefs = Object.fromEntries(
    Object.entries(memory.culturalBeliefs).filter(([, belief]) => !(
      belief.epistemic === 'implanted' && belief.object === thought.text && belief.subject === agent.id
    )),
  )
  const actionValues = { ...memory.actionValues }
  if (thought.directive) {
    actionValues[thought.directive.action] = clamp(
      (actionValues[thought.directive.action] ?? 0) - thought.directive.polarity * thought.confidence * 2.5,
      -10,
      10,
    )
  }
  const nextMemory = appendWorkingMemory({
    ...memory,
    thoughts: memory.thoughts.filter(item => item.id !== thoughtId),
    culturalBeliefs,
    actionValues,
  }, {
    tick,
    type: 'forgotten-thought',
    thoughtId,
    salience: 4,
  })
  return {
    ...agent,
    memory: nextMemory,
    monologue: `A thought has slipped beyond recall: “${thought.text}”`,
  }
}

const appendWorkingMemory = (memory, event) => ({
  ...memory,
  workingMemory: [...memory.workingMemory, event].slice(-MAX_WORKING_MEMORY),
})

const synchronizeSurvivalMemory = (memory, tick) => {
  const survival = { food: null, water: null, shelter: null }
  const bestScores = { food: -1, water: -1, shelter: -1 }

  for (const belief of Object.values(memory.beliefs.locations)) {
    const survivalKey = SURVIVAL_KEYS[belief.action]
    if (!survivalKey) continue
    const score = getEffectiveConfidence(belief, tick) * (belief.salience ?? 1)
    if (score <= bestScores[survivalKey]) continue
    bestScores[survivalKey] = score
    survival[survivalKey] = {
      x: belief.x,
      y: belief.y,
      type: belief.type,
      affordance: belief.affordance,
      lastSeen: belief.lastObserved,
      learnedFrom: belief.source === 'self' ? undefined : belief.source,
    }
  }

  return { ...memory, survival }
}

const pruneBeliefs = (locations, tick) => {
  const ranked = Object.entries(locations)
    .map(([key, belief]) => ({
      key,
      belief,
      score: getEffectiveConfidence(belief, tick) * (belief.salience ?? 1),
    }))
    .filter(entry => entry.score > 0.08)
    .sort((a, b) => b.score - a.score)
  const selected = new Map()

  // Always reserve a few slots for survival knowledge before filling by salience.
  for (const action of ['HYDRATE', 'CONSUME', 'SHELTER']) {
    for (const entry of ranked.filter(candidate => candidate.belief.action === action).slice(0, 4)) {
      selected.set(entry.key, entry.belief)
    }
  }
  for (const entry of ranked) {
    if (selected.size >= MAX_LOCATION_BELIEFS) break
    selected.set(entry.key, entry.belief)
  }
  return Object.fromEntries(selected)
}

const perceptionSalience = (agent, stimulus, isNovel) => {
  const drive = stimulus.affordance.drive
  const drivePressure = drive && agent.drives[drive] !== undefined ? agent.drives[drive] * 5 : 0
  const survivalBonus = SURVIVAL_KEYS[stimulus.affordance.tag] ? 3 : 0
  return clamp(1 + stimulus.affordance.value / 20 + drivePressure + survivalBonus + (isNovel ? 2 : 0), 1, 12)
}

export const updatePerceptionMemory = (agent, stimuli, observedTileKeys, tick) => {
  let memory = normalizeMemory(agent.memory)
  const locations = { ...memory.beliefs.locations }
  const observedActionsByTile = new Map()

  for (const stimulus of stimuli) {
    if (!PERSISTENT_LOCATION_TAGS.has(stimulus.affordance.tag)) continue
    const key = tileKey(stimulus.x, stimulus.y)
    const actions = observedActionsByTile.get(key) ?? new Set()
    actions.add(stimulus.affordance.tag)
    observedActionsByTile.set(key, actions)
  }

  // Seeing a remembered location without the expected affordance is corrective evidence.
  for (const [key, belief] of Object.entries(locations)) {
    const observedKey = tileKey(belief.x, belief.y)
    if (!observedTileKeys.has(observedKey)) continue
    const observedActions = observedActionsByTile.get(observedKey) ?? new Set()
    if (!observedActions.has(belief.action)) {
      locations[key] = {
        ...belief,
        confidence: belief.confidence * 0.2,
        lastContradicted: tick,
      }
    }
  }

  let novelCount = 0
  const memorableStimuli = stimuli
    .filter(stimulus => PERSISTENT_LOCATION_TAGS.has(stimulus.affordance.tag))
    .map(stimulus => ({
      stimulus,
      score: perceptionSalience(
        agent,
        stimulus,
        !locations[locationKey(stimulus.x, stimulus.y, stimulus.affordance.tag)],
      ) - Math.hypot(stimulus.x - agent.x, stimulus.y - agent.y) * 0.05,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_NEW_BELIEFS_PER_SCAN)
    .map(entry => entry.stimulus)

  for (const stimulus of memorableStimuli) {
    const action = stimulus.affordance.tag
    const key = locationKey(stimulus.x, stimulus.y, action)
    const existing = locations[key]
    if (!existing) novelCount += 1
    locations[key] = {
      ...existing,
      x: stimulus.x,
      y: stimulus.y,
      type: stimulus.type,
      height: stimulus.height,
      action,
      affordance: { ...stimulus.affordance },
      confidence: 1,
      salience: perceptionSalience(agent, stimulus, !existing),
      expectedValue: existing
        ? existing.expectedValue * 0.7 + stimulus.affordance.value * 0.3
        : stimulus.affordance.value,
      lastObserved: tick,
      observations: (existing?.observations ?? 0) + 1,
      successes: existing?.successes ?? 0,
      failures: existing?.failures ?? 0,
      source: 'self',
    }
  }

  memory = {
    ...memory,
    beliefs: { locations: pruneBeliefs(locations, tick) },
  }
  memory = appendWorkingMemory(memory, {
    tick,
    type: 'perception',
    observedTiles: observedTileKeys.size,
    usefulStimuli: stimuli.filter(stimulus => PERSISTENT_LOCATION_TAGS.has(stimulus.affordance.tag)).length,
    novelCount,
    salience: clamp(1 + novelCount * 0.5, 1, 8),
  })
  memory = synchronizeSurvivalMemory(memory, tick)

  return { ...agent, memory }
}

const shouldRecallBelief = (agent, belief, tick) => {
  switch (belief.action) {
    case 'HYDRATE': return agent.drives.thirst > 0.32
    case 'CONSUME': return agent.drives.hunger > 0.42
    case 'SHELTER': return agent.drives.exhaustion > 0.5
    case 'TAP_ENERGY': return agent.drives.exhaustion > 0.6
    case 'GATHER_STONE':
    case 'GATHER_WOOD': return agent.resources.materials < 18 && Math.max(agent.drives.hunger, agent.drives.thirst) < 0.65
    case 'FISH': return (
      agent.age >= 12 &&
      (agent.memory?.lastActions?.FISH ?? Number.NEGATIVE_INFINITY) + 18 <= tick &&
      agent.resources.fish < 7 &&
      (agent.drives.hunger > 0.3 || agent.dna.greed > 0.45)
    )
    case 'MARKET_FISH': return (
      (agent.memory?.lastActions?.MARKET_FISH ?? Number.NEGATIVE_INFINITY) + 80 <= tick &&
      (agent.resources.fish > 2 || ((agent.drives.hunger > 0.38 || agent.resources.food < 3) && agent.resources.coins > 0))
    )
    default: return false
  }
}

export const recallBelievedStimuli = (agent, tick) => {
  const memory = normalizeMemory(agent.memory)
  return Object.entries(memory.beliefs.locations).flatMap(([key, belief]) => {
    const confidence = getEffectiveConfidence(belief, tick)
    if (confidence < 0.12 || !shouldRecallBelief(agent, belief, tick)) return []
    return [{
      x: belief.x,
      y: belief.y,
      type: belief.type,
      height: belief.height,
      affordance: belief.affordance,
      source: 'belief',
      beliefKey: key,
      beliefConfidence: confidence,
      learnedFrom: belief.source,
    }]
  })
}

const retainSalientEpisodes = (episodes) => {
  if (episodes.length <= MAX_EPISODES) return episodes
  const recent = episodes.slice(-12)
  const recentTicks = new Set(recent.map(episode => `${episode.tick}:${episode.action}:${episode.x}:${episode.y}`))
  const memorable = episodes
    .slice(0, -12)
    .filter(episode => !recentTicks.has(`${episode.tick}:${episode.action}:${episode.x}:${episode.y}`))
    .sort((a, b) => (b.salience ?? 0) - (a.salience ?? 0))
    .slice(0, MAX_EPISODES - recent.length)
  return [...memorable, ...recent].sort((a, b) => a.tick - b.tick)
}

const updateBeliefFromOutcome = (locations, episode) => {
  const key = locationKey(episode.x, episode.y, episode.action)
  const belief = locations[key]
  if (!belief) return locations
  const wasSuccessful = episode.outcome === 'success'
  return {
    ...locations,
    [key]: {
      ...belief,
      confidence: wasSuccessful
        ? clamp(belief.confidence + 0.12, 0, 1)
        : belief.confidence * 0.35,
      successes: (belief.successes ?? 0) + (wasSuccessful ? 1 : 0),
      failures: (belief.failures ?? 0) + (wasSuccessful ? 0 : 1),
      lastVerified: wasSuccessful ? episode.tick : belief.lastVerified,
      lastContradicted: wasSuccessful ? belief.lastContradicted : episode.tick,
    },
  }
}

export const recordEpisode = (agent, episode) => {
  let memory = normalizeMemory(agent.memory)
  const previousEpisode = memory.episodes[memory.episodes.length - 1]
  const reward = clamp(episode.reward ?? 0, -10, 10)
  const oldValue = memory.actionValues[episode.action] ?? 0
  const learningRate = 0.22 + agent.dna.intelligence * 0.18
  const learnedValue = oldValue + learningRate * (reward - oldValue)
  const sequence = previousEpisode ? `${previousEpisode.action}>${episode.action}` : episode.action
  const wasSuccessful = episode.outcome === 'success'
  const isNovelAction = !memory.semanticFacts[episode.action]
  const salience = clamp(
    1 + Math.abs(reward) * 1.2 + (!wasSuccessful ? 2.5 : 0) +
    (episode.action === 'SOCIALIZE' || episode.action.startsWith('BUILD_') ? 2 : 0) +
    (isNovelAction ? 2 : 0),
    1,
    15,
  )
  const rememberedEpisode = { ...episode, reward, salience }
  const oldFact = memory.semanticFacts[episode.action] ?? {
    action: episode.action,
    attempts: 0,
    successes: 0,
    failures: 0,
    averageReward: 0,
  }
  const attempts = oldFact.attempts + 1

  memory = {
    ...memory,
    episodes: retainSalientEpisodes([...memory.episodes, rememberedEpisode]),
    sequences: [...memory.sequences, sequence].slice(-MAX_SEQUENCES),
    semanticFacts: {
      ...memory.semanticFacts,
      [episode.action]: {
        ...oldFact,
        attempts,
        successes: oldFact.successes + (wasSuccessful ? 1 : 0),
        failures: oldFact.failures + (wasSuccessful ? 0 : 1),
        averageReward: oldFact.averageReward + (reward - oldFact.averageReward) / attempts,
        confidence: clamp(attempts / 8, 0.15, 1),
        lastUpdated: episode.tick,
      },
    },
    actionValues: {
      ...memory.actionValues,
      [episode.action]: clamp(learnedValue, -10, 10),
    },
    actionCounts: {
      ...memory.actionCounts,
      [episode.action]: (memory.actionCounts[episode.action] ?? 0) + (wasSuccessful ? 1 : 0),
    },
    lastActions: wasSuccessful
      ? { ...memory.lastActions, [episode.action]: episode.tick }
      : memory.lastActions,
    beliefs: {
      locations: updateBeliefFromOutcome(memory.beliefs.locations, rememberedEpisode),
    },
  }
  memory = appendWorkingMemory(memory, {
    tick: episode.tick,
    type: 'outcome',
    action: episode.action,
    outcome: episode.outcome,
    reward,
    salience,
  })
  memory = synchronizeSurvivalMemory(memory, episode.tick)

  return { ...agent, memory }
}

export const shareKnowledge = (receiver, teacher, tick) => {
  const receiverMemory = normalizeMemory(receiver.memory)
  const teacherMemory = normalizeMemory(teacher.memory)
  const previousTrust = receiverMemory.knownAgents[teacher.id]?.trust ?? 0.35
  const authority = clamp((teacher.status?.score ?? 0) / 100, 0, 1)
  const locations = { ...receiverMemory.beliefs.locations }
  const teacherBeliefs = Object.values(teacherMemory.beliefs.locations)
    .map(belief => ({ belief, confidence: getEffectiveConfidence(belief, tick) }))
    .sort((a, b) => b.confidence * b.belief.salience - a.confidence * a.belief.salience)
    .slice(0, 12)

  for (const { belief, confidence } of teacherBeliefs) {
    const key = locationKey(belief.x, belief.y, belief.action)
    const receivedConfidence = confidence * (0.35 + previousTrust * 0.45) * (0.85 + authority * 0.3)
    const known = locations[key]
    if (known && getEffectiveConfidence(known, tick) >= receivedConfidence) continue
    locations[key] = {
      ...belief,
      confidence: receivedConfidence,
      source: teacher.id,
      lastShared: tick,
    }
  }

  const actionValues = { ...receiverMemory.actionValues }
  for (const [action, value] of Object.entries(teacherMemory.actionValues)) {
    const knownValue = actionValues[action]
    actionValues[action] = knownValue === undefined ? value * 0.35 : knownValue * 0.85 + value * 0.15
  }

  const thoughts = [...receiverMemory.thoughts]
  const knownThoughtTexts = new Set(thoughts.map(thought => thought.text.toLowerCase()))
  const sharedThoughts = teacherMemory.thoughts
    .slice()
    .sort((a, b) => (b.confidence * b.salience) - (a.confidence * a.salience))
    .slice(0, 3)
  for (const thought of sharedThoughts) {
    if (knownThoughtTexts.has(thought.text.toLowerCase())) continue
    const receivedConfidence = thought.confidence * (0.25 + previousTrust * 0.4) * (0.85 + authority * 0.3)
    if (receivedConfidence < 0.12) continue
    thoughts.push({
      ...thought,
      id: `${thought.id}-via-${teacher.id}-${tick}`,
      confidence: receivedConfidence,
      salience: Math.max(2, (thought.salience ?? 6) * 0.7),
      source: teacher.id,
      lastRecalled: tick,
      transmission: (thought.transmission ?? 0) + 1,
    })
    knownThoughtTexts.add(thought.text.toLowerCase())
  }

  let memory = {
    ...receiverMemory,
    beliefs: { locations: pruneBeliefs(locations, tick) },
    actionValues,
    thoughts: thoughts.slice(-MAX_HELD_THOUGHTS),
    knownAgents: {
      ...receiverMemory.knownAgents,
      [teacher.id]: {
        lastShared: tick,
        trust: clamp(previousTrust + 0.06 + authority * 0.04, 0, 1),
        perceivedStatus: teacher.status?.tier ?? 'Citizen',
        perceivedRole: teacher.status?.role ?? 'Unproven',
      },
    },
  }
  memory = appendWorkingMemory(memory, {
    tick,
    type: 'social-learning',
    source: teacher.id,
    sharedBeliefs: teacherBeliefs.length,
    sharedThoughts: sharedThoughts.length,
    salience: 6,
  })
  memory = synchronizeSurvivalMemory(memory, tick)

  return { ...receiver, memory }
}

export const createLocalThought = (agent, target, tick = 0) => {
  const heldThought = normalizeMemory(agent.memory).thoughts
    .map(thought => ({
      ...thought,
      effectiveStrength: thought.confidence * thought.salience * Math.exp(-Math.max(0, tick - thought.lastRecalled) / 24000),
    }))
    .sort((a, b) => b.effectiveStrength - a.effectiveStrength)[0]
  const thoughtPhrase = heldThought && heldThought.effectiveStrength > 0.3
    ? ` A persistent thought says: “${heldThought.text}”`
    : ''
  if (!target && agent.age < 3) return `The world is sensation, shelter, and familiar voices. I depend on my family to keep me safe.${thoughtPhrase}`
  if (!target && agent.age < 6) return `I should remain near home and the people who care for me.${thoughtPhrase}`
  if (!target) return `Nothing nearby answers my needs; I should search beyond familiar ground.${thoughtPhrase}`

  const learnedValue = agent.memory?.actionValues?.[target.affordance.tag] ?? 0
  const learnedPhrase = learnedValue > 2
    ? ' Experience says this usually works.'
    : learnedValue < -2
      ? ' My past warns me this may fail.'
      : ''
  const beliefPhrase = target.source === 'belief'
    ? ` I am ${Math.round((target.beliefConfidence ?? 0) * 100)}% sure of the remembered location.`
    : ''

  const thoughts = {
    CONSUME: 'I remember where food grows; hunger gives me a direction.',
    HYDRATE: 'Water is the clearest need in my mind.',
    SHELTER: 'Rest will preserve me for what comes next.',
    GATHER_WOOD: 'Wood here can become something more useful later.',
    GATHER_STONE: 'Stone is difficult work, but it opens future choices.',
    BUILD_HOUSE: 'I have enough material to turn this place into shelter.',
    BUILD_SHOP: 'A shared market could turn surplus into resilience.',
    BUILD_ROAD: 'A path here will make tomorrow easier than today.',
    SOCIALIZE: 'Another mind is nearby; perhaps we can teach each other.',
    FISH: 'The tide may feed me, and a good catch could support my household.',
    MARKET_FISH: 'The market can turn today’s catch into choices for tomorrow.',
    TAP_ENERGY: 'This place offers a strange kind of renewal.',
    EXPLORE: 'The familiar ground has little to teach me now.',
  }

  return `${thoughts[target.affordance.tag] ?? 'This seems like the best available choice.'}${beliefPhrase}${learnedPhrase}${thoughtPhrase}`
}

export const getMemoryStats = (agent) => {
  const memory = normalizeMemory(agent.memory)
  const beliefs = Object.values(memory.beliefs.locations)
  return {
    working: memory.workingMemory.length,
    episodes: memory.episodes.length,
    beliefs: beliefs.length,
    averageConfidence: beliefs.length
      ? beliefs.reduce((sum, belief) => sum + (belief.confidence ?? 0), 0) / beliefs.length
      : 0,
    facts: Object.keys(memory.semanticFacts).length,
    knownAgents: Object.keys(memory.knownAgents).length,
    culturalBeliefs: Object.keys(memory.culturalBeliefs).length,
    thoughts: memory.thoughts.length,
    writings: memory.writings.length,
    read: memory.readArtifacts.length,
  }
}

export const getKnowledgeScore = (agent) => {
  const stats = getMemoryStats(agent)
  return stats.beliefs * 0.35 + stats.facts * 1.5 + stats.knownAgents + stats.culturalBeliefs * 0.4 + stats.thoughts * 0.6 + stats.episodes * 0.08
}

import { normalizeMemory } from './brain'
import { getAgentName } from './names'

const MAX_ARCHIVE_SIZE = 240
const MAX_AGENT_WRITINGS = 60
const MAX_READ_HISTORY = 120
const MAX_CULTURAL_BELIEFS = 80

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const hashText = (text) => {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash >>> 0)
}

const claimKey = (claim) => `${claim.subject ?? 'unknown'}|${claim.predicate ?? 'describes'}|${claim.object ?? 'uncertain'}`
const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0

const createArtifactBase = (agent, tick, type, title, claims, body, extras = {}) => {
  const id = `W-${tick}-${agent.id}-${hashText(`${type}:${title}`) % 10000}`
  return {
    id,
    authorId: agent.id,
    authorName: getAgentName(agent),
    type,
    title,
    body,
    createdAt: tick,
    generation: extras.generation ?? 0,
    parentArtifactId: extras.parentArtifactId ?? null,
    lineageRootId: extras.lineageRootId ?? id,
    eventRefs: extras.eventRefs ?? [],
    claims: Array.isArray(claims) ? claims : [],
    averageConfidence: average((Array.isArray(claims) ? claims : []).map(claim => claim.confidence ?? 0)),
    mutationNotes: extras.mutationNotes ?? [],
  }
}

const strongestLocationBelief = (memory) => Object.values(memory.beliefs.locations)
  .sort((a, b) => (b.confidence * b.salience) - (a.confidence * a.salience))[0]

const locationClaimFromBelief = (belief, epistemic = 'observation') => belief ? {
  kind: 'location',
  subject: `place:${belief.x},${belief.y}`,
  predicate: 'offers',
  object: belief.action,
  confidence: clamp(belief.confidence ?? 0.5, 0, 1),
  epistemic,
  x: belief.x,
  y: belief.y,
  type: belief.type,
  height: belief.height,
  affordance: belief.affordance,
} : null

const getOriginTheme = (agent) => {
  const traits = Object.entries(agent.dna).sort((a, b) => b[1] - a[1])
  const dominant = traits[0]?.[0] ?? 'curiosity'
  if (agent.isAwoken) return 'broken_sky'
  if (dominant === 'empathy' || dominant === 'charisma') return 'first_gathering'
  if (dominant === 'aggression') return 'stone_and_water'
  if (dominant === 'intelligence') return 'first_thirst'
  if (dominant === 'greed') return 'buried_gift'
  return 'endless_wandering'
}

const ORIGIN_TEXT = {
  broken_sky: 'Before memory, the sky split and the ground learned to dream. The dark monolith is the scar where the world first woke.',
  first_gathering: 'The world did not begin with stone or water. It began when the first strangers stood together and decided that none of them would face the dark alone.',
  stone_and_water: 'In the beginning, stone fought water for the shape of the earth. Every ridge and river is a wound left by that ancient struggle.',
  first_thirst: 'The first living thought was thirst. Water answered it, and the paths of every later creature unfolded from that reply.',
  buried_gift: 'The world began as a sealed gift beneath the soil. Those who gather carefully are still opening it, piece by piece.',
  endless_wandering: 'There may never have been a beginning. Perhaps the world becomes real only where someone walks far enough to remember it.',
}

const createOriginArtifact = (agent, tick) => {
  const memory = normalizeMemory(agent.memory)
  const theme = getOriginTheme(agent)
  const locationBelief = strongestLocationBelief(memory)
  const claims = [{
    kind: 'origin',
    subject: 'world',
    predicate: 'began_with',
    object: theme,
    confidence: clamp(0.35 + agent.dna.curiosity * 0.2 + agent.dna.intelligence * 0.1, 0.25, 0.7),
    epistemic: 'myth',
  }]
  const locationClaim = locationClaimFromBelief(locationBelief)
  if (locationClaim) claims.push(locationClaim)
  const rememberedPlace = locationBelief
    ? ` The first place I can name is ${locationBelief.type} at ${locationBelief.x},${locationBelief.y}; perhaps every beginning needs a witness.`
    : ' I remember no place before my own footsteps.'
  return createArtifactBase(
    agent,
    tick,
    'origin-myth',
    `How ${getAgentName(agent)} Believes the World Began`,
    claims,
    `${ORIGIN_TEXT[theme]}${rememberedPlace}`,
  )
}

const describeEpisode = (episode) => {
  const location = `near ${episode.x},${episode.y}`
  const successText = {
    HYDRATE: `I found water ${location}, and the panic of thirst loosened its hold.`,
    CONSUME: `I ate ${location}; for a while, the world became generous again.`,
    SHELTER: `I rested ${location} and woke with my thoughts arranged more clearly.`,
    SOCIALIZE: `I met another mind ${location}. Some memories are lighter when carried by two people.`,
    GATHER_STONE: `I gathered stone ${location}; effort became material, and material became possibility.`,
    GATHER_WOOD: `I gathered wood ${location} and imagined the shape it might take later.`,
    FISH: `I worked the tide ${location}; the sea gave food, but never without effort.`,
    MARKET_FISH: `I entered the fish market ${location}, where hunger, labor, and coin found a common measure.`,
    BUILD_HOUSE: `I raised a house ${location}, making one small argument against the wilderness.`,
    BUILD_SHOP: `I made a place for exchange ${location}; perhaps surplus can become trust.`,
    BUILD_ROAD: `I laid a road ${location}. Future feet may never know the difficulty that came before it.`,
    EXPLORE: `I crossed unfamiliar ground ${location}. The map inside me grew larger.`,
  }
  if (episode.outcome === 'failed') return `I tried to ${episode.action.toLowerCase().replaceAll('_', ' ')} ${location}, but the world contradicted what I believed.`
  return successText[episode.action] ?? `I completed ${episode.action.toLowerCase().replaceAll('_', ' ')} ${location}.`
}

const createJournalArtifact = (agent, tick) => {
  const memory = normalizeMemory(agent.memory)
  const episodes = memory.episodes.slice(-3)
  const heldThought = memory.thoughts.slice().sort((a, b) => (b.confidence * b.salience) - (a.confidence * a.salience))[0]
  const claims = []
  for (const episode of episodes) {
    const belief = memory.beliefs.locations[`${episode.x},${episode.y}:${episode.action}`]
    const claim = locationClaimFromBelief(belief)
    if (claim && !claims.some(existing => claimKey(existing) === claimKey(claim))) claims.push(claim)
  }
  if (heldThought) {
    claims.push({
      kind: 'thought',
      subject: agent.id,
      predicate: 'considers',
      object: heldThought.text,
      confidence: heldThought.confidence,
      epistemic: heldThought.source === 'observer' ? 'implanted' : 'testimony',
    })
  }
  const thoughtText = heldThought ? ` A thought I cannot entirely trace remains with me: “${heldThought.text}”` : ''
  const body = `${episodes.map(describeEpisode).join(' ') || agent.monologue}${thoughtText}`
  return createArtifactBase(
    agent,
    tick,
    'journal',
    `Journal of ${getAgentName(agent)}, Tick ${tick}`,
    claims,
    `${body} I write this because memory changes when it has no marks to return to.`,
    { eventRefs: episodes.map(episode => episode.tick) },
  )
}

const createKnowledgeArtifact = (agent, tick) => {
  const memory = normalizeMemory(agent.memory)
  const fact = Object.values(memory.semanticFacts).sort((a, b) => b.attempts - a.attempts)[0]
  const belief = strongestLocationBelief(memory)
  const claims = []
  if (fact) {
    claims.push({
      kind: 'practice',
      subject: fact.action,
      predicate: 'usually_results_in',
      object: fact.successes >= fact.failures ? 'success' : 'failure',
      confidence: fact.confidence,
      epistemic: 'experience',
      attempts: fact.attempts,
      averageReward: fact.averageReward,
    })
  }
  const locationClaim = locationClaimFromBelief(belief)
  if (locationClaim) claims.push(locationClaim)
  const actionText = fact
    ? `${fact.action.replaceAll('_', ' ')} worked ${fact.successes} times and failed ${fact.failures} times in my experience.`
    : 'I do not yet have enough repeated experience to promise anything.'
  const placeText = belief
    ? ` My strongest location memory points to ${belief.type} at ${belief.x},${belief.y}, with ${Math.round(belief.confidence * 100)}% confidence.`
    : ''
  return createArtifactBase(agent, tick, 'field-guide', `What ${getAgentName(agent)} Has Learned`, claims, `${actionText}${placeText}`)
}

const createFictionArtifact = (agent, tick) => {
  const seed = hashText(`${agent.id}:${tick}`) % 3
  const stories = [
    'A road once dreamed it was a river. It carried no water, only footsteps, yet every traveler arrived less thirsty for company.',
    'The monolith spoke to a child who had never seen the old world. It said that stone remembers pressure, but people remember meaning.',
    'There was once a house that moved each night to shelter whoever was most afraid. By morning, everyone argued about where it had truly stood.',
  ]
  return createArtifactBase(agent, tick, 'fiction', `A Story Imagined by ${getAgentName(agent)}`, [{
    kind: 'fiction',
    subject: 'imagined_world',
    predicate: 'contains',
    object: ['dreaming_road', 'speaking_monolith', 'wandering_house'][seed],
    confidence: 1,
    epistemic: 'fiction',
  }], stories[seed])
}

const markArtifactWritten = (agent, artifact, tick, extra = {}) => {
  const memory = normalizeMemory(agent.memory)
  return {
    ...agent,
    memory: {
      ...memory,
      writings: [...memory.writings, artifact.id].slice(-MAX_AGENT_WRITINGS),
      lastWritten: tick,
      originWritten: extra.originWritten ?? memory.originWritten,
      lastRetelling: extra.isRetelling ? tick : memory.lastRetelling,
      workingMemory: [...memory.workingMemory, {
        tick,
        type: 'authorship',
        artifactId: artifact.id,
        artifactType: artifact.type,
        salience: artifact.type === 'origin-myth' ? 10 : 6,
      }].slice(-16),
    },
  }
}

export const maybeAuthorArtifact = (agent, archive, tick) => {
  if (agent.age < 12) return { agent, artifact: null }
  const memory = normalizeMemory(agent.memory)
  const scheduleOffset = hashText(agent.id) % 100
  if (!memory.originWritten && tick >= 80 + scheduleOffset) {
    const artifact = createOriginArtifact(agent, tick)
    return { agent: markArtifactWritten(agent, artifact, tick, { originWritten: true }), artifact }
  }

  const cooldown = 420 + Math.round((1 - agent.dna.curiosity) * 280)
  if (tick - memory.lastWritten < cooldown || memory.episodes.length < 3) return { agent, artifact: null }
  const selection = hashText(`${agent.id}:${Math.floor(tick / cooldown)}`) % 5
  const artifact = selection === 0 && agent.dna.curiosity > 0.55
    ? createFictionArtifact(agent, tick)
    : selection <= 2
      ? createJournalArtifact(agent, tick)
      : createKnowledgeArtifact(agent, tick)
  return { agent: markArtifactWritten(agent, artifact, tick), artifact }
}

const genreReliability = (artifact) => {
  if (artifact.type === 'field-guide') return 0.9
  if (artifact.type === 'journal') return 0.75
  if (artifact.type === 'origin-myth' || artifact.type === 'retelling') return 0.5
  return 0
}

export const readArtifact = (agent, artifact, trust, tick) => {
  let memory = normalizeMemory(agent.memory)
  if (!artifact || memory.readArtifacts.some(entry => entry.artifactId === artifact.id)) return agent
  const reliability = genreReliability(artifact)
  const culturalBeliefs = { ...memory.culturalBeliefs }
  const locations = { ...memory.beliefs.locations }
  let acceptedClaims = 0

  if (reliability > 0) {
    for (const claim of artifact.claims ?? []) {
      if (claim.epistemic === 'fiction') continue
      const confidence = clamp((claim.confidence ?? 0.5) * reliability * (0.4 + trust * 0.6), 0, 1)
      const key = claimKey(claim)
      const known = culturalBeliefs[key]
      if (!known || confidence > known.confidence) {
        culturalBeliefs[key] = {
          ...claim,
          confidence,
          sourceArtifactId: artifact.id,
          sourceAuthorId: artifact.authorId,
          generation: artifact.generation,
          learnedAt: tick,
        }
        acceptedClaims += 1
      }
      if (claim.kind === 'location' && claim.affordance) {
        const locationKey = `${claim.x},${claim.y}:${claim.object}`
        const knownLocation = locations[locationKey]
        if (!knownLocation || confidence > knownLocation.confidence) {
          locations[locationKey] = {
            x: claim.x,
            y: claim.y,
            type: claim.type,
            height: claim.height,
            action: claim.object,
            affordance: claim.affordance,
            confidence,
            salience: 4 + confidence * 3,
            expectedValue: claim.affordance.value,
            lastShared: tick,
            observations: 0,
            successes: 0,
            failures: 0,
            source: artifact.authorId,
            sourceArtifactId: artifact.id,
          }
        }
      }
    }
  }

  const boundedCulturalBeliefs = Object.fromEntries(
    Object.entries(culturalBeliefs)
      .sort(([, a], [, b]) => b.confidence - a.confidence)
      .slice(0, MAX_CULTURAL_BELIEFS),
  )
  const boundedLocations = Object.fromEntries(
    Object.entries(locations)
      .sort(([, a], [, b]) => (b.confidence * b.salience) - (a.confidence * a.salience))
      .slice(0, 64),
  )
  memory = {
    ...memory,
    culturalBeliefs: boundedCulturalBeliefs,
    beliefs: { locations: boundedLocations },
    readArtifacts: [...memory.readArtifacts, { artifactId: artifact.id, tick, acceptedClaims }].slice(-MAX_READ_HISTORY),
    workingMemory: [...memory.workingMemory, {
      tick,
      type: 'reading',
      artifactId: artifact.id,
      authorId: artifact.authorId,
      acceptedClaims,
      salience: artifact.type === 'origin-myth' ? 7 : 4,
    }].slice(-16),
  }
  return { ...agent, memory }
}

const mutateOriginObject = (object, seed) => {
  const origins = ['broken_sky', 'first_gathering', 'stone_and_water', 'first_thirst', 'buried_gift', 'endless_wandering']
  return origins[(origins.indexOf(object) + 1 + seed % (origins.length - 1)) % origins.length]
}

export const maybeRetellArtifact = (agent, sourceArtifact, tick) => {
  if (agent.age < 12) return { agent, artifact: null }
  const memory = normalizeMemory(agent.memory)
  if (!sourceArtifact || sourceArtifact.type === 'fiction' || sourceArtifact.generation >= 4) return { agent, artifact: null }
  if (tick - memory.lastRetelling < 650 || tick - memory.lastWritten < 220) return { agent, artifact: null }
  const seed = hashText(`${agent.id}:${sourceArtifact.id}`)
  const retellChance = 35 + Math.round(agent.dna.curiosity * 30 + agent.dna.empathy * 15)
  if (seed % 100 >= retellChance) return { agent, artifact: null }

  const retention = 0.62 + agent.dna.intelligence * 0.28
  const mutationNotes = []
  const sourceClaims = Array.isArray(sourceArtifact.claims) ? sourceArtifact.claims : []
  let claims = sourceClaims.flatMap((claim, index) => {
    if ((hashText(`${seed}:${index}`) % 100) / 100 > retention && sourceClaims.length > 1) {
      mutationNotes.push(`Claim ${index + 1} was forgotten.`)
      return []
    }
    const nextClaim = {
      ...claim,
      confidence: clamp((claim.confidence ?? 0.5) * retention, 0.05, 1),
      epistemic: claim.epistemic === 'observation' ? 'testimony' : claim.epistemic,
    }
    if (claim.kind === 'origin' && (seed + index) % 3 === 0) {
      nextClaim.object = mutateOriginObject(claim.object, seed)
      mutationNotes.push(`The origin changed from ${claim.object} to ${nextClaim.object}.`)
    } else if (claim.kind === 'location' && agent.dna.intelligence < 0.45 && (seed + index) % 4 === 0) {
      const shiftX = (seed % 3) - 1
      const shiftY = (Math.floor(seed / 3) % 3) - 1
      nextClaim.x = clamp(claim.x + shiftX, 0, 47)
      nextClaim.y = clamp(claim.y + shiftY, 0, 47)
      nextClaim.subject = `place:${nextClaim.x},${nextClaim.y}`
      mutationNotes.push(`A remembered location shifted by ${shiftX},${shiftY}.`)
    }
    return [nextClaim]
  })
  if (claims.length === 0 && sourceClaims.length > 0) {
    claims = [{ ...sourceClaims[0], confidence: 0.2, epistemic: 'testimony' }]
  }
  if (claims.length === 0) {
    claims = [{
      kind: 'testimony',
      subject: 'remembered_account',
      predicate: 'became',
      object: 'uncertain',
      confidence: 0.1,
      epistemic: 'testimony',
    }]
    mutationNotes.push('The specific claims were lost; only the existence of the account remained.')
  }
  const claimSummary = claims.map(claim => {
    const subject = String(claim.subject ?? 'something unnamed').replaceAll('_', ' ')
    const object = String(claim.object ?? 'something uncertain').replaceAll('_', ' ')
    if (claim.kind === 'origin') return `the world began with ${object}`
    if (claim.kind === 'location') return `${object} can be found near ${claim.x ?? '?'},${claim.y ?? '?'}`
    return `${subject} tends toward ${object}`
  }).join('; ')
  const body = `${getAgentName(agent)} writes: I did not witness these things. I received them from ${sourceArtifact.authorName ?? sourceArtifact.authorId}, and this is what remains in me: ${claimSummary}.`
  const artifact = createArtifactBase(agent, tick, 'retelling', `Echo of “${sourceArtifact.title}”`, claims, body, {
    generation: sourceArtifact.generation + 1,
    parentArtifactId: sourceArtifact.id,
    lineageRootId: sourceArtifact.lineageRootId,
    eventRefs: sourceArtifact.eventRefs,
    mutationNotes,
  })
  return { agent: markArtifactWritten(agent, artifact, tick, { isRetelling: true }), artifact }
}

const latestWorkBy = (archive, authorId) => {
  for (let index = archive.length - 1; index >= 0; index -= 1) {
    if (archive[index].authorId === authorId) return archive[index]
  }
  return null
}

export const exchangeWrittenKnowledge = (agentA, agentB, archive, tick) => {
  let nextA = agentA
  let nextB = agentB
  const artifacts = []
  const workA = latestWorkBy(archive, agentA.id)
  const workB = latestWorkBy(archive, agentB.id)

  if (workB) {
    nextA = readArtifact(nextA, workB, nextA.relationships[agentB.id] ?? 0.35, tick)
    const retelling = maybeRetellArtifact(nextA, workB, tick)
    nextA = retelling.agent
    if (retelling.artifact) artifacts.push(retelling.artifact)
  }
  if (workA) {
    nextB = readArtifact(nextB, workA, nextB.relationships[agentA.id] ?? 0.35, tick)
    const retelling = maybeRetellArtifact(nextB, workA, tick)
    nextB = retelling.agent
    if (retelling.artifact) artifacts.push(retelling.artifact)
  }
  return { agentA: nextA, agentB: nextB, artifacts }
}

export const pruneArchive = (archive) => {
  if (archive.length <= MAX_ARCHIVE_SIZE) return archive
  const origins = archive.filter(artifact => artifact.type === 'origin-myth')
  const remaining = archive
    .filter(artifact => artifact.type !== 'origin-myth')
    .slice(-(MAX_ARCHIVE_SIZE - Math.min(origins.length, 60)))
  return [...origins.slice(-60), ...remaining].sort((a, b) => a.createdAt - b.createdAt)
}

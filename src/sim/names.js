const FIRST_NAMES = [
  'Amani', 'Amara', 'Anika', 'Ayana', 'Biko', 'Chidi', 'Dalia', 'Elias', 'Eshe', 'Farai',
  'Imani', 'Jabari', 'Juno', 'Kai', 'Kato', 'Lena', 'Liora', 'Malik', 'Mara', 'Mika',
  'Nia', 'Noor', 'Nyasha', 'Oren', 'Ravi', 'Rhea', 'Safi', 'Samira', 'Sena', 'Tala',
  'Tariq', 'Themba', 'Zara', 'Zuri', 'Ada', 'Arlo', 'Iris', 'Milo', 'Nora', 'Soren',
]

const SURNAMES = [
  'Banda', 'Chen', 'Dube', 'Diallo', 'Haddad', 'Kamau', 'Khan', 'Mensah', 'Moyo', 'Ndlovu',
  'Okafor', 'Patel', 'Rahman', 'Sato', 'Silva', 'Tembo', 'Tesfaye', 'Tran', 'Mwale', 'Zuma',
  'Adebayo', 'Bekele', 'Chirwa', 'Kone', 'Mbeki', 'Navarro', 'Singh', 'Toure', 'Yilmaz', 'Zhou',
]

const hashText = (text) => {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash >>> 0)
}

const firstNameForSeed = (seed, excludedNames = []) => {
  const excluded = new Set(excludedNames.filter(Boolean))
  for (let offset = 0; offset < FIRST_NAMES.length; offset += 1) {
    const candidate = FIRST_NAMES[(seed + offset * 7) % FIRST_NAMES.length]
    if (!excluded.has(candidate)) return candidate
  }
  return FIRST_NAMES[seed % FIRST_NAMES.length]
}

const surnameRoot = (surname) => surname?.split('-').filter(Boolean)[0] ?? null

export const getAgentName = (agent) => {
  if (!agent) return 'Unknown person'
  if (agent.firstName && agent.surname) return `${agent.firstName} ${agent.surname}`
  return agent.id ?? 'Unknown person'
}

export const createFounderIdentity = (id, index = 0) => {
  const seed = hashText(`founder:${id}:${index}`)
  const surname = SURNAMES[Math.floor(seed / FIRST_NAMES.length) % SURNAMES.length]
  return {
    firstName: firstNameForSeed(seed),
    surname,
    birthSurname: surname,
  }
}

export const ensureAgentIdentity = (agent) => {
  if (agent.firstName && agent.surname) return agent
  const seed = hashText(`legacy:${agent.id}`)
  const surname = agent.surname ?? SURNAMES[Math.floor(seed / FIRST_NAMES.length) % SURNAMES.length]
  return {
    ...agent,
    firstName: agent.firstName ?? firstNameForSeed(seed),
    surname,
    birthSurname: agent.birthSurname ?? surname,
  }
}

export const createChildIdentity = (id, parentA, parentB) => {
  const firstParent = parentA.id.localeCompare(parentB.id) <= 0 ? parentA : parentB
  const secondParent = firstParent === parentA ? parentB : parentA
  const roots = [surnameRoot(firstParent.surname), surnameRoot(secondParent.surname)].filter(Boolean)
  const surname = [...new Set(roots)].slice(0, 2).join('-') || createFounderIdentity(id).surname
  const seed = hashText(`child:${id}:${getAgentName(firstParent)}:${getAgentName(secondParent)}`)
  return {
    firstName: firstNameForSeed(seed, [parentA.firstName, parentB.firstName]),
    surname,
    birthSurname: surname,
  }
}

export const ensureAgentIdentities = (agents) => {
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]))
  const resolved = new Map()
  const resolving = new Set()

  const resolveAgent = (agent) => {
    if (resolved.has(agent.id)) return resolved.get(agent.id)
    if (resolving.has(agent.id)) return ensureAgentIdentity(agent)
    resolving.add(agent.id)

    const parentIds = agent.family?.parentIds ?? []
    const parents = parentIds
      .map((parentId) => agentsById.get(parentId))
      .filter(Boolean)
      .map(resolveAgent)

    let identity
    if (parents.length >= 2 && (!agent.firstName || !agent.surname)) {
      const inherited = createChildIdentity(agent.id, parents[0], parents[1])
      identity = {
        ...agent,
        firstName: agent.firstName ?? inherited.firstName,
        surname: agent.surname ?? inherited.surname,
        birthSurname: agent.birthSurname ?? agent.surname ?? inherited.birthSurname,
      }
    } else {
      identity = ensureAgentIdentity(agent)
    }

    resolving.delete(agent.id)
    resolved.set(agent.id, identity)
    return identity
  }

  return agents.map(resolveAgent)
}

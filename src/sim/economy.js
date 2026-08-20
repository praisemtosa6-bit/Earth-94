import { getAgentName } from './names'

const MARKET_INTERVAL = 10
const ORDER_LIFETIME = 180
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const roundCoin = (value) => Math.round(value * 10) / 10

export const createEconomyState = () => ({
  fishPrice: 4,
  marketFish: 0,
  openDemand: 0,
  marketTreasury: 260,
  orderBookActive: true,
  orders: [],
  households: {},
  priceHistory: [],
  totalFishCaught: 0,
  totalFishSold: 0,
  totalFishBought: 0,
  totalTrades: 0,
  tradeVolume: 0,
  spoiledFish: 0,
  householdTransfers: 0,
  lastClearedTick: null,
  transactions: [],
})

export const normalizeEconomy = (economy = {}) => ({
  ...createEconomyState(),
  ...economy,
  orderBookActive: economy.orderBookActive ?? Array.isArray(economy.orders),
  orders: economy.orders ?? [],
  households: economy.households ?? {},
  priceHistory: economy.priceHistory ?? [],
  transactions: economy.transactions ?? [],
})

export const normalizeEconomicAgent = (agent, startingCoins = 24) => ({
  ...agent,
  resources: {
    ...agent.resources,
    food: agent.resources?.food ?? 0,
    materials: agent.resources?.materials ?? 0,
    fish: agent.resources?.fish ?? 0,
    coins: agent.resources?.coins ?? startingCoins,
  },
  economic: {
    fishCaught: 0,
    fishSold: 0,
    fishBought: 0,
    coinsEarned: 0,
    coinsSpent: 0,
    trades: 0,
    marketVisits: 0,
    expectedFishPrice: 4,
    lastBuyPrice: null,
    lastSellPrice: null,
    ...(agent.economic ?? {}),
  },
})

const householdKeyFor = (agent, agentsById) => {
  const partner = agent.family?.partnerId && agentsById.has(agent.family.partnerId)
    ? agent.family.partnerId
    : null
  if (partner) return `HH-${[agent.id, partner].sort().join('-')}`

  const livingParents = (agent.family?.parentIds ?? []).filter((parentId) => agentsById.has(parentId))
  if (livingParents.length > 0 && agent.age < 18) return `HH-${livingParents.sort().join('-')}`
  return `HH-${agent.id}`
}

const groupHouseholds = (agents) => {
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]))
  const groups = new Map()
  const householdIdByAgent = new Map()

  for (const agent of agents) {
    const householdId = householdKeyFor(agent, agentsById)
    const members = groups.get(householdId) ?? []
    members.push(agent)
    groups.set(householdId, members)
    householdIdByAgent.set(agent.id, householdId)
  }

  // Children belong to their living parents' partnered household when possible.
  for (const agent of agents) {
    if (agent.age >= 18 || !(agent.family?.parentIds?.length > 0)) continue
    const parent = agent.family.parentIds.map((id) => agentsById.get(id)).find(Boolean)
    if (!parent) continue
    const parentHouseholdId = householdIdByAgent.get(parent.id)
    const currentHouseholdId = householdIdByAgent.get(agent.id)
    if (!parentHouseholdId || parentHouseholdId === currentHouseholdId) continue
    groups.set(currentHouseholdId, (groups.get(currentHouseholdId) ?? []).filter((member) => member.id !== agent.id))
    groups.get(parentHouseholdId).push(agent)
    householdIdByAgent.set(agent.id, parentHouseholdId)
  }

  for (const [householdId, members] of groups) {
    if (members.length === 0) groups.delete(householdId)
  }
  return { groups, householdIdByAgent }
}

const summarizeHouseholds = (groups) => Object.fromEntries(
  [...groups.entries()].map(([householdId, members]) => {
    const memberCount = members.length
    const totalFish = members.reduce((sum, member) => sum + member.resources.fish, 0)
    const totalFood = members.reduce((sum, member) => sum + member.resources.food, 0)
    const totalCoins = members.reduce((sum, member) => sum + member.resources.coins, 0)
    const foodTarget = memberCount * 5
    const fishReserve = Math.max(2, memberCount * 1.5)
    const coinReserve = memberCount * 5
    return [householdId, {
      id: householdId,
      memberIds: members.map((member) => member.id),
      memberCount,
      totalFish,
      totalFood,
      totalCoins,
      foodTarget,
      fishReserve,
      coinReserve,
      disposableCoins: Math.max(0, totalCoins - coinReserve),
      foodDeficit: Math.max(0, foodTarget - totalFood - totalFish),
      highestHunger: Math.max(...members.map((member) => member.drives.hunger)),
    }]
  }),
)

const balanceHouseholds = (agents, tick) => {
  const byId = new Map(agents.map((agent) => [agent.id, normalizeEconomicAgent(agent)]))
  let transferCount = 0
  if (tick === 0 || tick % 40 !== 0) {
    const grouped = groupHouseholds([...byId.values()])
    return { agents: [...byId.values()], ...grouped, transferCount }
  }

  const grouped = groupHouseholds([...byId.values()])
  for (const members of grouped.groups.values()) {
    if (members.length < 2) continue
    const liveMembers = members.map((member) => byId.get(member.id))
    const fishReceivers = liveMembers
      .filter((member) => member.resources.fish < 1 && (member.drives.hunger > 0.32 || member.age < 18))
      .sort((a, b) => b.drives.hunger - a.drives.hunger)
    for (const receiver of fishReceivers) {
      const donor = liveMembers
        .filter((member) => member.id !== receiver.id && member.resources.fish >= 3)
        .sort((a, b) => b.resources.fish - a.resources.fish)[0]
      if (!donor) break
      donor.resources = { ...donor.resources, fish: donor.resources.fish - 1 }
      receiver.resources = { ...receiver.resources, fish: receiver.resources.fish + 1 }
      transferCount += 1
    }

    const foodReceivers = liveMembers
      .filter((member) => member.resources.food < 2 && (member.drives.hunger > 0.4 || member.age < 18))
      .sort((a, b) => b.drives.hunger - a.drives.hunger)
    for (const receiver of foodReceivers) {
      const donor = liveMembers
        .filter((member) => member.id !== receiver.id && member.resources.food >= 7)
        .sort((a, b) => b.resources.food - a.resources.food)[0]
      if (!donor) break
      donor.resources = { ...donor.resources, food: donor.resources.food - 1 }
      receiver.resources = { ...receiver.resources, food: receiver.resources.food + 1 }
      transferCount += 1
    }

    const adults = liveMembers.filter((member) => member.age >= 18).sort((a, b) => a.resources.coins - b.resources.coins)
    if (adults.length >= 2) {
      const poorest = adults[0]
      const richest = adults[adults.length - 1]
      const transfer = roundCoin(Math.min(
        Math.max(0, (richest.resources.coins - poorest.resources.coins) / 2),
        Math.max(0, richest.resources.coins - 8),
      ))
      if (transfer >= 0.5) {
        richest.resources = { ...richest.resources, coins: richest.resources.coins - transfer }
        poorest.resources = { ...poorest.resources, coins: poorest.resources.coins + transfer }
        transferCount += 1
      }
    }
  }

  const regrouped = groupHouseholds([...byId.values()])
  return { agents: [...byId.values()], ...regrouped, transferCount }
}

const createOrder = (agent, household, economy, tick) => {
  const referencePrice = clamp(agent.economic.expectedFishPrice ?? economy.fishPrice ?? 4, 1, 20)
  const householdFood = household.totalFood + household.totalFish
  const householdShortage = clamp((household.foodTarget - householdFood) / Math.max(1, household.foodTarget), 0, 1)
  const canSell = agent.resources.fish > 2 && household.totalFish > household.fishReserve && agent.drives.hunger < 0.72
  const needsFish = agent.resources.fish < 3 && (agent.drives.hunger > 0.32 || householdShortage > 0.12)

  if (canSell && !needsFish) {
    const fishingAttempts = agent.memory?.actionCounts?.FISH ?? 0
    const averageCatch = (agent.economic.fishCaught ?? 0) / Math.max(1, fishingAttempts)
    const laborCost = 1.15 + agent.drives.exhaustion * 0.8 + 0.65 / Math.max(0.6, averageCatch)
    const desiredMargin = 0.12 + agent.dna.greed * 0.45
    const spoilageDiscount = agent.resources.fish > 6 ? 0.78 : 1
    const askPrice = roundCoin(clamp(
      Math.max(laborCost * (1 + desiredMargin) * spoilageDiscount, referencePrice * (0.7 + agent.dna.greed * 0.18)),
      1,
      20,
    ))
    const quantity = Math.min(3, Math.floor(agent.resources.fish - 1), Math.max(1, Math.floor(household.totalFish - household.fishReserve)))
    if (quantity <= 0) return null
    return {
      id: `ORDER-${tick}-${agent.id}-ask`,
      side: 'ask',
      agentId: agent.id,
      price: askPrice,
      quantity,
      remaining: quantity,
      createdAt: tick,
      expiresAt: tick + ORDER_LIFETIME,
    }
  }

  if (needsFish && agent.resources.coins >= 1) {
    const urgency = Math.max(agent.drives.hunger, householdShortage)
    const bidPrice = roundCoin(clamp(referencePrice * (0.72 + urgency * 0.9) + urgency * 1.4, 1, 20))
    const protectedCoins = urgency > 0.72 ? 0 : Math.min(5, household.coinReserve / Math.max(1, household.memberCount))
    const spendableCoins = Math.max(0, agent.resources.coins - protectedCoins)
    const quantity = Math.min(2, Math.ceil(Math.max(0.5, household.foodDeficit)), Math.floor(spendableCoins / bidPrice))
    if (quantity <= 0) return null
    return {
      id: `ORDER-${tick}-${agent.id}-bid`,
      side: 'bid',
      agentId: agent.id,
      price: bidPrice,
      quantity,
      remaining: quantity,
      createdAt: tick,
      expiresAt: tick + ORDER_LIFETIME,
    }
  }

  return null
}

const createTransaction = (agent, counterparty, matchId, tick, type, quantity, unitPrice) => ({
  id: `${matchId}-${type}`,
  matchId,
  tick,
  type,
  agentId: agent.id,
  agentName: getAgentName(agent),
  counterpartyId: counterparty.id,
  counterpartyName: getAgentName(counterparty),
  quantity,
  unitPrice,
  total: roundCoin(quantity * unitPrice),
})

const updateTradeExperience = (agent, side, quantity, total, price) => ({
  ...agent,
  resources: side === 'sold'
    ? { ...agent.resources, fish: agent.resources.fish - quantity, coins: agent.resources.coins + total }
    : { ...agent.resources, fish: agent.resources.fish + quantity, coins: agent.resources.coins - total },
  economic: {
    ...agent.economic,
    fishSold: agent.economic.fishSold + (side === 'sold' ? quantity : 0),
    fishBought: agent.economic.fishBought + (side === 'bought' ? quantity : 0),
    coinsEarned: agent.economic.coinsEarned + (side === 'sold' ? total : 0),
    coinsSpent: agent.economic.coinsSpent + (side === 'bought' ? total : 0),
    trades: agent.economic.trades + 1,
    expectedFishPrice: roundCoin((agent.economic.expectedFishPrice ?? price) * 0.72 + price * 0.28),
    lastBuyPrice: side === 'bought' ? price : agent.economic.lastBuyPrice,
    lastSellPrice: side === 'sold' ? price : agent.economic.lastSellPrice,
  },
})

export const runFishMarket = (agents, economyState, tick) => {
  let economy = normalizeEconomy(economyState)
  if (!economy.orderBookActive) {
    economy = {
      ...economy,
      orderBookActive: true,
      spoiledFish: economy.spoiledFish + Math.max(0, economy.marketFish ?? 0),
      marketFish: 0,
      orders: [],
    }
  }

  const balanced = balanceHouseholds(agents, tick)
  const byId = new Map(balanced.agents.map((agent) => [agent.id, normalizeEconomicAgent(agent)]))
  let orders = economy.orders.filter((order) => (
    order.expiresAt > tick &&
    order.remaining > 0 &&
    byId.has(order.agentId)
  ))
  const householdSummaries = summarizeHouseholds(balanced.groups)

  for (const visitor of balanced.agents.filter((agent) => agent.marketIntent === 'fish')) {
    const current = byId.get(visitor.id)
    current.economic = { ...current.economic, marketVisits: current.economic.marketVisits + 1 }
    orders = orders.filter((order) => order.agentId !== current.id)
    const householdId = balanced.householdIdByAgent.get(current.id)
    const order = createOrder(current, householdSummaries[householdId], economy, tick)
    if (order) orders.push(order)
  }

  const transactions = []
  const matches = []
  const previousPrice = clamp(economy.fishPrice || 4, 1, 20)

  if (tick % MARKET_INTERVAL === 0) {
    const bids = orders.filter((order) => order.side === 'bid').sort((a, b) => b.price - a.price || a.createdAt - b.createdAt)
    const asks = orders.filter((order) => order.side === 'ask').sort((a, b) => a.price - b.price || a.createdAt - b.createdAt)
    let bidIndex = 0
    let askIndex = 0

    while (bidIndex < bids.length && askIndex < asks.length) {
      const bid = bids[bidIndex]
      const ask = asks[askIndex]
      if (bid.price < ask.price) break
      const buyer = byId.get(bid.agentId)
      const seller = byId.get(ask.agentId)
      if (!buyer || !seller || buyer.id === seller.id) {
        if (!buyer || buyer.id === seller?.id) bid.remaining = 0
        if (!seller || buyer?.id === seller.id) ask.remaining = 0
        if (bid.remaining <= 0) bidIndex += 1
        if (ask.remaining <= 0) askIndex += 1
        continue
      }

      const restingPrice = bid.createdAt === ask.createdAt
        ? (bid.price + ask.price) / 2
        : bid.createdAt < ask.createdAt ? bid.price : ask.price
      const unitPrice = roundCoin(clamp(restingPrice, ask.price, bid.price))
      const buyerEmergency = buyer.drives.hunger > 0.72
      const protectedCoins = buyerEmergency ? 0 : 3
      const affordable = Math.floor(Math.max(0, buyer.resources.coins - protectedCoins) / unitPrice)
      const available = Math.floor(Math.max(0, seller.resources.fish - 1))
      const quantity = Math.min(bid.remaining, ask.remaining, affordable, available)
      if (quantity <= 0) {
        if (affordable <= 0) bid.remaining = 0
        if (available <= 0) ask.remaining = 0
        if (bid.remaining <= 0) bidIndex += 1
        if (ask.remaining <= 0) askIndex += 1
        continue
      }

      const total = roundCoin(quantity * unitPrice)
      const nextBuyer = updateTradeExperience(buyer, 'bought', quantity, total, unitPrice)
      const nextSeller = updateTradeExperience(seller, 'sold', quantity, total, unitPrice)
      byId.set(buyer.id, nextBuyer)
      byId.set(seller.id, nextSeller)
      bid.remaining -= quantity
      ask.remaining -= quantity
      const matchId = `MATCH-${tick}-${matches.length + 1}`
      transactions.push(createTransaction(nextSeller, nextBuyer, matchId, tick, 'sold', quantity, unitPrice))
      transactions.push(createTransaction(nextBuyer, nextSeller, matchId, tick, 'bought', quantity, unitPrice))
      matches.push({ quantity, unitPrice, total })
      if (bid.remaining <= 0) bidIndex += 1
      if (ask.remaining <= 0) askIndex += 1
    }
    orders = orders.filter((order) => order.remaining > 0)
  }

  const tradedFish = matches.reduce((sum, match) => sum + match.quantity, 0)
  const tradedCoins = matches.reduce((sum, match) => sum + match.total, 0)
  const clearingPrice = tradedFish > 0
    ? roundCoin(matches.reduce((sum, match) => sum + match.unitPrice * match.quantity, 0) / tradedFish)
    : previousPrice
  const openSupply = orders.filter((order) => order.side === 'ask').reduce((sum, order) => sum + order.remaining, 0)
  const openDemand = orders.filter((order) => order.side === 'bid').reduce((sum, order) => sum + order.remaining, 0)
  const finalAgents = [...byId.values()].map((agent) => ({ ...agent, marketIntent: null }))
  const finalGroups = groupHouseholds(finalAgents)
  const priceMove = previousPrice > 0 ? Math.abs(clearingPrice - previousPrice) / previousPrice : 0
  const events = matches.length > 0 && priceMove >= 0.2
    ? [`Tick ${tick}: Fish price moved from ${previousPrice.toFixed(1)} to ${clearingPrice.toFixed(1)} coins after ${tradedFish} fish traded`]
    : []

  return {
    agents: finalAgents,
    economy: {
      ...economy,
      fishPrice: clearingPrice,
      marketFish: openSupply,
      openDemand,
      orders,
      households: summarizeHouseholds(finalGroups.groups),
      totalFishSold: economy.totalFishSold + tradedFish,
      totalFishBought: economy.totalFishBought + tradedFish,
      totalTrades: economy.totalTrades + matches.length,
      tradeVolume: economy.tradeVolume + tradedCoins,
      householdTransfers: economy.householdTransfers + balanced.transferCount,
      lastClearedTick: tick % MARKET_INTERVAL === 0 ? tick : economy.lastClearedTick,
      priceHistory: tradedFish > 0
        ? [...economy.priceHistory, { tick, price: clearingPrice, volume: tradedFish }].slice(-120)
        : economy.priceHistory,
      transactions: [...economy.transactions, ...transactions].slice(-40),
    },
    events,
  }
}

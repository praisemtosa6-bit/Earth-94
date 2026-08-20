export const TICKS_PER_YEAR = 20000
export const YEARS_PER_TICK = 1 / TICKS_PER_YEAR
export const WORLD_START_YEAR = 1600
export const DAYS_PER_YEAR = 365

const LIFE_STAGES = [
  { key: 'infant', label: 'Infant', minAge: 0, maxAge: 3 },
  { key: 'child', label: 'Child', minAge: 3, maxAge: 12 },
  { key: 'adolescent', label: 'Adolescent', minAge: 12, maxAge: 18 },
  { key: 'adult', label: 'Adult', minAge: 18, maxAge: 60 },
  { key: 'elder', label: 'Elder', minAge: 60, maxAge: Number.POSITIVE_INFINITY },
]

export const getLifeStage = (age = 0) => (
  LIFE_STAGES.find((stage) => age >= stage.minAge && age < stage.maxAge) ?? LIFE_STAGES[0]
)

export const normalizeLifecycleAgent = (agent, tick = 0) => {
  const stage = getLifeStage(agent.age)
  return {
    ...agent,
    bornAtTick: agent.bornAtTick ?? Math.round(tick - agent.age * TICKS_PER_YEAR),
    lifeStage: stage.key,
    lifecycle: {
      widowedAt: null,
      formerPartnerIds: [],
      inheritedFromIds: [],
      lastFamilyTeachingTick: null,
      lastElderTeachingTick: null,
      ...(agent.lifecycle ?? {}),
    },
  }
}

export const migrateLegacyAgentAge = (agent, tick = 0) => {
  const recordedBirth = (agent.family?.parentIds?.length ?? 0) > 0
    ? Number(agent.id.match(/^A-(\d+)-/)?.[1])
    : Number.NaN
  if (Number.isFinite(recordedBirth)) {
    return {
      ...agent,
      age: Math.max(0, (tick - recordedBirth) / TICKS_PER_YEAR),
      bornAtTick: recordedBirth,
    }
  }

  if ((agent.family?.parentIds?.length ?? 0) > 0) {
    const estimatedLifetimeTicks = Math.max(0, (agent.age ?? 0) / 0.01)
    return {
      ...agent,
      age: estimatedLifetimeTicks / TICKS_PER_YEAR,
      bornAtTick: Math.round(tick - estimatedLifetimeTicks),
    }
  }

  const founderAgeAtLanding = Math.max(0, Math.min(30, (agent.age ?? 18) - tick * 0.01))
  const reconstructedAge = 18 + founderAgeAtLanding * 1.35 + tick / (2000 * 365)
  return {
    ...agent,
    age: reconstructedAge,
    bornAtTick: Math.round(tick - reconstructedAge * TICKS_PER_YEAR),
  }
}

export const canPursueActionAtAge = (age, action) => {
  if (action === 'FISH') return age >= 12
  if (action === 'BUILD_HOUSE') return age >= 16
  if (action === 'MARKET_FISH') return age >= 14
  if (action === 'BUILD_SHOP' || action === 'TRADE') return age >= 18
  if (action === 'GATHER_STONE' || action === 'GATHER_WOOD' || action === 'EXPLORE') return age >= 6
  return true
}

export const createLifeCalendar = () => ({
  anchorTick: 0,
  elapsedYearsAtAnchor: 0,
  ticksPerYear: TICKS_PER_YEAR,
  ageModel: 'synchronized-v2',
  agesRebased: true,
})

export const migrateLifeCalendar = (calendar, tick = 0) => {
  if (calendar) {
    const previousTicksPerYear = calendar.ticksPerYear ?? 2000
    const elapsedYearsAtTick = calendar.elapsedYearsAtAnchor + (tick - calendar.anchorTick) / previousTicksPerYear
    return previousTicksPerYear === TICKS_PER_YEAR
      ? { ...calendar, ageModel: 'synchronized-v2', agesRebased: calendar.agesRebased ?? false }
      : {
          ...calendar,
          anchorTick: tick,
          elapsedYearsAtAnchor: elapsedYearsAtTick,
          ticksPerYear: TICKS_PER_YEAR,
          ageModel: 'synchronized-v2',
          agesRebased: calendar.agesRebased ?? false,
        }
  }
  return {
      // Preserve the date shown by old saves, then synchronize future calendar and aging speed.
      anchorTick: tick,
      elapsedYearsAtAnchor: tick / (2000 * 365),
      ticksPerYear: TICKS_PER_YEAR,
      ageModel: 'synchronized-v2',
      agesRebased: false,
    }
}

export const getElapsedWorldYears = (tick, calendar) => {
  const normalized = migrateLifeCalendar(calendar, tick)
  return normalized.elapsedYearsAtAnchor + (tick - normalized.anchorTick) / normalized.ticksPerYear
}

export const getDayProgress = (tick, calendar) => {
  const exactDay = getElapsedWorldYears(tick, calendar) * DAYS_PER_YEAR
  return exactDay - Math.floor(exactDay)
}

export const isNightTime = (tick, calendar) => {
  const dayProgress = getDayProgress(tick, calendar)
  return dayProgress < 0.25 || dayProgress >= 0.75
}

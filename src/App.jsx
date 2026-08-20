import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { createInitialState, runTick } from './sim/simulation'
import { create3DRenderer } from './sim/renderer3d'
import { forgetThought, getKnowledgeScore, getMemoryStats, implantThought } from './sim/brain'
import {
  clearSimulation,
  getPersistenceClientId,
  isRemotePersistenceConfigured,
  loadRemoteSimulation,
  loadSimulation,
  saveRemoteSimulation,
  saveSimulation,
} from './sim/persistence'
import { getAgentName } from './sim/names'
import { WORLD_START_YEAR, getElapsedWorldYears, getLifeStage, isNightTime } from './sim/lifecycle'

function App() {
  const mapContainerRef = useRef(null)
  const rendererRef = useRef(null)
  const stateRef = useRef(null)
  const selectedAgentIdRef = useRef(null)
  const hasWorldControlRef = useRef(!isRemotePersistenceConfigured())
  const syncInFlightRef = useRef(false)
  const formatSimTime = (tick, calendar) => {
    const elapsedYears = getElapsedWorldYears(tick, calendar)
    const completedYears = Math.floor(elapsedYears)
    const yearProgress = elapsedYears - completedYears
    const exactDayOfYear = yearProgress * 365
    const dayOfYear = Math.floor(exactDayOfYear)
    const totalSimMinutes = (exactDayOfYear - dayOfYear) * 24 * 60
    const hours = Math.floor(totalSimMinutes / 60)
    const minutes = Math.floor(totalSimMinutes % 60)
    const ampm = hours >= 12 ? 'PM' : 'AM'
    const displayHours = hours % 12 || 12
    const timeStr = `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`
    
    const year = WORLD_START_YEAR + completedYears
    const calendarDate = new Date(Date.UTC(2000, 0, dayOfYear + 1))
    const dateStr = `${calendarDate.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    })}, ${year} AD`
    
    return { time: timeStr, date: dateStr }
  }

  const [state, setState] = useState(() => loadSimulation() ?? createInitialState())
  const simTime = useMemo(() => formatSimTime(state.tick, state.calendar), [state.calendar, state.tick])
  const [selectedAgentId, setSelectedAgentId] = useState(null)
  const [selectedArtifactId, setSelectedArtifactId] = useState(null)
  const [previewPath, setPreviewPath] = useState([])
  const [isRunning, setIsRunning] = useState(true)
  const [ticksPerSecond, setTicksPerSecond] = useState(8)
  const [thoughtDraft, setThoughtDraft] = useState('')
  const [leftView, setLeftView] = useState('society')
  const [persistenceStatus, setPersistenceStatus] = useState(
    () => isRemotePersistenceConfigured() ? 'connecting' : 'local',
  )
  const [hasWorldControl, setHasWorldControl] = useState(() => !isRemotePersistenceConfigured())

  const selectedAgent = useMemo(
    () => state.agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [selectedAgentId, state.agents],
  )
  const selectedMemory = useMemo(
    () => selectedAgent ? getMemoryStats(selectedAgent) : null,
    [selectedAgent],
  )
  const selectedHousehold = useMemo(
    () => selectedAgent
      ? Object.values(state.economy?.households ?? {}).find((household) => household.memberIds.includes(selectedAgent.id)) ?? null
      : null,
    [selectedAgent, state.economy?.households],
  )
  const archive = useMemo(() => state.archive ?? [], [state.archive])
  const selectedArtifact = useMemo(
    () => archive.find((artifact) => artifact.id === selectedArtifactId) ?? archive[archive.length - 1] ?? null,
    [archive, selectedArtifactId],
  )
  const selectedLineage = useMemo(
    () => selectedArtifact
      ? archive.filter((artifact) => artifact.lineageRootId === selectedArtifact.lineageRootId)
      : [],
    [archive, selectedArtifact],
  )
  const rankedAgents = useMemo(
    () => state.agents
      .filter((agent) => agent.status?.rank)
      .slice()
      .sort((a, b) => a.status.rank - b.status.rank),
    [state.agents],
  )
  const meaningfulEvents = useMemo(
    () => state.metrics.events
      .filter((eventText) => (
        !eventText.includes('exchanged knowledge with another agent') &&
        !eventText.includes('Fish market cleared')
      ))
      .slice(-6)
      .reverse(),
    [state.metrics.events],
  )
  const agentNamesById = useMemo(
    () => new Map(state.agents.map((agent) => [agent.id, getAgentName(agent)])),
    [state.agents],
  )
  const lifeStageCounts = useMemo(
    () => state.agents.reduce((counts, agent) => {
      const stage = getLifeStage(agent.age).key
      counts[stage] = (counts[stage] ?? 0) + 1
      return counts
    }, {}),
    [state.agents],
  )

  useEffect(() => {
    stateRef.current = state
    selectedAgentIdRef.current = selectedAgentId
    hasWorldControlRef.current = hasWorldControl
  }, [state, selectedAgentId, hasWorldControl])

  useEffect(() => {
    if (!isRemotePersistenceConfigured()) return undefined
    let active = true
    let timer
    const clientId = getPersistenceClientId()

    const scheduleNextSync = () => {
      if (active) timer = window.setTimeout(synchronizeWorld, 4_000)
    }

    const acceptRemote = (remote) => {
      if (!remote?.state) return
      setState(remote.state)
      setHasWorldControl(remote.isController === true)
      setPersistenceStatus(remote.isController ? 'connected' : 'spectating')
    }

    const attemptControl = async (candidateState) => {
      const result = await saveRemoteSimulation(candidateState, clientId)
      if (result.status === 'saved') {
        setState((current) => ({ ...current, revision: result.revision }))
        setHasWorldControl(true)
        setPersistenceStatus('connected')
        return
      }
      if (result.state) {
        acceptRemote({
          state: result.state,
          isController: result.isController,
          leaseExpiresAt: result.leaseExpiresAt,
        })
      }
    }

    async function synchronizeWorld() {
      if (!active || syncInFlightRef.current) return scheduleNextSync()
      syncInFlightRef.current = true
      try {
        if (hasWorldControlRef.current) {
          setPersistenceStatus('syncing')
          const result = await saveRemoteSimulation(stateRef.current, clientId)
          if (!active) return
          if (result.status === 'saved') {
            setState((current) => ({ ...current, revision: result.revision }))
            setHasWorldControl(true)
            setPersistenceStatus('connected')
          } else if (result.state) {
            acceptRemote({ state: result.state, isController: result.isController })
          }
        } else {
          setPersistenceStatus('connecting')
          const remote = await loadRemoteSimulation(stateRef.current?.worldId, clientId)
          if (!active) return
          if (!remote) {
            await attemptControl(stateRef.current)
          } else {
            acceptRemote(remote)
            const leaseExpired = !remote.leaseExpiresAt || Date.parse(remote.leaseExpiresAt) <= Date.now()
            if (!remote.isController && leaseExpired) await attemptControl(remote.state)
          }
        }
      } catch (error) {
        console.warn('Could not synchronize the Earth 94 world database.', error)
        if (active) {
          setHasWorldControl(false)
          setPersistenceStatus('offline')
        }
      } finally {
        syncInFlightRef.current = false
        scheduleNextSync()
      }
    }

    synchronizeWorld()

    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [])

  const buildPreviewPath = (start, end) => {
    const steps = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y), 1)
    const points = []
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps
      points.push({
        x: Math.round(start.x + (end.x - start.x) * t),
        y: Math.round(start.y + (end.y - start.y) * t),
      })
    }
    return points
  }

  useEffect(() => {
    const timer = setInterval(() => {
      if (!isRunning || !hasWorldControl) {
        return
      }
      setState((prev) => {
        const next = runTick(prev)
        return next
      })
    }, Math.max(30, Math.round(1000 / ticksPerSecond)))
    return () => clearInterval(timer)
  }, [hasWorldControl, isRunning, ticksPerSecond])

  // Keep a local recovery cache; the database synchronization loop owns remote saves.
  useEffect(() => {
    if (state.tick === 0 || state.tick % 40 !== 0) return undefined
    const timer = window.setTimeout(() => {
      const latestState = stateRef.current
      if (!latestState) return
      saveSimulation(latestState)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [state.tick])

  useEffect(() => {
    const saveLatestState = () => {
      if (stateRef.current) saveSimulation(stateRef.current)
    }
    window.addEventListener('beforeunload', saveLatestState)
    return () => window.removeEventListener('beforeunload', saveLatestState)
  }, [])

  useEffect(() => {
    const container = mapContainerRef.current
    if (!container) {
      return
    }
    rendererRef.current = create3DRenderer(
      container,
      (agentId) => {
        setSelectedAgentId(agentId)
        setPreviewPath([])
      },
      (tileCoord) => {
        setPreviewPath((prev) => {
          const currentState = stateRef.current
          const currentSelectedId = selectedAgentIdRef.current
          const current = currentState?.agents.find((agent) => agent.id === currentSelectedId)
          if (!current) return prev
          return buildPreviewPath({ x: current.x, y: current.y }, tileCoord)
        })
      },
    )
    return () => {
      rendererRef.current?.dispose()
      rendererRef.current = null
    }
  }, [])

  useEffect(() => {
    rendererRef.current?.update(state, selectedAgentId, previewPath)
  }, [state, selectedAgentId, previewPath])

  const injectFood = () => {
    if (!hasWorldControl || !selectedAgentId) {
      return
    }
    setState((prev) => ({
      ...prev,
      agents: prev.agents.map((agent) =>
        agent.id === selectedAgentId
          ? { ...agent, resources: { ...agent.resources, food: agent.resources.food + 20 } }
          : agent,
      ),
    }))
  }

  const boostTrait = (trait, delta) => {
    if (!hasWorldControl || !selectedAgentId) {
      return
    }
    setState((prev) => ({
      ...prev,
      agents: prev.agents.map((agent) => {
        if (agent.id !== selectedAgentId) {
          return agent
        }
        return { ...agent, dna: { ...agent.dna, [trait]: Math.max(0, Math.min(1, agent.dna[trait] + delta)) } }
      }),
    }))
  }

  const implantSelectedThought = () => {
    const text = thoughtDraft.trim()
    if (!hasWorldControl || !selectedAgentId || !text) return
    setState((prev) => ({
      ...prev,
      agents: prev.agents.map((agent) =>
        agent.id === selectedAgentId ? implantThought(agent, text, prev.tick) : agent,
      ),
      metrics: {
        ...prev.metrics,
        events: [
          ...prev.metrics.events.slice(-8),
          `Tick ${prev.tick}: observer placed a thought in ${selectedAgentId}'s mind`,
        ],
      },
    }))
    setThoughtDraft('')
  }

  const forgetSelectedThought = (thoughtId) => {
    if (!hasWorldControl || !selectedAgentId) return
    setState((prev) => ({
      ...prev,
      agents: prev.agents.map((agent) =>
        agent.id === selectedAgentId ? forgetThought(agent, thoughtId, prev.tick) : agent,
      ),
    }))
  }

  const triggerDrought = () => {
    if (!hasWorldControl) return
    setState((prev) => ({
      ...prev,
      world: prev.world.map((tile) => ({ ...tile, richness: Math.max(0.05, tile.richness * 0.45) })),
      metrics: { ...prev.metrics, events: [...prev.metrics.events.slice(-8), `Tick ${prev.tick}: drought`] },
    }))
  }

  const startNewWorld = () => {
    if (!hasWorldControl) return
    clearSimulation()
    setSelectedAgentId(null)
    setSelectedArtifactId(null)
    setPreviewPath([])
    setThoughtDraft('')
    setState({
      ...createInitialState(),
      revision: stateRef.current?.revision ?? 0,
    })
  }

  const ownedHomes = state.world.filter(tile => tile.structure === 'house' && tile.ownerId).length
  const nightActive = isNightTime(state.tick, state.calendar)
  const shelteredPeople = state.agents.filter((agent) => agent.indoors).length
  const exposedPeople = nightActive ? state.agents.length - shelteredPeople : 0
  const activeCrocodiles = (state.predators ?? []).filter((predator) => predator.state !== 'IN_WATER').length
  const leader = rankedAgents[0] ?? null
  const economy = state.economy ?? {}
  const openOrders = economy.orders ?? []
  const openBids = openOrders.filter((order) => order.side === 'bid').length
  const openAsks = openOrders.filter((order) => order.side === 'ask').length
  const recentTransactions = (economy.transactions ?? []).filter((transaction) => transaction.type === 'sold').slice(-3).reverse()
  const isWorldAdvancing = isRunning && hasWorldControl

  return (
    <main className="civ-shell">
      <header className="top-hud">
        <div className="brand-block">
          <div className="hud-title">EARTH 94</div>
          <span className={isWorldAdvancing ? 'live-indicator active' : 'live-indicator'}>
            {!hasWorldControl ? 'SPECTATING' : isRunning ? 'LIVE' : 'PAUSED'}
          </span>
          <span
            className={`persistence-indicator ${persistenceStatus}`}
            title={persistenceStatus === 'local' ? 'Saved in this browser' : `World database: ${persistenceStatus}`}
          >
            {persistenceStatus === 'local' && 'LOCAL SAVE'}
            {persistenceStatus === 'connecting' && 'DB…'}
            {persistenceStatus === 'syncing' && 'SAVING…'}
            {persistenceStatus === 'connected' && 'DB SAVED'}
            {persistenceStatus === 'spectating' && 'SHARED WORLD'}
            {persistenceStatus === 'offline' && 'DB OFFLINE'}
          </span>
        </div>
        <div className="sim-clock">
          <strong>{simTime.date}</strong>
          <span>{simTime.time} · Tick {state.tick}</span>
        </div>
        <div className="top-controls">
          <button onClick={() => setIsRunning((value) => !value)} disabled={!hasWorldControl}>{isRunning ? 'Pause' : 'Resume'}</button>
          <button onClick={() => setState((prev) => runTick(prev))} disabled={isRunning || !hasWorldControl}>Step</button>
          <label className="speed-control">
            <span>{ticksPerSecond} tps</span>
            <input
              aria-label="Simulation speed"
              type="range"
              min="1"
              max="30"
              value={ticksPerSecond}
              onChange={(event) => setTicksPerSecond(Number(event.target.value))}
              disabled={!hasWorldControl}
            />
          </label>
          <button className="quiet-button" onClick={startNewWorld} disabled={!hasWorldControl}>New World</button>
        </div>
      </header>

      <aside className="left-hud">
        <nav className="panel-tabs" aria-label="Society information">
          <button className={leftView === 'society' ? 'active' : ''} onClick={() => setLeftView('society')}>Society</button>
          <button className={leftView === 'archive' ? 'active' : ''} onClick={() => setLeftView('archive')}>Archive <span>{archive.length}</span></button>
        </nav>

        {leftView === 'society' ? (
          <div className="panel-view">
            <section className="pulse-grid" aria-label="Society overview">
              <div><strong>{state.agents.length}</strong><span>People</span><small>{lifeStageCounts.infant ?? 0} infants · {lifeStageCounts.child ?? 0} children · {lifeStageCounts.adolescent ?? 0} teens · {lifeStageCounts.adult ?? 0} adults · {lifeStageCounts.elder ?? 0} elders</small></div>
              <div><strong>{ownedHomes}</strong><span>Owned homes</span><small>{state.metrics.households ?? 0} partnered households</small></div>
              <div><strong>{state.metrics.totalBirths ?? 0}</strong><span>Born here</span><small>{state.metrics.totalDeaths ?? 0} deaths · {state.metrics.widowhoods ?? 0} widowed</small></div>
              <div><strong>{archive.length}</strong><span>Writings</span><small>{state.metrics.familyTeachings ?? 0} family lessons</small></div>
            </section>

            {state.metrics.highestCortisol > 0.65 && (
              <div className="world-alert">High society stress: {Math.round(state.metrics.highestCortisol * 100)}%</div>
            )}

            {nightActive && (
              <div className="world-alert night-alert">
                Night watch: {shelteredPeople} sheltered · {exposedPeople} exposed · {activeCrocodiles} crocodiles ashore
              </div>
            )}

            <section className="focus-section economy-section">
              <div className="section-heading"><h3>Fish economy</h3><span>{economy.totalTrades ?? 0} trades · {Math.floor(economy.totalFishCaught ?? 0)} caught</span></div>
              <div className="economy-grid">
                <div><strong>{(economy.fishPrice ?? 4).toFixed(1)}¢</strong><span>Price / fish</span></div>
                <div><strong>{Math.floor(economy.marketFish ?? 0)}</strong><span>Fish listed</span></div>
                <div><strong>{Math.floor(economy.openDemand ?? 0)}</strong><span>Wanted</span></div>
                <div><strong>{Math.floor(economy.tradeVolume ?? 0)}¢</strong><span>Trade volume</span></div>
              </div>
              <p className="muted">Order book: {openBids} {openBids === 1 ? 'bid' : 'bids'} · {openAsks} {openAsks === 1 ? 'ask' : 'asks'}</p>
              <div className="transaction-list">
                {recentTransactions.map((transaction) => (
                  <p key={transaction.id}>
                    <span>{transaction.agentName}</span>
                    <small>{transaction.type} {transaction.quantity} fish · {transaction.total.toFixed(1)} coins</small>
                  </p>
                ))}
                {recentTransactions.length === 0 && <p className="muted">The dock is open; the first catch has not traded yet.</p>}
              </div>
            </section>

            <section className="focus-section">
              <div className="section-heading"><h3>Hierarchy</h3><span>{leader ? `${getAgentName(leader)} leads` : 'emerging'}</span></div>
              <div className="hierarchy-list">
                {rankedAgents.length === 0 && <p className="muted">Status is still emerging.</p>}
                {rankedAgents.slice(0, 5).map((agent) => (
                  <button className="hierarchy-entry" key={agent.id} onClick={() => setSelectedAgentId(agent.id)}>
                    <strong>#{agent.status.rank}</strong>
                    <span><b>{getAgentName(agent)}</b><small>{agent.id} · {agent.status.tier} · {agent.status.role}</small></span>
                    <em>{agent.status.score.toFixed(0)}</em>
                  </button>
                ))}
              </div>
            </section>

            <section className="focus-section">
              <div className="section-heading"><h3>What just happened</h3></div>
              <ul className="events-list compact">
                {meaningfulEvents.map((eventText, index) => (
                  <li key={`${eventText}-${index}`}>{eventText}</li>
                ))}
                {meaningfulEvents.length === 0 && <li>Waiting for the next meaningful change.</li>}
              </ul>
            </section>

            <details className="scenario-controls">
              <summary>World interventions</summary>
              <button onClick={triggerDrought}>Trigger drought</button>
            </details>
          </div>
        ) : (
          <div className="panel-view archive-view">
            <div className="section-heading"><h3>Living Archive</h3><span>{archive.length} works</span></div>
            {archive.length === 0 && <p className="muted">Origin accounts begin appearing after tick 80.</p>}
            <div className="archive-list">
              {archive.slice(-8).reverse().map((artifact) => (
                <button
                  className={artifact.id === selectedArtifact?.id ? 'archive-entry selected' : 'archive-entry'}
                  key={artifact.id}
                  onClick={() => setSelectedArtifactId(artifact.id)}
                >
                  <span>{artifact.title}</span>
                  <small>{artifact.authorName ?? agentNamesById.get(artifact.authorId) ?? artifact.authorId} · {artifact.type} · gen {artifact.generation}</small>
                </button>
              ))}
            </div>
            {selectedArtifact && (
              <article className="archive-reader">
                <h4>{selectedArtifact.title}</h4>
                <p className="archive-meta">{selectedArtifact.authorName ?? agentNamesById.get(selectedArtifact.authorId) ?? selectedArtifact.authorId} · tick {selectedArtifact.createdAt} · generation {selectedArtifact.generation}</p>
                <p>{selectedArtifact.body}</p>
                <p className="archive-meta">Confidence {(selectedArtifact.averageConfidence * 100).toFixed(0)}% · {selectedLineage.length} work{selectedLineage.length === 1 ? '' : 's'} in lineage</p>
                {selectedArtifact.parentArtifactId && <p className="archive-meta">Retold from {selectedArtifact.parentArtifactId}</p>}
                {(selectedArtifact.claims ?? []).length > 0 && (
                  <details>
                    <summary>Claims</summary>
                    <ul className="claim-list">
                      {selectedArtifact.claims.map((claim, index) => (
                        <li key={`${claim.subject ?? 'unknown'}-${claim.predicate ?? 'describes'}-${index}`}>
                          {String(claim.subject ?? 'unknown').replaceAll('_', ' ')} → {String(claim.predicate ?? 'describes').replaceAll('_', ' ')} → {String(claim.object ?? 'uncertain').replaceAll('_', ' ')} ({Math.round((claim.confidence ?? 0) * 100)}%)
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {(selectedArtifact.mutationNotes ?? []).length > 0 && (
                  <details>
                    <summary>Changes in retelling</summary>
                    <ul className="claim-list">
                      {selectedArtifact.mutationNotes.map((note, index) => <li key={`${note}-${index}`}>{note}</li>)}
                    </ul>
                  </details>
                )}
              </article>
            )}
          </div>
        )}
      </aside>

      <section className="world-panel">
        <div className="map-stack">
          <div ref={mapContainerRef} className="world-3d" aria-label="Simulation world" />
          <div className="map-label">
            WORLD VIEW · {nightActive ? `NIGHT · ${activeCrocodiles} CROCS ACTIVE` : 'DAY'} · FISH {(economy.fishPrice ?? 4).toFixed(1)}¢
          </div>
        </div>
        <div className="legend">
          <span><i className="swatch food" />Food</span>
          <span><i className="swatch water" />Water</span>
          <span><i className="swatch beach" />Beach</span>
          <span><i className="swatch wood" />Wood</span>
          <span><i className="swatch stone" />Stone</span>
          <span><i className="swatch shop" />Shop</span>
          <span><i className="swatch dock" />Dock</span>
          <span><i className="swatch empty" />Empty</span>
          <span><i className="swatch agent" />Agent</span>
          <span><i className="swatch crocodile" />Crocodile</span>
        </div>
      </section>

      <aside className="right-hud">
        <div className="section-heading inspector-heading"><h2>Agent</h2><span>{selectedAgent ? getAgentName(selectedAgent) : 'none selected'}</span></div>
        <label className="agent-target-label" htmlFor="agent-target">Inspect a person</label>
        <select
          id="agent-target"
          className="agent-target-select"
          value={selectedAgentId ?? ''}
          onChange={(event) => {
            setSelectedAgentId(event.target.value || null)
            setPreviewPath([])
          }}
        >
          <option value="">Choose an agent</option>
          {state.agents.map((agent) => (
            <option key={agent.id} value={agent.id}>{getAgentName(agent)} · {agent.status?.role ?? 'Unproven'}</option>
          ))}
        </select>

        {!selectedAgent && (
          <div className="empty-inspector">
            <strong>No agent selected</strong>
            <p>Choose someone above or click a person in the world to inspect their needs, thoughts, family, and memories.</p>
          </div>
        )}
        {selectedAgent && (
          <div className="agent-card">
            <div className="agent-identity">
              <div><strong>{getAgentName(selectedAgent)}</strong><span>{selectedAgent.id} · {getLifeStage(selectedAgent.age).label}, {selectedAgent.age.toFixed(1)} · {selectedAgent.status?.tier !== getLifeStage(selectedAgent.age).label ? `${selectedAgent.status?.tier ?? 'Citizen'} · ` : ''}{selectedAgent.status?.role ?? 'Unproven'}</span></div>
              <em>{selectedAgent.status?.rank ? `#${selectedAgent.status.rank}` : '—'}</em>
            </div>
            <p className="agent-state">{selectedAgent.state.replaceAll('_', ' ').toLowerCase()}</p>

            <div className="needs-grid">
              {[
                ['Hunger', selectedAgent.drives.hunger],
                ['Thirst', selectedAgent.drives.thirst],
                ['Fatigue', selectedAgent.drives.exhaustion],
                ['Isolation', selectedAgent.drives.isolation],
              ].map(([label, value]) => (
                <div key={label}><strong>{Math.round(value * 100)}%</strong><span>{label}</span></div>
              ))}
            </div>

            <div className="monologue-box">
              <h4>Current thought</h4>
              <p>"{selectedAgent.monologue}"</p>
              {selectedAgent.attentionTarget && <small>Heading to {selectedAgent.attentionTarget.affordance.tag.replaceAll('_', ' ').toLowerCase()} at {selectedAgent.attentionTarget.x},{selectedAgent.attentionTarget.y}</small>}
            </div>

            <details className="agent-details">
              <summary>Life, memory, and chemistry</summary>
              <div className="detail-list">
                <p>Prestige <strong>{(selectedAgent.status?.score ?? 0).toFixed(0)}</strong> · Health <strong>{selectedAgent.health.toFixed(0)}</strong></p>
                <p>Home <strong>{selectedAgent.home ? `${selectedAgent.home.x},${selectedAgent.home.y}` : 'none'}</strong> · Partner <strong>{agentNamesById.get(selectedAgent.family?.partnerId) ?? 'none'}</strong> · Children <strong>{selectedAgent.family?.childrenIds?.length ?? 0}</strong></p>
                {selectedAgent.lifecycle?.widowedAt && <p>Widowed at tick <strong>{selectedAgent.lifecycle.widowedAt}</strong> · Former partners <strong>{selectedAgent.lifecycle.formerPartnerIds?.map((id) => agentNamesById.get(id) ?? id).join(', ') || 'unknown'}</strong></p>}
                {(selectedAgent.family?.parentIds?.length ?? 0) > 0 && <p>Parents <strong>{selectedAgent.family.parentIds.map((parentId) => agentNamesById.get(parentId) ?? parentId).join(' & ')}</strong></p>}
                {(selectedAgent.lifecycle?.inheritedFromIds?.length ?? 0) > 0 && <p>Inherited from <strong>{selectedAgent.lifecycle.inheritedFromIds.map((id) => agentNamesById.get(id) ?? id).join(', ')}</strong></p>}
                <p>Food <strong>{selectedAgent.resources.food.toFixed(0)}</strong> · Fish <strong>{selectedAgent.resources.fish.toFixed(1)}</strong> · Materials <strong>{selectedAgent.resources.materials.toFixed(0)}</strong></p>
                <p>Wallet <strong>{selectedAgent.resources.coins.toFixed(1)} coins</strong> · Caught <strong>{selectedAgent.economic?.fishCaught ?? 0}</strong> · Market trades <strong>{selectedAgent.economic?.trades ?? 0}</strong></p>
                {selectedHousehold && <p>Household <strong>{selectedHousehold.memberCount} people · {selectedHousehold.totalCoins.toFixed(1)} coins</strong> · Reserve <strong>{selectedHousehold.coinReserve.toFixed(0)}</strong> · Food gap <strong>{selectedHousehold.foodDeficit.toFixed(1)}</strong></p>}
                <p>Expected fish price <strong>{(selectedAgent.economic?.expectedFishPrice ?? economy.fishPrice ?? 4).toFixed(1)} coins</strong>{selectedAgent.economic?.lastBuyPrice ? <> · Last paid <strong>{selectedAgent.economic.lastBuyPrice.toFixed(1)}</strong></> : null}{selectedAgent.economic?.lastSellPrice ? <> · Last earned <strong>{selectedAgent.economic.lastSellPrice.toFixed(1)}</strong></> : null}</p>
                <p>Knowledge <strong>{getKnowledgeScore(selectedAgent).toFixed(1)}</strong> · Experiences <strong>{selectedMemory?.episodes ?? 0}</strong> · Facts <strong>{selectedMemory?.facts ?? 0}</strong></p>
                <p>Writings <strong>{selectedMemory?.writings ?? 0}</strong> · Read <strong>{selectedMemory?.read ?? 0}</strong> · Cultural beliefs <strong>{selectedMemory?.culturalBeliefs ?? 0}</strong></p>
                <p>Last family lesson <strong>{selectedAgent.lifecycle?.lastFamilyTeachingTick ?? 'none'}</strong> · Last elder lesson <strong>{selectedAgent.lifecycle?.lastElderTeachingTick ?? 'none'}</strong></p>
                <p>Dopamine <strong>{Math.round(selectedAgent.chemistry.dopamine * 100)}%</strong> · Stress <strong>{Math.round(selectedAgent.chemistry.cortisol * 100)}%</strong></p>
                {selectedAgent.family?.expectingBirthTick && <p>Expecting a child around tick <strong>{selectedAgent.family.expectingBirthTick}</strong></p>}
              </div>
            </details>

            {(selectedAgent.memory?.thoughts?.length ?? 0) > 0 && (
              <div className="held-thoughts">
                <h4>Persistent thoughts</h4>
                {selectedAgent.memory.thoughts.slice(-3).reverse().map((thought) => (
                  <div className="held-thought" key={thought.id}>
                    <span>“{thought.text}”</span>
                    <small>{Math.round(thought.confidence * 100)}% · from {thought.source} · transmission {thought.transmission ?? 0}</small>
                    <button
                      className="forget-thought"
                      onClick={() => forgetSelectedThought(thought.id)}
                      aria-label={`Forget thought: ${thought.text}`}
                    >
                      Forget
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="thought-implant">
              <label htmlFor="thought-draft">Give {selectedAgent.firstName} a thought</label>
              <textarea
                id="thought-draft"
                maxLength={280}
                placeholder={`What should ${selectedAgent.firstName} believe?`}
                value={thoughtDraft}
                onChange={(event) => setThoughtDraft(event.target.value)}
              />
              <div className="thought-implant-footer">
                <small>{thoughtDraft.length}/280</small>
                <button onClick={implantSelectedThought} disabled={!thoughtDraft.trim()}>Implant Thought</button>
              </div>
            </div>

            <details className="scenario-controls agent-experiments">
              <summary>Experimental controls</summary>
              <div className="control-row">
                <button onClick={injectFood}>Add Food</button>
                <button onClick={() => boostTrait('greed', 0.1)}>Increase Greed</button>
                <button onClick={() => boostTrait('curiosity', 0.1)}>Increase Curiosity</button>
              </div>
            </details>
          </div>
        )}
      </aside>
    </main>
  )
}

export default App

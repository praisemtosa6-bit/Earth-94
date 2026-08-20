import { WORLD_SIZE } from './constants'

const COLORS = {
  beach: { center: '#e2c27c', edge: '#9c743b' },
  food: { center: '#75ef8d', edge: '#2e8c45' },
  water: { center: '#4da9ff', edge: '#0c2f63' },
  wood: { center: '#8adf75', edge: '#346b2f' },
  stone: { center: '#d2dae8', edge: '#5e6777' },
  empty: { center: '#3a485f', edge: '#161f30' },
}

const colorForAgent = (agent) => {
  const r = Math.round(100 + agent.dna.aggression * 140)
  const g = Math.round(90 + agent.dna.empathy * 130)
  const b = Math.round(80 + agent.dna.intelligence * 160)
  return `rgb(${r} ${g} ${b})`
}

const traitGlowForAgent = (agent) => {
  const r = Math.round(140 + agent.dna.charisma * 90)
  const g = Math.round(100 + agent.dna.curiosity * 110)
  const b = Math.round(110 + agent.dna.intelligence * 120)
  return `rgb(${r} ${g} ${b})`
}

const hexPoints = (cx, cy, size) => {
  const points = []
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 180) * (60 * i - 30)
    points.push({
      x: cx + size * Math.cos(angle),
      y: cy + size * Math.sin(angle),
    })
  }
  return points
}

const drawHex = (ctx, cx, cy, size) => {
  const points = hexPoints(cx, cy, size)
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i += 1) {
    ctx.lineTo(points[i].x, points[i].y)
  }
  ctx.closePath()
}

const worldToScreen = (x, y, offsetX, offsetY, hexSize) => {
  const drawX = x - offsetX
  const drawY = y - offsetY
  const cx = 44 + drawX * (hexSize * 1.5)
  const cy = 40 + drawY * (hexSize * Math.sqrt(3)) + (x % 2 ? (hexSize * Math.sqrt(3)) / 2 : 0)
  return { cx, cy }
}

const hash01 = (x, y, seed = 13) => {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 17.17) * 43758.5453123
  return n - Math.floor(n)
}

const getViewport = (state, selectedAgentId) => {
  const selected = state.agents.find((agent) => agent.id === selectedAgentId) ?? state.agents[0]
  const centerX = selected?.x ?? Math.floor(WORLD_SIZE / 2)
  const centerY = selected?.y ?? Math.floor(WORLD_SIZE / 2)
  const width = 34
  const height = 22
  const offsetX = Math.max(0, Math.min(WORLD_SIZE - width - 1, centerX - Math.floor(width / 2)))
  const offsetY = Math.max(0, Math.min(WORLD_SIZE - height - 1, centerY - Math.floor(height / 2)))
  return { offsetX, offsetY, width, height }
}

const drawTerrainHex = (ctx, tile, cx, cy, hexSize) => {
  const palette = COLORS[tile.type] ?? COLORS.empty
  const gradient = ctx.createRadialGradient(cx - hexSize * 0.2, cy - hexSize * 0.25, 2, cx, cy, hexSize * 1.2)
  gradient.addColorStop(0, palette.center)
  gradient.addColorStop(1, palette.edge)
  ctx.fillStyle = gradient
  drawHex(ctx, cx, cy, hexSize)
  ctx.fill()

  // Inner glow grid line.
  ctx.globalAlpha = 0.36
  ctx.strokeStyle = '#b2d4ff'
  ctx.lineWidth = 0.8
  drawHex(ctx, cx, cy, hexSize - 0.3)
  ctx.stroke()
  ctx.globalAlpha = 1

  // Tile depth: highlighted ridge and darker bottom "extrusion".
  const points = hexPoints(cx, cy, hexSize)
  ctx.beginPath()
  ctx.moveTo(points[5].x, points[5].y)
  ctx.lineTo(points[0].x, points[0].y)
  ctx.lineTo(points[1].x, points[1].y)
  ctx.strokeStyle = 'rgb(255 255 255 / 55%)'
  ctx.lineWidth = 1
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(points[2].x, points[2].y)
  ctx.lineTo(points[3].x, points[3].y)
  ctx.lineTo(points[4].x, points[4].y)
  ctx.strokeStyle = 'rgb(0 0 0 / 55%)'
  ctx.lineWidth = 3
  ctx.stroke()
}

const drawClutter = (ctx, tile, cx, cy, hexSize) => {
  if (tile.type === 'wood') {
    for (let i = 0; i < 3; i += 1) {
      const ox = (hash01(tile.x, tile.y, 30 + i) - 0.5) * hexSize * 0.9
      const oy = (hash01(tile.x, tile.y, 40 + i) - 0.5) * hexSize * 0.7
      ctx.fillStyle = '#1f4e27'
      ctx.beginPath()
      ctx.moveTo(cx + ox, cy - 4 + oy)
      ctx.lineTo(cx - 3 + ox, cy + 3 + oy)
      ctx.lineTo(cx + 3 + ox, cy + 3 + oy)
      ctx.closePath()
      ctx.fill()
    }
  }
  if (tile.type === 'stone') {
    const ox = (hash01(tile.x, tile.y, 59) - 0.5) * hexSize * 0.8
    const oy = (hash01(tile.x, tile.y, 71) - 0.5) * hexSize * 0.6
    ctx.fillStyle = '#8f96a8'
    ctx.beginPath()
    ctx.arc(cx + ox, cy + oy, 2.8, 0, Math.PI * 2)
    ctx.fill()
  }
}

const buildControllerMap = (state) => {
  const controlMap = new Map()
  for (const agent of state.agents) {
    const offsets = [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]
    for (const [dx, dy] of offsets) {
      const x = agent.x + dx
      const y = agent.y + dy
      if (x < 0 || y < 0 || x >= WORLD_SIZE || y >= WORLD_SIZE) continue
      const key = `${x}:${y}`
      const existing = controlMap.get(key)
      if (!existing || existing.power < agent.dna.charisma) {
        controlMap.set(key, { controllerId: agent.id, power: agent.dna.charisma })
      }
    }
  }
  return controlMap
}

const neonColorForOwner = (ownerId) => {
  const seed = ownerId.split('-').pop() ?? '0'
  const n = Number(seed) || 0
  return n % 2 === 0 ? '#f7f06e' : '#d25dff'
}

const neighborCoord = (x, y, dir) => {
  const even = x % 2 === 0
  const evenOffsets = [
    [1, 0],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
  ]
  const oddOffsets = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 0],
    [0, -1],
    [1, -1],
  ]
  const [dx, dy] = even ? evenOffsets[dir] : oddOffsets[dir]
  return { x: x + dx, y: y + dy }
}

const drawTerritoryBorders = (ctx, state, viewport, hexSize, controlMap) => {
  for (const tile of state.world) {
    if (
      tile.x < viewport.offsetX ||
      tile.y < viewport.offsetY ||
      tile.x >= viewport.offsetX + viewport.width ||
      tile.y >= viewport.offsetY + viewport.height
    ) {
      continue
    }
    const key = `${tile.x}:${tile.y}`
    const owner = controlMap.get(key)
    if (!owner) continue
    const borderColor = neonColorForOwner(owner.controllerId)
    const { cx, cy } = worldToScreen(tile.x, tile.y, viewport.offsetX, viewport.offsetY, hexSize)
    const points = hexPoints(cx, cy, hexSize + 1)
    for (let dir = 0; dir < 6; dir += 1) {
      const n = neighborCoord(tile.x, tile.y, dir)
      const neighborOwner = controlMap.get(`${n.x}:${n.y}`)
      if (neighborOwner?.controllerId === owner.controllerId) {
        continue
      }
      const a = points[dir]
      const b = points[(dir + 1) % 6]
      ctx.save()
      ctx.strokeStyle = borderColor
      ctx.lineWidth = 3.2
      ctx.shadowColor = borderColor
      ctx.shadowBlur = 8
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
      ctx.restore()
    }
  }
}

const drawVignette = (ctx, width, height) => {
  const vignette = ctx.createRadialGradient(width / 2, height / 2, height * 0.33, width / 2, height / 2, height * 0.7)
  vignette.addColorStop(0, 'rgb(0 0 0 / 0%)')
  vignette.addColorStop(1, 'rgb(0 0 0 / 60%)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, width, height)
}

const viewportFor = (state, selectedAgentId) => getViewport(state, selectedAgentId)

export const renderTerrain = (canvas, state, selectedAgentId) => {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const hexSize = 16
  const viewport = viewportFor(state, selectedAgentId)
  const controlMap = buildControllerMap(state)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#080d18'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  for (const tile of state.world) {
    if (
      tile.x < viewport.offsetX ||
      tile.y < viewport.offsetY ||
      tile.x >= viewport.offsetX + viewport.width ||
      tile.y >= viewport.offsetY + viewport.height
    ) {
      continue
    }
    const { cx, cy } = worldToScreen(tile.x, tile.y, viewport.offsetX, viewport.offsetY, hexSize)
    const alpha = 0.7 + tile.richness * 0.3
    ctx.globalAlpha = alpha
    drawTerrainHex(ctx, tile, cx, cy, hexSize)
    ctx.globalAlpha = 1
    drawClutter(ctx, tile, cx, cy, hexSize)
  }
  drawTerritoryBorders(ctx, state, viewport, hexSize, controlMap)
  drawVignette(ctx, canvas.width, canvas.height)
}

export const renderAgents = (canvas, state, selectedAgentId, timeMs) => {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const hexSize = 16
  const viewport = viewportFor(state, selectedAgentId)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  for (const agent of state.agents) {
    if (
      agent.x < viewport.offsetX ||
      agent.y < viewport.offsetY ||
      agent.x >= viewport.offsetX + viewport.width ||
      agent.y >= viewport.offsetY + viewport.height
    ) {
      continue
    }
    const { cx, cy } = worldToScreen(agent.x, agent.y, viewport.offsetX, viewport.offsetY, hexSize)
    const bob = Math.sin(timeMs / 420 + Number(agent.id.split('-')[1] ?? 0)) * 2.2
    const size = 7 + Math.round(agent.dna.charisma * 2)
    ctx.save()
    ctx.translate(0, bob)
    ctx.shadowColor = traitGlowForAgent(agent)
    ctx.shadowBlur = 12
    ctx.fillStyle = colorForAgent(agent)
    // Tiny "billboard" icon body.
    ctx.fillRect(cx - size / 2, cy - size * 0.2, size, size * 0.95)
    ctx.beginPath()
    ctx.arc(cx, cy - size * 0.6, size * 0.35, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    // Bloom pulse.
    const pulse = 0.22 + ((Math.sin(timeMs / 520 + agent.dna.curiosity * 6) + 1) / 2) * 0.28
    ctx.globalAlpha = pulse
    ctx.fillStyle = traitGlowForAgent(agent)
    ctx.beginPath()
    ctx.arc(cx, cy + bob, size * 1.35, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1

    if (agent.id === selectedAgentId) {
      drawHex(ctx, cx, cy + bob, hexSize + 4)
      ctx.strokeStyle = '#fef18c'
      ctx.lineWidth = 2.2
      ctx.shadowColor = '#fef18c'
      ctx.shadowBlur = 10
      ctx.stroke()
      ctx.shadowBlur = 0
    }
  }
}

export const getAgentAtPixel = (state, pixelX, pixelY, selectedAgentId) => {
  const viewport = viewportFor(state, selectedAgentId)
  const hexSize = 16
  let best = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const agent of state.agents) {
    if (
      agent.x < viewport.offsetX ||
      agent.y < viewport.offsetY ||
      agent.x >= viewport.offsetX + viewport.width ||
      agent.y >= viewport.offsetY + viewport.height
    ) {
      continue
    }
    const { cx, cy } = worldToScreen(agent.x, agent.y, viewport.offsetX, viewport.offsetY, hexSize)
    const dx = cx - pixelX
    const dy = cy - pixelY
    const distance = Math.sqrt(dx * dx + dy * dy)
    if (distance < bestDistance) {
      bestDistance = distance
      best = agent
    }
  }
  return bestDistance <= 14 ? best : null
}

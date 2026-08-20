import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { WORLD_SIZE } from './constants'
import { getDayProgress } from './lifecycle'

const TERRAIN_COLORS = {
  beach: [0.76, 0.57, 0.31],
  empty: [0.22, 0.29, 0.2],
  food: [0.22, 0.52, 0.2],
  shop: [0.18, 0.24, 0.34],
  stone: [0.42, 0.43, 0.42],
  water: [0.05, 0.2, 0.34],
  wood: [0.12, 0.34, 0.14],
}

const BEACH_PATCH_GEOMETRY = new THREE.CircleGeometry(0.78, 8)
const BEACH_PATCH_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xd8b56b, side: THREE.DoubleSide })

// --- Visual Asset Factories ---

const createAgentMesh = (agent) => {
  const group = new THREE.Group()
  const color = agent.dna.aggression > 0.5 ? 0xff4444 : 0x4444ff
  const bodyMat = new THREE.MeshStandardMaterial({ color })

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.2, 4, 8), bodyMat)
  torso.position.y = 0.3
  torso.castShadow = true
  group.add(torso)

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 16), bodyMat)
  head.position.y = 0.25
  torso.add(head)

  // Awakening Halo (Golden Glow)
  const haloGeo = new THREE.TorusGeometry(0.12, 0.01, 8, 32)
  const haloMat = new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0 })
  const halo = new THREE.Mesh(haloGeo, haloMat)
  halo.rotation.x = Math.PI / 2
  halo.position.y = 0.45
  group.add(halo)

  const limbGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.2)
  const leftLeg = new THREE.Mesh(limbGeo, bodyMat)
  leftLeg.position.set(-0.06, -0.15, 0)
  torso.add(leftLeg)

  const rightLeg = new THREE.Mesh(limbGeo, bodyMat)
  rightLeg.position.set(0.06, -0.15, 0)
  torso.add(rightLeg)

  const auraMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending })
  const aura = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 16), auraMat)
  torso.add(aura)

  const pulseGeo = new THREE.RingGeometry(0.1, 0.2, 32)
  const pulseMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })
  const pulse = new THREE.Mesh(pulseGeo, pulseMat)
  pulse.rotateX(-Math.PI / 2)
  pulse.position.y = 0.02
  group.add(pulse)

  return { group, torso, head, leftLeg, rightLeg, bodyMat, auraMat, pulse, pulseMat, pulseTimer: 0, halo, haloMat }
}

const createCrocodileMesh = () => {
  const group = new THREE.Group()
  const hideMaterial = new THREE.MeshStandardMaterial({ color: 0x355d2a, roughness: 0.9 })
  const darkHideMaterial = new THREE.MeshStandardMaterial({ color: 0x203f20, roughness: 1 })

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.22, 1.05), hideMaterial)
  body.position.y = 0.16
  body.castShadow = true
  group.add(body)

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.2, 0.5), hideMaterial)
  head.position.set(0, 0.16, -0.65)
  head.castShadow = true
  group.add(head)

  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.13, 0.42), darkHideMaterial)
  snout.position.set(0, 0.12, -1.03)
  group.add(snout)

  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.9, 7), darkHideMaterial)
  tail.rotation.x = Math.PI / 2
  tail.position.set(0, 0.14, 0.92)
  tail.castShadow = true
  group.add(tail)

  const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0xffd54a })
  for (const x of [-0.12, 0.12]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), eyeMaterial)
    eye.position.set(x, 0.28, -0.78)
    group.add(eye)
  }

  return { group, tail }
}

const createPropMesh = (type) => {
  const group = new THREE.Group()
  if (type === 'house') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.8), new THREE.MeshStandardMaterial({ color: 0xeeeeee }))
    body.position.y = 0.3
    body.castShadow = true
    body.receiveShadow = true
    group.add(body)
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.7, 0.4, 4), new THREE.MeshStandardMaterial({ color: 0xaa4444 }))
    roof.position.y = 0.8
    roof.rotation.y = Math.PI / 4
    roof.castShadow = true
    group.add(roof)
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.34, 0.04), new THREE.MeshStandardMaterial({ color: 0x6b3f22 }))
    door.position.set(0, 0.19, 0.42)
    group.add(door)
    const windowMaterial = new THREE.MeshStandardMaterial({ color: 0xffd86b, emissive: 0x6b4500, emissiveIntensity: 0.8 })
    const window = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.04), windowMaterial)
    window.position.set(0.24, 0.42, 0.42)
    group.add(window)
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.45, 0.14), new THREE.MeshStandardMaterial({ color: 0x5b4a43 }))
    chimney.position.set(0.28, 0.92, 0.12)
    chimney.castShadow = true
    group.add(chimney)
  } else if (type === 'monolith') {
    // Obsidian Monolith (Civilization Anchor)
    const geo = new THREE.BoxGeometry(0.4, 2.0, 0.4)
    const mat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, metalness: 0.9, roughness: 0.1, emissive: 0x220044 })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.y = 1.0
    mesh.castShadow = true
    group.add(mesh)
    
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.1, 0.45), new THREE.MeshBasicMaterial({ color: 0xaa00ff }))
    core.position.y = 1.8
    group.add(core)
  } else if (type === 'shop') {
    // Shop Building (Blue body, white roof/awning)
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.9), new THREE.MeshStandardMaterial({ color: 0x3366ff }))
    body.position.y = 0.25
    body.castShadow = true
    group.add(body)
    
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.1, 1.0), new THREE.MeshStandardMaterial({ color: 0xeeeeee }))
    roof.position.y = 0.5
    group.add(roof)

    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.05), new THREE.MeshStandardMaterial({ color: 0xffff00 }))
    sign.position.set(0, 0.7, 0.45)
    group.add(sign)
  } else if (type === 'dock') {
    const woodMaterial = new THREE.MeshStandardMaterial({ color: 0x8a5a2f, roughness: 0.9 })
    const deck = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.12, 0.75), woodMaterial)
    deck.position.y = 0.14
    deck.castShadow = true
    group.add(deck)
    for (const x of [-0.48, 0.48]) {
      for (const z of [-0.28, 0.28]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.48, 8), woodMaterial)
        post.position.set(x, -0.02, z)
        group.add(post)
      }
    }
    const fishCrate = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.25, 0.3), new THREE.MeshStandardMaterial({ color: 0x4d7c8a }))
    fishCrate.position.set(0.25, 0.31, 0)
    group.add(fishCrate)
  } else if (type === 'beach') {
    const sand = new THREE.Mesh(BEACH_PATCH_GEOMETRY, BEACH_PATCH_MATERIAL)
    sand.rotation.x = -Math.PI / 2
    sand.position.y = 0.025
    group.add(sand)
  } else {
    // Stylized procedural tree (Default)
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.08, 0.5), new THREE.MeshStandardMaterial({ color: 0x5d4037 }))
    trunk.position.y = 0.25
    trunk.castShadow = true
    group.add(trunk)
    
    for (let i = 0; i < 4; i++) {
       const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.25, 0), new THREE.MeshStandardMaterial({ color: 0x2e7d32 }))
       leaves.position.set((Math.random()-0.5)*0.2, 0.4 + i*0.15, (Math.random()-0.5)*0.2)
       leaves.castShadow = true
       group.add(leaves)
    }
  }
  return group
}

export const create3DRenderer = (container, onAgentClick, onTileClick) => {
  if (!container) return null

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0a0a0f)
  
  const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000)
  camera.position.set(24, 20, 24)

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(container.clientWidth, container.clientHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  container.appendChild(renderer.domElement)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.maxDistance = 100

  scene.add(new THREE.AmbientLight(0xffffff, 0.9))
  const sunLight = new THREE.DirectionalLight(0xffffff, 1.0)
  sunLight.castShadow = true
  sunLight.shadow.mapSize.set(2048, 2048)
  sunLight.shadow.camera.near = 0.5;
  sunLight.shadow.camera.far = 500;
  sunLight.shadow.camera.left = -40; sunLight.shadow.camera.right = 40
  sunLight.shadow.camera.top = 40; sunLight.shadow.camera.bottom = -40
  scene.add(sunLight)

  const moonLight = new THREE.DirectionalLight(0x4466ff, 0.2)
  moonLight.position.set(-10, 50, -10)
  scene.add(moonLight)

  // --- Celestial Bodies (Visual Sun/Moon) ---
  const sunGeo = new THREE.SphereGeometry(2, 32, 32)
  const sunMat = new THREE.MeshBasicMaterial({ color: 0xffffee })
  const sunMesh = new THREE.Mesh(sunGeo, sunMat)
  scene.add(sunMesh)

  const moonGeo = new THREE.SphereGeometry(1.2, 32, 32)
  const moonMat = new THREE.MeshBasicMaterial({ color: 0x99aaff })
  const moonMesh = new THREE.Mesh(moonGeo, moonMat)
  scene.add(moonMesh)

  const terrainGeo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, WORLD_SIZE, WORLD_SIZE)
  terrainGeo.rotateX(-Math.PI / 2)
  
  const land = new THREE.Mesh(terrainGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true }))
  land.receiveShadow = true
  scene.add(land)

  const waterGeo = new THREE.PlaneGeometry(WORLD_SIZE * 20, WORLD_SIZE * 20)
  waterGeo.rotateX(-Math.PI / 2)
  // Transparent rendering fixes:
  const waterMat = new THREE.MeshStandardMaterial({ 
     color: 0x0055aa, transparent: true, opacity: 0.6, 
     roughness: 0.1, metalness: 0.2, depthWrite: false 
  })
  const waterMesh = new THREE.Mesh(waterGeo, waterMat)
  waterMesh.position.y = 0.22 * 4.0 
  scene.add(waterMesh)

  const attentionRing = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.6, 32), new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.8, side: THREE.DoubleSide }))
  attentionRing.rotateX(-Math.PI / 2); attentionRing.visible = false; scene.add(attentionRing)

  const memoryGhost = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.3 }))
  memoryGhost.visible = false; scene.add(memoryGhost)

  const agentMeshes = new Map()
  const crocodileMeshes = new Map()
  const propPool = new Map()
  let lastTerrainUpdateTick = Number.NEGATIVE_INFINITY

  const raycaster = new THREE.Raycaster()
  const mouse = new THREE.Vector2()

  const onMouseDown = (event) => {
    const rect = container.getBoundingClientRect()
    mouse.x = ((event.clientX - rect.left) / container.clientWidth) * 2 - 1
    mouse.y = -((event.clientY - rect.top) / container.clientHeight) * 2 + 1
    raycaster.setFromCamera(mouse, camera)
    
    const intersects = raycaster.intersectObjects(Array.from(agentMeshes.values()).map(m => m.group), true)
    if (intersects.length > 0) {
      let curr = intersects[0].object
      while (curr.parent && !curr.userData.agentId) curr = curr.parent
      if (curr.userData.agentId) onAgentClick(curr.userData.agentId)
    } else {
      const gInts = raycaster.intersectObject(land)
      if (gInts.length > 0) onTileClick({ x: Math.round(gInts[0].point.x + (WORLD_SIZE/2)), y: Math.round(gInts[0].point.z + (WORLD_SIZE/2)) })
    }
  }
  container.addEventListener('mousedown', onMouseDown)

  let animationFrameId = null
  const animate = () => {
    animationFrameId = requestAnimationFrame(animate)
    controls.update()
    
    agentMeshes.forEach(am => {
      // Dopamine Pulses
      if (am.pulseTimer > 0) {
        am.pulseTimer -= 0.02
        am.pulse.scale.setScalar(1.0 + (1.0-am.pulseTimer) * 3.0)
        am.pulseMat.opacity = am.pulseTimer * 0.8
      } else { am.pulseMat.opacity = 0 }
      
      // Halo Pulse for Awakened
      if (am.haloMat.opacity > 0) {
         am.halo.rotation.z += 0.05
         am.halo.scale.setScalar(1.0 + Math.sin(performance.now() * 0.005) * 0.1)
      }
    })

    crocodileMeshes.forEach((crocodile) => {
      crocodile.tail.rotation.y = Math.sin(performance.now() * 0.006) * 0.18
    })
    
    renderer.render(scene, camera)
  }
  animate()

  const ELEVATION_SCALE = 4.0

  return {
    update: (state, selectedId) => {
      if (!state) return

      // --- 1. Update Terrain Geometry & Mycelial Glow ---
      const centerOff = WORLD_SIZE / 2

      if (state.tick - lastTerrainUpdateTick >= 4) {
        const positions = terrainGeo.attributes.position.array
        const vertexCount = (WORLD_SIZE + 1) * (WORLD_SIZE + 1)
        const colors = new Float32Array(vertexCount * 3)

        for (let y = 0; y <= WORLD_SIZE; y++) {
          for (let x = 0; x <= WORLD_SIZE; x++) {
            const vertexIndex = (y * (WORLD_SIZE + 1) + x) * 3
            const tIdx = Math.min(state.world.length - 1, (Math.min(y, WORLD_SIZE-1) * WORLD_SIZE) + Math.min(x, WORLD_SIZE-1))
            const tile = state.world[tIdx]
            positions[vertexIndex + 1] = tile.height * ELEVATION_SCALE

            // Collective Mind Bloom (Terrain Color Pulse)
            const rawTrace = state.substrate.getValue(x,y).data
            const traceStrength = Number.isFinite(rawTrace) ? Math.max(0, Math.min(1, rawTrace / 5)) : 0
            const baseColor = TERRAIN_COLORS[tile.type] ?? TERRAIN_COLORS.empty
            colors[vertexIndex] = Math.max(0, Math.min(1, baseColor[0] + traceStrength * 0.08))
            colors[vertexIndex + 1] = Math.max(0, Math.min(1, baseColor[1] + traceStrength * 0.2))
            colors[vertexIndex + 2] = Math.max(0, Math.min(1, baseColor[2] + traceStrength * 0.25))
          }
        }

        terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
        terrainGeo.attributes.position.needsUpdate = true
        terrainGeo.computeVertexNormals()
        lastTerrainUpdateTick = state.tick
      }

      // --- 2. Dynamic Atmosphere ---
      const dayProgress = getDayProgress(state.tick, state.calendar)
      // Angle: 6 AM (0) -> 12 PM (PI/2) -> 6 PM (PI) -> 12 AM (3PI/2)
      const sunAngle = (dayProgress * Math.PI * 2) - (Math.PI / 2)
      
      const orbitRadius = 45 
      const sunX = Math.cos(sunAngle) * orbitRadius
      const sunY = Math.sin(sunAngle) * orbitRadius
      const sunZ = 0 // Keep it simple on one axis for better shadow stability
      
      sunLight.position.set(sunX, sunY, sunZ)
      sunMesh.position.set(sunX, sunY, sunZ)
      sunLight.intensity = Math.max(0, Math.sin(sunAngle)) * 1.5
      
      const moonAngle = sunAngle + Math.PI
      const moonX = Math.cos(moonAngle) * orbitRadius
      const moonY = Math.sin(moonAngle) * orbitRadius
      const moonZ = 0
      
      moonLight.position.set(moonX, moonY, moonZ)
      moonMesh.position.set(moonX, moonY, moonZ)
      moonLight.intensity = Math.max(0, Math.sin(moonAngle)) * 0.4

      const s = Math.max(0, Math.sin(sunAngle))
      scene.background.setRGB(0.02 + s * 0.1, 0.02 + s * 0.3, 0.05 + s * 0.5)

      // --- 3. Update Agents ---
      const existingIds = new Set(agentMeshes.keys())
      state.agents.forEach(a => {
        let am = agentMeshes.get(a.id)
        if (!am) {
          am = createAgentMesh(a); am.group.userData.agentId = a.id
          scene.add(am.group); agentMeshes.set(a.id, am)
        }
        existingIds.delete(a.id)

        am.group.visible = !a.indoors

        const visualY = (a.height ?? 0.5) * ELEVATION_SCALE
        am.group.position.set(a.x - centerOff, visualY, a.y - centerOff)
        
        // Awakening Halo
        am.haloMat.opacity = a.isAwoken ? 0.8 : 0;

        if (a.ticksSinceEvaluation === 0) am.torso.rotation.y = Math.sin(performance.now() * 0.02) * 0.3
        else am.torso.rotation.y = 0
        if (a.dopamineSpike) am.pulseTimer = 1.0

        if (a.id === selectedId) {
          am.auraMat.opacity = 0.4 + Math.sin(performance.now() * 0.01) * 0.2
          if (a.attentionTarget) {
            const tx = a.attentionTarget.x - centerOff, tz = a.attentionTarget.y - centerOff
            const ty = (state.world[a.attentionTarget.y * WORLD_SIZE + a.attentionTarget.x]?.height ?? 0) * ELEVATION_SCALE
            if (Math.sqrt((a.x-tx-centerOff)**2 + (a.y-tz-centerOff)**2) <= a.visionRange) {
               attentionRing.position.set(tx, ty + 0.05, tz); attentionRing.visible = true; memoryGhost.visible = false
            } else {
               memoryGhost.position.set(tx, ty + 0.8, tz); memoryGhost.visible = true; attentionRing.visible = false
            }
          } else { attentionRing.visible = false; memoryGhost.visible = false }
        }
        am.auraMat.color.setRGB(0.5 + a.chemistry.cortisol * 0.5, 0.2 + a.chemistry.dopamine * 0.5, 0.2)
      })
      existingIds.forEach(id => { scene.remove(agentMeshes.get(id).group); agentMeshes.delete(id) })

      // --- 4. Crocodiles ---
      const existingCrocodileIds = new Set(crocodileMeshes.keys())
      ;(state.predators ?? []).forEach((predator) => {
        let crocodile = crocodileMeshes.get(predator.id)
        if (!crocodile) {
          crocodile = createCrocodileMesh()
          scene.add(crocodile.group)
          crocodileMeshes.set(predator.id, crocodile)
        }
        existingCrocodileIds.delete(predator.id)
        const tile = state.world[predator.y * WORLD_SIZE + predator.x]
        const visualY = tile?.type === 'water'
          ? 0.91
          : (tile?.height ?? 0.25) * ELEVATION_SCALE + 0.05
        crocodile.group.position.set(predator.x - centerOff, visualY, predator.y - centerOff)
        crocodile.group.rotation.y = Math.atan2(predator.facing?.dx ?? 0, predator.facing?.dy ?? 1)
      })
      existingCrocodileIds.forEach((id) => {
        scene.remove(crocodileMeshes.get(id).group)
        crocodileMeshes.delete(id)
      })

      // --- 5. Props Sync ---
      state.world.forEach(tile => {
        const hasBeachPatch = tile.type === 'beach' && (tile.x + tile.y) % 3 === 0
        const hasVisibleStructure = tile.type === 'wood' || hasBeachPatch || tile.structure === 'house' || tile.structure === 'monolith' || tile.structure === 'shop' || tile.structure === 'dock';
        if (hasVisibleStructure) {
          const key = `${tile.x},${tile.y}`
          if (!propPool.has(key)) {
            let propType = tile.structure || 'tree';
            if (tile.type === 'beach' && !tile.structure) propType = 'beach';
            
            const p = createPropMesh(propType)
            let propHeight = tile.height * ELEVATION_SCALE
            p.position.set(tile.x - centerOff, propHeight, tile.y - centerOff)
            scene.add(p)
            propPool.set(key, p)
          }
        }
      })
    },
    dispose: () => {
      if (animationFrameId !== null) cancelAnimationFrame(animationFrameId)
      container.removeEventListener('mousedown', onMouseDown)
      renderer.dispose()
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement)
    }
  }
}

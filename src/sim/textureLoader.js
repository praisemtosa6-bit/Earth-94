import * as THREE from 'three'

// Texture loader with fallback to synthetic textures
const textureLoader = new THREE.TextureLoader()

const loadTextureWithFallback = async (url, fallbackTexture) => {
  try {
    const texture = await new Promise((resolve, reject) => {
      textureLoader.load(url, resolve, undefined, reject)
    })
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    return texture
  } catch {
    console.warn(`Failed to load texture ${url}, using fallback`)
    return fallbackTexture
  }
}

// High-quality triplanar material with real texture support
export const createAdvancedTriplanarMaterial = async (
  tileType,
  baseColor,
  accentColor,
  roughnessValue = 0.7,
  metalnessValue = 0.05,
  seed = 0
) => {
  // Generate fallback textures in case real assets aren't available
  const fallbackAlbedo = createSyntheticAlbedoTexture(baseColor, accentColor, seed)
  const fallbackNormal = createSyntheticNormalMap(seed)
  const fallbackRoughness = createSyntheticRoughnessMap(roughnessValue, 0.15, seed)
  const fallbackMetalness = createSyntheticMetalnessMap(metalnessValue, 0.02, seed)

  // Try to load real textures, otherwise use fallbacks
  const albedoBaseUrl = `/textures/${tileType}/albedo`
  const normalBaseUrl = `/textures/${tileType}/normal`
  const roughnessBaseUrl = `/textures/${tileType}/roughness`
  const metalnessBaseUrl = `/textures/${tileType}/metalness`

  // Attempt to load textures in parallel
  const [albedo, normal, roughness, metalness] = await Promise.all([
    loadTextureWithFallback(`${albedoBaseUrl}.jpg`, fallbackAlbedo),
    loadTextureWithFallback(`${normalBaseUrl}.jpg`, fallbackNormal),
    loadTextureWithFallback(`${roughnessBaseUrl}.jpg`, fallbackRoughness),
    loadTextureWithFallback(`${metalnessBaseUrl}.jpg`, fallbackMetalness),
  ])

  const material = new THREE.MeshStandardMaterial({
    color: baseColor,
    map: albedo,
    normalMap: normal,
    roughnessMap: roughness,
    metalnessMap: metalness,
    roughness: roughnessValue,
    metalness: metalnessValue,
  })

  return material
}

// Create synthetic albedo texture with Perlin-like noise
const createSyntheticAlbedoTexture = (baseColor, accentColor, seed = 0) => {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return new THREE.CanvasTexture(canvas)

  // Fill with base color
  const baseHex = baseColor.toString(16).padStart(6, '0')
  ctx.fillStyle = `#${baseHex}`
  ctx.fillRect(0, 0, size, size)

  // Add variation with improved noise
  const accentHex = accentColor.toString(16).padStart(6, '0')
  const scale = 0.15 + (Math.sin(seed * 7) * 0.1)
  const density = 600 + Math.floor(Math.sin(seed * 13) * 200)

  for (let i = 0; i < density; i += 1) {
    const x = Math.floor(Math.random() * size)
    const y = Math.floor(Math.random() * size)
    const noise = perlinLike(x / size, y / size, seed)
    const alphaValue = Math.max(0, Math.min(1, scale + noise * 0.2))
    const alpha = Math.floor(alphaValue * 255).toString(16).padStart(2, '0')
    ctx.fillStyle = `#${accentHex}${alpha}`
    const brushSize = 1 + Math.floor(noise * 2)
    ctx.fillRect(x, y, brushSize, brushSize)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipMapLinearFilter
  return texture
}

// Create synthetic normal map with pseudo-Perlin noise
const createSyntheticNormalMap = (seed = 0) => {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return new THREE.CanvasTexture(canvas)

  const imageData = ctx.createImageData(size, size)
  const data = imageData.data

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4
      const u = x / size
      const v = y / size

      const n = perlinLike(u * 3, v * 3, seed)
      const nx = perlinLike(u * 3 + 1000, v * 3, seed + 1)
      const ny = perlinLike(u * 3, v * 3 + 1000, seed + 2)

      data[i] = Math.floor((nx * 0.5 + 0.5) * 255)
      data[i + 1] = Math.floor((ny * 0.5 + 0.5) * 255)
      data[i + 2] = Math.floor((0.7 + n * 0.3) * 255)
      data[i + 3] = 255
    }
  }

  ctx.putImageData(imageData, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  return texture
}

// Create synthetic roughness map
const createSyntheticRoughnessMap = (baseRoughness = 0.7, variation = 0.2, seed = 0) => {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return new THREE.CanvasTexture(canvas)

  const imageData = ctx.createImageData(size, size)
  const data = imageData.data

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4
      const u = x / size
      const v = y / size
      const noise = perlinLike(u * 4, v * 4, seed)
      const roughness = Math.max(0, Math.min(1, baseRoughness + (noise - 0.5) * variation))

      const value = Math.floor(roughness * 255)
      data[i] = value
      data[i + 1] = value
      data[i + 2] = value
      data[i + 3] = 255
    }
  }

  ctx.putImageData(imageData, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  return texture
}

// Create synthetic metalness map
const createSyntheticMetalnessMap = (baseMetalness = 0.05, variation = 0.02, seed = 0) => {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return new THREE.CanvasTexture(canvas)

  const imageData = ctx.createImageData(size, size)
  const data = imageData.data

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4
      const u = x / size
      const v = y / size
      const noise = perlinLike(u * 6, v * 6, seed)
      const metalness = Math.max(0, Math.min(1, baseMetalness + (noise - 0.5) * variation))

      const value = Math.floor(metalness * 255)
      data[i] = value
      data[i + 1] = value
      data[i + 2] = value
      data[i + 3] = 255
    }
  }

  ctx.putImageData(imageData, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  return texture
}

// Simplified Perlin-like noise function - returns value in [-1, 1] range
const perlinLike = (x, y, seed) => {
  const cx = Math.floor(x)
  const cy = Math.floor(y)
  const fx = x - cx
  const fy = y - cy

  const u = fade(fx)
  const v = fade(fy)

  const n00 = dotGridGradient(cx, cy, x, y, seed)
  const n10 = dotGridGradient(cx + 1, cy, x, y, seed)
  const ix0 = lerp(n00, n10, u)

  const n01 = dotGridGradient(cx, cy + 1, x, y, seed)
  const n11 = dotGridGradient(cx + 1, cy + 1, x, y, seed)
  const ix1 = lerp(n01, n11, u)

  return Math.max(-1, Math.min(1, lerp(ix0, ix1, v)))
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10)
const lerp = (a, b, t) => a + (b - a) * t
const dotGridGradient = (ix, iy, x, y, seed) => {
  const hash = ((ix ^ (iy * 73856093)) ^ (seed * 19349663)) & 255
  const angle = (hash / 256) * Math.PI * 2
  const gx = Math.cos(angle)
  const gy = Math.sin(angle)
  const dx = x - ix
  const dy = y - iy
  return gx * dx + gy * dy
}

// Simplified material cache for performance
const materialCache = new Map()

export const getOrCreateTriplanarMaterial = (tileType, baseColor, accentColor, roughness, metalness, seed) => {
  const safeColor = isNaN(baseColor) ? 0x808080 : (typeof baseColor === 'number' ? baseColor : parseInt(baseColor, 16))
  const safeRoughness = Math.max(0, Math.min(1, roughness || 0.7))
  const safeMetalness = Math.max(0, Math.min(1, metalness || 0.05))
  
  const cacheKey = `adv-${tileType}-${safeColor.toString(16)}-${safeRoughness}-${safeMetalness}-${seed}`

  if (!materialCache.has(cacheKey)) {
    const albedo = createSyntheticAlbedoTexture(safeColor, accentColor || safeColor, seed)
    const normal = createSyntheticNormalMap(seed)
    const roughnessMap = createSyntheticRoughnessMap(safeRoughness, 0.15, seed)

    const material = new THREE.MeshStandardMaterial({
      color: safeColor,
      map: albedo,
      normalMap: normal,
      roughnessMap: roughnessMap,
      roughness: safeRoughness,
      metalness: safeMetalness,
      envMapIntensity: 1.0
    })

    materialCache.set(cacheKey, material)
  }

  return materialCache.get(cacheKey)
}

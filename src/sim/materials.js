import * as THREE from 'three'
import { getOrCreateTriplanarMaterial } from './textureLoader'

// High-quality material system with PBR texture support
export const createTriplanarStandardMaterial = (albedoColor, accentColor, roughness = 0.7, metalness = 0.05, seed = 0) => {
  // Use the advanced material system with texture loading support
  return getOrCreateTriplanarMaterial(
    'terrain',
    albedoColor,
    accentColor,
    roughness,
    metalness,
    seed
  )
}

// Texture configuration for different tile types
// Supports both procedural generation and real texture asset loading
export const textureConfig = {
  beach: { albedo: 0xc7a35d, accent: 0xf0d796, roughness: 0.92, metalness: 0.01 },
  food: { albedo: 0x63b26e, accent: 0xcce8a4, roughness: 0.75, metalness: 0.04 },
  wood: { albedo: 0x4f8f4a, accent: 0x2f5d2c, roughness: 0.8, metalness: 0.03 },
  stone: { albedo: 0x8f97a8, accent: 0xced4de, roughness: 0.85, metalness: 0.08 },
  empty: { albedo: 0x5e6374, accent: 0x3f4559, roughness: 0.78, metalness: 0.05 },
  water: { albedo: 0x2e6fb8, accent: 0x9fd6ff, roughness: 0.3, metalness: 0.4 },
}

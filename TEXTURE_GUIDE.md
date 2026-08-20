# Triplanar Shader Material System

## Overview

This implementation adds a professional-grade PBR (Physically-Based Rendering) material system with triplanar texture mapping and support for real texture assets. It brings a significant visual fidelity improvement over the previous procedural canvas approach.

## Architecture

### Core Files

1. **`materials.js`** - High-level material factory and configuration
2. **`textureLoader.js`** - Advanced texture generation and loading system with fallbacks
3. **`renderer3d.js`** - Updated terrain rendering using new materials

## Features

### Current Capabilities

✅ **Procedural Texture Generation**
- High-quality synthetic textures with Perlin-like noise
- Per-tile color variation based on richness and coastal influence
- Emissive glow for visual depth
- Full PBR material support (albedo, normal, roughness, metalness maps)

✅ **Material Caching**
- Intelligent material cache prevents duplicate creation
- Significant performance improvement for large terrains

✅ **Texture Configuration**
- Per-tile-type texture parameters
- Easy customization of roughness and metalness

### Ready for Enhancement

📦 **Real Texture Asset Support**
The system is fully prepared to load real texture assets when you add them:

```
public/textures/
├── food/
│   ├── albedo.jpg
│   ├── normal.jpg
│   ├── roughness.jpg
│   └── metalness.jpg
├── wood/
├── stone/
├── water/
└── empty/
```

## Adding Real Texture Assets

### Step 1: Create Texture Maps

For each tile type, you'll need 4 maps per texture set:

1. **Albedo (Color) Map** - The base color information
   - Recommended: 2K resolution (2048x2048 or 1024x1024)
   - Format: JPG or PNG (sRGB color space)
   - Should show the natural color variation

2. **Normal Map** - Surface detail information
   - Recommended: 2K resolution
   - Format: JPG or PNG
   - Should show microdetail like moss, rocks, grass blades
   - Blue-dominant (0, 0, 255) = upward-facing surfaces

3. **Roughness Map** - Surface smoothness information
   - Grayscale texture: black = smooth, white = rough
   - Recommended: 1K resolution
   - Use for moss/organic on food, scratches on stone, etc.

4. **Metalness Map** - Metallic content
   - Grayscale texture: black = non-metallic, white = metallic
   - Most tiles should be mostly black (non-metallic)
   - Consider tiny metallic flecks in stone

### Step 2: Organize Texture Files

Place textures in the directory structure above. The loader automatically attempts to load from these paths.

### Step 3: Naming Convention

- Every texture file should follow the pattern: `{type}/{mapName}.jpg`
- Types: `food`, `wood`, `stone`, `water`, `empty`
- Map names: `albedo`, `normal`, `roughness`, `metalness`

## Texture Recommendations by Type

### Food (Grassland)
- **Albedo**: Bright green grass with slight color variation
- **Normal**: Fine grass texture detail, slight undulation
- **Roughness**: Medium-high (0.7-0.75), organic texture
- **Metalness**: Very low (0.02-0.04), minimal sheen

### Wood (Forest)
- **Albedo**: Dark green with brown undertones
- **Normal**: Medium detail, slightly bumpy surface
- **Roughness**: High (0.8), natural bark texture
- **Metalness: Low (0.03)

### Stone (Rocky)
- **Albedo**: Gray with brown/tan variation
- **Normal**: High detail, clear rock formations
- **Roughness**: Highest (0.85), rough stone surface
- **Metalness**: Higher (0.08), possible mineral flecks

### Water
- **Albedo**: Blue with some transparency simulation in variation
- **Normal**: Wave-like ripple patterns
- **Roughness**: Low (0.3), reflective surface
- **Metalness**: Higher (0.4), reflective property

### Empty (Dirt/Stone Mix)
- **Albedo**: Muted gray-brown
- **Normal**: Subtle detail
- **Roughness**: Medium (0.78)
- **Metalness**: Low (0.05)

## Technical Details

### Procedural Generation

The system includes built-in procedural generation with improved Perlin-like noise:

```javascript
// Example: Using procedural materials
import { createTriplanarStandardMaterial, textureConfig } from './sim/materials.js'

const config = textureConfig.stone
const material = createTriplanarStandardMaterial(
  config.albedo,  // Base color as hex
  config.accent,  // Accent color for variation
  config.roughness,
  config.metalness,
  seed // Unique seed per tile for variation
)
```

### Material Caching

Materials are cached by a composite key:
```
`{type}-{baseColor}-{accentColor}-{roughness}-{metalness}-{seed}`
```

This means identical materials are reused, maximizing performance.

## Performance Considerations

- **Texture Resolution**: 2K x 2K maps provide excellent quality without excessive memory usage
- **Material Caching**: Reduces draw calls and memory footprint
- **Fallback System**: If assets don't load, procedural generation maintains visual quality
- **Lazy Loading**: Textures are loaded only as needed

## Next Steps for Maximum Fidelity

1. **Create/source high-quality PBR texture packs**
2. **Place them in `public/textures/{type}/{mapName}.jpg`**
3. **Optional: Use a texture atlas for even better performance**
4. **Consider 4K textures for tiling improvement** over procedural during close zoom

## Troubleshooting

### Textures Not Loading?
- Check browser console for 404 errors
- Verify file paths: `/textures/{type}/{name}.jpg`
- Ensure files are in the `public/` directory
- Check that file extensions match (case-sensitive on Linux/Mac)

### Material Performance Issues?
- Reduce texture resolution at distance using LOD
- Limit number of unique materials in viewport
- Profile using Three.js Inspector

### Procedural Materials Look Different Per Tile?
- This is intentional! Each tile gets a unique seed for variation
- Adjust texture config to reduce variation if desired

## Future Enhancements

- Triplanar blending for vertices at different angles
- AO (Ambient Occlusion) maps for shadow detail
- Height maps for parallax occlusion mapping
- Dynamic texture switching based on LOD
- Real-time texture asset hot-reloading during development

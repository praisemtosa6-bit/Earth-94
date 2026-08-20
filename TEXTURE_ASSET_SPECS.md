# Texture Asset Specifications

Use this guide to source or create PBR texture assets for Earth 94.

## Quick Reference Table

| Tile Type | Albedo Color | Roughness | Metalness | Use Case |
|-----------|--------------|-----------|-----------|----------|
| **Food** | #63b26e (Green) | 0.75 | 0.04 | Grassland, vegetation |
| **Wood** | #4f8f4a (Dark Green) | 0.8 | 0.03 | Forest, dense vegetation |
| **Stone** | #8f97a8 (Gray) | 0.85 | 0.08 | Rocky terrain, mountains |
| **Water** | #2e6fb8 (Blue) | 0.3 | 0.4 | Water bodies |
| **Empty** | #5e6374 (Gray-Brown) | 0.78 | 0.05 | Dirt, barren terrain |

## Detailed Specifications

### FOOD TILES - Grassland Texture

**Visual Theme**: Healthy grass with soil variation

**Albedo Map (Color)**
- Dominant color: Bright grass green (#63b26e)
- Variation: Mix in some yellow-green (#7cef9d) and brown (#8b7355)
- Pattern: Random grass clumps, fine blades
- Recommended sources: Poly Haven grass, Substance 3D grassland

**Normal Map**
- Pattern: Fine, repetitive grass blade details
- Scale: Mix of 4-8mm and 2-3mm detail
- Height variation: Subtle undulation (±0.5-1mm apparent)
- Mostly pointing up (blue-dominant, Z: 200+)

**Roughness Map**
- Base value: 0.75 (relatively rough)
- Variation: ±0.05 (fine variation in blade arrangement)
- Smoother areas: Where grass is matted (0.70)
- Rougher areas: Where soil shows through (0.80)

**Metalness Map**
- Nearly solid black (0 metalness)
- Optional: Tiny metallic vein streaks (0.02-0.04) for realism

---

### WOOD TILES - Dense Forest Texture

**Visual Theme**: Dark forest with bark texture

**Albedo Map (Color)**
- Dominant color: Dark forest green (#4f8f4a)
- Variation: Mix forest green (#2f5d2c) and brown (#5d4033)
- Pattern: Textured moss/bark with organic variation
- Consider: Adding subtle peat/organic material look

**Normal Map**
- Pattern: Coarse bark-like texture
- Scale: Mix of rough 8-12mm and medium 4-6mm
- Height variation: Moderate undulation (±1-2mm apparent)
- Mostly up with some sideways normals for bark cracks

**Roughness Map**
- Base value: 0.80 (rough organic material)
- Variation: ±0.08 (more variation than grass due to bark)
- Smoother: Lichen/moss areas (0.75)
- Rougher: Exposed wood (0.85)

**Metalness Map**
- Solid black (0 metalness)
- Optional: Texture for fungal growth or mineral deposits

---

### STONE TILES - Rocky Terrain

**Visual Theme**: Natural stone with geological variation

**Albedo Map (Color)**
- Dominant color: Medium gray (#8f97a8)
- Variation: Mix brown-gray (#7a6f5f), light gray (#ced4de), rust (#b87337)
- Pattern: Geological strata, lichen, weathering
- Recommended: Tile-based stone textures (low repeat scale)

**Normal Map**
- Pattern: High-detail rock fractures and weathering
- Scale: Mix of 12-20mm and 4-8mm detail
- Height variation: Significant (±2-4mm apparent for realism)
- Varied directions: Shows actual rock face erosion

**Roughness Map**
- Base value: 0.85 (very rough stone)
- Variation: ±0.10 (high variation from smooth mineral faces to porous areas)
- Smoother: Weathered faces (0.78)
- Rougher: Fresh breaks and pitted areas (0.92)

**Metalness Map**
- Base: Dark gray (#333 or lower)
- Pattern: Mineral flecks and striations
- Variation: 0.05-0.15 for mineral content
- Consider: Pyrite or other metallic minerals for realism

---

### WATER TILES - Liquid Surface

**Visual Theme**: Water with ripple/wave patterns

**Albedo Map (Color)**
- Dominant color: Ocean blue (#2e6fb8)
- Variation: Mix cyan (#4da9ff), darker blue (#0c2f63)
- Pattern: Wave highlights and shadow variation
- Should show: Foam (white), depth variation

**Normal Map**
- Pattern: Wave ripples and undulations
- Scale: Multiple scales 10-30mm for wave structure
- Direction: Should show wave direction/flow
- Amplitude: Greater height variation (±3-5mm apparent)
- Consider: Smooth areas for deep water

**Roughness Map**
- Base value: 0.30 (relatively smooth/reflective)
- Variation: ±0.15 (high variation from mirror-smooth to foamy)
- Smooth peaks: 0.20 (reflective calm water)
- Rough areas: 0.45 (foamy, turbulent regions)

**Metalness Map**
- Base value: 0.40 (water is reflective)
- Minimal variation (water is uniform in metallicity)
- Primarily solid medium gray (#666)

---

### EMPTY TILES - Barren Dirt/Stone Mix

**Visual Theme**: Exposed earth and scattered rocks

**Albedo Map (Color)**
- Dominant color: Muted gray-brown (#5e6374)
- Variation: Mix tan (#8b7355), gray (#4a4a4a), orange-brown (#8b6335)
- Pattern: Exposed soil with embedded pebbles
- Should show: Erosion patterns, scattered stones

**Normal Map**
- Pattern: Medium soil/pebble texture detail
- Scale: Mix 6-12mm for soil particles and small rocks
- Height variation: Moderate (±1-2mm)
- Mostly up with scattered stone faces pointing sideways

**Roughness Map**
- Base value: 0.78 (moderately rough)
- Variation: ±0.08
- Smoother: Compacted soil (0.72)
- Rougher: Rough rocks and debris (0.85)

**Metalness Map**
- Mostly black (near 0)
- Optional: Very subtle variation for mineral content

---

## Source Recommendations

Free/Commercial Texture Sources:
- **Poly Haven** (Free, CC0) - High quality, easy to use
- **OpenGameArt** (Free, various licenses) - User-contributed
- **Substance 3D** (Paid subscription) - Professional quality
- **Textures.com** (Paid) - Extensive library
- **Cgtrader** (Paid marketplace) - Curated quality assets

## Implementation Tips

1. **Start with one tile type** (recommend: Stone for hardest test)
2. **Use 1K-2K resolution** for good balance of quality/performance
3. **Ensure seamless tiling** - textures should repeat without visible seams
4. **Test with different lighting** - ensure normal maps work with scene lights
5. **Iterate gradually** - add other tile types once first one looks good

## Testing After Adding Assets

1. Place textures in `public/textures/{type}/{map}.jpg`
2. Reload the application
3. Check browser console for any 404 errors
4. Verify tiles use the new textures (compare to procedural fallback)
5. Adjust Material color/roughness/metalness in `materials.js` if needed

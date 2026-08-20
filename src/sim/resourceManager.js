export class ResourceManager {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.hexes = new Map();
    this.lastDiffusionTime = performance.now();
    this.init();
  }

  init() {
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        this.hexes.set(`${x}:${y}`, {
          water: Math.random() * 100,
          food: Math.random() * 50,
          fertility: Math.random() * 1.0,
          x,
          y
        });
      }
    }
  }

  getNeighbors(x, y) {
    const neighbors = [];
    const dirs = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [1, 1], [1, -1], [-1, 1], [-1, -1]
    ];

    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
        neighbors.push(`${nx}:${ny}`);
      }
    }
    return neighbors;
  }

  diffuse() {
    const nextHexes = new Map();
    const diffusionRate = 0.1;

    for (const [key, resources] of this.hexes) {
      const neighbors = this.getNeighbors(resources.x, resources.y);
      
      // Calculate how much to give away
      const waterLoss = resources.water * diffusionRate;
      const foodLoss = resources.food * (diffusionRate * 0.5);
      const fertilityLoss = resources.fertility * (diffusionRate * 0.2);

      // Distribute to neighbors
      const sharePerNeighbor = {
        water: waterLoss / neighbors.length,
        food: foodLoss / neighbors.length,
        fertility: fertilityLoss / neighbors.length
      };

      // Base for next state (current minus what we gave away)
      if (!nextHexes.has(key)) {
        nextHexes.set(key, { ...resources });
      }
      const currentNext = nextHexes.get(key);
      currentNext.water -= waterLoss;
      currentNext.food -= foodLoss;
      currentNext.fertility -= fertilityLoss;

      // Add to neighbors
      for (const nKey of neighbors) {
        if (!nextHexes.has(nKey)) {
          nextHexes.set(nKey, { ...this.hexes.get(nKey) });
        }
        const neighborNext = nextHexes.get(nKey);
        neighborNext.water += sharePerNeighbor.water;
        neighborNext.food += sharePerNeighbor.food;
        neighborNext.fertility += sharePerNeighbor.fertility;
      }
    }
    this.hexes = nextHexes;
  }

  update(currentTime, dayProgress, sunAngleIntensity = 0) {
    // Diffusion every 30 seconds
    if (currentTime - this.lastDiffusionTime >= 30000) {
      this.diffuse();
      this.lastDiffusionTime = currentTime;
    }

    // Food regeneration logic
    // sunAngleIntensity is 0-1 based on sun position (0 at night/horizon, 1 at midday)
    const sunlight = sunAngleIntensity;

    for (const resources of this.hexes.values()) {
      if (resources.isWaterSource) {
        resources.water = 100; // Constantly replenished
      }
      
      // Regrow food based on water, fertility, and sunlight (Photosynthesis)
      // Regeneration is highest when sun is directly overhead
      const photosynthesis = (resources.water / 100) * resources.fertility * sunlight;
      
      // Night Decay / Consumption: Metabolism continues even at night
      // If no sunlight, food slowly decays or is consumed by local "ecosystem"
      const decay = sunlight > 0 ? 0 : 0.02; 
      
      resources.food = Math.max(0, Math.min(100, resources.food + photosynthesis * 0.15 - decay));
      
      // Water slowly depletes/evaporates based on sunlight
      resources.water = Math.max(0, resources.water - sunlight * 0.08);
    }
  }

  getResource(x, y) {
    return this.hexes.get(`${x}:${y}`);
  }
}

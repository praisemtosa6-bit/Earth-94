export class SubstrateManager {
  constructor(size) {
    this.size = size;
    // Layered Buffers
    this.moisture = new Float32Array(size * size);
    this.vegetation = new Float32Array(size * size);
    this.dataTrace = new Float32Array(size * size); // "Mycelial Network" - stigmergic memory
    this.wisdomTrace = new Float32Array(size * size); // Teaching layer from Awakened agents
    
    this.tickCounter = 0;
    this.lastUpdateTime = performance.now();
    this.init();
  }

  init() {
    for (let i = 0; i < this.size * this.size; i++) {
      const x = i % this.size;
      const y = Math.floor(i / this.size);
      this.moisture[i] = (x === 0 && y === 0) ? 1.0 : 0.1;
      this.vegetation[i] = 0.05;
      this.dataTrace[i] = 0;
      this.wisdomTrace[i] = 0;
    }
  }

  sanitize() {
    const clampFinite = (value, min, max, fallback) => (
      Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
    )
    for (let i = 0; i < this.size * this.size; i++) {
      this.moisture[i] = clampFinite(this.moisture[i], 0, 1, 0.1)
      this.vegetation[i] = clampFinite(this.vegetation[i], 0, 1, 0.05)
      this.dataTrace[i] = clampFinite(this.dataTrace[i], 0, 5, 0)
      this.wisdomTrace[i] = clampFinite(this.wisdomTrace[i], 0, 1, 0)
    }
  }

  getIndex(x, y) {
    if (x < 0 || x >= this.size || y < 0 || y >= this.size) return -1;
    return y * this.size + x;
  }

  writeData(x, y, amount) {
    const idx = this.getIndex(x, y);
    if (idx !== -1) {
      // Reinforcement logic: Adding to existing trace creates "Highways"
      this.dataTrace[idx] = Math.min(5.0, this.dataTrace[idx] + amount);
    }
  }

  writeWisdom(x, y, amount) {
    const idx = this.getIndex(x, y);
    if (idx !== -1) {
      this.wisdomTrace[idx] = Math.min(1.0, this.wisdomTrace[idx] + amount);
    }
  }

  update(currentTime, sunIntensity) {
    this.sanitize()
    const rawDeltaTime = (currentTime - this.lastUpdateTime) / 1000;
    // Browser tabs and frame stalls can create multi-second gaps. A bounded step keeps
    // diffusion a convex blend instead of allowing alternating negative/positive values.
    const deltaTime = Math.max(0, Math.min(0.5, Number.isFinite(rawDeltaTime) ? rawDeltaTime : 0));
    this.lastUpdateTime = currentTime;
    this.tickCounter++;

    // 1. Diffusion Logic for all layers
    const nextMoisture = new Float32Array(this.moisture);
    const nextData = new Float32Array(this.dataTrace);
    const nextWisdom = new Float32Array(this.wisdomTrace);
    
    const diffRate = Math.min(0.75, 0.05 * (deltaTime * 30));
    const decay200 = this.tickCounter % 200 === 0;

    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const idx = this.getIndex(x, y);
        const dirs = [[1,0], [-1,0], [0,1], [0,-1]];
        let mSum = 0, dSum = 0, wSum = 0, count = 0;

        for (const [dx, dy] of dirs) {
          const nIdx = this.getIndex(x + dx, y + dy);
          if (nIdx !== -1) {
            mSum += this.moisture[nIdx];
            dSum += this.dataTrace[nIdx];
            wSum += this.wisdomTrace[nIdx];
            count++;
          }
        }

        const mAvg = mSum / count;
        const dAvg = dSum / count;
        const wAvg = wSum / count;

        // Apply diffusion
        if (x !== 0 || y !== 0) nextMoisture[idx] += (mAvg - this.moisture[idx]) * diffRate;
        nextData[idx] += (dAvg - this.dataTrace[idx]) * (diffRate * 0.5); // Data diffuses slower
        nextWisdom[idx] += (wAvg - this.wisdomTrace[idx]) * (diffRate * 0.2);

        // Apply decay
        nextMoisture[idx] = Math.max(0, nextMoisture[idx] - sunIntensity * 0.001 * deltaTime);
        
        // Sim-God Logic: 10% decay every 200 ticks
        if (decay200) {
          nextData[idx] *= 0.9;
          nextWisdom[idx] *= 0.95;
        }

        nextMoisture[idx] = Math.max(0, Math.min(1, Number.isFinite(nextMoisture[idx]) ? nextMoisture[idx] : 0.1))
        nextData[idx] = Math.max(0, Math.min(5, Number.isFinite(nextData[idx]) ? nextData[idx] : 0))
        nextWisdom[idx] = Math.max(0, Math.min(1, Number.isFinite(nextWisdom[idx]) ? nextWisdom[idx] : 0))
      }
    }
    
    this.moisture = nextMoisture;
    this.dataTrace = nextData;
    this.wisdomTrace = nextWisdom;

    // 2. Vegetation Growth
    for (let i = 0; i < this.size * this.size; i++) {
      const growthFactor = this.moisture[i] * sunIntensity * 0.02 * deltaTime;
      const decayFactor = (1.0 - sunIntensity) * 0.005 * deltaTime;
      const nextVegetation = this.vegetation[i] + growthFactor - decayFactor
      this.vegetation[i] = Math.max(0, Math.min(1.0, Number.isFinite(nextVegetation) ? nextVegetation : 0.05));
    }
  }

  getTrace(x, y) {
    const idx = this.getIndex(x, y);
    if (idx === -1) return { data: 0, wisdom: 0 };
    return {
      data: this.dataTrace[idx],
      wisdom: this.wisdomTrace[idx]
    };
  }

  getValue(x, y) {
    const idx = this.getIndex(x, y);
    if (idx === -1) return { moisture: 0, vegetation: 0, data: 0, wisdom: 0 };
    return {
      moisture: this.moisture[idx],
      vegetation: this.vegetation[idx],
      data: this.dataTrace[idx],
      wisdom: this.wisdomTrace[idx]
    };
  }
}

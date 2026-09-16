const DEFAULTS = Object.freeze({
  enabled: true,
  triggerMode: "bass-threshold",
  rmsSensitivity: 1,
  rmsMinThreshold: 0.008,
  rmsFloorMultiplier: 1.34,
  rmsCrestRatio: 0.34,
  rmsCooldown: 0.14,
  rmsPeakWindow: 0.22,
  rmsDecay: 7.2,
  rmsInputMin: 0.5,
  rmsInputMax: 0.8,
  density: 720,
  bassFrom: 35,
  bassTo: 220,
  bassInputMin: 0.04,
  bassInputMax: 0.55,
  cruiseSpeed: 1.35,
  quietBrightness: 0.2,
  cruiseTrailLength: 1.15,
  speedMin: 1.35,
  speedMax: 30,
  starSize: 2.2,
  trailLengthMin: 1.15,
  trailLengthMax: 4,
  spread: 1.05,
  viewDistance: 1,
  brightnessMin: 0.2,
  brightnessMax: 0.82,
  color: "#b8d9ff"
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const PARAMETER_LIMITS = Object.freeze({
  cruiseSpeed: [0, 5],
  speedMin: [0, 30],
  speedMax: [0, 30],
  quietBrightness: [0, 10],
  brightnessMin: [0, 10],
  brightnessMax: [0, 10],
  cruiseTrailLength: [0, 4],
  trailLengthMin: [0, 4],
  trailLengthMax: [0, 4],
  viewDistance: [0.25, 4],
  rmsSensitivity: [0.4, 2.5],
  rmsMinThreshold: [0, 0.2],
  rmsFloorMultiplier: [0.5, 3],
  rmsCrestRatio: [0.05, 1],
  rmsCooldown: [0.04, 1],
  rmsPeakWindow: [0.05, 1],
  rmsDecay: [0.5, 20],
  rmsInputMin: [0, 1],
  rmsInputMax: [0, 1]
});

const MAPPING_FLOOR_PAIRS = Object.freeze([
  ["cruiseSpeed", "speedMin", "speedMax"],
  ["quietBrightness", "brightnessMin", "brightnessMax"],
  ["cruiseTrailLength", "trailLengthMin", "trailLengthMax"]
]);

export const enforceStarfieldMappingFloors = parameters => {
  const normalized = { ...parameters };
  for (const [defaultKey, lowerKey, upperKey] of MAPPING_FLOOR_PAIRS) {
    const defaultValue = Number(normalized[defaultKey]);
    const lowerValue = Number(normalized[lowerKey]);
    const upperValue = Number(normalized[upperKey]);
    if (!Number.isFinite(defaultValue) || !Number.isFinite(lowerValue) || !Number.isFinite(upperValue)) continue;
    normalized[lowerKey] = Math.max(defaultValue, lowerValue);
    normalized[upperKey] = Math.max(normalized[lowerKey], upperValue);
  }
  return normalized;
};

export const mapLinearClamped = (value, inputMin, inputMax, outputMin, outputMax) => {
  const lowerInput = Number(inputMin);
  const upperInput = Number(inputMax);
  const lowerOutput = Number(outputMin);
  const upperOutput = Number(outputMax);
  if (![value, lowerInput, upperInput, lowerOutput, upperOutput].every(Number.isFinite)) return lowerOutput;
  if (upperInput <= lowerInput) return Number(value) >= upperInput ? upperOutput : lowerOutput;
  const progress = clamp((Number(value) - lowerInput) / (upperInput - lowerInput), 0, 1);
  return lowerOutput + (upperOutput - lowerOutput) * progress;
};

export const calculateStarfieldFocal = (width, height, spread, viewDistance) => {
  const safeWidth = Math.max(0, Number(width) || 0);
  const safeHeight = Math.max(0, Number(height) || 0);
  const spreadValue = Number(spread);
  const distanceValue = Number(viewDistance);
  const safeSpread = Number.isFinite(spreadValue) ? Math.max(0, spreadValue) : 1;
  const safeDistance = Number.isFinite(distanceValue) ? Math.max(0.01, distanceValue) : 1;
  return Math.min(safeWidth, safeHeight) * 0.5 * safeSpread / safeDistance;
};

export const calculateStarfieldAudioEnergy = (metrics, parameters = DEFAULTS) => {
  if (typeof metrics?.sampleBand === "function") {
    const from = Math.min(Number(parameters.bassFrom), Number(parameters.bassTo));
    const to = Math.max(Number(parameters.bassFrom), Number(parameters.bassTo));
    const split = from + (to - from) * 0.34;
    return clamp(metrics.sampleBand(from, split) * 0.62 + metrics.sampleBand(split, to) * 0.38, 0, 1);
  }
  return clamp(Number(metrics?.bass) || 0, 0, 1);
};

export const createRmsPeakState = () => ({
  floor: 0,
  crest: 0.04,
  previous: 0,
  candidate: 0,
  candidateAt: 0,
  lastHit: -99,
  envelope: 0,
  lastStepAt: 0
});

export const stepRmsPeakDetector = (state, rms, time, parameters = DEFAULTS) => {
  const detector = state || createRmsPeakState();
  const level = clamp(Number(rms) || 0, 0, 1);
  const now = Number(time) || 0;
  if (!detector.floor && !detector.previous) detector.floor = level;
  detector.floor += (level - detector.floor) * (level > detector.floor ? 0.018 : 0.075);
  detector.crest = Math.max(0.04, level, detector.crest * 0.993);
  const sensitivity = clamp(Number(parameters.rmsSensitivity) || 1, 0.4, 2.5);
  const thresholdScale = 1 / (0.55 + sensitivity * 0.45);
  const threshold = Math.max(
    Number(parameters.rmsMinThreshold) || 0,
    detector.floor * Number(parameters.rmsFloorMultiplier) * thresholdScale,
    detector.crest * Number(parameters.rmsCrestRatio) * thresholdScale
  );
  let hit = false;
  let power = 0;

  if (level >= detector.previous && level > threshold) {
    if (level >= detector.candidate) {
      detector.candidate = level;
      detector.candidateAt = now;
    }
  } else if (detector.candidate > threshold && detector.previous < detector.candidate + 0.0001) {
    if (now - detector.lastHit >= Number(parameters.rmsCooldown)) {
      hit = true;
      power = clamp((detector.candidate - threshold) / Math.max(0.025, detector.crest - threshold), 0, 1);
      detector.lastHit = now;
    }
    detector.candidate = 0;
  }
  if (detector.candidate && now - detector.candidateAt > Number(parameters.rmsPeakWindow)) detector.candidate = 0;

  const elapsed = detector.lastStepAt ? clamp(now - detector.lastStepAt, 0, 0.1) : 0;
  detector.envelope *= Math.exp(-elapsed * Number(parameters.rmsDecay));
  if (hit) detector.envelope = Math.max(detector.envelope, power);
  detector.lastStepAt = now;
  detector.previous = level;
  return { hit, power, threshold, rms: level, envelope: detector.envelope, state: detector };
};

export const calculateStarfieldResponse = (bass, parameters = DEFAULTS) => {
  // One calibration window owns the entire response: the lower bound is the
  // silence threshold, the upper bound is the saturation point, and the
  // interval between them maps linearly to a normalized 0..1 intensity.
  const inputMin = parameters.triggerMode === "rms-peak" ? parameters.rmsInputMin : parameters.bassInputMin;
  const inputMax = parameters.triggerMode === "rms-peak" ? parameters.rmsInputMax : parameters.bassInputMax;
  const intensity = mapLinearClamped(bass, inputMin, inputMax, 0, 1);
  const belowThreshold = Number.isFinite(Number(bass))
    && Number.isFinite(Number(inputMin))
    && Number(bass) < Number(inputMin);
  const cruiseTrailLength = Number.isFinite(Number(parameters.cruiseTrailLength))
    ? Number(parameters.cruiseTrailLength)
    : Number(parameters.trailLengthMin);
  return {
    intensity,
    speed: belowThreshold
      ? Number(parameters.cruiseSpeed)
      : mapLinearClamped(intensity, 0, 1, parameters.speedMin, parameters.speedMax),
    brightness: belowThreshold
      ? Number(parameters.quietBrightness)
      : mapLinearClamped(intensity, 0, 1, parameters.brightnessMin, parameters.brightnessMax),
    trailLength: belowThreshold
      ? cruiseTrailLength
      : mapLinearClamped(intensity, 0, 1, parameters.trailLengthMin, parameters.trailLengthMax)
  };
};

const hexToRgb = hex => {
  const normalized = hex.replace("#", "");
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16)
  };
};

export class Starfield {
  constructor(canvas, initial = {}) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { alpha: false });
    if (!this.context) throw new Error("当前浏览器不支持 2D 星空画布。");

    const migrated = { ...initial };
    if ("cruiseSpeed" in migrated && !("speedMin" in migrated)) {
      const cruiseSpeed = Number(migrated.cruiseSpeed);
      const propulsionMax = Number(migrated.speedMax);
      if (Number.isFinite(cruiseSpeed)) {
        migrated.speedMin = cruiseSpeed;
        migrated.speedMax = cruiseSpeed + (Number.isFinite(propulsionMax) ? Math.max(0, propulsionMax) : 42);
      }
    } else if (!("speedMin" in migrated)) {
      const legacyBase = Number(migrated.baseSpeed);
      const legacyBoost = Number(migrated.audioBoost);
      if (Number.isFinite(legacyBase)) {
        migrated.speedMin = legacyBase;
        migrated.speedMax = legacyBase + (Number.isFinite(legacyBoost) ? Math.max(0, legacyBoost) : 42);
      }
    }
    if (!Number.isFinite(Number(migrated.cruiseSpeed))) {
      const previousQuietSpeed = Number(migrated.speedMin);
      migrated.cruiseSpeed = Number.isFinite(previousQuietSpeed) ? previousQuietSpeed : DEFAULTS.cruiseSpeed;
    }
    if (!("brightnessMax" in migrated) && Number.isFinite(Number(migrated.brightness))) {
      migrated.brightnessMax = Number(migrated.brightness);
    }
    if (!Number.isFinite(Number(migrated.quietBrightness))) {
      const previousQuietBrightness = Number(migrated.brightnessMin);
      migrated.quietBrightness = Number.isFinite(previousQuietBrightness) ? previousQuietBrightness : DEFAULTS.quietBrightness;
    }
    if (!Number.isFinite(Number(migrated.trailLengthMin))) {
      const previousTrailLength = Number(migrated.trailLength);
      migrated.trailLengthMin = Number.isFinite(previousTrailLength) ? previousTrailLength : DEFAULTS.trailLengthMin;
      migrated.trailLengthMax = Number.isFinite(previousTrailLength)
        ? Math.max(previousTrailLength, DEFAULTS.trailLengthMax)
        : DEFAULTS.trailLengthMax;
    }
    if (!Number.isFinite(Number(migrated.cruiseTrailLength))) {
      const previousQuietTrailLength = Number(migrated.trailLengthMin);
      migrated.cruiseTrailLength = Number.isFinite(previousQuietTrailLength)
        ? previousQuietTrailLength
        : DEFAULTS.cruiseTrailLength;
    }
    this.parameters = Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, migrated[key] ?? DEFAULTS[key]]));
    for (const [key, [minimum, maximum]] of Object.entries(PARAMETER_LIMITS)) {
      const value = Number(this.parameters[key]);
      this.parameters[key] = Number.isFinite(value) ? clamp(value, minimum, maximum) : DEFAULTS[key];
    }
    this.parameters = enforceStarfieldMappingFloors(this.parameters);
    this.stars = [];
    this.width = 1;
    this.height = 1;
    this.depth = 1;
    this.lastTime = performance.now();
    this.audioEnergy = 0;
    this.targetAudioEnergy = 0;
    this.rmsPeakState = createRmsPeakState();
    this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(document.documentElement);
    this.resize();
    this.syncStarCount();
    this.frame = requestAnimationFrame(time => this.draw(time));
  }

  getParameters() {
    return { ...this.parameters };
  }

  setParameter(key, value) {
    if (!(key in DEFAULTS)) return;
    const limits = PARAMETER_LIMITS[key];
    const numericValue = Number(value);
    this.parameters[key] = key === "triggerMode"
      ? (value === "rms-peak" ? "rms-peak" : "bass-threshold")
      : limits && Number.isFinite(numericValue)
      ? clamp(numericValue, limits[0], limits[1])
      : value;
    this.parameters = enforceStarfieldMappingFloors(this.parameters);
    if (key === "triggerMode") {
      this.rmsPeakState = createRmsPeakState();
      this.audioEnergy = 0;
      this.targetAudioEnergy = 0;
    }
    if (key === "density") this.syncStarCount();
  }

  setAudioMetrics(metrics) {
    if (this.parameters.triggerMode === "rms-peak") {
      const peak = stepRmsPeakDetector(this.rmsPeakState, metrics?.level, performance.now() * 0.001, this.parameters);
      this.targetAudioEnergy = peak.envelope;
      return;
    }
    // Read the analyser bins using this scene's own frequency bounds. The
    // magnetic-fluid bass range and visual mapping remain fully independent.
    this.targetAudioEnergy = calculateStarfieldAudioEnergy(metrics, this.parameters);
  }

  resize() {
    const ratio = Math.min(devicePixelRatio || 1, 2);
    this.width = innerWidth;
    this.height = innerHeight;
    this.depth = Math.max(this.width, this.height);
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  createStar(atFarPlane = false) {
    return {
      x: (Math.random() * 2 - 1) * this.width,
      y: (Math.random() * 2 - 1) * this.height,
      z: atFarPlane ? this.depth : Math.random() * this.depth + 1,
      phase: Math.random() * Math.PI * 2
    };
  }

  syncStarCount() {
    const target = Math.round(clamp(Number(this.parameters.density), 80, 2200));
    while (this.stars.length < target) this.stars.push(this.createStar());
    if (this.stars.length > target) this.stars.length = target;
  }

  recycle(star) {
    Object.assign(star, this.createStar(true));
  }

  draw(time) {
    const delta = clamp((time - this.lastTime) / 16.667, 0.25, 2.5);
    this.lastTime = time;
    if (this.parameters.triggerMode === "rms-peak") this.audioEnergy = this.targetAudioEnergy;
    else this.audioEnergy += (this.targetAudioEnergy - this.audioEnergy) * 0.12;
    const response = calculateStarfieldResponse(this.audioEnergy, this.parameters);

    const context = this.context;
    context.fillStyle = "#05070a";
    context.fillRect(0, 0, this.width, this.height);

    if (this.parameters.enabled) {
      const color = hexToRgb(this.parameters.color);
      const speed = this.reducedMotion
        ? 0
        : response.speed * delta;
      const centerX = this.width / 2;
      const centerY = this.height / 2;
      const focal = calculateStarfieldFocal(
        this.width,
        this.height,
        this.parameters.spread,
        this.parameters.viewDistance
      );

      context.lineCap = "round";
      for (const star of this.stars) {
        const previousZ = star.z + speed * response.trailLength * 4;
        star.z -= speed;
        if (star.z < 1) this.recycle(star);

        const x = centerX + (star.x / star.z) * focal;
        const y = centerY + (star.y / star.z) * focal;
        const previousX = centerX + (star.x / previousZ) * focal;
        const previousY = centerY + (star.y / previousZ) * focal;
        if (x < -80 || x > this.width + 80 || y < -80 || y > this.height + 80) {
          this.recycle(star);
          continue;
        }

        const proximity = 1 - star.z / this.depth;
        const twinkle = 0.78 + Math.sin(time * 0.0018 + star.phase) * 0.22;
        const alpha = clamp((0.16 + proximity * 0.84) * response.brightness * twinkle, 0, 1);
        const radius = Math.max(0.35, proximity * Number(this.parameters.starSize));
        context.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
        context.lineWidth = radius;
        context.beginPath();
        context.moveTo(previousX, previousY);
        context.lineTo(x, y);
        context.stroke();
      }
    }

    this.frame = requestAnimationFrame(next => this.draw(next));
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
  }

  getStatus() {
    const response = calculateStarfieldResponse(this.audioEnergy, this.parameters);
    return { bass: this.audioEnergy, triggerMode: this.parameters.triggerMode, ...response };
  }
}

export { DEFAULTS as DEFAULT_STARFIELD_CONFIG };

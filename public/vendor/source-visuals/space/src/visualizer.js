import { DEFAULT_VISUAL_CONFIG as D } from "./default-config.js";

const vertexShader = `#version 300 es
in vec2 a_position;
out vec2 v_TexCoord;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_TexCoord = a_position * 0.5 + 0.5;
}`;

export const fragmentShader = `#version 300 es
precision highp float;
precision highp int;

#define PI 3.1415927
#define STEPS 100
#define INSIDE_STEPS 12
#define AO_STEPS 5
#define SMOOTHING_VAL 0.06
#define numBlobs 80

in vec2 v_TexCoord;
out vec4 fragColor;

uniform vec2 u_Resolution;
uniform vec2 u_Offset;
uniform float u_Time;
uniform float u_LayerScale;
uniform vec3 u_LiquidColor;
uniform float u_LiquidAlpha;
uniform float u_CenterConcentration;
uniform float u_LiquidFusion;
uniform float u_EdgeSmoothness;
uniform float u_MinBlobSize;
uniform float u_AnimationSpeed;
uniform float u_SphereCount;
uniform float u_LiquidSize;
uniform float u_MotionRange;
uniform vec3 u_EdgeColor1;
uniform vec3 u_EdgeColor2;
uniform float u_EdgeIntensity;
uniform float u_EdgeWidth;
uniform float u_GradientRotation;
uniform float u_CameraDistance;
uniform float u_AngleX;
uniform float u_AngleY;
uniform vec3 u_PointerTarget;
uniform float u_PointerAttraction;
uniform float u_PointerRadius;
uniform vec3 u_HighlightColor1;
uniform float u_HighlightIntensity1;
uniform float u_HighlightConcentration1;
uniform float u_HorizontalAngle1;
uniform float u_VerticalAngle1;
uniform vec3 u_HighlightColor2;
uniform float u_HighlightIntensity2;
uniform float u_HighlightConcentration2;
uniform float u_HorizontalAngle2;
uniform float u_VerticalAngle2;

const float fl = 2.0;
const vec3 lookAt = vec3(0.0);
float saturate(float value) { return clamp(value, 0.0, 1.0); }

vec4 hash41(float src) {
  vec4 p4 = fract(vec4(src) * vec4(0.1031, 0.1136, 0.1375, 0.1543));
  p4 += dot(p4, p4.wzxy + 33.33);
  return fract((p4.xxyz + p4.yzzw) * p4.zywx);
}

float smin(float a, float b, float k) {
  k *= 6.0;
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * h * k * (1.0 / 6.0);
}

vec4 GetBlob(int i, float time) {
  vec4 rand1 = hash41(float(i));
  vec4 rand2 = hash41(float(i) * 1.3145);
  vec2 minmaxFreq = vec2(0.4, 2.8);
  vec2 minmaxPhaseOffset = vec2(0.0, 2.0 * PI);
  vec2 minmaxRadius = vec2(0.15, 0.5);
  vec2 minmaxMoveRadius = vec2(0.2, 1.0);
  vec3 freq = mix(minmaxFreq.xxx, minmaxFreq.yyy, rand1.xyz);
  vec3 phase = mix(minmaxPhaseOffset.xxx, minmaxPhaseOffset.yyy, rand2.xyz);
  float moveRad = mix(minmaxMoveRadius.x, minmaxMoveRadius.y, pow(rand2.w, 1.0));
  float rad = mix(minmaxRadius.x, minmaxRadius.y, pow(rand1.w, 2.0)) * exp(-moveRad * 1.75);
  rad = max(rad, u_MinBlobSize);
  freq *= u_AnimationSpeed;
  rad *= u_LiquidSize;
  moveRad *= u_MotionRange;
  vec3 bp_chaos = vec3(
    sin(time * freq.x + phase.x),
    cos(time * freq.y + phase.y),
    sin(time * freq.z + phase.z)
  ) * vec3(moveRad);
  if (u_PointerAttraction > 0.0001) {
    vec3 pointerDelta = u_PointerTarget - bp_chaos;
    float radiusSquared = max(0.000001, u_PointerRadius * u_PointerRadius);
    float pointerFalloff = max(0.0, 1.0 - dot(pointerDelta.xy, pointerDelta.xy) / radiusSquared);
    pointerFalloff *= pointerFalloff;
    bp_chaos += pointerDelta * u_PointerAttraction * pointerFalloff;
  }
  return vec4(bp_chaos, rad);
}

float mapScene(vec3 p) {
  float d = 100000.0;
  int blobCount = int(u_SphereCount);
  for (int i = 0; i < numBlobs; i++) {
    if (i >= blobCount) break;
    vec4 blob = GetBlob(i, u_Time);
    float blobDist = length(p - blob.xyz) - blob.w;
    d = smin(d, blobDist, SMOOTHING_VAL * u_LiquidFusion);
  }
  return d;
}

float March(vec3 ro, vec3 rd, float startT, float endT, out float endD, out int stepsTaken) {
  float t = startT;
  for (stepsTaken = 0; stepsTaken < STEPS; stepsTaken++) {
    vec3 p = ro + t * rd;
    float d = mapScene(p);
    endD = d;
    if (d < 0.001) return t;
    t += d;
    if (t > endT) return t;
  }
  return t;
}

bool IntersectBoundingSphere(vec3 ro, vec3 rd, float radius, out float startT, out float endT) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - radius * radius;
  float discriminant = b * b - c;
  if (discriminant < 0.0) return false;
  float root = sqrt(discriminant);
  startT = max(0.0, -b - root);
  endT = -b + root;
  return endT > startT;
}

float InsideMarch(vec3 ro, vec3 rd) {
  float t = 0.0;
  float accumD = 0.0;
  for (int i = 0; i < INSIDE_STEPS; i++) {
    float d = mapScene(ro + t * rd);
    if (d < 0.0) accumD += -d;
    t += 0.05;
  }
  return accumD;
}

vec3 Normal(vec3 p) {
  const float h = 0.001;
  const vec2 k = vec2(1.0, -1.0);
  return normalize(k.xyy * mapScene(p + k.xyy * h) +
                   k.yyx * mapScene(p + k.yyx * h) +
                   k.yxy * mapScene(p + k.yxy * h) +
                   k.xxx * mapScene(p + k.xxx * h));
}

float AO(vec3 pos, vec3 nor) {
  float occ = 0.0;
  float sca = 1.0;
  for (int i = 0; i < AO_STEPS; i++) {
    float t = 0.01 + 0.08 * float(i);
    float d = mapScene(pos + t * nor);
    occ += (t - d) * sca;
    sca *= 0.85;
  }
  return clamp(1.0 - occ / 3.14, 0.0, 1.0);
}

vec3 Render(vec3 ro, vec3 rd, float d, out vec3 bodyCol) {
  vec3 p = ro + d * rd;
  vec3 nor = Normal(p);
  float thickness = InsideMarch(p - nor * 0.01, rd);
  vec3 lightDir = normalize(vec3(-1.0, 2.0, 0.0));
  vec3 refl = reflect(rd, nor);
  vec3 refr = refract(rd, nor, 1.0 / 1.4);
  if (length(refr) == 0.0) refr = refl;
  float fresnel = abs(dot(rd, nor));
  float lightDot = dot(nor, lightDir);
  float ssFake = saturate(lightDot * 0.5 + 0.5);
  float spec = pow(saturate(dot(refl, lightDir)), 256.0);
  float ao = AO(p, nor);
  vec3 liquidCol = u_LiquidColor;
  float ambientStrength = 0.2 + 0.6 * clamp((u_CenterConcentration - 0.1) / 2.9, 0.0, 1.0);
  float aoFactor = ao * 0.5 + 0.5;
  vec3 lighting = mix(vec3(ambientStrength), vec3(1.0), ssFake);
  liquidCol *= lighting * aoFactor;
  bodyCol = clamp(liquidCol, vec3(0.0), vec3(1.0));

  vec3 highlight1Dir = normalize(vec3(
    cos(u_HorizontalAngle1 * PI / 180.0) * sin(u_VerticalAngle1 * PI / 180.0),
    cos(u_VerticalAngle1 * PI / 180.0),
    sin(u_HorizontalAngle1 * PI / 180.0) * sin(u_VerticalAngle1 * PI / 180.0)));
  vec3 highlight2Dir = normalize(vec3(
    cos(u_HorizontalAngle2 * PI / 180.0) * sin(u_VerticalAngle2 * PI / 180.0),
    cos(u_VerticalAngle2 * PI / 180.0),
    sin(u_HorizontalAngle2 * PI / 180.0) * sin(u_VerticalAngle2 * PI / 180.0)));
  vec3 refDir = reflect(rd, nor);
  float highlight1 = pow(saturate(dot(refDir, highlight1Dir)), u_HighlightConcentration1);
  float highlight2 = pow(saturate(dot(refDir, highlight2Dir)), u_HighlightConcentration2);
  liquidCol += u_HighlightColor1 * highlight1 * u_HighlightIntensity1;
  liquidCol += u_HighlightColor2 * highlight2 * u_HighlightIntensity2;

  float gradientAngle = u_GradientRotation * PI / 180.0;
  vec2 rotDir = vec2(cos(gradientAngle), sin(gradientAngle));
  float gradientFactor = clamp(dot(p.xy, rotDir) * 0.5 + 0.5, 0.0, 1.0);
  vec3 edgeLightColor = mix(u_EdgeColor1, u_EdgeColor2, gradientFactor);
  float rimFactor = 1.0 - abs(dot(rd, nor));
  float rimPower = 4.0 / max(0.1, u_EdgeWidth);
  liquidCol += edgeLightColor * pow(rimFactor, rimPower) * u_EdgeIntensity;
  return clamp(liquidCol, vec3(0.0), vec3(1.0));
}

void main() {
  vec2 uv = v_TexCoord * 2.0 - 1.0;
  uv -= u_Offset;
  uv /= max(u_LayerScale, 0.001);
  uv.x *= u_Resolution.x / u_Resolution.y;
  vec3 ro = vec3(0.0, 0.0, u_CameraDistance);
  float angleXRad = u_AngleX * PI / 180.0;
  float angleYRad = u_AngleY * PI / 180.0;
  mat3 rotX = mat3(vec3(1.0,0.0,0.0), vec3(0.0,cos(angleXRad),-sin(angleXRad)), vec3(0.0,sin(angleXRad),cos(angleXRad)));
  mat3 rotY = mat3(vec3(cos(angleYRad),0.0,sin(angleYRad)), vec3(0.0,1.0,0.0), vec3(-sin(angleYRad),0.0,cos(angleYRad)));
  vec3 newRo = ro * rotX;
  newRo = newRo * rotY;
  vec3 newCf = normalize(lookAt - newRo);
  vec3 newCr = normalize(cross(newCf, vec3(0.0, 1.0, 0.0)));
  vec3 newCu = normalize(cross(newCr, newCf));
  vec3 rd = normalize(uv.x * newCr + uv.y * newCu + fl * newCf);
  float boundRadius = u_MotionRange + u_LiquidSize * 0.5
    + u_LiquidFusion * 0.25
    + u_PointerAttraction * (u_CameraDistance + u_PointerRadius);
  float startT;
  float endT;
  if (!IntersectBoundingSphere(newRo, rd, boundRadius, startT, endT)) {
    fragColor = vec4(0.0);
    return;
  }
  float endD;
  int stepsTaken;
  float d = March(newRo, rd, startT, endT, endD, stepsTaken);
  if (d > endT) {
    fragColor = vec4(0.0);
    return;
  }
  float edgeAlpha = 1.0 - smoothstep(0.001, 0.001 + u_EdgeSmoothness, endD);
  vec3 bodyCol = vec3(0.0);
  vec3 fullCol = vec3(0.0);
  if (edgeAlpha > 0.0) fullCol = Render(newRo, rd, d, bodyCol);
  bodyCol = pow(bodyCol, vec3(1.0 / 2.2));
  fullCol = pow(fullCol, vec3(1.0 / 2.2));

  // Highlights and rim light are the positive difference between the complete
  // render and the body-only render. Body opacity fades only the remaining fill.
  vec3 accentCol = max(fullCol - bodyCol, vec3(0.0));
  float accentAlpha = max(accentCol.r, max(accentCol.g, accentCol.b));
  float bodyAlpha = clamp(u_LiquidAlpha, 0.0, 1.0);
  vec3 premultipliedCol = mix(accentCol, fullCol, bodyAlpha) * edgeAlpha;
  float finalAlpha = mix(accentAlpha, 1.0, bodyAlpha) * edgeAlpha;
  fragColor = vec4(premultipliedCol, finalAlpha);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
  return shader;
}

export function mapLinearClamped(value, inputMin, inputMax, outputMin, outputMax) {
  const safeValue = Number.isFinite(value) ? value : 0;
  const firstInput = Number.isFinite(inputMin) ? inputMin : 0;
  const secondInput = Number.isFinite(inputMax) ? inputMax : firstInput;
  const inMin = Math.min(firstInput, secondInput);
  const inMax = Math.max(firstInput, secondInput);
  const outMin = Number.isFinite(outputMin) ? outputMin : 0;
  const outMax = Number.isFinite(outputMax) ? outputMax : outMin;
  if (inMax === inMin) return safeValue >= inMax ? outMax : outMin;
  const progress = Math.min(1, Math.max(0, (safeValue - inMin) / (inMax - inMin)));
  return outMin + progress * (outMax - outMin);
}

export function calculateAudioMapping(metrics, params) {
  return {
    sphereSize: mapLinearClamped(metrics.bass, params.bassInputMin, params.bassInputMax, params.sphereSizeMin, params.sphereSizeMax),
    coreSize: mapLinearClamped(metrics.bass, params.bassInputMin, params.bassInputMax, params.coreSizeMin, params.coreSizeMax),
    overallSize: mapLinearClamped(metrics.level, params.levelInputMin, params.levelInputMax, params.overallSizeMin, params.overallSizeMax),
    sphereDistance: mapLinearClamped(metrics.bass, params.bassInputMin, params.bassInputMax, params.sphereDistanceMin, params.sphereDistanceMax),
    edgeIntensity: mapLinearClamped(metrics.mid, params.midInputMin, params.midInputMax, params.edgeIntensityMin, params.edgeIntensityMax)
  };
}

export function calculatePointerMotion(pointer, hoverAmplitude) {
  const x = Number.isFinite(pointer?.[0]) ? Math.min(1, Math.max(-1, pointer[0])) : 0;
  const y = Number.isFinite(pointer?.[1]) ? Math.min(1, Math.max(-1, pointer[1])) : 0;
  const amplitude = Number.isFinite(hoverAmplitude) ? Math.max(0, hoverAmplitude) : 0;
  return {
    offset: [x === 0 ? 0 : x * amplitude, y === 0 ? 0 : y * amplitude]
  };
}

export function calculatePointerTarget(pointer, offset, aspect, cameraDistance, layerScale) {
  const safeScale = Math.max(0.001, Number.isFinite(layerScale) ? layerScale : 1);
  const planeScale = (Number.isFinite(cameraDistance) ? cameraDistance : 0) / 2;
  return [
    (pointer[0] - offset[0]) / safeScale * aspect * planeScale,
    (pointer[1] - offset[1]) / safeScale * planeScale,
    0
  ];
}

export function smoothExponential(current, target, elapsedMs, responseMs = 140) {
  const elapsed = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0);
  const response = Math.max(1, Number.isFinite(responseMs) ? responseMs : 140);
  const blend = 1 - Math.exp(-elapsed / response);
  return current + (target - current) * blend;
}

export function isPointerInfluenceActive(hovered, activeUntil, now) {
  return Boolean(hovered) || Number(activeUntil) > Number(now);
}

export function hslToRgb(hue, saturation, lightness) {
  const h = ((Number(hue) % 1) + 1) % 1;
  const s = Math.min(1, Math.max(0, Number(saturation)));
  const l = Math.min(1, Math.max(0, Number(lightness)));
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const section = h * 6;
  const secondary = chroma * (1 - Math.abs(section % 2 - 1));
  const [r, g, b] = section < 1 ? [chroma, secondary, 0]
    : section < 2 ? [secondary, chroma, 0]
      : section < 3 ? [0, chroma, secondary]
        : section < 4 ? [0, secondary, chroma]
          : section < 5 ? [secondary, 0, chroma]
            : [chroma, 0, secondary];
  const offset = l - chroma / 2;
  return [r + offset, g + offset, b + offset];
}

export function rgbToHsl(rgb) {
  const [red, green, blue] = rgb.map(value => Math.min(1, Math.max(0, Number(value) || 0)));
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  const lightness = (maximum + minimum) / 2;
  if (delta === 0) return [0, 0, lightness];
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue;
  if (maximum === red) hue = ((green - blue) / delta) % 6;
  else if (maximum === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;
  return [((hue / 6) % 1 + 1) % 1, saturation, lightness];
}

export function createRandomEdgeColor(sourceColor, random = Math.random) {
  const [, saturation, lightness] = rgbToHsl(sourceColor);
  const hue = Math.min(1, Math.max(0, Number(random()) || 0));
  return hslToRgb(hue, saturation, lightness);
}

export function interpolateEdgeColor(from, to, progress) {
  const t = Math.min(1, Math.max(0, Number(progress) || 0));
  const eased = t * t * (3 - 2 * t);
  const [fromHue, saturation, lightness] = rgbToHsl(from);
  const [toHue] = rgbToHsl(to);
  const hueDelta = ((toHue - fromHue + 1.5) % 1) - 0.5;
  return hslToRgb(fromHue + hueDelta * eased, saturation, lightness);
}

export class MagneticVisualizer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl2", { alpha: true, antialias: false, premultipliedAlpha: true, powerPreference: "high-performance" });
    if (!this.gl) throw new Error("当前浏览器不支持 WebGL 2。请启用硬件加速或换用最新版 Chrome / Edge。");
    const gl = this.gl;
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertexShader));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentShader));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    this.program = program;
    this.locations = {};
    const names = ["Resolution","Offset","Time","LayerScale","LiquidColor","LiquidAlpha","CenterConcentration","LiquidFusion","EdgeSmoothness","MinBlobSize","AnimationSpeed","SphereCount","LiquidSize","MotionRange","EdgeColor1","EdgeColor2","EdgeIntensity","EdgeWidth","GradientRotation","CameraDistance","AngleX","AngleY","PointerTarget","PointerAttraction","PointerRadius","HighlightColor1","HighlightIntensity1","HighlightConcentration1","HorizontalAngle1","VerticalAngle1","HighlightColor2","HighlightIntensity2","HighlightConcentration2","HorizontalAngle2","VerticalAngle2"];
    names.forEach(name => { this.locations[name] = gl.getUniformLocation(program, `u_${name}`); });
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    this.pointer = [0, 0];
    this.displayPointer = [0, 0];
    this.pointerHoverActive = false;
    this.pointerActiveUntil = 0;
    this.pointerInfluence = 0;
    this.lastFrameNow = performance.now();
    this.displayOffset = [0, 0];
    this.params = {
      liquidColor: [...D.liquidColor], liquidAlpha: D.liquidAlpha,
      centerConcentration: D.centerConcentration, liquidFusion: D.liquidFusion,
      edgeSmoothness: D.edgeSmoothness,
      baseSpeed: D.baseSpeed, audioSpeedMultiplier: D.audioSpeedMultiplier,
      sphereCount: D.sphereCount,
      levelInputMin: 0.015, levelInputMax: 0.3,
      bassInputMin: 0.04, bassInputMax: 0.55,
      midInputMin: 0.04, midInputMax: 0.5,
      sphereSizeMin: D.liquidSize, sphereSizeMax: 2.74,
      coreSizeMin: D.minBlobSize, coreSizeMax: 0.14,
      overallSizeMin: 1, overallSizeMax: 1.28,
      sphereDistanceMin: D.sphereDistance, sphereDistanceMax: 1.22,
      edgeColor1: [...D.edgeColor1], edgeColor2: [...D.edgeColor2],
      randomEdgeColorsEnabled: false, randomEdgeColorSpeed: 0.08,
      singleEdgeColorEnabled: false,
      autoGradientRotationEnabled: false, autoGradientRotationSpeed: 6,
      edgeIntensityMin: D.edgeIntensity, edgeIntensityMax: D.edgeIntensity + 1.5, edgeWidth: D.edgeWidth,
      gradientRotation: D.gradientRotation, cameraDistance: D.cameraDistance,
      highlightColor1: [...D.highlightColor1], highlightIntensity1: D.highlightIntensity1,
      highlightConcentration1: D.highlightConcentration1, horizontalAngle1: D.horizontalAngle1,
      verticalAngle1: D.verticalAngle1, highlightColor2: [...D.highlightColor2],
      highlightIntensity2: D.highlightIntensity2, highlightConcentration2: D.highlightConcentration2,
      horizontalAngle2: D.horizontalAngle2, verticalAngle2: D.verticalAngle2,
      hoverAmplitude: 0.18,
      pointerAttractionEnabled: false, pointerAttraction: 0, pointerRadius: 3.2,
      pixelBudgetMP: 2.5, deviceScaleMax: 1.5,
      targetFps: 55, adaptiveResolutionMin: 0.6,
      angleX: 0, angleY: 0
    };
    this.dynamicEdgeColors = [[...this.params.edgeColor1], [...this.params.edgeColor2]];
    this.edgeColorTransitions = [];
    this.dynamicGradientRotation = this.params.gradientRotation;
    this.resetEdgeColorTransitions();
    this.metrics = { bass: 0, mid: 0, level: 0, hasAudio: false };
    this.performanceStats = { adaptiveScale: 1, fps: 60, frames: 0, windowStarted: performance.now() };
    this.started = performance.now();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    localStorage.removeItem("magnetic:window-position");
    canvas.addEventListener("pointermove", this.onPointerMove, { passive: false });
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    this.resize();
    this.render();
  }

  updatePointer = event => {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer = [
      ((event.clientX - rect.left) / rect.width - 0.5) * 2,
      (0.5 - (event.clientY - rect.top) / rect.height) * 2
    ];
  };

  onPointerDown = event => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    this.updatePointer(event);
    this.pointerActiveUntil = performance.now() + 900;
  };

  onPointerMove = event => {
    this.updatePointer(event);
    if (event.pointerType !== "touch") this.pointerHoverActive = true;
  };

  onPointerLeave = event => {
    if (event.pointerType === "touch") return;
    this.pointerHoverActive = false;
    this.pointerActiveUntil = 0;
    this.pointer[0] = 0;
    this.pointer[1] = 0;
  };

  setMetrics(metrics) { this.metrics = metrics; }

  resetEdgeColorTransitions() {
    this.dynamicEdgeColors = [[...this.params.edgeColor1], [...this.params.edgeColor2]];
    this.edgeColorTransitions = this.dynamicEdgeColors.map(color => ({
      from: [...color],
      to: createRandomEdgeColor(color),
      progress: 0,
      durationScale: 0.82 + Math.random() * 0.36
    }));
  }

  updateEdgeColorTransitions(elapsedMs) {
    if (!this.params.randomEdgeColorsEnabled || this.params.randomEdgeColorSpeed <= 0 || document.visibilityState !== "visible") return;
    const step = Math.max(0, elapsedMs) / 1000 * this.params.randomEdgeColorSpeed;
    this.edgeColorTransitions.forEach((transition, index) => {
      transition.progress += step / transition.durationScale;
      while (transition.progress >= 1) {
        transition.progress -= 1;
        transition.from = [...transition.to];
        transition.to = createRandomEdgeColor(transition.from);
        transition.durationScale = 0.82 + Math.random() * 0.36;
      }
      this.dynamicEdgeColors[index] = interpolateEdgeColor(transition.from, transition.to, transition.progress);
    });
  }

  updateGradientRotation(elapsedMs) {
    const p = this.params;
    if (!p.autoGradientRotationEnabled || p.autoGradientRotationSpeed === 0 || document.visibilityState !== "visible") return;
    const next = this.dynamicGradientRotation + Math.max(0, elapsedMs) / 1000 * p.autoGradientRotationSpeed;
    this.dynamicGradientRotation = ((next + 180) % 360 + 360) % 360 - 180;
  }

  setParameter(key, value) {
    if (!(key in this.params)) return;
    if (Array.isArray(this.params[key])) {
      if (Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)) {
        this.params[key] = [...value];
        if (key === "edgeColor1" || key === "edgeColor2") this.resetEdgeColorTransitions();
      }
      return;
    }
    if (typeof this.params[key] === "boolean") {
      const changed = this.params[key] !== Boolean(value);
      this.params[key] = Boolean(value);
      if (key === "randomEdgeColorsEnabled" && changed) this.resetEdgeColorTransitions();
      if (key === "autoGradientRotationEnabled" && changed) this.dynamicGradientRotation = this.params.gradientRotation;
      return;
    }
    const next = Number(value);
    if (!Number.isFinite(next)) return;
    this.params[key] = key === "sphereCount" ? Math.round(next) : next;
    if (key === "gradientRotation") this.dynamicGradientRotation = next;
    if (key === "pixelBudgetMP" || key === "deviceScaleMax" || key === "adaptiveResolutionMin") this.resize();
  }

  getParameters() {
    return Object.fromEntries(Object.entries(this.params).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]));
  }

  getStatus() {
    const mapping = calculateAudioMapping(this.metrics, this.params);
    return {
      resolution: `${this.canvas.width} × ${this.canvas.height}`,
      fps: this.performanceStats.fps,
      renderScale: this.performanceStats.adaptiveScale,
      position: "0 px, 0 px",
      ...mapping
    };
  }

  uniform1(name, value) { this.gl.uniform1f(this.locations[name], value); }
  uniform3(name, value) { this.gl.uniform3fv(this.locations[name], value); }

  resize() {
    // Render at device resolution with a generous pixel budget. This keeps 1080p
    // viewports genuinely 1080p while preventing pathological GPU loads on 4K HiDPI.
    const cssPixels = Math.max(1, this.canvas.clientWidth * this.canvas.clientHeight);
    const pixelBudgetScale = Math.sqrt(this.params.pixelBudgetMP * 1000000 / cssPixels);
    const scale = Math.min(devicePixelRatio || 1, this.params.deviceScaleMax, pixelBudgetScale) * this.performanceStats.adaptiveScale;
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * scale));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * scale));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.gl.viewport(0, 0, width, height);
    }
  }

  updatePerformance(now) {
    const stats = this.performanceStats;
    stats.frames += 1;
    const elapsed = now - stats.windowStarted;
    if (elapsed < 1000) return;
    stats.fps = stats.frames * 1000 / elapsed;
    stats.frames = 0;
    stats.windowStarted = now;
    if (document.visibilityState !== "visible" || this.params.targetFps <= 0) return;
    const minimum = Math.min(1, Math.max(0.35, this.params.adaptiveResolutionMin));
    let nextScale = stats.adaptiveScale;
    if (stats.fps < this.params.targetFps - 2) nextScale *= 0.9;
    else if (stats.fps > this.params.targetFps + 3) nextScale += 0.05;
    nextScale = Math.min(1, Math.max(minimum, nextScale));
    if (Math.abs(nextScale - stats.adaptiveScale) >= 0.01) {
      stats.adaptiveScale = nextScale;
      this.resize();
    }
  }

  render = now => {
    const frameNow = Number.isFinite(now) ? now : performance.now();
    const elapsedMs = Math.min(64, Math.max(0, frameNow - this.lastFrameNow));
    this.lastFrameNow = frameNow;
    this.updatePerformance(frameNow);
    const pointerActive = isPointerInfluenceActive(this.pointerHoverActive, this.pointerActiveUntil, frameNow);
    this.pointerInfluence = smoothExponential(this.pointerInfluence, pointerActive ? 1 : 0, elapsedMs);
    const gl = this.gl;
    this.displayPointer[0] += (this.pointer[0] - this.displayPointer[0]) * 0.08;
    this.displayPointer[1] += (this.pointer[1] - this.displayPointer[1]) * 0.08;
    const pointerMotion = calculatePointerMotion(this.displayPointer, this.params.hoverAmplitude);
    const targetOffset = pointerMotion.offset;
    this.displayOffset[0] += (targetOffset[0] - this.displayOffset[0]) * 0.08;
    this.displayOffset[1] += (targetOffset[1] - this.displayOffset[1]) * 0.12;
    const p = this.params;
    this.updateEdgeColorTransitions(elapsedMs);
    this.updateGradientRotation(elapsedMs);
    const mapping = calculateAudioMapping(this.metrics, p);
    const animationSpeed = p.baseSpeed * (this.metrics.hasAudio ? p.audioSpeedMultiplier : 1);
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const pointerTarget = calculatePointerTarget(this.displayPointer, this.displayOffset, aspect, p.cameraDistance, mapping.overallSize);

    gl.useProgram(this.program);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(this.locations.Resolution, this.canvas.width, this.canvas.height);
    gl.uniform2f(this.locations.Offset, this.displayOffset[0], this.displayOffset[1]);
    this.uniform1("Time", (frameNow - this.started) / 1000);
    this.uniform1("LayerScale", mapping.overallSize);
    this.uniform3("LiquidColor", p.liquidColor);
    this.uniform1("LiquidAlpha", p.liquidAlpha);
    this.uniform1("CenterConcentration", p.centerConcentration);
    this.uniform1("LiquidFusion", p.liquidFusion);
    this.uniform1("EdgeSmoothness", p.edgeSmoothness);
    this.uniform1("MinBlobSize", mapping.coreSize);
    this.uniform1("AnimationSpeed", animationSpeed);
    this.uniform1("SphereCount", p.sphereCount);
    this.uniform1("LiquidSize", mapping.sphereSize);
    this.uniform1("MotionRange", mapping.sphereDistance);
    const edgeColor1 = p.randomEdgeColorsEnabled ? this.dynamicEdgeColors[0] : p.edgeColor1;
    const edgeColor2 = p.singleEdgeColorEnabled ? edgeColor1 : p.randomEdgeColorsEnabled ? this.dynamicEdgeColors[1] : p.edgeColor2;
    this.uniform3("EdgeColor1", edgeColor1);
    this.uniform3("EdgeColor2", edgeColor2);
    this.uniform1("EdgeIntensity", mapping.edgeIntensity);
    this.uniform1("EdgeWidth", p.edgeWidth);
    this.uniform1("GradientRotation", p.autoGradientRotationEnabled ? this.dynamicGradientRotation : p.gradientRotation);
    this.uniform1("CameraDistance", p.cameraDistance);
    this.uniform1("AngleX", p.angleX);
    this.uniform1("AngleY", p.angleY);
    this.uniform3("PointerTarget", pointerTarget);
    this.uniform1("PointerAttraction", p.pointerAttractionEnabled ? p.pointerAttraction * this.pointerInfluence : 0);
    this.uniform1("PointerRadius", p.pointerRadius);
    this.uniform3("HighlightColor1", p.highlightColor1);
    this.uniform1("HighlightIntensity1", p.highlightIntensity1);
    this.uniform1("HighlightConcentration1", p.highlightConcentration1);
    this.uniform1("HorizontalAngle1", p.horizontalAngle1);
    this.uniform1("VerticalAngle1", p.verticalAngle1);
    this.uniform3("HighlightColor2", p.highlightColor2);
    this.uniform1("HighlightIntensity2", p.highlightIntensity2);
    this.uniform1("HighlightConcentration2", p.highlightConcentration2);
    this.uniform1("HorizontalAngle2", p.horizontalAngle2);
    this.uniform1("VerticalAngle2", p.verticalAngle2);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.frame = requestAnimationFrame(this.render);
  };
}

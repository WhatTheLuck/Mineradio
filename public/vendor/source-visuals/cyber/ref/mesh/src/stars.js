// Teal point-cloud above the horizon. ShaderMaterial so each star can have
// its own size and twinkle phase. Soft radial falloff in the fragment shader
// gives every star a blurred halo (the "glow"), and big stars sparkle on
// high-frequency audio energy.
var WE_Stars = (function (scene) {
  var COUNT = 2000;
  var geo   = new THREE.BufferGeometry();
  var pos   = new Float32Array(COUNT * 3);
  var aSize = new Float32Array(COUNT);
  var aSeed = new Float32Array(COUNT);
  var aBig  = new Float32Array(COUNT);

  // Deterministic PRNG (mulberry32) so the starfield layout is identical
  // on every page load instead of being re-rolled by Math.random().
  var seed = 0x9e3779b9;
  function rand() {
    seed = (seed + 0x6D2B79F5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Stars are placed as mirror pairs across the X axis so the starfield is
  // left/right symmetric — same composition rule as the terrain wireframe.
  // Each pair shares position-magnitude, size and big-ness; only the twinkle
  // seed differs, so a pair doesn't blink in perfect sync (that would read as
  // an obvious duplicate).
  for (var i = 0; i < COUNT; i += 2) {
    var x = rand() * 30;                // positive half only; mirror handles -X
    var y = rand() * 20 + 2;
    var z = (rand() - 0.5) * 60;
    var big = rand() < 0.18;
    var size = big ? (0.18 + rand() * 0.10) : (0.06 + rand() * 0.03);
    var bigF = big ? 1.0 : 0.0;

    pos[i * 3]     =  x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
    aSize[i] = size;
    aSeed[i] = rand();
    aBig[i]  = bigF;

    if (i + 1 < COUNT) {
      pos[(i + 1) * 3]     = -x;
      pos[(i + 1) * 3 + 1] = y;
      pos[(i + 1) * 3 + 2] = z;
      aSize[i + 1] = size;
      aSeed[i + 1] = rand();           // independent twinkle phase
      aBig[i + 1]  = bigF;
    }
  }

  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize',    new THREE.BufferAttribute(aSize, 1));
  geo.setAttribute('aSeed',    new THREE.BufferAttribute(aSeed, 1));
  geo.setAttribute('aBig',     new THREE.BufferAttribute(aBig, 1));

  // Two colors per star: `uColor` is the base hue (idle / un-twinkling), and
  // `uTwinkleColor` is what big stars approach at peak sparkle. The fragment
  // shader mixes them per-vertex using a `vTwinkle` varying that captures the
  // per-star twinkle amount, so the color shift is tied to the individual
  // sparkle cycle, not a global average.
  var uniforms = {
    uTime:          { value: 0 },
    uColor:         { value: new THREE.Color(0.0, 0.5, 0.42) },
    uTwinkleColor:  { value: new THREE.Color(0.0, 1.0, 0.85) },
    uSizePulse:     { value: 1.0 },
    uTwinkleAmount: { value: 0.0 },
    uPixelRatio:    { value: window.devicePixelRatio || 1 }
  };

  var vertexShader = [
    'attribute float aSize;',
    'attribute float aSeed;',
    'attribute float aBig;',
    'uniform float uTime;',
    'uniform float uSizePulse;',
    'uniform float uTwinkleAmount;',
    'uniform float uPixelRatio;',
    'varying float vSparkle;',
    'varying float vTwinkle;',
    'void main() {',
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  float phase = aSeed * 6.2831 + uTime * 5.5;',
    '  float tw    = sin(phase) * 0.5 + 0.5;',
    // twAmt is 0..~1 (0 for small stars; up to uTwinkleAmount for big ones at
    // peak phase). Drives both the per-star size sparkle and the color mix.
    '  float twAmt = aBig * uTwinkleAmount * tw;',
    '  vTwinkle = clamp(twAmt, 0.0, 1.0);',
    '  float sparkle = 1.0 + twAmt * 1.8;',
    '  gl_PointSize = aSize * uSizePulse * sparkle * uPixelRatio * 700.0 / -mv.z;',
    '  gl_Position = projectionMatrix * mv;',
    '  vSparkle = sparkle;',
    '}'
  ].join('\n');

  var fragmentShader = [
    'uniform vec3 uColor;',
    'uniform vec3 uTwinkleColor;',
    'varying float vSparkle;',
    'varying float vTwinkle;',
    'void main() {',
    '  vec2 d = gl_PointCoord - vec2(0.5);',
    '  float r = length(d) * 2.0;',
    '  if (r > 1.0) discard;',
    // Bright core + soft halo. Halo dominates the apparent size, making the
    // star read as a blurry point of light rather than a hard dot.
    '  float core = pow(1.0 - r, 4.0);',
    '  float halo = pow(1.0 - r, 1.3) * 0.45;',
    '  float a    = core + halo;',
    // Per-star color: lerp base → twinkle by this star's instantaneous
    // sparkle. Sparkle then brightens the result on top of the color shift.
    '  vec3 baseCol = mix(uColor, uTwinkleColor, vTwinkle);',
    '  vec3 col = baseCol * (1.0 + vSparkle * 0.5);',
    '  gl_FragColor = vec4(col * a, a);',
    '}'
  ].join('\n');

  var mat = new THREE.ShaderMaterial({
    uniforms:       uniforms,
    vertexShader:   vertexShader,
    fragmentShader: fragmentShader,
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.AdditiveBlending
  });

  var pts   = new THREE.Points(geo, mat);
  // The reference renders a second, texture-backed star layer and assigns
  // high-band history directly to CustomStarShader.power. Reuse this scene's
  // star positions while retaining the original shader and power uniform.
  var powerGeo = new THREE.BufferGeometry();
  var powerSize = new Float32Array(COUNT);
  var powerOpacity = new Float32Array(COUNT);
  for (var powerIndex = 0; powerIndex < COUNT; powerIndex++) {
    powerSize[powerIndex] = aSize[powerIndex] * 5;
    powerOpacity[powerIndex] = rand() * 0.4;
  }
  powerGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  powerGeo.setAttribute('size', new THREE.BufferAttribute(powerSize, 1));
  powerGeo.setAttribute('opacity', new THREE.BufferAttribute(powerOpacity, 1));
  var powerMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(CustomStarShader.uniforms),
    vertexShader: CustomStarShader.vertexShader,
    fragmentShader: CustomStarShader.fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  powerMat.uniforms.texturePrimary.value = new THREE.TextureLoader().load('ref/ribbon/js/corona.png');
  powerMat.uniforms.textureSpectral.value = new THREE.TextureLoader().load('ref/ribbon/js/star_colorshift.png');
  var powerPoints = new THREE.Points(powerGeo, powerMat);
  var clock = new THREE.Clock();
  scene.add(pts, powerPoints);

  function update() {
    uniforms.uTime.value      = clock.getElapsedTime();
    // In idle mode (no audio) we feed a fraction of `idle` into the twinkle
    // term so the big stars keep visibly sparkling instead of going inert.
    var idle = WE_Audio.idle;
    var ribbonStarPower = WE_Audio.ribbonStarPower;
    powerMat.uniforms.power.value = ribbonStarPower;
    uniforms.uSizePulse.value     = 1.0 + WE_Audio.bass * 0.6 + Math.min(ribbonStarPower, 1.5) * 0.25;
    uniforms.uTwinkleAmount.value = WE_Audio.high + Math.min(ribbonStarPower, 1) + idle * 0.35;
    // uColor/uTwinkleColor are user-set via the WE properties — no per-frame
    // recoloring; the audio response is in size and per-star twinkle mix.
  }

  function setStarColor(r, g, b) {
    uniforms.uColor.value.setRGB(r, g, b);
  }
  function setTwinkleColor(r, g, b) {
    uniforms.uTwinkleColor.value.setRGB(r, g, b);
  }

  return {
    update:          update,
    setStarColor:    setStarColor,
    setTwinkleColor: setTwinkleColor
  };
})(WE_Scene.scene);

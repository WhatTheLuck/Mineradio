/* Three.js r134 BufferGeometry port of ref/ribbon/js/Ribbon.js.
   Joint motion, noise coordinates, spine length, width and color generation
   intentionally match the authorized reference. */
var WE_Ribbon = (function (scene) {
  var DEFAULT_RIBBON_LEN = 400;
  var GROUP_IDS = [0, 0, 0, 0, 1, 1, 1, 2, 3, 4];
  var BOUNDS = 1000;
  var DEFAULT_CONFETTI_COUNT = 50;
  var CONFETTI_SIZE = 60;
  var params = {
    animate: true, wireframe: false,
    ribbonSpeed: 0.00025, ribbonLength: DEFAULT_RIBBON_LEN,
    confettiCount: DEFAULT_CONFETTI_COUNT, seed: 6702.0117446020031,
    // Keep the animated paths dense, then size and place the complete cluster
    // independently in world space. The default center sits directly above
    // the terrain origin so the camera can orbit one stable focal point.
    spread: 0.68,
    scale: 0.01, positionX: 0, positionY: 4.8, positionZ: 0,
    visible: true, audioSync: true,
    audioMotionThreshold: 0.08, audioEnergyMax: 2,
    audioSpeedMin: 0.00025, audioSpeedMax: 0.0015,
    listenStrength: 1, rgbShift: true, rgbShiftSensitivity: 1.1, sharedTriggerMax: 4,
    rgbShiftScale: 5, glow: true, glowSizeScale: 1,
    glowAmountScale: 0.3, tiltAudio: true, tiltScale: 1,
    cameraDrop: true, cameraDropScale: 1, cameraDropSpeed: 2, fastRotation: true,
    noiseEnabled: false, noiseScale: 0.05, bloomAudio: true,
    bloomScale: 1, starsAudio: true,
    starEnergyThreshold: 0.35, starEnergyMax: 0.65,
    starCenterRadius: 260, starCenterDensity: 0.12
  };

  var root = new THREE.Group();
  var world = new THREE.Group();
  root.add(world);
  scene.add(root);
  var ribbons = [];
  var confetti = [];
  var confettiHolder = new THREE.Group();
  world.add(confettiHolder);
  var stars = null;
  var noise;
  var noiseTime = 0;

  function randomRange(min, max) { return min + Math.random() * (max - min); }
  function lerp(t, min, max) { return min + (max - min) * t; }
  function randomVector3(range) {
    return new THREE.Vector3(
      randomRange(-range, range),
      randomRange(-range, range),
      randomRange(-range, range)
    );
  }

  function Ribbon(id) {
    this.length = Math.max(32, Math.round(params.ribbonLength || DEFAULT_RIBBON_LEN));
    this.noiseId = id / 300;
    this.ribbonWidth = randomRange(4, 10);
    if (Math.random() < 0.2) this.ribbonWidth = 20;
    this.head = new THREE.Vector3();
    this.prev = new THREE.Vector3();
    this.arm1 = new THREE.Vector3(300 * 1.7 * params.spread, 0, 0);
    this.arm2 = new THREE.Vector3(200 * 1.7 * params.spread, 0, 0);
    this.arm3 = new THREE.Vector3(100 * 1.7 * params.spread, 0, 0);
    this.arm1T = new THREE.Vector3();
    this.arm2T = new THREE.Vector3();
    this.arm3T = new THREE.Vector3();
    this.direction = new THREE.Vector3();
    this.normal = new THREE.Vector3();
    this.up = new THREE.Vector3(1, 0, 0);
    this.xAxis = new THREE.Vector3(1, 0, 0);
    this.yAxis = new THREE.Vector3(0, 1, 0);
    this.zAxis = new THREE.Vector3(0, 0, 1);
    this.positions = new Float32Array(this.length * 6);
    this.colors = new Float32Array(this.length * 6);
    this.indices = new Uint16Array((this.length - 1) * 6);
    for (var face = 0; face < this.length - 1; face++) {
      var ii=face*6, vi=face*2;
      this.indices[ii]=vi; this.indices[ii+1]=vi+1; this.indices[ii+2]=vi+2;
      this.indices[ii+3]=vi+1; this.indices[ii+4]=vi+3; this.indices[ii+5]=vi+2;
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setIndex(new THREE.BufferAttribute(this.indices, 1));
    this.material = new THREE.MeshPhongMaterial({
      side: THREE.DoubleSide, vertexColors: true, color: 0xffffff,
      shininess: 30, specular: 0x50473b
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    world.add(this.mesh);
    this.reset();
  }

  Ribbon.prototype.reset = function () {
    this.prev.copy(this.head);
    this.positions.fill(0);
    var hue1 = (this.noiseId + Math.random() * 0.01) % 2;
    var hue2 = (this.noiseId + Math.random() * 0.01) % 2;
    if (Math.random() < 0.1) hue1 = Math.random();
    if (Math.random() < 0.1) hue2 = Math.random();
    var sat = randomRange(0.6, 1);
    var lightness = randomRange(0.2, 0.6);
    var color = new THREE.Color();
    for (var i = 0; i < this.length; i++) {
      color.setHSL(lerp(i / this.length, hue1, hue2), sat, lightness);
      var ci=i*6;
      this.colors[ci]=color.r; this.colors[ci+1]=color.g; this.colors[ci+2]=color.b;
      this.colors[ci+3]=color.r; this.colors[ci+4]=color.g; this.colors[ci+5]=color.b;
    }
    this.geometry.attributes.color.needsUpdate = true;
  };

  Ribbon.prototype.getNoiseAngle = function (zOffset) {
    return noise.noise3d(noiseTime, this.noiseId, zOffset) * Math.PI * 2;
  };

  Ribbon.prototype.update = function (skipNormals) {
    this.prev.copy(this.head);
    this.arm1T.copy(this.arm1);
    this.arm2T.copy(this.arm2);
    this.arm3T.copy(this.arm3);
    this.arm1T.applyAxisAngle(this.zAxis, this.getNoiseAngle(0));
    this.arm1T.applyAxisAngle(this.yAxis, this.getNoiseAngle(20));
    this.arm2T.applyAxisAngle(this.zAxis, this.getNoiseAngle(50));
    this.arm2T.applyAxisAngle(this.xAxis, this.getNoiseAngle(70));
    this.arm3T.applyAxisAngle(this.xAxis, this.getNoiseAngle(100));
    this.arm3T.applyAxisAngle(this.yAxis, this.getNoiseAngle(150));
    this.head.copy(this.arm1T).add(this.arm2T).add(this.arm3T);
    this.direction.subVectors(this.head, this.prev).normalize();
    this.normal.crossVectors(this.direction, this.up).normalize().multiplyScalar(this.ribbonWidth);
    this.positions.copyWithin(6, 0, (this.length - 1) * 6);
    this.positions[0] = this.head.x + this.normal.x;
    this.positions[1] = this.head.y + this.normal.y;
    this.positions[2] = this.head.z + this.normal.z;
    this.positions[3] = this.head.x - this.normal.x;
    this.positions[4] = this.head.y - this.normal.y;
    this.positions[5] = this.head.z - this.normal.z;
    this.geometry.attributes.position.needsUpdate = true;
    if (!skipNormals) this.geometry.computeVertexNormals();
  };

  function disposeRibbons() {
    ribbons.forEach(function (r) { world.remove(r.mesh); r.geometry.dispose(); r.material.dispose(); });
    ribbons.length = 0;
  }

  function disposeConfetti() {
    confetti.forEach(function (item) {
      confettiHolder.remove(item.mesh);
      item.geometry.dispose();
      item.material.dispose();
    });
    confetti.length = 0;
  }

  function buildConfetti() {
    disposeConfetti();
    var confettiCount = Math.max(0, Math.round(params.confettiCount));
    for (var i = 0; i < confettiCount; i++) {
      var confettiBounds = BOUNDS * params.spread;
      var position = randomVector3(confettiBounds);
      var color = new THREE.Color();
      color.setHSL((position.x + BOUNDS) / (BOUNDS * 2), randomRange(0.6, 1), randomRange(0.2, 0.6));
      var geometry = new THREE.PlaneGeometry(CONFETTI_SIZE, CONFETTI_SIZE, 1, 1);
      var material = new THREE.MeshPhongMaterial({
        side: THREE.DoubleSide,
        color: color,
        shininess: 30,
        specular: 0x50473b
      });
      var mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(position);
      mesh.rotation.setFromVector3(randomVector3(1));

      // Match Confetti.js: clustered scale comes from the same simplex field
      // as the ribbons, including its deliberately broad signed range.
      var n = noise.noise3d(position.x * 0.02, position.y * 0.02, position.z * 0.02);
      var scale = lerp(Math.pow(n, 3), 0.1, 1.5);
      mesh.scale.setScalar(scale);
      mesh.frustumCulled = false;
      confettiHolder.add(mesh);
      confetti.push({ mesh: mesh, geometry: geometry, material: material });
    }
  }

  function disposeStars() {
    if (!stars) return;
    world.remove(stars.holder);
    stars.dotGeometry.dispose();
    stars.glowGeometry.dispose();
    stars.dotMaterial.dispose();
    stars.glowMaterial.dispose();
    stars = null;
  }

  function buildStars() {
    disposeStars();
    var count = 10000;
    // Reference Stars.js constants. Spatial concentration only applies to the
    // ribbons/confetti; the star volume remains the original 1000-unit cube.
    var range = 1000;
    var positions = new Float32Array(count * 3);
    var sizes = new Float32Array(count);
    var opacities = new Float32Array(count);
    var glowPositions = new Float32Array(count * 3);
    var glowSizes = new Float32Array(count);
    var glowOpacities = new Float32Array(count);

    for (var i = 0; i < count; i++) {
      var position;
      var accepted = false;
      // Thin the volume smoothly around the ribbon cluster. Keeping a small
      // non-zero density avoids a visibly cut-out sphere while moving most
      // stars away from the visual centre.
      for (var attempt = 0; attempt < 32 && !accepted; attempt++) {
        position = randomVector3(range);
        var centerRadius = Math.max(0, params.starCenterRadius);
        var centerDistance = position.length();
        var centerT = centerRadius > 0 ? Math.min(1, centerDistance / centerRadius) : 1;
        var keepProbability = params.starCenterDensity + (1 - params.starCenterDensity) * centerT * centerT;
        accepted = centerDistance >= centerRadius || Math.random() <= keepProbability;
      }
      position.toArray(positions, i * 3);
      position.toArray(glowPositions, i * 3);
      var n = (noise.noise3d(position.x * 0.002, position.y * 0.002, position.z * 0.002) + 1) * 0.5;
      var size = lerp(Math.pow(n, 3), 2, 20);
      // These are the dense white audio stars, not confetti. Give every point
      // enough authored opacity to remain legible once energy crosses the
      // threshold; the energy uniform still makes the entire layer exactly
      // black at zero.
      var opacity = 0.25 + Math.random() * 0.75;
      sizes[i] = size;
      glowSizes[i] = size * 5;
      opacities[i] = opacity;
      glowOpacities[i] = opacity;
    }

    var dotGeometry = new THREE.BufferGeometry();
    dotGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    dotGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    dotGeometry.setAttribute('opacity', new THREE.BufferAttribute(opacities, 1));
    var glowGeometry = new THREE.BufferGeometry();
    glowGeometry.setAttribute('position', new THREE.BufferAttribute(glowPositions, 3));
    glowGeometry.setAttribute('size', new THREE.BufferAttribute(glowSizes, 1));
    glowGeometry.setAttribute('opacity', new THREE.BufferAttribute(glowOpacities, 1));

    // `texture` became a reserved GLSL function name under WebGL2. Preserve
    // the reference shader math while aliasing only that uniform so the old
    // WebGL1 shader compiles on the current renderer.
    function scalePointShader(shader) {
      return 'uniform float pointScale;\n' + shader.replace(
        'gl_PointSize = size * ( 300.0 / length( mvPosition.xyz ) );',
        'gl_PointSize = size * pointScale * ( 300.0 / length( mvPosition.xyz ) );'
      );
    }
    var dotUniforms = THREE.UniformsUtils.clone(StarShader.uniforms);
    dotUniforms.pointTexture = { value: null };
    dotUniforms.pointScale = { value: params.scale };
    dotUniforms.starBrightness = { value: 0 };
    var dotFragmentShader = StarShader.fragmentShader
      .replace('uniform sampler2D texture;', 'uniform sampler2D pointTexture;')
      .replace('texture2D( texture,', 'texture2D( pointTexture,')
      .replace('varying float vOpacity;', 'varying float vOpacity;\nuniform float starBrightness;')
      .replace('gl_FragColor.a *= vOpacity;', 'gl_FragColor *= vOpacity * starBrightness;');
    var dotMaterial = new THREE.ShaderMaterial({
      uniforms: dotUniforms,
      vertexShader: scalePointShader(StarShader.vertexShader),
      fragmentShader: dotFragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    dotMaterial.uniforms.pointTexture.value = new THREE.TextureLoader().load('ref/ribbon/js/dot.png');
    var glowUniforms = THREE.UniformsUtils.clone(CustomStarShader.uniforms);
    glowUniforms.pointScale = { value: params.scale };
    glowUniforms.starBrightness = { value: 0 };
    var glowFragmentShader = CustomStarShader.fragmentShader
      .replace('uniform float power;', 'uniform float power;\nuniform float starBrightness;')
      .replace(
        'gl_FragColor = alpha*vec4(finalColor, vOpacity * power);',
        'gl_FragColor = alpha * vec4(finalColor, vOpacity) * starBrightness;'
      );
    var glowMaterial = new THREE.ShaderMaterial({
      uniforms: glowUniforms,
      vertexShader: scalePointShader(CustomStarShader.vertexShader),
      fragmentShader: glowFragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    glowMaterial.uniforms.texturePrimary.value = new THREE.TextureLoader().load('ref/ribbon/js/corona.png');
    glowMaterial.uniforms.textureSpectral.value = new THREE.TextureLoader().load('ref/ribbon/js/star_colorshift.png');
    // Keep the reference texture color neutral. The shared 0..1 brightness
    // uniform now owns both RGB and alpha for a guaranteed black zero state.
    glowMaterial.uniforms.power.value = 1;

    var dots = new THREE.Points(dotGeometry, dotMaterial);
    var glow = new THREE.Points(glowGeometry, glowMaterial);
    dots.frustumCulled = false;
    glow.frustumCulled = false;
    var holder = new THREE.Group();
    holder.add(dots, glow);
    world.add(holder);
    stars = {
      holder: holder,
      dots: dots,
      glow: glow,
      dotGeometry: dotGeometry,
      glowGeometry: glowGeometry,
      dotMaterial: dotMaterial,
      glowMaterial: glowMaterial,
      count: count
    };
  }

  function rebuild() {
    disposeRibbons();
    Math.seedrandom(params.seed);
    noise = new SimplexNoise();
    // Original init(): seeded random start time, also used in every ribbon id.
    noiseTime = Math.random() * 1000;
    for (var i = 0; i < GROUP_IDS.length; i++) ribbons.push(new Ribbon(GROUP_IDS[i] * 100 + i + noiseTime));
    var ribbonLength = Math.max(32, Math.round(params.ribbonLength || DEFAULT_RIBBON_LEN));
    for (var step = 0; step < ribbonLength; step++) {
      for (var j = 0; j < ribbons.length; j++) ribbons[j].update(true);
      noiseTime += params.ribbonSpeed;
    }
    for (var normalIndex=0; normalIndex<ribbons.length; normalIndex++) ribbons[normalIndex].geometry.computeVertexNormals();
    buildStars();
    buildConfetti();
    applyParams();
  }

  function applyParams() {
    root.visible = params.visible;
    root.scale.setScalar(params.scale);
    root.position.set(params.positionX, params.positionY, params.positionZ);
    origin.position.copy(root.position);
    origin.distance = 700 * params.scale;
    cameraLight.distance = 1000 * params.scale;
    if (stars) {
      stars.dotMaterial.uniforms.pointScale.value = params.scale;
      stars.glowMaterial.uniforms.pointScale.value = params.scale;
    }
    world.rotation.set(0, 0, 0);
    ribbons.forEach(function (r) { r.material.wireframe = params.wireframe; });
  }

  function update(dt) {
    if (stars) {
      var starBrightness = params.starsAudio && WE_Audio.sourceActive
        ? WE_Audio.ribbonStarBrightness
        : 0;
      stars.dotMaterial.uniforms.starBrightness.value = starBrightness;
      stars.glowMaterial.uniforms.starBrightness.value = starBrightness;
      stars.glowMaterial.uniforms.power.value = 1;
      stars.glowMaterial.uniforms.spectralLookup.value = 0;
    }
    if (!params.animate) return;
    var speed = params.ribbonSpeed;
    // A disconnected source retains a very slow authored drift. Once a real
    // source is active, the reference ribbon-speed mapping owns the motion.
    if (params.audioSync && WE_Audio.sourceActive) speed = WE_Audio.ribbonSpeed;
    noiseTime += speed;
    for (var i = 0; i < ribbons.length; i++) ribbons[i].update();
    // The reference is frame-based. Scaling by 60 Hz preserves its exact
    // motion at the intended rate while remaining stable on faster displays.
    var frameScale = Math.min(dt * 60, 4);
    for (var j = 0; j < confetti.length; j++) {
      var mesh = confetti[j].mesh;
      mesh.rotation.x += 0.02 * frameScale;
      mesh.rotation.y += 0.01 * frameScale;
      mesh.rotation.z += 0.01 * frameScale;
      mesh.position.y += 0.7 * frameScale;
      var confettiBounds = BOUNDS * params.spread;
      if (mesh.position.y > confettiBounds) mesh.position.y = -confettiBounds;
    }
    // Ribbon space stays fixed. Camera motion is owned by app.js.
    world.rotation.set(0, 0, 0);
  }

  var ambient = new THREE.AmbientLight(0x333333);
  var origin = new THREE.PointLight(0xffffff, 2, 9.8);
  var cameraLight = new THREE.PointLight(0xffffff, 1, 14.3);
  var front = new THREE.DirectionalLight(0xffffff, 1);
  var up = new THREE.DirectionalLight(0xffffff, 1);
  front.position.set(0, 0, 1);
  up.position.set(0, 1, 0);
  scene.add(ambient, origin, cameraLight, front, up);
  rebuild();
  return {
    params: params,
    update: update,
    applyParams: applyParams,
    rebuild: rebuild,
    root: root,
    cameraLight: cameraLight,
    getRibbonCount: function () { return ribbons.length; },
    getConfettiCount: function () { return confetti.length; },
    getStarCount: function () { return stars ? stars.count : 0; },
    getStarPower: function () { return stars ? stars.glowMaterial.uniforms.starBrightness.value : 0; },
    getRibbonLength: function () { return ribbons.length ? ribbons[0].length : 0; },
    getNoiseTime: function () { return noiseTime; }
  };
})(WE_Scene.scene);

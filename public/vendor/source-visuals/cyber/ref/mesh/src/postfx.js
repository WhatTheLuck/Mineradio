// UnrealBloom for the neon glow. Strength climbs with overall audio energy on
// top of the user-controlled base value, plus a short additive boost on each
// detected beat so kicks visibly punch through.
var WE_PostFX = (function (renderer, scene, camera) {
  // EffectComposer makes its own render target. Without an explicit pixel
  // ratio it falls back to 1.0 on some setups (so output looks soft) — pin
  // it to the same DPR the renderer is using so bloom isn't down/upsampled.
  var dpr = renderer.getPixelRatio();

  var composer = new EffectComposer(renderer);
  composer.setPixelRatio(dpr);
  composer.addPass(new RenderPass(scene, camera));

  var bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    1.0,   // strength — restrained base glow
    0.55,  // radius — tighter halo spread
    0.30   // threshold — only meaningfully lit lines bloom
  );
  composer.addPass(bloomPass);

  // The reference SpaceShader is an additive moving light wash. Keep it after
  // the host mesh bloom so the extra bloom stage cannot bleach or blur the
  // ribbon light colors before the remaining reference passes run.
  var lightsPass = new ShaderPass(THREE.SpaceShader);
  composer.addPass(lightsPass);

  var tiltPass = new ShaderPass(THREE.CustomTiltShiftShader);
  tiltPass.uniforms.focusPos.value = 0.35;
  tiltPass.uniforms.range.value = 0.5;
  tiltPass.uniforms.strength.value = 0.45;
  composer.addPass(tiltPass);

  var glowPass = new ShaderPass(THREE.SuperShader);
  glowPass.uniforms.vigOffset.value = 1.3;
  glowPass.uniforms.saturation.value = 0;
  glowPass.uniforms.contrast.value = 0;
  glowPass.uniforms.brightness.value = 0;
  // SuperShader contains its own RGB split. Disable that constant path so the
  // dedicated reference RGB pass is the only chromatic offset source and can
  // fully return to zero between low-mid drum onsets.
  glowPass.uniforms.rgbShiftAmount.value = 0;
  composer.addPass(glowPass);

  var rgbPass = new ShaderPass(THREE.CustomRGBShiftShader);
  composer.addPass(rgbPass);

  var noisePass = new ShaderPass(THREE.NoiseShader);
  composer.addPass(noisePass);
  window.addEventListener('resize', function () {
    composer.setSize(window.innerWidth, window.innerHeight);
  });

  function update(dt) {
    var base = (window.WE_Props && window.WE_Props.bloom);
    if (typeof base !== 'number') base = 0.7;
    // Energy is the slow lift; beat adds a sharp punch on kicks. Cap so the
    // bloom never saturates into a uniform white wash.
    var ribbon = window.WE_Ribbon ? WE_Ribbon.params : null;
    var s = base + WE_Audio.energy * 0.45 + WE_Audio.beat * 0.6;
    bloomPass.strength = Math.min(s, base + 1.5);
    bloomPass.radius = 0.55;

    var ribbonTime = ribbon && WE_Ribbon.getNoiseTime ? WE_Ribbon.getNoiseTime() : 0;
    lightsPass.uniforms.time.value = ribbonTime * 20;
    lightsPass.uniforms.opacity.value = WE_Audio.ribbonLights;
    glowPass.uniforms.glowSize.value = WE_Audio.ribbonGlowSize;
    glowPass.uniforms.glowAmount.value = WE_Audio.ribbonGlowAmount;
    rgbPass.uniforms.amount.value = WE_Audio.ribbonRgbShift;
    tiltPass.uniforms.offset.value = WE_Audio.ribbonTilt;
    noisePass.uniforms.time.value = ribbonTime;
    noisePass.uniforms.speed.value = 0.5;
    noisePass.uniforms.amount.value = ribbon && ribbon.noiseEnabled ? ribbon.noiseScale : 0;
  }

  function render() {
    composer.render();
  }

  // Called by WE_Scene.setRenderScale whenever the user changes the density
  // slider. Without this the bloom render targets stay at the original DPR
  // and the chunky-pixel look only applies to the base pass — the bloom halo
  // would still be silky-smooth on top.
  function setRenderScale(scale) {
    composer.setPixelRatio(scale);
    composer.setSize(window.innerWidth, window.innerHeight);
    glowPass.uniforms.resolution.value.set(window.innerWidth * scale, window.innerHeight * scale);
  }

  setRenderScale(dpr);
  return {
    update: update,
    render: render,
    setRenderScale: setRenderScale,
    getRibbonState: function () {
      return {
        rgbShift: rgbPass.uniforms.amount.value,
        glowSize: glowPass.uniforms.glowSize.value,
        glowAmount: glowPass.uniforms.glowAmount.value,
        lights: lightsPass.uniforms.opacity.value,
        tilt: tiltPass.uniforms.offset.value
      };
    }
  };
})(WE_Scene.renderer, WE_Scene.scene, WE_Scene.camera);

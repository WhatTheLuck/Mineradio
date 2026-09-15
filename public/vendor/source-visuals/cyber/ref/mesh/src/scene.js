// Renderer + camera + empty scene. Camera is fixed; the world moves past it.
var WE_Scene = (function () {
  var renderer = new THREE.WebGLRenderer({ antialias: false });
  // Render scale (canvas pixels per CSS pixel). Driven by the `density` user
  // property — low values produce a chunky lo-fi look because the renderer
  // and all post-pass textures get smaller, then NEAREST-upscale to the
  // canvas size. 1.0 is native resolution; anything below is intentionally
  // pixelated. setRenderScale() updates this at runtime.
  var renderScale = 1.0;

  function applyScale() {
    renderer.setPixelRatio(renderScale);
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  applyScale();
  // No tone mapping: we want HDR vertex colors (values > 1) to feed UnrealBloom
  // unmodified so the high-pass threshold actually fires on bright pixels.
  renderer.toneMapping = THREE.NoToneMapping;
  // NEAREST upscale of the backing buffer keeps the retro pixel-grid look when
  // renderScale < 1.0. Without this, the browser smooth-resizes the canvas and
  // low resolutions just read as blurry instead of chunky.
  renderer.domElement.style.imageRendering = 'pixelated';
  document.body.appendChild(renderer.domElement);

  var scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  var camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.set(0, 1.5, 10);
  camera.lookAt(0, 1.5, -1);

  window.addEventListener('resize', function () {
    applyScale();
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  function setRenderScale(scale) {
    if (!(scale > 0)) return;
    renderScale = scale;
    applyScale();
    // Forward to the post-fx composer so its internal render targets resize
    // to match — otherwise the bloom pass keeps its old resolution and the
    // density slider only affects the base render.
    if (window.WE_PostFX && WE_PostFX.setRenderScale) {
      WE_PostFX.setRenderScale(scale);
    }
  }

  return {
    renderer:       renderer,
    scene:          scene,
    camera:         camera,
    setRenderScale: setRenderScale
  };
})();

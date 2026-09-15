// Property defaults — overwritten whenever WE pushes user-property updates.
window.WE_Props = {
  speed:       1.0,
  sensitivity: 2.5,
  amplitude:   1.0,
  bloom:       0.9,
  density:     100,
  idle_motion: 0.6,
  symmetry:    true
};

// "r g b" float string ("0.8 0 0.4") → {r, g, b}. WE delivers all color
// properties in this format.
function parseColor(str) {
  if (typeof str !== 'string') return null;
  var parts = str.split(' ');
  if (parts.length < 3) return null;
  var r = parseFloat(parts[0]);
  var g = parseFloat(parts[1]);
  var b = parseFloat(parts[2]);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
  return { r: r, g: g, b: b };
}

// Apply a color property if present, parsing once and dispatching to setter.
function applyColor(prop, setter) {
  if (!prop) return;
  var c = parseColor(prop.value);
  if (c) setter(c.r, c.g, c.b);
}

window.wallpaperPropertyListener = {
  applyUserProperties: function (props) {
    if (props.speed)       WE_Props.speed       = props.speed.value;
    if (props.sensitivity) WE_Props.sensitivity = props.sensitivity.value;
    if (props.amplitude)   WE_Props.amplitude   = props.amplitude.value;
    if (props.bloom)       WE_Props.bloom       = props.bloom.value;
    if (props.density) {
      WE_Props.density = props.density.value;
      // density is a percentage of native pixel resolution: 100 = 1:1,
      // 30 = chunky retro pixels, 150 = oversampled. WE_Scene also forwards
      // the scale to WE_PostFX so the bloom render targets follow.
      WE_Scene.setRenderScale(props.density.value / 100);
    }
    if (props.idle_motion) WE_Props.idle_motion = props.idle_motion.value;
    if (props.symmetry)    WE_Props.symmetry    = !!props.symmetry.value;

    applyColor(props.color_near,         WE_Terrain.setNearColor);
    applyColor(props.color_mid,          WE_Terrain.setMidColor);
    applyColor(props.color_far,          WE_Terrain.setFarColor);
    applyColor(props.color_sunset,       WE_Terrain.setSunsetColor);
    applyColor(props.color_wave,         WE_Terrain.setWaveColor);
    applyColor(props.color_star,         WE_Stars.setStarColor);
    applyColor(props.color_star_twinkle, WE_Stars.setTwinkleColor);
  },
  // WE pushes engine-wide settings here: target FPS (from the per-display
  // fps_limit), the global audioprocessing toggle, and on some builds the
  // desktop scheme color.
  applyGeneralProperties: function (props) {
    if (props.fps && typeof props.fps.value === 'number') {
      setTargetFps(props.fps.value);
    }
    if (props.audioprocessing && typeof props.audioprocessing.value === 'boolean') {
      WE_Audio.setEnabled(props.audioprocessing.value);
    }
  },
  // WE calls this when the wallpaper should pause (fullscreen game running,
  // power saver, etc.). We stop the render loop entirely — no GPU work and
  // no needsUpdate churn on geometry.
  setPaused: function (isPaused) {
    paused = !!isPaused;
  }
};

// Browser-side fallback: if WE never calls setPaused (we're being previewed
// in a regular browser), at least pause on tab hide so dev iterations don't
// keep a GPU pegged in the background.
document.addEventListener('visibilitychange', function () {
  paused = document.hidden;
});

// --- Pause + FPS throttling ------------------------------------------------

var paused        = false;
var targetFrameMs = 0;        // 0 → no cap
var lastFrameMs   = 0;

function setTargetFps(fps) {
  if (!fps || fps <= 0) { targetFrameMs = 0; return; }
  targetFrameMs = 1000 / fps;
}

// --- Animation loop --------------------------------------------------------

var clock     = new THREE.Clock();
var prevTime  = 0;

function animate(now) {
  requestAnimationFrame(animate);

  if (paused) return;

  if (targetFrameMs > 0) {
    if (now - lastFrameMs < targetFrameMs - 0.5) return;
    lastFrameMs = now;
  }

  var t  = clock.getElapsedTime();
  var dt = t - prevTime;
  if (dt > 0.25) dt = 0.25;   // clamp after pause / tab hide
  prevTime = t;

  WE_Audio.step(dt);
  WE_Terrain.update(clock);
  WE_Stars.update();
  WE_PostFX.update();
  WE_PostFX.render();
}

requestAnimationFrame(animate);

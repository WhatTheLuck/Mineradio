// Two wireframe planes — a near one tinted by the user's WE scheme color, a
// far one fading toward the horizon (magenta → blue). The surface height
// field is *not* a globally scrolling noise anymore: every height comes from
// a pool of point impulses dropped onto the plane (boiling-water model).
// Each impulse fires a Gaussian-shaped ring that expands outward at speed
// `c` and decays in amplitude over time. The rendered height at any (x, z)
// is the linear sum of every live impulse's contribution, so two waves
// passing through one another superpose — crest + crest amplifies, crest +
// trough cancels, which is the correct physics for linear water waves.
var WE_Terrain = (function (scene) {

  // The near purple plane now has the same physical footprint as the far
  // yellow/orange plane.
  var FRONT_WIDTH  = 240;
  var FRONT_DEPTH  = 40;
  var FRONT_Z      = 4;
  var FRONT_FAR_Z  = FRONT_Z - FRONT_DEPTH / 2;            // -16

  // Both planes share this footprint so neither color field exposes a smaller
  // side edge when the user orbits the camera.
  var BACK_WIDTH   = 240;
  var BACK_DEPTH   = 40;

  // Slide back forward by 5% of FRONT_DEPTH so it overlaps the front's far
  // edge instead of leaving a visible seam. Both planes are wireframe so the
  // overlap just yields slightly denser grid in the seam band, never a
  // hard line.
  var OVERLAP      = FRONT_DEPTH * 0.05;                   // 2
  var BACK_NEAR_Z  = FRONT_FAR_Z + OVERLAP;                // -14
  var BACK_Z       = BACK_NEAR_Z - BACK_DEPTH / 2;         // -34
  var BACK_FAR_Z   = BACK_Z - BACK_DEPTH / 2;              // -54

  // World-space z range used for the near→far gradient. Compressed inward
  // so the cold-blue band lands close behind the front/back seam rather than
  // deep in the back plane; anything past GRAD_FAR_Z clamps to the sunset
  // stop, which paints the back plane as an orange horizon glow.
  var GRAD_NEAR_Z = FRONT_Z + FRONT_DEPTH / 2;             // 24
  var GRAD_FAR_Z  = -20;                                   // ~28 ed. from camera

  // Four-stop gradient anchors: near → mid → far → sunset. Each band has an
  // internal HDR boost so a 0..1 color from WE still pushes the dominant
  // channel above the bloom threshold. Setters multiply user input by their
  // band's boost factor and store the result; project.json defaults below
  // mirror these values once boosted.
  //   near:    boost 1.4  (magenta tip, light bloom on R/B)
  //   mid:     boost 1.0  (saturated already, no extra push)
  //   far:     boost 1.0  (cold blue, B picks up bloom)
  //   sunset:  boost 1.8  (warm orange, strong R bloom for horizon fog)
  //   wave:    no boost   (additive multiplier on Y crest white-add)
  var NEAR_BOOST   = 1.4;
  var SUNSET_BOOST = 1.8;

  var schemeR = 0.8 * NEAR_BOOST,  schemeG = 0.0,                schemeB = 0.4 * NEAR_BOOST;
  var BRIDGE_R = 0.85,             BRIDGE_G = 0.06,              BRIDGE_B = 0.60;
  var COLD_R   = 0.05,             COLD_G   = 0.15,              COLD_B   = 1.00;
  var SUN_R    = 1.0 * SUNSET_BOOST, SUN_G  = 0.31 * SUNSET_BOOST, SUN_B = 0.06 * SUNSET_BOOST;
  var WAVE_R   = 1.0,              WAVE_G   = 1.0,               WAVE_B   = 1.0;

  // Gradient stop positions along t ∈ [0, 1].
  var STOP_BRIDGE = 0.35;
  var STOP_COLD   = 0.65;

  // Shared depth attenuation. Not a monotonic fade anymore — it's a *valley*:
  // 1.0 through the bridge, dips hard in the cold-blue mid-back region to
  // keep dense parallel lines from bloom-summing into a haze, then climbs
  // back up at the horizon so the sunset orange stop is allowed to glow
  // (otherwise the "fog" would be invisible). Used both for the base gradient
  // bake and for scaling the audio crest white-add per vertex.
  function depthFadeAt(t) {
    if (t <= 0.45) return 1.0;
    if (t <= 0.70) {
      var a = (t - 0.45) / 0.25;
      return 1.0 - a * 0.70;            // 1.0 → 0.30
    }
    var b = (t - 0.70) / 0.30;
    if (b > 1) b = 1;
    return 0.30 + b * 0.40;              // 0.30 → 0.70 (sunset recovery)
  }

  // Bake the static near→far gradient into `dest`. This is the *base* color
  // per vertex (no audio response); the per-frame update adds a height-driven
  // white boost on top so wave crests literally light up.
  function applyDistanceGradient(geo, meshZ, dest) {
    var pos = geo.attributes.position;
    for (var i = 0; i < pos.count; i++) {
      var worldZ = pos.getZ(i) + meshZ;
      var t = (GRAD_NEAR_Z - worldZ) / (GRAD_NEAR_Z - GRAD_FAR_Z);
      if (t < 0) t = 0; else if (t > 1) t = 1;

      // Three-segment interpolation: scheme → bridge → cold blue → sunset.
      var r, g, b;
      if (t < STOP_BRIDGE) {
        var u = t / STOP_BRIDGE;
        r = schemeR * (1 - u) + BRIDGE_R * u;
        g = schemeG * (1 - u) + BRIDGE_G * u;
        b = schemeB * (1 - u) + BRIDGE_B * u;
      } else if (t < STOP_COLD) {
        var v = (t - STOP_BRIDGE) / (STOP_COLD - STOP_BRIDGE);
        r = BRIDGE_R * (1 - v) + COLD_R * v;
        g = BRIDGE_G * (1 - v) + COLD_G * v;
        b = BRIDGE_B * (1 - v) + COLD_B * v;
      } else {
        var w = (t - STOP_COLD) / (1 - STOP_COLD);
        r = COLD_R * (1 - w) + SUN_R * w;
        g = COLD_G * (1 - w) + SUN_G * w;
        b = COLD_B * (1 - w) + SUN_B * w;
      }
      // Modest quadratic lift to push the dominant channel of each band just
      // above the bloom threshold without washing everything to white.
      var glow = 1.0 + t * t * 0.25;
      var f = glow * depthFadeAt(t);
      dest[i * 3]     = r * f;
      dest[i * 3 + 1] = g * f;
      dest[i * 3 + 2] = b * f;
    }
  }

  function makePlane(z, width, depth, widthSegs, depthSegs) {
    var geo = new THREE.PlaneGeometry(width, depth, widthSegs, depthSegs);
    geo.rotateX(-Math.PI / 2);

    // Two color buffers: `baseColors` is the immutable gradient bake; the
    // attribute on geo (`liveColors`) is what the GPU reads — rewritten each
    // frame as base + height-boost so wave crests glow.
    var vertCount  = geo.attributes.position.count;
    var baseColors = new Float32Array(vertCount * 3);
    applyDistanceGradient(geo, z, baseColors);
    var liveColors = new Float32Array(baseColors);
    geo.setAttribute('color', new THREE.BufferAttribute(liveColors, 3));

    // Per-vertex depth fade, cached once. Independent of scheme colors, so it
    // never needs rebaking. The per-frame audio-glow pass scales its wave-add
    // by this so back-plane crests dim along with the static lines instead
    // of blooming through the fade.
    var depthFade = new Float32Array(vertCount);
    var pos = geo.attributes.position;
    for (var di = 0; di < vertCount; di++) {
      var wz = pos.getZ(di) + z;
      var tt = (GRAD_NEAR_Z - wz) / (GRAD_NEAR_Z - GRAD_FAR_Z);
      if (tt < 0) tt = 0; else if (tt > 1) tt = 1;
      depthFade[di] = depthFadeAt(tt);
    }

    // Build the edge index for LineSegments by hand. We can't just use a
    // wireframed Mesh: PlaneGeometry's triangulation lays every diagonal in
    // the same direction, which in perspective slopes "/" across the entire
    // plane and breaks left/right composition symmetry. Instead we add the
    // H/V grid edges everywhere, plus a per-quad diagonal that flips at the
    // vertical center column — left half "/" and right half "\" — so the
    // visible triangles mirror around the image center axis.
    var cols    = widthSegs + 1;
    var rows    = depthSegs + 1;
    var midCol  = (cols - 1) / 2;
    var idx = [];
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var i = r * cols + c;
        if (c < cols - 1) idx.push(i, i + 1);          // horizontal edge
        if (r < rows - 1) idx.push(i, i + cols);       // vertical edge
        if (c < cols - 1 && r < rows - 1) {
          if (c + 0.5 < midCol) {
            // Left half: (c, r+1) → (c+1, r) — slopes "/" on screen.
            idx.push(i + cols, i + 1);
          } else {
            // Right half: (c, r) → (c+1, r+1) — slopes "\" on screen.
            idx.push(i, i + cols + 1);
          }
        }
      }
    }
    var lineGeo = new THREE.BufferGeometry();
    // Share the position + color buffers with the source PlaneGeometry. The
    // impulse update writes into geo.attributes.position.array; because the
    // BufferAttribute instance is shared, the LineSegments sees those writes
    // for free. Same for color setters' gradient rebake.
    lineGeo.setAttribute('position', geo.attributes.position);
    lineGeo.setAttribute('color',    geo.attributes.color);
    lineGeo.setIndex(idx);

    var mat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      vertexColors: true
    });
    var mesh = new THREE.LineSegments(lineGeo, mat);
    mesh.position.z = z;
    scene.add(mesh);
    return { geo: geo, mat: mat, mesh: mesh, baseZ: z,
             baseColors: baseColors, depthFade: depthFade };
  }

  // Fixed grid resolution — the `density` WE property no longer controls
  // wireframe density (it now drives the renderer's pixel scale instead, in
  // scene.js). Rebuilding plane geometry at runtime would mean tearing down
  // and re-uploading buffers, so we just pick a sensible constant here.
  var density = 70;
  // Front and back have identical world-space dimensions. Keep the back mesh
  // slightly looser only to control its distant vertex cost.
  var front = makePlane(
    FRONT_Z, FRONT_WIDTH, FRONT_DEPTH,
    Math.floor(density * (FRONT_WIDTH / FRONT_DEPTH)),
    Math.floor(density)
  );
  // Back: much wider plane, but cells are looser per world unit. Visible cell
  // count across the screen at the horizon stays comparable to the front
  // because of perspective compression, while keeping total vertex count
  // reasonable (a uniform front-density grid at 240 wide would be 4× more
  // verts than we need).
  var back = makePlane(
    BACK_Z, BACK_WIDTH, BACK_DEPTH,
    Math.floor(density * (BACK_WIDTH / FRONT_WIDTH) * 0.5),
    Math.floor(density * 0.6)
  );

  // ---------------------------------------------------------------------------
  // Impulse field
  //
  // Each entry is one circular wave that was kicked onto the surface at a
  // moment in time. While alive, it contributes a Gaussian-shaped ring of
  // height around (x, z), centered at radius `c · (now - t0)` and `sigma`
  // wide. The instantaneous amplitude is `amp · exp(-decay · τ)`, so each
  // impulse trails off cleanly without needing an explicit lifetime; we
  // also flip `alive = 0` once its current amplitude drops under a tiny
  // floor, freeing its slot for reuse.
  //
  // Two-wave collisions resolve themselves: the height at (x, z) is the sum
  // over all live impulses, so a crest meeting a crest doubles, crest
  // meeting trough cancels — the standard linear-wave interference picture.
  // No "bounce" logic is needed; that isn't how water waves actually behave.
  // ---------------------------------------------------------------------------
  var MAX_IMPULSES = 56;
  var impulses = new Array(MAX_IMPULSES);
  for (var ii = 0; ii < MAX_IMPULSES; ii++) {
    impulses[ii] = { alive: 0, x: 0, z: 0, t0: 0, amp: 0, c: 0, sigma: 0, decay: 0 };
  }
  // Threshold below which an impulse's instantaneous amplitude is treated
  // as visually invisible, and the slot is freed. Tuned to ~0.5% of a unit
  // wave — small enough to be invisible after bloom, big enough that we
  // don't keep dead impulses around forever.
  var AMP_FLOOR = 0.0005;

  // Visible footprint for impulse placement, in world space. Camera is at
  // worldZ=8 looking at -z; visible Z stops at ~8. We push the far edge well
  // into the back plane (which is centered at z≈-27) so impulses are actually
  // born on the blue plane — wave speed × decay-lifetime is too short to
  // propagate there from the front zone. The X half-width here is the *near*
  // value; rndPos widens it with depth to cover the back's wider footprint.
  var IMP_X      =  24;
  var IMP_Z_NEAR =   6;
  var IMP_Z_FAR  = -34;

  var currentTime = 0;

  function addImpulse(x, z, t, amp, c, sigma, decay) {
    // Prefer an empty slot. If none, evict the oldest live one — by the
    // time the pool fills, the oldest impulse is almost always the one with
    // the smallest current amplitude, so this rarely produces a visible pop.
    var slot = -1, oldestAge = -Infinity, oldestSlot = 0;
    for (var i = 0; i < MAX_IMPULSES; i++) {
      if (!impulses[i].alive) { slot = i; break; }
      var age = t - impulses[i].t0;
      if (age > oldestAge) { oldestAge = age; oldestSlot = i; }
    }
    if (slot < 0) slot = oldestSlot;
    var imp   = impulses[slot];
    imp.alive = 1;
    imp.x     = x;
    imp.z     = z;
    imp.t0    = t;
    imp.amp   = amp;
    imp.c     = c;
    imp.sigma = sigma;
    imp.decay = decay;
  }

  // True when the user has the symmetry toggle on (default). Read lazily so
  // changes from WE land on the next impulse / render step without restart.
  function isSymmetric() {
    return !window.WE_Props || window.WE_Props.symmetry !== false;
  }

  var _rndPos = [0, 0];
  function rndPos(out) {
    var z = IMP_Z_FAR + Math.random() * (IMP_Z_NEAR - IMP_Z_FAR);
    // Half-width scales with depth so the back plane's perspective-stretched
    // footprint is actually covered. Near edge stays at IMP_X; far edge ~2.4×
    // that, which lines up roughly with the visible half-width at z=IMP_Z_FAR.
    var k     = (IMP_Z_NEAR - z) / (IMP_Z_NEAR - IMP_Z_FAR);
    var halfW = IMP_X * (1 + k * 1.4);
    // Symmetric mode: positive half only, the renderer adds a mirror twin at
    // -x for left/right symmetry. Keeping rndPos one-sided avoids x ≈ 0
    // collapsing the twin onto the source as a doubled axial ridge.
    // Asymmetric mode: place freely across the full visible width — no twin.
    if (isSymmetric()) {
      out[0] = Math.random() * halfW;
    } else {
      out[0] = (Math.random() - 0.5) * 2 * halfW;
    }
    out[1] = z;
  }

  // Single-point sampler — backs heightAt() for any future consumer that
  // needs the surface elevation at one (x, z). updateMeshFromImpulses
  // inlines the same math with an outer-loop-per-impulse layout for
  // batching; this version stays clean for clarity.
  function _impulseSum(worldX, worldZ) {
    var sum = 0;
    var sources = isSymmetric() ? 2 : 1;
    var speed = (window.WE_Props && window.WE_Props.speed) || 1.0;
    for (var i = 0; i < MAX_IMPULSES; i++) {
      var imp = impulses[i];
      if (!imp.alive) continue;
      var tau = currentTime - imp.t0;
      if (tau <= 0) continue;
      var ampNow = imp.amp * Math.exp(-imp.decay * tau);
      if (ampNow < AMP_FLOOR) continue;
      // Wave-front radius rc scales with the user's speed slider — same
      // impulse, faster expansion. Amplitude decay stays on real tau so the
      // visible lifetime of each wave doesn't get shorter when sped up.
      var rc = imp.c * tau * speed;
      var sigma  = imp.sigma;
      var spread = 4 * sigma;                          // 4σ ≈ 1/3000 amp
      var rMaxSq = (rc + spread) * (rc + spread);
      var rMinRaw = rc - spread;
      var rMinSq  = rMinRaw > 0 ? rMinRaw * rMinRaw : 0;
      var inv2Sig2 = 1 / (2 * sigma * sigma);
      var dz = worldZ - imp.z;
      var dz2 = dz * dz;
      // Up to two sources per impulse: (imp.x, imp.z) and, in symmetric mode,
      // its mirror (-imp.x, imp.z). Asymmetric mode drops the second source.
      for (var s = 0; s < sources; s++) {
        var sx = s === 0 ? imp.x : -imp.x;
        var dx = worldX - sx;
        var d2 = dx * dx + dz2;
        if (d2 > rMaxSq || d2 < rMinSq) continue;
        var diff = Math.sqrt(d2) - rc;
        sum += ampNow * Math.exp(-diff * diff * inv2Sig2);
      }
    }
    return sum;
  }

  // World-space height lookup. Same surface the renderer sees, just queried
  // at one point — kept on the public API for future layers that need to
  // sit on or react to the surface.
  function heightAt(worldX, worldZ) {
    var amp = (window.WE_Props && window.WE_Props.amplitude) || 1.0;
    return _impulseSum(worldX, worldZ) * amp;
  }

  // Mesh rewrite. Outer loop per impulse so we only compute per-impulse
  // constants (rc, sigma, bounding ring) once each frame. Inner loop is per
  // vertex, with an annular early-exit before the sqrt + exp.
  function updateMeshFromImpulses(plane) {
    var pos    = plane.geo.attributes.position;
    var posArr = pos.array;
    var count  = pos.count;
    var meshZ  = plane.baseZ;
    var amp    = (window.WE_Props && window.WE_Props.amplitude) || 1.0;
    var speed  = (window.WE_Props && window.WE_Props.speed)     || 1.0;
    var mirror = isSymmetric();

    // Zero pass — every frame is a fresh accumulation; no carry-over.
    for (var v = 0; v < count; v++) posArr[v * 3 + 1] = 0;

    for (var i = 0; i < MAX_IMPULSES; i++) {
      var imp = impulses[i];
      if (!imp.alive) continue;
      var tau = currentTime - imp.t0;
      if (tau <= 0) continue;
      var ampNow = imp.amp * Math.exp(-imp.decay * tau);
      if (ampNow < AMP_FLOOR) { imp.alive = 0; continue; }
      ampNow *= amp;

      // Wave-front radius rc scales with the user's speed slider. Amplitude
      // decay keeps using raw tau so the wave's visible lifetime stays
      // constant — faster waves cover more ground in the same window.
      var rc       = imp.c * tau * speed;
      var sigma    = imp.sigma;
      var inv2Sig2 = 1 / (2 * sigma * sigma);
      var spread   = 4 * sigma;
      var rMaxSq   = (rc + spread) * (rc + spread);
      var rMinRaw  = rc - spread;
      var rMinSq   = rMinRaw > 0 ? rMinRaw * rMinRaw : 0;
      var ix = imp.x, iz = imp.z, ixMirror = -imp.x;

      for (var v2 = 0; v2 < count; v2++) {
        var vx = posArr[v2 * 3];
        var vz = posArr[v2 * 3 + 2];
        var dz = (vz + meshZ) - iz;
        var dz2 = dz * dz;

        // Source A at (ix, iz) — always rendered.
        var dxA = vx - ix;
        var d2A = dxA * dxA + dz2;
        if (d2A <= rMaxSq && d2A >= rMinSq) {
          var diffA = Math.sqrt(d2A) - rc;
          posArr[v2 * 3 + 1] += ampNow * Math.exp(-diffA * diffA * inv2Sig2);
        }
        // Source B at (-ix, iz) — only in symmetric mode (the mirror twin).
        if (mirror) {
          var dxB = vx - ixMirror;
          var d2B = dxB * dxB + dz2;
          if (d2B <= rMaxSq && d2B >= rMinSq) {
            var diffB = Math.sqrt(d2B) - rc;
            posArr[v2 * 3 + 1] += ampNow * Math.exp(-diffB * diffB * inv2Sig2);
          }
        }
      }
    }
    pos.needsUpdate = true;

    // Color pass — base gradient + wave-color add scaled by wave height.
    // Crests (created by audio impulses) drive Y > 0, so peaks tinted by the
    // user's wave color glow over the gradient. The add is also multiplied by
    // the per-vertex depth fade so back-plane crests don't burn through the
    // horizon dim that the static gradient already applied.
    var col     = plane.geo.attributes.color;
    var colArr  = col.array;
    var baseArr = plane.baseColors;
    var fadeArr = plane.depthFade;
    var GAIN    = 1.6;
    for (var v3 = 0; v3 < count; v3++) {
      var y = posArr[v3 * 3 + 1];
      var add = y > 0 ? y * GAIN * fadeArr[v3] : 0;
      var i3 = v3 * 3;
      colArr[i3]     = baseArr[i3]     + add * WAVE_R;
      colArr[i3 + 1] = baseArr[i3 + 1] + add * WAVE_G;
      colArr[i3 + 2] = baseArr[i3 + 2] + add * WAVE_B;
    }
    col.needsUpdate = true;
  }

  // ---------------------------------------------------------------------------
  // Audio → impulse injection
  //
  // Four flavors of kick, layered:
  //   beat  : one (or two) hard impulse on each detected onset — the drum hits
  //   bass  : Bernoulli per frame at a rate proportional to current bass —
  //           the sustained low-end energy stirring the surface
  //   high  : many tiny fast-decay impulses — the "fizz" texture
  //   idle  : periodic gentle stirs when there's no music, so the wallpaper
  //           is never completely flat
  //
  // Each impulse's position is uniform-random across the visible footprint,
  // which is the whole point: no global wave direction, just many local
  // sources, like bubbles surfacing in boiling water.
  // ---------------------------------------------------------------------------
  var WAVE_SPEED = 4.0;
  var prevBeat   = 0;
  var lastIdleT  = 0;

  function injectFromAudio(t) {
    var bass = WE_Audio.bass;
    var high = WE_Audio.high;
    var beat = WE_Audio.beat;
    var idle = WE_Audio.idle;

    // Beat onsets: fire on the rising edge so a single kick produces one
    // event, not a sustained stream across the decay tail.
    if (beat > 0.6 && prevBeat <= 0.6) {
      var nKicks = 1 + (Math.random() < 0.45 ? 1 : 0);
      for (var b = 0; b < nKicks; b++) {
        rndPos(_rndPos);
        addImpulse(_rndPos[0], _rndPos[1], t,
                   0.55 + beat * 0.55, WAVE_SPEED * 1.0, 1.5, 0.85);
      }
    }
    prevBeat = beat;

    // Bass swell — medium impulses, rate scales with current bass level.
    if (bass > 0.18 && Math.random() < bass * 0.12) {
      rndPos(_rndPos);
      addImpulse(_rndPos[0], _rndPos[1], t,
                 0.25 + bass * 0.40, WAVE_SPEED * 0.9, 1.1, 1.1);
    }

    // High-frequency fizz — frequent tiny short-lived ripples.
    if (high > 0.15 && Math.random() < high * 0.20) {
      rndPos(_rndPos);
      addImpulse(_rndPos[0], _rndPos[1], t,
                 0.12 + high * 0.18, WAVE_SPEED * 0.75, 0.6, 1.8);
    }

    // Idle simmer — minimum surface activity when WE_Audio is silent.
    var idleScale = (window.WE_Props && window.WE_Props.idle_motion);
    if (typeof idleScale !== 'number') idleScale = 0.6;
    if (idle > 0.01 && idleScale > 0.001) {
      var idleRate = idle * idleScale * 1.4;       // target impulses / sec
      var dtIdle   = t - lastIdleT;
      if (dtIdle > 0.25 && Math.random() < idleRate * dtIdle) {
        rndPos(_rndPos);
        addImpulse(_rndPos[0], _rndPos[1], t,
                   0.25 * idleScale + 0.10, WAVE_SPEED * 0.8, 1.0, 1.0);
        lastIdleT = t;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Per-frame update
  // ---------------------------------------------------------------------------
  function update(clock) {
    currentTime = clock.getElapsedTime();

    injectFromAudio(currentTime);
    updateMeshFromImpulses(front);
    updateMeshFromImpulses(back);
    // No global mat.color modulation here — per-vertex height-driven glow in
    // updateMeshFromImpulses is doing the audio-reactive brightening now,
    // which means individual lines flash on crests instead of the whole plane
    // dimming/brightening like a background wash.
  }

  // Re-bake the base gradient on both planes. Called by each color setter
  // when WE pushes an updated value; cheap because it runs once per change,
  // not per frame. The live color attribute on each geo picks up the new
  // base on the next per-frame update pass.
  function rebakeGradient() {
    applyDistanceGradient(front.geo, front.baseZ, front.baseColors);
    applyDistanceGradient(back.geo,  back.baseZ,  back.baseColors);
  }

  function setNearColor(r, g, b) {
    schemeR = r * NEAR_BOOST;
    schemeG = g * NEAR_BOOST;
    schemeB = b * NEAR_BOOST;
    rebakeGradient();
  }
  function setMidColor(r, g, b) {
    BRIDGE_R = r; BRIDGE_G = g; BRIDGE_B = b;
    rebakeGradient();
  }
  function setFarColor(r, g, b) {
    COLD_R = r; COLD_G = g; COLD_B = b;
    rebakeGradient();
  }
  function setSunsetColor(r, g, b) {
    SUN_R = r * SUNSET_BOOST;
    SUN_G = g * SUNSET_BOOST;
    SUN_B = b * SUNSET_BOOST;
    rebakeGradient();
  }
  // Wave color tints the height-driven add in the per-frame color pass —
  // no rebake needed because it isn't part of the static gradient.
  function setWaveColor(r, g, b) {
    WAVE_R = r; WAVE_G = g; WAVE_B = b;
  }

  // Seed a handful of partially-aged impulses so the very first rendered
  // frame already has some motion instead of opening on a flat sheet.
  (function seedImpulses() {
    for (var s = 0; s < 6; s++) {
      rndPos(_rndPos);
      addImpulse(_rndPos[0], _rndPos[1],
                 -Math.random() * 0.8,             // born up to 0.8s ago
                 0.4, WAVE_SPEED, 1.0, 1.0);
    }
  })();

  return {
    update:         update,
    setNearColor:   setNearColor,
    setMidColor:    setMidColor,
    setFarColor:    setFarColor,
    setSunsetColor: setSunsetColor,
    setWaveColor:   setWaveColor,
    heightAt:       heightAt
  };
})(WE_Scene.scene);

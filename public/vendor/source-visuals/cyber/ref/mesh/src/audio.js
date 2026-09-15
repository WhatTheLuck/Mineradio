// Wallpaper Engine audio bridge.
//
// WE pushes a Float32Array(128) into the registered callback at ~30 Hz:
//   indices  0–63  → left  channel frequency bins
//   indices 64–127 → right channel frequency bins
//   each value is roughly in 0.0–1.0 (post smoothing applied by WE).
//
// We collapse to mono, then split into three bands the scene reads from:
//   bass  (0–4)    drives terrain height
//   mid   (5–14)   drives terrain scroll speed
//   high  (15–31)  drives star / horizon glow
//   energy(0–31)   drives bloom strength
//
// On top of the raw bands we expose:
//   beat       short pulse (1.0 → decay) when bass spikes above local average
//   idle       0..1, ramps up after a few hundred ms of silence so the scene
//              can fall back to synthetic motion when no music is playing
//   enabled    flipped by WE's general `audioprocessing` flag — when off we
//              fully release every band so the scene goes into pure idle mode
var WE_Audio = (function () {
  var state = {
    bass:    0,
    mid:     0,
    high:    0,
    energy:  0,
    beat:    0,
    // Instantaneous values calculated with the same bin splits and squared
    // energy equations as ref/ribbon/js/main.js. These intentionally are not
    // attack/release smoothed: the original ribbon reacts per audio frame.
    ribbonEnergy:       0,
    ribbonLowEnergy:    0,
    ribbonLowMidEnergy: 0,
    ribbonMidEnergy:    0,
    ribbonHighEnergy:   0,
    ribbonMidAverage:   0,
    ribbonHighBaseline: 0,
    ribbonLowDelta:     0,
    ribbonLowMidDelta:  0,
    ribbonBeat:         0,
    // Direct outputs of ref/ribbon/js/main.js::audio(). These values update
    // once per 128-bin audio callback, just like the Wallpaper Engine source.
    ribbonRgbShift:     0,
    ribbonGlowSize:     0,
    ribbonGlowAmount:   0,
    ribbonLights:       0,
    ribbonTilt:         0,
    ribbonStarPower:    0,
    ribbonStarBrightness: 0,
    ribbonSpeed:        0,
    ribbonCameraZ:      700,
    sourceActive:       false,
    idle:    1,        // start in idle until the first audio frame arrives
    enabled: true,
    raw:     new Float32Array(64)
  };

  // Smoothed targets — the public `state.bass/mid/high/energy` lerp toward
  // these every frame in `step()`. Fast attack so beats land hard, slow
  // release so the visuals don't flicker between bins.
  var target = { bass: 0, mid: 0, high: 0, energy: 0 };

  // Rolling baseline for the bass band. A simple onset detector: when the
  // raw bass jumps well above its own moving average, we kick `state.beat`
  // to 1.0 and let it decay each frame.
  var bassAvg = 0;
  var ribbonLowHistory = [];
  var ribbonLowMidHistory = [];
  var ribbonMidHistory = [];
  var ribbonHighHistory = [];
  var ribbonCameraZ = 700;

  // Wall-clock of the last meaningful audio frame. If WE stops calling us
  // (or every sample is near zero), idle creeps up toward 1.
  var lastAudioMs = 0;

  function avg(arr, from, to) {
    var sum = 0;
    for (var i = from; i <= to; i++) sum += arr[i];
    return sum / (to - from + 1);
  }

  function historyAverage(values) {
    if (!values.length) return 0;
    var sum = 0;
    for (var i = 0; i < values.length; i++) sum += values[i];
    return sum / values.length;
  }

  function appendHistory(values, value, maxLength) {
    values.push(value);
    if (values.length > maxLength) values.shift();
  }

  function squaredEnergy(audioArray, leftFrom, leftTo, rightFrom, rightTo) {
    var energy = 0;
    for (var i = leftFrom; i <= leftTo; i++) energy += audioArray[i] * audioArray[i];
    for (var j = rightFrom; j <= rightTo; j++) energy += audioArray[j] * audioArray[j];
    return energy;
  }

  function mapLinearClamped(value, inputMin, inputMax, outputMin, outputMax) {
    if (inputMax <= inputMin) return value >= inputMax ? outputMax : outputMin;
    var t = Math.max(0, Math.min(1, (value - inputMin) / (inputMax - inputMin)));
    return outputMin + (outputMax - outputMin) * t;
  }

  function onAudio(audioArray) {
    if (!state.enabled) return;
    // A registered Wallpaper Engine callback is itself an active source. The
    // browser input adapters also set this explicitly so stopping them can
    // restore the slower idle drift immediately.
    state.sourceActive = true;

    var sumSamples = 0;
    for (var i = 0; i < 64; i++) {
      var v = (audioArray[i] + audioArray[i + 64]) * 0.5;
      state.raw[i] = v;
      sumSamples += v;
    }

    // WE keeps calling us even on silence (all zeros). Only treat the frame
    // as "real audio" when there's actually signal present.
    if (sumSamples > 0.01) lastAudioMs = (performance && performance.now) ? performance.now() : Date.now();

    var sens = (window.WE_Props && window.WE_Props.sensitivity) || 2.5;
    target.bass   = Math.min(avg(state.raw,  0,  4) * sens, 1.0);
    target.mid    = Math.min(avg(state.raw,  5, 14) * sens, 1.0);
    target.high   = Math.min(avg(state.raw, 15, 31) * sens, 1.0);
    target.energy = Math.min(avg(state.raw,  0, 31) * sens, 1.0);

    // Reference ribbon parity. Its splitArr()/lmhSub()/instantEnergy() path
    // uses bins 0..62 and 63..125, with 21-bin low/mid/high bands.
    var ribbonScale = (window.WE_Ribbon && WE_Ribbon.params) ? WE_Ribbon.params.listenStrength : 1;
    var ribbonEnergyScale = ribbonScale * ribbonScale;
    var totalEnergy = squaredEnergy(audioArray, 0, 62, 63, 125) * ribbonEnergyScale;
    var lowEnergy   = squaredEnergy(audioArray, 0, 20, 63, 83) * ribbonEnergyScale;
    var midEnergy   = squaredEnergy(audioArray, 21, 41, 84, 104) * ribbonEnergyScale;
    var highEnergy  = squaredEnergy(audioArray, 42, 62, 105, 125) * ribbonEnergyScale;
    var lowMidEnergy = lowEnergy + midEnergy;
    var lowBaseline = historyAverage(ribbonLowHistory);
    var lowMidBaseline = historyAverage(ribbonLowMidHistory);
    var highBaseline = historyAverage(ribbonHighHistory);
    var monoMid = 0;
    for (var mi = 21; mi <= 41; mi++) monoMid += (Math.abs(audioArray[mi]) + Math.abs(audioArray[mi + 64])) * 0.5;

    state.ribbonEnergy       = totalEnergy;
    state.ribbonLowEnergy    = lowEnergy;
    state.ribbonLowMidEnergy = lowMidEnergy;
    state.ribbonMidEnergy    = midEnergy;
    state.ribbonHighEnergy   = highEnergy;
    state.ribbonMidAverage   = monoMid / 21;
    state.ribbonHighBaseline = highBaseline;
    state.ribbonLowDelta     = lowEnergy - lowBaseline;
    state.ribbonLowMidDelta  = lowMidEnergy - lowMidBaseline;

    var ribbon = (window.WE_Ribbon && WE_Ribbon.params) ? WE_Ribbon.params : null;
    if (ribbon) {
      // Beat/dub and camera equations are intentionally callback-driven.
      // The reference subtracts fade once per WE audio frame, not per render.
      var sharedTriggerThreshold = typeof ribbon.rgbShiftSensitivity === 'number' ? ribbon.rgbShiftSensitivity : 1.1;
      var sharedTriggerMax = typeof ribbon.sharedTriggerMax === 'number'
        ? Math.max(sharedTriggerThreshold + 0.01, ribbon.sharedTriggerMax)
        : Math.max(sharedTriggerThreshold + 0.01, 4);
      var sharedTriggerLevel = mapLinearClamped(
        state.ribbonLowMidDelta,
        sharedTriggerThreshold,
        sharedTriggerMax,
        0,
        1
      );
      state.ribbonBeat = sharedTriggerLevel;
      if (ribbon.cameraDrop) {
        var cameraDropSpeed = typeof ribbon.cameraDropSpeed === 'number' ? ribbon.cameraDropSpeed : 1;
        // Both effects use the same 0..1 value. Camera speed only controls
        // how quickly its position catches the shared linear target.
        var cameraTargetZ = 1000 - sharedTriggerLevel * 300;
        var cameraFollow = 1 - Math.pow(0.9, cameraDropSpeed);
        ribbonCameraZ += (cameraTargetZ - ribbonCameraZ) * cameraFollow;
      }

      state.ribbonRgbShift = ribbon.rgbShift
        ? sharedTriggerLevel * 0.1 * ribbon.rgbShiftScale
        : 0;
      state.ribbonGlowSize = ribbon.glow
        ? Math.max(0, Math.min(1, totalEnergy * 0.5 * ribbon.glowSizeScale))
        : 0;
      state.ribbonGlowAmount = ribbon.glow
        ? Math.max(0, Math.min(1, totalEnergy * 0.5 * ribbon.glowAmountScale))
        : 0;
      state.ribbonLights = ribbon.bloomAudio
        ? Math.max(0, Math.min(0.3, midEnergy * 0.2 * ribbon.bloomScale))
        : 0;
      state.ribbonTilt = ribbon.tiltAudio
        ? Math.max(0, Math.min(1, state.ribbonMidAverage * 0.5 * ribbon.tiltScale))
        : 0;
      state.ribbonStarPower = ribbon.starsAudio ? highBaseline * 0.5 : 0;
      var starEnergyMin = typeof ribbon.starEnergyThreshold === 'number' ? ribbon.starEnergyThreshold : 0.35;
      var starEnergyMax = typeof ribbon.starEnergyMax === 'number'
        ? Math.max(starEnergyMin + 0.01, ribbon.starEnergyMax)
        : Math.max(starEnergyMin + 0.01, 0.65);
      state.ribbonStarBrightness = ribbon.starsAudio
        ? mapLinearClamped(totalEnergy, starEnergyMin, starEnergyMax, 0, 1)
        : 0;
      var motionThreshold = typeof ribbon.audioMotionThreshold === 'number' ? ribbon.audioMotionThreshold : 0;
      var energyMax = typeof ribbon.audioEnergyMax === 'number'
        ? Math.max(motionThreshold + 0.01, ribbon.audioEnergyMax)
        : Math.max(motionThreshold + 0.01, 2);
      var speedMin = typeof ribbon.audioSpeedMin === 'number' ? ribbon.audioSpeedMin : ribbon.ribbonSpeed;
      var speedMax = typeof ribbon.audioSpeedMax === 'number' ? ribbon.audioSpeedMax : 0.0015;
      if (speedMax < speedMin) {
        var swappedSpeed = speedMin;
        speedMin = speedMax;
        speedMax = swappedSpeed;
      }
      state.ribbonSpeed = ribbon.audioSync && totalEnergy >= motionThreshold
        ? mapLinearClamped(totalEnergy, motionThreshold, energyMax, speedMin, speedMax)
        : ribbon.ribbonSpeed;
      state.ribbonCameraZ = ribbonCameraZ;
    }

    appendHistory(ribbonLowHistory, lowEnergy, 43);
    appendHistory(ribbonLowMidHistory, lowMidEnergy, 43);
    appendHistory(ribbonMidHistory, midEnergy, 43);
    appendHistory(ribbonHighHistory, highEnergy, 3);

    // Onset detector. Threshold of 1.5× the moving baseline + minimum
    // absolute level keeps quiet ambient sections from spamming pulses.
    bassAvg = bassAvg * 0.92 + target.bass * 0.08;
    if (target.bass > bassAvg * 1.5 && target.bass > 0.35) {
      state.beat = 1.0;
    }
  }

  // Frame-driven smoothing. Called by main.js once per rendered frame with
  // dt in seconds. Doing the lerp here (not in the WE callback) keeps the
  // visuals smooth regardless of how often WE actually pushes audio.
  function step(dt) {
    // Attack/release factors are roughly "per 60fps frame at unit dt".
    // dt-scaled so the response feels the same when fps is throttled.
    var k = Math.min(dt * 60, 3);
    var attack  = 1 - Math.pow(1 - 0.40, k);
    var release = 1 - Math.pow(1 - 0.08, k);

    state.bass   += (target.bass   - state.bass)   * (target.bass   > state.bass   ? attack : release);
    state.mid    += (target.mid    - state.mid)    * (target.mid    > state.mid    ? attack : release);
    state.high   += (target.high   - state.high)   * (target.high   > state.high   ? attack : release);
    state.energy += (target.energy - state.energy) * (target.energy > state.energy ? attack : release);

    state.beat *= Math.pow(0.88, k);
    state.ribbonBeat *= Math.pow(0.72, k);
    if (state.beat < 0.001) state.beat = 0;

    // Idle ramps up after ~600 ms of silence and saturates at 1.0 around 1.5 s.
    var now = (performance && performance.now) ? performance.now() : Date.now();
    var silenceMs = now - lastAudioMs;
    var idleTarget = state.enabled ? Math.max(0, Math.min(1, (silenceMs - 600) / 900)) : 1;
    state.idle += (idleTarget - state.idle) * (idleTarget > state.idle ? release : attack);
  }

  function setEnabled(on) {
    state.enabled = !!on;
    if (!on) {
      target.bass = target.mid = target.high = target.energy = 0;
      state.beat = 0;
      state.ribbonEnergy = state.ribbonLowEnergy = state.ribbonLowMidEnergy = state.ribbonMidEnergy = state.ribbonHighEnergy = 0;
      state.ribbonMidAverage = state.ribbonHighBaseline = state.ribbonLowDelta = state.ribbonLowMidDelta = state.ribbonBeat = 0;
      state.ribbonRgbShift = 0;
      state.ribbonGlowSize = state.ribbonGlowAmount = state.ribbonLights = state.ribbonTilt = 0;
      state.ribbonStarPower = state.ribbonStarBrightness = state.ribbonSpeed = 0;
      // Force idle to ramp immediately — silence is now the steady state.
      lastAudioMs = 0;
    }
  }

  function setSourceActive(on) {
    state.sourceActive = !!on;
    if (!on) {
      target.bass = target.mid = target.high = target.energy = 0;
      state.ribbonEnergy = state.ribbonLowEnergy = state.ribbonLowMidEnergy = state.ribbonMidEnergy = state.ribbonHighEnergy = 0;
      state.ribbonMidAverage = state.ribbonHighBaseline = state.ribbonLowDelta = state.ribbonLowMidDelta = state.ribbonBeat = 0;
      state.ribbonRgbShift = 0;
      state.ribbonGlowSize = state.ribbonGlowAmount = state.ribbonLights = state.ribbonTilt = 0;
      state.ribbonStarPower = state.ribbonStarBrightness = state.ribbonSpeed = 0;
    }
  }

  if (typeof window.wallpaperRegisterAudioListener === 'function') {
    window.wallpaperRegisterAudioListener(onAudio);
  }

  state.step       = step;
  state.setEnabled = setEnabled;
  state.setSourceActive = setSourceActive;
  return state;
})();

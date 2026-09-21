'use strict';

// Camera pixels never reach the stage or renderer persistence. A compressed snapshot
// crosses the trusted Electron bridge only when SiliconFlow VLM analysis runs.
var MineradioEmoMusic = (function () {
  var PRESET_INDEX = 15;
  var MEDIAPIPE_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/';
  var FACE_LOSS_GRACE_MS = 900;
  var canvas, ctx, video, stream, faceMesh, panel, hud;
  var active = false, starting = false, inferenceBusy = false, raf = 0, epoch = 0;
  var latestLandmarks, smoothLandmarks, lastFaceAt = 0, lastInferenceAt = 0, failure = '';
  var transform = { cx: .5, cy: .5, scale: 1 };
  var inputAspect = 4 / 3;
  var view = { yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0 };
  var lastCanvasWidth = 0, lastCanvasHeight = 0, lastFrame;
  var featureIndexSet, cachedTriangles, cachedGraph, rippleBursts = [];
  var rmsPeakState = createRmsPeakState();
  var peakVisualState = { power: 0, born: -99 };
  var telemetry, telemetryAt = 0, telemetryError = '', telemetryTimer = 0, faceLossTimer = 0, vlmReady = false, vlmCaptureCanvas;
  var fallbackCurve = [], fallbackScores = null, vlmCurve = [];
  var hudMotion = { scores: {}, curve: [], prompts: [], lastAt: 0 };
  var gazeState = createGazeState();

  var CAMERA_PROFILES = {
    eco: { width: 640, height: 480, frameRate: 24, label: '轻量 640×480 · 24 FPS' },
    balanced: { width: 960, height: 720, frameRate: 30, label: '均衡 960×720 · 30 FPS' },
    detail: { width: 1280, height: 720, frameRate: 30, label: '精细 1280×720 · 30 FPS' }
  };
  var EYES = [
    { corners: [33, 133], lids: [159, 145], center: 468, ring: [469, 470, 471, 472] },
    { corners: [362, 263], lids: [386, 374], center: 473, ring: [474, 475, 476, 477] }
  ];

  var EMOTION_DIMENSIONS = [
    { key: 'tension_relaxation', negative: 'Tension', positive: 'Relaxation', angleDown: 200, negativeTag: 'calm breathing', positiveTag: 'relaxed atmosphere' },
    { key: 'anger_calmness', negative: 'Anger', positive: 'Calmness', angleDown: 235, negativeTag: 'warm release', positiveTag: 'gentle rhythm' },
    { key: 'irritation_leisure', negative: 'Irritation', positive: 'Leisure', angleDown: 270, negativeTag: 'smooth groove', positiveTag: 'light texture' },
    { key: 'sadness_happiness', negative: 'Sadness', positive: 'Happiness', angleDown: 305, negativeTag: 'uplifting harmony', positiveTag: 'bright warmth' },
    { key: 'sleepiness_energy', negative: 'Sleepiness', positive: 'Energy', angleDown: 340, negativeTag: 'refreshing beat', positiveTag: 'vivid pulse' }
  ];

  var defaults = {
    mode: 'particles', particleSize: .9, motionStrength: 1.25,
    meshLineWidth: .35, meshDensity: 5, surfaceOpacity: .85, surfaceSpecular: 0, surfaceMeshOverlay: false,
    dispersion: true,
    dispersionBandLowHz: 64, dispersionBandHighHz: 653,
    dispersionTriggerLow: .79, dispersionTriggerHigh: .97,
    dispersionEffectLow: 2.8, dispersionEffectHigh: 12,
    peakSensitivity: .5,
    ripple: true, rippleStrength: .35, rippleSpeed: 1.35, rippleWidth: .35,
    shake: true, shakeStrength: .3,
    flash: true, flashStrength: .5,
    particleBrightness: 1.15,
    lasers: true, laserDirection: 'lyrics', laserStrength: .7, laserWidth: 3.3, laserLength: 1.65,
    galaxy: true, galaxyDensity: .15,
    eyeTracking: true, gazeOverlay: true, cameraProfile: 'eco',
    gazeSmoothing: .45, gazeDeadzone: .1,
    gazeCenterX: .006028199398630182, gazeCenterY: -.054092100642267105,
    gazeOffsetX: -.08, gazeOffsetY: .14,
    telemetry: true, telemetryMode: 'vlm', pollSeconds: 10
  };
  // File presets saved through the desktop bridge are the only persisted
  // parameter source. Until the newest saved preset is read, use defaults.
  var settings = normalizeSettings();

  function clamp(v, a, b) { return Math.max(a, Math.min(b, Number(v) || 0)); }
  function sourceAspect(width, height) {
    width = Number(width); height = Number(height);
    return width > 0 && height > 0 ? width / height : 4 / 3;
  }
  function cameraSourceAspect() {
    if (video && video.videoWidth > 0 && video.videoHeight > 0) return sourceAspect(video.videoWidth, video.videoHeight);
    var track = stream && stream.getVideoTracks && stream.getVideoTracks()[0];
    var trackSettings = track && track.getSettings && track.getSettings();
    return sourceAspect(trackSettings && trackSettings.width, trackSettings && trackSettings.height);
  }
  function projectFacePoint(point, center, scale, aspect) {
    aspect = Number(aspect) > 0 ? Number(aspect) : 4 / 3;
    return {
      x: (center.cx - point.x) * aspect * scale,
      y: (point.y - center.cy) * scale,
      // MediaPipe defines z in approximately the same scale as x.
      z: (point.z || 0) * aspect * scale
    };
  }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function normalizeSettings(value) {
    value = Object.assign({}, defaults, value || {});
    value.meshDensity = Math.round(clamp(value.meshDensity, 1, 5));
    value.dispersionBandLowHz = clamp(value.dispersionBandLowHz, 20, 780);
    value.dispersionBandHighHz = clamp(value.dispersionBandHighHz, value.dispersionBandLowHz + 10, 800);
    value.dispersionTriggerLow = clamp(value.dispersionTriggerLow, 0, .99);
    value.dispersionTriggerHigh = clamp(value.dispersionTriggerHigh, value.dispersionTriggerLow + .01, 1);
    value.dispersionEffectLow = clamp(value.dispersionEffectLow, 0, 12);
    value.dispersionEffectHigh = clamp(value.dispersionEffectHigh, value.dispersionEffectLow, 12);
    value.peakSensitivity = clamp(value.peakSensitivity, .4, 2.5);
    value.rippleWidth = clamp(value.rippleWidth, .01, 2);
    value.laserWidth = clamp(value.laserWidth, .4, 8);
    if (value.laserDirection !== 'face' && value.laserDirection !== 'lyrics') value.laserDirection = 'gaze';
    if (!CAMERA_PROFILES[value.cameraProfile]) value.cameraProfile = 'eco';
    value.gazeSmoothing = clamp(value.gazeSmoothing, .05, .8);
    value.gazeDeadzone = clamp(value.gazeDeadzone, .03, .35);
    value.gazeCenterX = clamp(value.gazeCenterX, -1, 1);
    value.gazeCenterY = clamp(value.gazeCenterY, -1, 1);
    value.gazeOffsetX = clamp(value.gazeOffsetX, -.6, .6);
    value.gazeOffsetY = clamp(value.gazeOffsetY, -.6, .6);
    value.pollSeconds = Math.round(clamp(value.pollSeconds, 1, 60));
    if (value.telemetryMode !== 'random') value.telemetryMode = 'vlm';
    delete value.endpoint;
    return value;
  }
  function hostVisible() {
    if (typeof desktopRuntimeState === 'object' && desktopRuntimeState && desktopRuntimeState.desktop) {
      if (desktopRuntimeState.embedded === true || desktopRuntimeState.interactive === true) return true;
      return desktopRuntimeState.minimized !== true && desktopRuntimeState.visible !== false;
    }
    return !document.hidden;
  }
  function hasDetectedFace(now) {
    now = Number(now);
    if (!isFinite(now)) now = performance.now();
    return !!(latestLandmarks && lastFaceAt > 0 && now - lastFaceAt <= FACE_LOSS_GRACE_MS);
  }

  function ensureCanvas() {
    if (canvas) return canvas;
    canvas = document.createElement('canvas');
    canvas.id = 'emomusic-face-canvas';
    canvas.className = 'external-visual-canvas emomusic-face-canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'EmoMusic 三维情绪面部可视化；拖动同步旋转面部与歌词视角');
    canvas.addEventListener('mousedown', function (e) {
      if (!active || e.button === 2 || (e.target.closest && e.target.closest('#fx-panel,#bottom-bar,#top-right,#playlist-panel,.emomusic-telemetry'))) return;
      if (typeof beginParticlePointerDrag === 'function') beginParticlePointerDrag(e);
    });
    document.getElementById('canvas-container').appendChild(canvas);
    ctx = canvas.getContext('2d', { alpha: false });
    ensureHud();
    return canvas;
  }

  function resizeCanvas() {
    ensureCanvas();
    var dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    var w = Math.max(1, Math.round(innerWidth * dpr)), h = Math.max(1, Math.round(innerHeight * dpr));
    if (w === lastCanvasWidth && h === lastCanvasHeight) return;
    lastCanvasWidth = canvas.width = w; lastCanvasHeight = canvas.height = h;
    canvas.style.width = innerWidth + 'px'; canvas.style.height = innerHeight + 'px';
  }

  function inferenceInterval() {
    var quality = typeof fx === 'object' && String(fx.performanceQuality || 'eco');
    return quality === 'ultra' || quality === 'high' ? 34 : quality === 'balanced' ? 46 : 64;
  }
  function interpolationProfile() {
    var quality = typeof fx === 'object' && String(fx.performanceQuality || 'eco');
    return quality === 'ultra' ? { stride: 1, steps: 2 } : quality === 'high' ? { stride: 1, steps: 1 } : quality === 'balanced' ? { stride: 2, steps: 1 } : { stride: 4, steps: 1 };
  }
  function interpolateMesh(landmarks, edges, stride, steps) {
    var points = landmarks ? landmarks.slice() : [];
    if (!landmarks || !edges) return points;
    stride = Math.max(1, Math.round(Number(stride) || 1)); steps = Math.max(0, Math.round(Number(steps) || 0));
    for (var i = 0; i < edges.length; i += stride) {
      var edge = edges[i], a = landmarks[edge[0]], b = landmarks[edge[1]]; if (!a || !b) continue;
      for (var n = 1; n <= steps; n++) { var t = n / (steps + 1); points.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: (a.z || 0) + ((b.z || 0) - (a.z || 0)) * t, sourceIndex: edge[0] }); }
    }
    return points;
  }
  function featureIndices() {
    if (featureIndexSet) return featureIndexSet;
    featureIndexSet = {};
    ['FACEMESH_LIPS', 'FACEMESH_LEFT_EYE', 'FACEMESH_RIGHT_EYE', 'FACEMESH_LEFT_EYEBROW', 'FACEMESH_RIGHT_EYEBROW', 'FACEMESH_LEFT_IRIS', 'FACEMESH_RIGHT_IRIS'].forEach(function (name) {
      (window[name] || []).forEach(function (edge) { featureIndexSet[edge[0]] = featureIndexSet[edge[1]] = true; });
    });
    return featureIndexSet;
  }
  function smoothFace(landmarks) {
    if (!smoothLandmarks || smoothLandmarks.length !== landmarks.length) { smoothLandmarks = landmarks.map(function (p) { return { x: p.x, y: p.y, z: p.z || 0 }; }); return smoothLandmarks; }
    landmarks.forEach(function (p, i) { smoothLandmarks[i].x += (p.x - smoothLandmarks[i].x) * .38; smoothLandmarks[i].y += (p.y - smoothLandmarks[i].y) * .38; smoothLandmarks[i].z += ((p.z || 0) - smoothLandmarks[i].z) * .38; });
    return smoothLandmarks;
  }
  function createGazeState() {
    return { valid: false, x: 0, y: 0, rawX: 0, rawY: 0, confidence: 0, direction: '未识别', pupils: [], pupilRatio: 0, updatedAt: 0 };
  }
  function cameraConstraints(profile) {
    var selected = CAMERA_PROFILES[profile] || CAMERA_PROFILES.eco;
    return { audio: false, video: { facingMode: 'user', width: { ideal: selected.width }, height: { ideal: selected.height }, frameRate: { ideal: selected.frameRate, max: selected.frameRate } } };
  }
  function eyeMeasurement(landmarks, definition, aspect) {
    var a=landmarks&&landmarks[definition.corners[0]],b=landmarks&&landmarks[definition.corners[1]],top=landmarks&&landmarks[definition.lids[0]],bottom=landmarks&&landmarks[definition.lids[1]],center=landmarks&&landmarks[definition.center];
    if(!a||!b||!top||!bottom||!center)return null;
    aspect=Number(aspect)>0?Number(aspect):4/3;
    var vx=(b.x-a.x)*aspect,vy=b.y-a.y,width=Math.sqrt(vx*vx+vy*vy);
    var tx=(bottom.x-top.x)*aspect,ty=bottom.y-top.y,height=Math.sqrt(tx*tx+ty*ty);
    if(width<.008||height<.002)return null;
    var midX=(a.x+b.x)*.5,midY=(a.y+b.y)*.5,dx=(center.x-midX)*aspect,dy=center.y-midY;
    var lidMidX=(top.x+bottom.x)*.5,lidMidY=(top.y+bottom.y)*.5,ldx=(center.x-lidMidX)*aspect,ldy=center.y-lidMidY;
    var radius=0;
    definition.ring.forEach(function(index){var point=landmarks[index];if(point)radius+=Math.hypot((point.x-center.x)*aspect,point.y-center.y);});
    radius/=definition.ring.length;
    return { horizontal:(dx*vx+dy*vy)/(width*width)*2, vertical:(ldx*tx+ldy*ty)/(height*height)*2, openness:height/width, pupilRatio:radius/width, pupil:{x:center.x,y:center.y,z:center.z||0} };
  }
  function gazeDirection(x,y,deadzone) {
    deadzone=clamp(deadzone,.03,.35);var ax=Math.abs(x),ay=Math.abs(y);
    if(ax<deadzone&&ay<deadzone)return '中央';
    if(ax>ay*1.2)return x<0?'左':'右';
    if(ay>ax*1.2)return y<0?'上':'下';
    return (y<0?'上':'下')+(x<0?'左':'右');
  }
  function estimateGaze(landmarks, aspect, calibration, deadzone) {
    var eyes=EYES.map(function(definition){return eyeMeasurement(landmarks,definition,aspect);}).filter(Boolean);
    if(!eyes.length)return createGazeState();
    var horizontal=0,vertical=0,pupilRatio=0,confidence=0;
    eyes.forEach(function(eye){horizontal+=eye.horizontal;vertical+=eye.vertical;pupilRatio+=eye.pupilRatio;confidence+=clamp((eye.openness-.055)/.16,0,1);});
    horizontal/=eyes.length;vertical/=eyes.length;pupilRatio/=eyes.length;confidence/=eyes.length;
    if(eyes.length===2)confidence*=clamp(1-Math.abs(eyes[0].horizontal-eyes[1].horizontal)*.9-Math.abs(eyes[0].vertical-eyes[1].vertical)*.55,.15,1);
    // The webcam image is not mirrored in landmark space; invert horizontal so
    // labels describe the performer's own left/right gaze.
    var rawX=clamp(-horizontal,-1,1),rawY=clamp(vertical*.58,-1,1),x=clamp(rawX-Number(calibration&&calibration.x||0),-1,1),y=clamp(rawY-Number(calibration&&calibration.y||0),-1,1);
    return { valid:confidence>.08,x:x,y:y,rawX:rawX,rawY:rawY,confidence:confidence,direction:gazeDirection(x,y,deadzone),pupils:eyes.map(function(eye){return eye.pupil;}),pupilRatio:pupilRatio,updatedAt:0 };
  }
  function applyGazeOffset(sample,offsetX,offsetY,deadzone) {
    if(!sample||!sample.valid)return sample;
    sample.x=clamp(Number(sample.x)+Number(offsetX||0),-1,1);
    sample.y=clamp(Number(sample.y)+Number(offsetY||0),-1,1);
    sample.direction=gazeDirection(sample.x,sample.y,deadzone);
    return sample;
  }
  function smoothGaze(previous,next,alpha) {
    if(!next||!next.valid)return createGazeState();
    alpha=clamp(alpha,.05,.8);previous=previous&&previous.valid?previous:createGazeState();var first=!previous.valid;
    next.x=first?next.x:previous.x+(next.x-previous.x)*alpha;next.y=first?next.y:previous.y+(next.y-previous.y)*alpha;next.confidence=first?next.confidence:previous.confidence+(next.confidence-previous.confidence)*alpha;next.pupilRatio=first?next.pupilRatio:previous.pupilRatio+(next.pupilRatio-previous.pupilRatio)*alpha;
    if(!first&&previous.pupils&&previous.pupils.length===next.pupils.length)next.pupils=next.pupils.map(function(point,index){var old=previous.pupils[index];return{x:old.x+(point.x-old.x)*alpha,y:old.y+(point.y-old.y)*alpha,z:(old.z||0)+((point.z||0)-(old.z||0))*alpha};});
    next.direction=gazeDirection(next.x,next.y,settings.gazeDeadzone);return next;
  }
  function updateGaze(landmarks,now) {
    if(!settings.eyeTracking)return;
    // Face Mesh already emits refined iris landmarks. Keep this inexpensive
    // circle-center calculation on every result instead of adding a second
    // camera pass, pixel scan, model, or gaze-specific frame limiter.
    now=Number(now)||performance.now();
    var next=estimateGaze(landmarks,cameraSourceAspect(),{x:settings.gazeCenterX,y:settings.gazeCenterY},settings.gazeDeadzone);applyGazeOffset(next,settings.gazeOffsetX,settings.gazeOffsetY,settings.gazeDeadzone);next.updatedAt=now;gazeState=smoothGaze(gazeState,next,settings.gazeSmoothing);
    if(gazeState.valid)window.dispatchEvent(new CustomEvent('mineradio-gaze-update',{detail:{x:gazeState.x,y:gazeState.y,confidence:gazeState.confidence,direction:gazeState.direction,pupilRatio:gazeState.pupilRatio}}));
  }
  function fitTransform(points) {
    var minX = 1, maxX = 0, minY = 1, maxY = 0;
    points.forEach(function (p) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); });
    var faceW = Math.max(.12, maxX - minX) * inputAspect, faceH = Math.max(.16, maxY - minY);
    transform.cx += ((minX + maxX) * .5 - transform.cx) * .12; transform.cy += ((minY + maxY) * .5 - transform.cy) * .12;
    transform.scale += (Math.min(2.7, Math.max(1.05, Math.min(.58 / faceW, .76 / faceH))) - transform.scale) * .1;
  }
  function meshTriangles(edges) {
    if (cachedTriangles) return cachedTriangles;
    cachedTriangles = [];
    for (var i = 0; i + 2 < edges.length; i += 3) {
      var unique = {}, indices = [];
      for (var e = 0; e < 3; e++) {
        var edge = edges[i + e] || [];
        for (var n = 0; n < 2; n++) if (edge[n] != null && !unique[edge[n]]) { unique[edge[n]] = true; indices.push(edge[n]); }
      }
      if (indices.length === 3) cachedTriangles.push(indices);
    }
    return cachedTriangles;
  }
  function meshGraph(edges, count) {
    if (cachedGraph && cachedGraph.length === count) return cachedGraph;
    cachedGraph = Array.from({ length: count }, function () { return []; });
    (edges || []).forEach(function (edge) {
      var a = edge[0], b = edge[1];
      if (cachedGraph[a] && cachedGraph[b]) { cachedGraph[a].push(b); cachedGraph[b].push(a); }
    });
    return cachedGraph;
  }
  function meshHopDistances(origin, count) {
    var graph = meshGraph(window.FACEMESH_TESSELATION || [], count), distance = new Int16Array(count), queue = [origin];
    distance.fill(-1); distance[origin] = 0;
    for (var q = 0; q < queue.length; q++) {
      var at = queue[q], next = graph[at] || [];
      for (var i = 0; i < next.length; i++) if (distance[next[i]] < 0) { distance[next[i]] = distance[at] + 1; queue.push(next[i]); }
    }
    return distance;
  }
  function createRmsPeakState() {
    return { floor: 0, crest: .04, previous: 0, candidate: 0, candidateAt: 0, lastHit: -99 };
  }
  function timeDomainRms(data) {
    if (!data || !data.length) return 0;
    var sum = 0, count = 0, stride = Math.max(1, Math.floor(data.length / 512));
    for (var i = 0; i < data.length; i += stride) {
      var value = Number(data[i]);
      if (!isFinite(value)) continue;
      value = data instanceof Float32Array || data instanceof Float64Array ? value : (value - 128) / 128;
      sum += value * value; count++;
    }
    return count ? Math.sqrt(sum / count) : 0;
  }
  function frequencyBandRms(data, sampleRate, fftSize, lowHz, highHz) {
    if (!data || !data.length) return 0;
    sampleRate = Math.max(1, Number(sampleRate) || 44100); fftSize = Math.max(2, Number(fftSize) || data.length * 2);
    var hzPerBin = sampleRate / fftSize;
    var start = clamp(Math.floor(Math.min(lowHz, highHz) / hzPerBin), 0, data.length - 1);
    var end = clamp(Math.ceil(Math.max(lowHz, highHz) / hzPerBin), start + 1, data.length);
    var sum = 0, count = 0;
    for (var i = start; i < end; i++) { var value = clamp(Number(data[i]) / 255, 0, 1); sum += value * value; count++; }
    return count ? Math.sqrt(sum / count) : 0;
  }
  function linearThresholdMap(level, triggerLow, triggerHigh, effectLow, effectHigh) {
    level = clamp(level, 0, 1);
    triggerLow = clamp(triggerLow, 0, .99);
    triggerHigh = clamp(triggerHigh, triggerLow + .01, 1);
    if (level <= triggerLow) return 0;
    var t = clamp((level - triggerLow) / (triggerHigh - triggerLow), 0, 1);
    return Number(effectLow) + (Number(effectHigh) - Number(effectLow)) * t;
  }
  function peakPowerMap(power, effectLow, effectHigh) {
    var intensity = clamp((Number(power) - .48) / 1.02, 0, 1);
    return Number(effectLow) + (Number(effectHigh) - Number(effectLow)) * intensity;
  }
  function stepRmsPeakDetector(state, rms, time, sensitivity) {
    state = state || createRmsPeakState(); rms = clamp(rms, 0, 1); time = Number(time) || 0;
    sensitivity = clamp(sensitivity == null ? 1 : sensitivity, .4, 2.5);
    if (!state.floor && !state.previous) state.floor = rms;
    state.floor += (rms - state.floor) * (rms > state.floor ? .018 : .075);
    state.crest = Math.max(.04, rms, state.crest * .993);
    var thresholdScale = 1 / (.55 + sensitivity * .45);
    var threshold = Math.max(.008, state.floor * 1.34 * thresholdScale, state.crest * .34 * thresholdScale);
    var hit = false, power = 0;
    if (rms >= state.previous && rms > threshold) {
      if (rms >= state.candidate) { state.candidate = rms; state.candidateAt = time; }
    } else if (state.candidate > threshold && state.previous < state.candidate + .0001) {
      if (time - state.lastHit >= .14) {
        hit = true;
        power = .48 + clamp((state.candidate - threshold) / Math.max(.025, state.crest - threshold), 0, 1) * 1.02;
        state.lastHit = time;
      }
      state.candidate = 0;
    }
    if (state.candidate && time - state.candidateAt > .22) state.candidate = 0;
    state.previous = rms;
    return { hit: hit, power: power, threshold: threshold, rms: rms, state: state };
  }
  function rippleSample(index, time) {
    var response = 0;
    for (var i = 0; i < rippleBursts.length; i++) {
      var burst = rippleBursts[i], age = time - burst.born, hop = burst.distance[index];
      if (hop < 0) continue;
      var front = age * 18 * settings.rippleSpeed;
      var width = 1.35 + settings.rippleWidth * 2.1;
      response += Math.exp(-Math.pow((hop - front) / width, 2)) * burst.power * (1 - age / 1.55);
    }
    return clamp(response, 0, 1.8);
  }
  function mapPoint(point, w, h, audio, index, ripple) {
    var scale = Math.min(w, h * 1.22), projected = projectFacePoint(point, transform, transform.scale, inputAspect), x = projected.x, y = projected.y, z = projected.z;
    ripple = Number(ripple) || 0;
    // The ripple lifts the mesh perpendicular to the face plane. There is no
    // perpetual sine/random motion: displacement exists only after an RMS peak.
    z -= ripple * settings.rippleStrength * settings.motionStrength * .034;
    var cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), cx = Math.cos(view.pitch), sx = Math.sin(view.pitch);
    var rx = x * cy - z * sy, rz = x * sy + z * cy, ry = y * cx - rz * sx; rz = y * sx + rz * cx;
    var perspective = clamp(1 / (1 + rz * .72), .58, 1.55);
    return { x: w * .5 + rx * scale * perspective, y: h * .5 + ry * scale * perspective, z: rz, p: perspective };
  }

  function faceAudioLight(audio) {
    return clamp((audio.rms * 1.4 + audio.energy * .28) * settings.particleBrightness, 0, 1.4);
  }
  function traceConnections(base, edges, w, h, audio, time, offset, minBucket, maxBucket) {
    ctx.beginPath();
    for (var i = 0; i < edges.length; i++) {
      var edge = edges[i], a = base[edge[0]], b = base[edge[1]];
      if (!a || !b) continue;
      var ra = rippleSample(edge[0], time), rb = rippleSample(edge[1], time);
      var bucket = Math.min(3, Math.floor(clamp(Math.max(ra, rb) / 1.5, 0, .999) * 4));
      if (bucket < minBucket || bucket > maxBucket) continue;
      var pa = mapPoint(a, w, h, audio, edge[0], ra), pb = mapPoint(b, w, h, audio, edge[1], rb);
      ctx.moveTo(pa.x + offset, pa.y); ctx.lineTo(pb.x + offset, pb.y);
    }
  }
  function drawConnectionSet(base, edges, w, h, audio, time, rgb, alpha, width) {
    for (var bucket = 0; bucket < 4; bucket++) {
      traceConnections(base, edges, w, h, audio, time, 0, bucket, bucket);
      var lift = bucket / 3;
      ctx.strokeStyle = 'rgba(' + rgb.join(',') + ',' + clamp(alpha + lift * .48 * settings.particleBrightness, 0, 1) + ')';
      ctx.lineWidth = width * (1 + lift * .48); ctx.stroke();
    }
  }
  function drawDenseMeshPoints(base, edges, w, h, audio, time) {
    var level = Math.max(1, Math.min(5, Math.round(settings.meshDensity)));
    var stride = level === 1 ? 4 : level === 2 ? 2 : 1;
    var points = base.filter(function (_, index) { return index % stride === 0; });
    if (level > 3) points = interpolateMesh(base, edges, 1, level - 3);
    var light = faceAudioLight(audio), size = Math.max(.7, Math.min(w, h) / 1700) * settings.meshLineWidth;
    ctx.save(); ctx.globalCompositeOperation = 'source-over';
    points.forEach(function (point, index) {
      var source = point.sourceIndex == null ? index * stride : point.sourceIndex;
      var ripple = rippleSample(source, time), mapped = mapPoint(point, w, h, audio, source, ripple);
      var brightness = clamp(.30 + light * .18 + ripple * .34 * settings.particleBrightness, .24, .94);
      ctx.fillStyle = 'rgba(218,240,247,' + brightness + ')';
      ctx.beginPath();ctx.arc(mapped.x,mapped.y,size*(level >= 4 ? .62 : .82),0,Math.PI*2);ctx.fill();
    });
    ctx.restore();
    return points.length;
  }
  function drawMeshMode(base, w, h, audio, time) {
    var edges = window.FACEMESH_TESSELATION || [];
    var light = faceAudioLight(audio), chroma = audio.dispersion * Math.max(1, w / 1200);
    var line = Math.max(.55, w / 2380) * settings.meshLineWidth;
    ctx.save(); ctx.globalCompositeOperation = 'source-over'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (chroma > .03) {
      traceConnections(base, edges, w, h, audio, time, -chroma, 0, 3); ctx.strokeStyle = 'rgba(255,48,120,' + clamp(.08 + chroma * .018, .08, .30) + ')'; ctx.lineWidth = line; ctx.stroke();
      traceConnections(base, edges, w, h, audio, time, chroma, 0, 3); ctx.strokeStyle = 'rgba(48,224,255,' + clamp(.08 + chroma * .018, .08, .30) + ')'; ctx.lineWidth = line; ctx.stroke();
    }
    // Keep the official MediaPipe topology while using one neutral treatment
    // for both sides of the face instead of red/green eye markers.
    drawConnectionSet(base, edges, w, h, audio, time, [192,192,192], .26 + light * .10, line);
    var featureColor = [218,240,247];
    drawConnectionSet(base, window.FACEMESH_RIGHT_EYE || [], w, h, audio, time, featureColor, .76, line * 1.35);
    drawConnectionSet(base, window.FACEMESH_RIGHT_EYEBROW || [], w, h, audio, time, featureColor, .76, line * 1.35);
    drawConnectionSet(base, window.FACEMESH_LEFT_EYE || [], w, h, audio, time, featureColor, .76, line * 1.35);
    drawConnectionSet(base, window.FACEMESH_LEFT_EYEBROW || [], w, h, audio, time, featureColor, .76, line * 1.35);
    drawConnectionSet(base, window.FACEMESH_FACE_OVAL || [], w, h, audio, time, [224,224,224], .78, line * 1.4);
    drawConnectionSet(base, window.FACEMESH_LIPS || [], w, h, audio, time, [224,224,224], .78, line * 1.4);
    ctx.restore();
    return drawDenseMeshPoints(base, edges, w, h, audio, time);
  }
  function drawSurfaceMode(base, w, h, audio, time) {
    var triangles = meshTriangles(window.FACEMESH_TESSELATION || []), light = faceAudioLight(audio);
    var projected = triangles.map(function (triangle) {
      if (!triangle.every(function (index) { return !!base[index]; })) return null;
      var points = triangle.map(function (index) { return mapPoint(base[index],w,h,audio,index,rippleSample(index,time)); });
      return { indices: triangle, points: points, z: (points[0].z + points[1].z + points[2].z) / 3 };
    }).filter(Boolean).sort(function (a,b) { return a.z - b.z; });
    ctx.save(); ctx.globalCompositeOperation = 'source-over'; ctx.lineJoin = 'round';
    projected.forEach(function (triangle, index) {
      var p = triangle.points, ripple = Math.max(rippleSample(triangle.indices[0],time),rippleSample(triangle.indices[1],time),rippleSample(triangle.indices[2],time));
      var depthLight = clamp(.52 - triangle.z * .8, .12, .92), shimmer = .5 + .5 * Math.sin(index * .41 + time * .42);
      var alpha = settings.surfaceOpacity * (.13 + depthLight * .17 + light * .12 + ripple * .27);
      var red = Math.round(22 + depthLight * 42 + light * 25 + settings.surfaceSpecular * shimmer * 12);
      var green = Math.round(76 + depthLight * 80 + light * 41 + settings.surfaceSpecular * shimmer * 22);
      var blue = Math.round(132 + depthLight * 92 + light * 40);
      ctx.beginPath();ctx.moveTo(p[0].x,p[0].y);ctx.lineTo(p[1].x,p[1].y);ctx.lineTo(p[2].x,p[2].y);ctx.closePath();
      ctx.fillStyle='rgba('+red+','+green+','+blue+','+clamp(alpha,0,.94)+')';ctx.fill();
      if(settings.surfaceMeshOverlay){ctx.strokeStyle='rgba(132,224,255,'+clamp(.035+light*.035+ripple*.12,0,.26)+')';ctx.lineWidth=Math.max(.35,w/3600);ctx.stroke();}
    });
    var oval = [], seen = {};
    (window.FACEMESH_FACE_OVAL || []).forEach(function (edge) { var index=edge[0]; if(base[index]&&!seen[index]){seen[index]=true;oval.push(mapPoint(base[index],w,h,audio,index,rippleSample(index,time)));} });
    if(oval.length>2){ctx.beginPath();ctx.moveTo(oval[0].x,oval[0].y);for(var o=1;o<oval.length;o++)ctx.lineTo(oval[o].x,oval[o].y);ctx.closePath();ctx.clip();var spec=ctx.createRadialGradient(w*.42,h*.35,0,w*.46,h*.44,Math.min(w,h)*.34);spec.addColorStop(0,'rgba(216,251,255,'+clamp(.04+light*.085,0,.28)+')');spec.addColorStop(.38,'rgba(78,178,255,'+clamp(.025+light*.045,0,.18)+')');spec.addColorStop(1,'rgba(27,20,92,0)');ctx.globalCompositeOperation='lighter';ctx.fillStyle=spec;ctx.fillRect(0,0,w,h);}
    ctx.restore();
    if (settings.surfaceMeshOverlay) {
      ctx.save(); ctx.globalAlpha = .18; drawMeshMode(base,w,h,Object.assign({},audio,{energy:audio.energy*.45,beat:audio.beat*.35}),time); ctx.restore();
    }
  }
  function drawParticleMode(base, w, h, audio, time) {
    var profile = interpolationProfile(), points = interpolateMesh(base, window.FACEMESH_TESSELATION || [], profile.stride, profile.steps), features = featureIndices();
    var light = faceAudioLight(audio), radiusBase = Math.max(.72, Math.min(w, h) / 1080) * settings.particleSize;
    var buckets = [[],[],[],[]], chroma = audio.dispersion * Math.max(1, w / 1200);
    points.forEach(function (p, i) {
      var source = p.sourceIndex == null ? i : p.sourceIndex, ripple = rippleSample(source,time), m = mapPoint(p,w,h,audio,source,ripple);
      var lift = clamp(ripple / 1.5, 0, 1), bucket = Math.min(3, Math.floor(lift * 3.999));
      buckets[bucket].push({ x:m.x, y:m.y, r:radiusBase*m.p*(features[source]?1.28:1)*(1+lift*.58) });
    });
    ctx.save(); ctx.globalCompositeOperation = 'source-over';
    if (chroma > .03) {
      [[-chroma,'rgba(255,48,120,.24)'],[chroma,'rgba(48,224,255,.24)']].forEach(function (pass) {
        ctx.beginPath(); buckets.forEach(function (items) { items.forEach(function (p) { ctx.moveTo(p.x+pass[0]+p.r,p.y);ctx.arc(p.x+pass[0],p.y,p.r,0,Math.PI*2); }); }); ctx.fillStyle=pass[1];ctx.fill();
      });
    }
    buckets.forEach(function (items, bucket) {
      if (!items.length) return; var lift=bucket/3, channel=Math.round(205+50*lift), alpha=clamp(.48+light*.16+lift*.34*settings.particleBrightness,0,1);
      ctx.beginPath();items.forEach(function(p){ctx.moveTo(p.x+p.r,p.y);ctx.arc(p.x,p.y,p.r,0,Math.PI*2);});ctx.fillStyle='rgba('+Math.round(116+139*lift)+','+channel+',255,'+alpha+')';ctx.fill();
    });
    ctx.restore(); return points.length;
  }
  function averagePoint(base, indices, w, h, audio) {
    var x = 0, y = 0, n = 0; indices.forEach(function (index) { if (!base[index]) return; var p = mapPoint(base[index], w, h, audio, index); x += p.x; y += p.y; n++; }); return n ? { x: x / n, y: y / n } : null;
  }
  function laserPeakFlash(envelope,power,strength){return clamp(clamp(envelope,0,1)*clamp(power,0,1.5)*clamp(strength,0,1.8),0,1.8);}
  function estimateFaceOrientation(landmarks) {
    if(!landmarks||!landmarks[234]||!landmarks[454]||!landmarks[10]||!landmarks[152])return{x:0,y:-.16,confidence:0};
    var left=landmarks[234],right=landmarks[454],top=landmarks[10],bottom=landmarks[152];
    var hx=right.x-left.x,hy=right.y-left.y,hz=(right.z||0)-(left.z||0);
    var vx=bottom.x-top.x,vy=bottom.y-top.y,vz=(bottom.z||0)-(top.z||0);
    var nx=hy*vz-hz*vy,ny=hz*vx-hx*vz,nz=hx*vy-hy*vx,length=Math.hypot(nx,ny,nz)||1;
    nx/=length;ny/=length;nz/=length;
    if(nz<0){nx=-nx;ny=-ny;nz=-nz;}
    // Keep both screen-axis signs aligned with the visible performer-facing
    // head motion after the camera feed is mirrored onto the stage.
    return{x:clamp(nx*1.35,-1.35,1.35),y:clamp(-ny*1.35-.16,-1.35,1.35),confidence:clamp(nz,0,1)};
  }
  function lyricProgressScreenTarget(w,h) {
    if(typeof THREE==='undefined'||typeof camera==='undefined'||!camera||typeof stageLyrics==='undefined'||!stageLyrics||!stageLyrics.current)return null;
    var current=stageLyrics.current,data=current.userData&&current.userData.lyric;if(!data)return null;
    var row=null,rows=Array.isArray(data.rowLayers)?data.rowLayers:[];
    for(var i=0;i<rows.length;i++)if(rows[i]&&rows[i].isActive&&rows[i].mesh){row=rows[i];break;}
    var targetMesh=row&&row.mesh||data.activeRowMesh||data.textMesh;if(!targetMesh||!targetMesh.geometry)return null;
    var mask=row&&row.lineMask||data.activeMask||data.mask||{};
    var geometryWidth=Number(row&&row.lineWorldW)||(targetMesh.geometry.parameters&&Number(targetMesh.geometry.parameters.width))||Number(data.textWorldW)||Number(data.worldW);
    if(!(geometryWidth>0))return null;
    var maskWidth=Math.max(1,Number(mask.width)||1),textWidth=Math.max(1,Number(mask.activeTextWidth)||Number(mask.textWidth)||maskWidth);
    var progress=clamp(current.userData&&isFinite(Number(current.userData.shownLyricProgress))?Number(current.userData.shownLyricProgress):Number(current.userData&&current.userData.lastLyricProgress),0,1);
    var point=new THREE.Vector3((progress-.5)*geometryWidth*clamp(textWidth/maskWidth,.05,1),0,.02);
    if(typeof targetMesh.updateWorldMatrix==='function')targetMesh.updateWorldMatrix(true,false);
    point.applyMatrix4(targetMesh.matrixWorld).project(camera);
    if(!isFinite(point.x)||!isFinite(point.y)||!isFinite(point.z)||point.z<-1||point.z>1)return null;
    return{x:(point.x*.5+.5)*w,y:(.5-point.y*.5)*h,progress:progress};
  }
  function laserDirection(base,w,h) {
    if(settings.laserDirection==='lyrics')return{target:lyricProgressScreenTarget(w,h)};
    if(settings.laserDirection==='face')return estimateFaceOrientation(base);
    return{x:-Math.sin(view.yaw)+gazeState.x*1.35,y:-.16*Math.cos(view.pitch)+gazeState.y*1.35,confidence:gazeState.confidence};
  }
  function parallelLyricRay(eye,eyeMidpoint,target) {
    if(!eye||!eyeMidpoint||!target)return null;
    var dx=target.x-eyeMidpoint.x,dy=target.y-eyeMidpoint.y,distance=Math.hypot(dx,dy);if(distance<1)return null;
    return{x:dx/distance,y:dy/distance,endX:eye.x+dx,endY:eye.y+dy};
  }
  function drawLasers(base, w, h, audio, time) {
    if (!settings.lasers||(settings.laserDirection==='gaze'&&(!settings.eyeTracking||!gazeState.valid))) return;
    var peakEnvelope=clamp(audio&&audio.peakEnvelope,0,1),peakPower=clamp(audio&&audio.peakPower,0,1.5);
    if(peakEnvelope<=.001||peakPower<=0)return;
    var eyes = [averagePoint(base,[33,133,159,145,468,469,470,471,472],w,h,audio),averagePoint(base,[362,263,386,374,473,474,475,476,477],w,h,audio)];
    // Rays can follow either the calibrated pupil vector or the normal of the
    // tracked face plane. A small forward bias keeps centered rays visible.
    var direction=laserDirection(base,w,h);if(!direction||(settings.laserDirection==='lyrics'&&!direction.target))return;
    var visibleEyes=eyes.filter(Boolean),eyeMidpoint=visibleEyes.length?{x:visibleEyes.reduce(function(sum,eye){return sum+eye.x;},0)/visibleEyes.length,y:visibleEyes.reduce(function(sum,eye){return sum+eye.y;},0)/visibleEyes.length}:null;
    var dirX=direction.x,dirY=direction.y;
    var dirLength=Math.sqrt(dirX*dirX+dirY*dirY)||1;dirX/=dirLength;dirY/=dirLength;
    var flash=laserPeakFlash(peakEnvelope,peakPower,settings.laserStrength),length=Math.max(w,h)*(.18+flash*.22)*settings.laserLength,spread=(2+flash*11)*settings.laserWidth,alpha=clamp(flash,0,1);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    eyes.forEach(function (eye) { if(!eye)return;var localDirX=dirX,localDirY=dirY,ex,ey;if(direction.target){var lyricRay=parallelLyricRay(eye,eyeMidpoint,direction.target);if(!lyricRay)return;localDirX=lyricRay.x;localDirY=lyricRay.y;ex=lyricRay.endX;ey=lyricRay.endY;}else{ex=eye.x+localDirX*length;ey=eye.y+localDirY*length;}var px=-localDirY,py=localDirX,midX=eye.x+(ex-eye.x)*.58,midY=eye.y+(ey-eye.y)*.58,beam=ctx.createLinearGradient(eye.x,eye.y,ex,ey);beam.addColorStop(0,'rgba(232,255,255,'+clamp(alpha*.98,0,1)+')');beam.addColorStop(.16,'rgba(72,234,255,'+clamp(alpha*.82,0,1)+')');beam.addColorStop(.72,'rgba(92,90,255,'+clamp(alpha*.28,0,1)+')');beam.addColorStop(1,'rgba(92,90,255,0)');ctx.beginPath();ctx.moveTo(eye.x+px*spread*.22,eye.y+py*spread*.22);ctx.quadraticCurveTo(midX+px*spread,midY+py*spread,ex+px*spread*.16,ey+py*spread*.16);ctx.lineTo(ex-px*spread*.16,ey-py*spread*.16);ctx.quadraticCurveTo(midX-px*spread,midY-py*spread,eye.x-px*spread*.22,eye.y-py*spread*.22);ctx.closePath();ctx.fillStyle=beam;ctx.fill();ctx.beginPath();ctx.moveTo(eye.x,eye.y);ctx.lineTo(ex,ey);ctx.lineWidth=(1.2+flash*4.4)*settings.laserWidth;ctx.strokeStyle='rgba(226,255,255,'+clamp(alpha*.92,0,1)+')';ctx.stroke();ctx.beginPath();ctx.arc(eye.x,eye.y,3+flash*7,0,Math.PI*2);ctx.fillStyle='rgba(214,254,255,'+clamp(alpha*.84,0,1)+')';ctx.fill();});
    ctx.restore();
  }
  function drawGazeOverlay(w,h,audio) {
    if(!settings.eyeTracking||!settings.gazeOverlay||!gazeState.valid||!gazeState.pupils.length)return;
    var pupils=gazeState.pupils.map(function(point){return mapPoint(point,w,h,audio,point.sourceIndex||0,0);});
    ctx.save();ctx.globalCompositeOperation='lighter';ctx.lineCap='round';
    pupils.forEach(function(point){
      var radius=Math.max(4.8,Math.min(w,h)*.007);
      if(settings.mode!=='mesh'){
        ctx.beginPath();ctx.arc(point.x,point.y,radius*2.35,0,Math.PI*2);ctx.strokeStyle='rgba(99,225,255,.28)';ctx.lineWidth=1;ctx.stroke();
      }
      ctx.beginPath();ctx.arc(point.x,point.y,radius,0,Math.PI*2);ctx.fillStyle='rgba(225,252,255,.92)';ctx.shadowColor='rgba(99,225,255,.9)';ctx.shadowBlur=12;ctx.fill();
    });
    ctx.restore();
  }
  function updateRmsPeakEffects(base, audio, time) {
    var peak = stepRmsPeakDetector(rmsPeakState, audio.rms, time, settings.peakSensitivity);
    if (peak.hit) { peakVisualState.power=peak.power;peakVisualState.born=time; }
    if (settings.ripple && peak.hit) {
      var graph = meshGraph(window.FACEMESH_TESSELATION || [], base.length), candidates=[];
      for(var i=0;i<Math.min(468,base.length);i++)if(base[i]&&graph[i]&&graph[i].length)candidates.push(i);
      var origin=candidates[Math.floor(Math.random()*candidates.length)]||1;
      rippleBursts.push({origin:origin,born:time,power:peak.power,distance:meshHopDistances(origin,base.length)});
      if(rippleBursts.length>5)rippleBursts.shift();
    }
    rippleBursts=rippleBursts.filter(function(r){return time-r.born<1.55;});
    var age=time-peakVisualState.born,envelope=age>=0&&age<.48?Math.exp(-age*7.2):0;
    audio.peakEnvelope=envelope;audio.peakPower=peakVisualState.power;
    audio.dispersion=settings.dispersion?peakPowerMap(peakVisualState.power,settings.dispersionEffectLow,settings.dispersionEffectHigh)*envelope:0;
    audio.shake=settings.shake?peakPowerMap(peakVisualState.power,0,settings.shakeStrength)*envelope:0;
  }
  function drawStatus(title, detail, live) {
    var dpr = Math.min(2, Math.max(1, devicePixelRatio || 1)); ctx.save(); ctx.setTransform(dpr,0,0,dpr,0,0); ctx.textAlign = 'left'; ctx.font = '700 10px Inter,sans-serif'; ctx.fillStyle = live ? 'rgba(99,225,255,.88)' : 'rgba(214,230,244,.76)'; ctx.fillText(title,26,34); ctx.font = '500 9px Inter,sans-serif'; ctx.fillStyle = 'rgba(190,208,226,.46)'; ctx.fillText(detail,26,50); if (live) { ctx.beginPath(); ctx.arc(15,31,3,0,6.283); ctx.fillStyle = 'rgba(89,240,211,.95)'; ctx.fill(); } ctx.restore();
  }
  function draw(frame) {
    resizeCanvas(); lastFrame = frame || lastFrame || {};
    var w = canvas.width, h = canvas.height, raw = frame && frame.audio || {}, playing = !!(frame && frame.playing);
    var audio = { beat: clamp(raw.beat,0,1), energy: clamp(raw.energy,0,1), bass: clamp(raw.bass,0,1), mid: clamp(raw.mid,0,1), treble: clamp(raw.treble,0,1), rms: playing ? timeDomainRms(frame.timeDomainData) : 0, dispersion: 0, shake: 0 }, time = Number(frame && frame.time) || performance.now() * .001;
    animateHud(performance.now());
    if (frame && frame.visualRotation) {
      view.targetYaw = clamp(Number(frame.visualRotation.y) || 0, -1.18, 1.18);
      view.targetPitch = clamp(Number(frame.visualRotation.x) || 0, -.72, .72);
    }
    view.yaw += (view.targetYaw - view.yaw) * .14; view.pitch += (view.targetPitch - view.pitch) * .14;
    ctx.globalCompositeOperation = 'source-over';ctx.fillStyle='rgb(2,4,12)';ctx.fillRect(0,0,w,h);
    if (!hasDetectedFace()) { var pulse = .5 + .5 * Math.sin(performance.now() * .0024); ctx.beginPath(); ctx.arc(w*.5,h*.48,Math.min(w,h)*(.1+pulse*.018),0,6.283); ctx.strokeStyle='rgba(70,112,255,'+(.12+pulse*.12)+')'; ctx.lineWidth=Math.max(1,w/1100); ctx.stroke(); drawStatus(failure?'摄像头未就绪':'EMOMUSIC · EMOTION FIELD',failure||'请将面部放入摄像头视野',false); return; }
    inputAspect = cameraSourceAspect();
    var base = smoothFace(latestLandmarks); fitTransform(base); updateRmsPeakEffects(base,audio,time);
    var flash=settings.flash?audio.peakEnvelope*settings.flashStrength:0;if(flash>0){ctx.fillStyle='rgba(18,38,72,'+clamp(flash*.22,0,.34)+')';ctx.fillRect(0,0,w,h);}
    var shakePixels=audio.shake*Math.min(w,h)*.012,shakeX=Math.sin(time*97.3)*shakePixels,shakeY=Math.cos(time*83.7)*shakePixels*.72;ctx.save();ctx.translate(shakeX,shakeY);
    var detail = base.length + ' LANDMARKS · ' + settings.mode.toUpperCase(); if (settings.mode === 'mesh') detail = drawMeshMode(base,w,h,audio,time) + ' MESH POINTS · MEDIAPIPE'; else if (settings.mode === 'surface') drawSurfaceMode(base,w,h,audio,time); else detail = drawParticleMode(base,w,h,audio,time) + ' PARTICLES · MEDIAPIPE';
    drawLasers(base,w,h,audio,time);drawGazeOverlay(w,h,audio);if(settings.eyeTracking&&gazeState.valid)detail+=' · GAZE '+gazeState.direction+' '+Math.round(gazeState.confidence*100)+'%';drawStatus('EMOMUSIC · NEURAL FIELD LIVE',detail,true);ctx.restore();
  }

  function mapCameraError(error) { var name = String(error && error.name || ''); return name === 'NotAllowedError' || name === 'SecurityError' ? '请允许 Mineradio 使用摄像头' : name === 'NotReadableError' ? '摄像头正被其他程序占用' : name === 'NotFoundError' ? '未检测到可用摄像头' : '面部识别启动失败'; }
  function inferenceLoop() { if (!active || !faceMesh || !video) return; raf = requestAnimationFrame(inferenceLoop); if (!hostVisible() || inferenceBusy || video.readyState < 2 || performance.now() - lastInferenceAt < inferenceInterval()) return; lastInferenceAt = performance.now(); inferenceBusy = true; Promise.resolve(faceMesh.send({ image: video })).catch(function (error) { if (!failure) console.warn('[EmoMusic] Face Mesh frame recovered:', error && (error.message || error.name) || error); }).finally(function () { inferenceBusy = false; }); }
  async function start() {
    if (active || starting) return; starting = true; failure = ''; var startEpoch = ++epoch; ensureCanvas().classList.add('active'); document.body.classList.add('emomusic-active');
    try {
      var api = typeof getDesktopWindowApi === 'function' ? getDesktopWindowApi() : window.desktopWindow; if (api && typeof api.requestGestureCameraPermission === 'function') { var grant = await api.requestGestureCameraPermission(); if (!grant || grant.ok !== true) throw new Error(grant && grant.error || 'CAMERA_PERMISSION_FAILED'); }
      await loadScriptOnce(MEDIAPIPE_ROOT + 'face_mesh.js'); if (startEpoch !== epoch || !fx || Number(fx.preset) !== PRESET_INDEX) return;
      video = document.createElement('video'); video.playsInline = true; video.muted = true; video.autoplay = true; video.style.display = 'none'; document.body.appendChild(video);
      stream = await navigator.mediaDevices.getUserMedia(cameraConstraints(settings.cameraProfile));
      if (startEpoch !== epoch || !fx || Number(fx.preset) !== PRESET_INDEX) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; return; }
      video.srcObject = stream; await video.play(); faceMesh = new FaceMesh({ locateFile:function(file){return MEDIAPIPE_ROOT+file;} }); faceMesh.setOptions({maxNumFaces:1,refineLandmarks:true,minDetectionConfidence:.55,minTrackingConfidence:.55}); faceMesh.onResults(function(results){if(!active)return;var marks=results&&results.multiFaceLandmarks&&results.multiFaceLandmarks[0],hadFace=hasDetectedFace();if(marks&&marks.length){clearTimeout(faceLossTimer);faceLossTimer=0;latestLandmarks=marks;lastFaceAt=performance.now();failure='';updateGaze(marks,lastFaceAt);if(!hadFace)scheduleTelemetry(true);return;}if(!faceLossTimer)faceLossTimer=setTimeout(function(){faceLossTimer=0;if(!hasDetectedFace()){latestLandmarks=null;smoothLandmarks=null;lastFaceAt=0;pauseEmotionGeneration();}},FACE_LOSS_GRACE_MS);}); active=true; scheduleTelemetry(true); inferenceLoop();
    } catch (error) { failure=mapCameraError(error); console.warn('[EmoMusic]',error&&(error.message||error.name)||error); cleanup(false); } finally { starting=false; }
  }
  function cleanup(hide) { epoch++;active=false;starting=false;inferenceBusy=false;if(raf)cancelAnimationFrame(raf);raf=0;if(faceMesh){try{faceMesh.close();}catch(_){}}faceMesh=null;if(stream)stream.getTracks().forEach(function(t){try{t.stop();}catch(_){}});stream=null;if(video){video.srcObject=null;video.remove();}video=null;vlmCaptureCanvas=null;latestLandmarks=null;smoothLandmarks=null;lastFaceAt=0;gazeState=createGazeState();inputAspect=4/3;rippleBursts=[];rmsPeakState=createRmsPeakState();peakVisualState={power:0,born:-99};hudMotion={scores:{},curve:[],prompts:[],lastAt:0};telemetry=null;telemetryAt=0;vlmReady=false;clearTimeout(telemetryTimer);clearTimeout(faceLossTimer);telemetryTimer=0;faceLossTimer=0;if(hide!==false){if(canvas)canvas.classList.remove('active');document.body.classList.remove('emomusic-active');if(hud)hud.classList.remove('active');}}

  function sparkPath(items,w,h){if(!items||!items.length)return'';var points=items.map(function(item,i){return{x:items.length===1?w/2:i/(items.length-1)*w,y:h/2-clamp(item.value,-1,1)*h*.42};});if(points.length===1)return'M'+points[0].x.toFixed(1)+' '+points[0].y.toFixed(1);var path='M'+points[0].x.toFixed(1)+' '+points[0].y.toFixed(1);for(var i=1;i<points.length;i++){var previous=points[i-1],point=points[i],mid=(previous.x+point.x)*.5;path+=' C'+mid.toFixed(1)+' '+previous.y.toFixed(1)+','+mid.toFixed(1)+' '+point.y.toFixed(1)+','+point.x.toFixed(1)+' '+point.y.toFixed(1);}return path;}
  function radarPoints(items,r,c){var list=(items||[]).slice(0,8);return list.map(function(item,i){var a=-Math.PI/2+i/list.length*Math.PI*2,rr=r*clamp(item.weight,0,5)/5;return(c+Math.cos(a)*rr).toFixed(1)+','+(c+Math.sin(a)*rr).toFixed(1);}).join(' ');}
  function radarLabelMarkup(items,outer){var list=(items||[]).slice(0,8),cx=70,cy=70;return list.map(function(item,i){var a=-Math.PI/2+i/list.length*Math.PI*2,r=outer?57:Math.max(13,38*clamp(item.weight,0,5)/5-9),x=cx+Math.cos(a)*r,y=clamp(cy+Math.sin(a)*r,9,134),anchor=Math.cos(a)>.25?'start':Math.cos(a)<-.25?'end':'middle';if(outer&&x>110){x=134;anchor='end';}else if(outer&&x<30){x=6;anchor='start';}return'<text x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" text-anchor="'+anchor+'">'+(outer?esc(item.tag):Number(item.weight||0).toFixed(1))+'</text>';}).join('');}
  function smoothValue(current,target,alpha){current=Number(current)||0;target=Number(target)||0;alpha=clamp(alpha,0,1);var value=current+(target-current)*alpha;return Math.abs(target-value)<.001?target:value;}
  function smoothCurve(current,target,alpha){var byTime={};(current||[]).forEach(function(item){byTime[item.ts]=Number(item.value)||0;});var previous=current&&current.length?Number(current[current.length-1].value)||0:0;return(target||[]).slice(-120).map(function(item){var from=Object.prototype.hasOwnProperty.call(byTime,item.ts)?byTime[item.ts]:previous;var value=smoothValue(from,clamp(item.value,-1,1),alpha);previous=value;return{ts:String(item.ts||''),value:value};});}
  function smoothPrompts(current,target,alpha){var byTag={};(current||[]).forEach(function(item){byTag[item.tag]=Number(item.weight)||0;});return(target||[]).slice(0,8).map(function(item){var tag=String(item.tag||'');return{tag:tag,weight:smoothValue(byTag[tag],clamp(item.weight,0,5),alpha),dimension:item.dimension};});}
  function vectorArrowMarkup(scores){return EMOTION_DIMENSIONS.map(function(item,index){var value=clamp(scores[item.key],-1,1),positive=value>=0,angle=(positive?(item.angleDown+180)%360:item.angleDown)*Math.PI/180,magnitude=Math.abs(value),radius=12+magnitude*62,x=100+Math.cos(angle)*radius,y=100-Math.sin(angle)*radius,bend=(index-2)*1.8,normalX=Math.sin(angle)*bend,normalY=Math.cos(angle)*bend,controlX=(100+x)*.5+normalX,controlY=(100+y)*.5+normalY,labelRadius=Math.max(29,radius+16),labelX=100+Math.cos(angle)*labelRadius,labelY=clamp(100-Math.sin(angle)*labelRadius,14,176),anchor=Math.cos(angle)>.28?'start':Math.cos(angle)<-.28?'end':'middle',color=positive?'#35d4f4':'#ff7b6b',label=positive?item.positive:item.negative,path='M100 100 Q'+controlX.toFixed(2)+' '+controlY.toFixed(2)+' '+x.toFixed(2)+' '+y.toFixed(2);if(labelX>168){labelX=184;anchor='end';}else if(labelX<32){labelX=16;anchor='start';}return'<g class="emomusic-vector-arrow" data-tone="'+(positive?'positive':'negative')+'"><path class="emomusic-vector-arrow-glow" d="'+path+'" stroke="'+color+'"></path><path class="emomusic-vector-arrow-line" d="'+path+'" stroke="'+color+'" marker-end="url(#emomusic-arrow-'+(positive?'positive':'negative')+')"></path><circle cx="100" cy="100" r="2.2" fill="'+color+'"></circle><text x="'+labelX.toFixed(2)+'" y="'+labelY.toFixed(2)+'" text-anchor="'+anchor+'"><tspan>'+esc(label)+'</tspan><tspan x="'+labelX.toFixed(2)+'" dy="10">'+(value>=0?'+':'')+value.toFixed(2)+'</tspan></text></g>';}).join('');}
  function compositeEmotionValue(scores){var positive=0,negative=0;EMOTION_DIMENSIONS.forEach(function(item){var value=clamp(scores[item.key],-1,1);if(value>=0)positive+=value*value;else negative+=value*value;});return clamp((Math.sqrt(positive)-Math.sqrt(negative))/Math.sqrt(EMOTION_DIMENSIONS.length),-1,1);}
  function createRandomTelemetry(randomFn, date){
    randomFn=typeof randomFn==='function'?randomFn:Math.random;date=date||new Date();var scores={};
    EMOTION_DIMENSIONS.forEach(function(item){var target=randomFn()*2-1,previous=fallbackScores&&Number(fallbackScores[item.key]);scores[item.key]=clamp(isFinite(previous)?previous*.48+target*.52:target,-1,1);});
    if(EMOTION_DIMENSIONS.every(function(item){return scores[item.key]<0;})){scores.sleepiness_energy=Math.abs(scores.sleepiness_energy)*.65+.08;}
    fallbackScores=scores;var value=compositeEmotionValue(scores),stamp=date.toLocaleTimeString('zh-CN',{hour12:false});fallbackCurve.push({ts:stamp,value:value});fallbackCurve=fallbackCurve.slice(-120);
    var items=EMOTION_DIMENSIONS.map(function(item){var score=scores[item.key];return{tag:score<0?item.negativeTag:item.positiveTag,weight:clamp(1+Math.abs(score)*4,0,5),dimension:item.key};}).sort(function(a,b){return b.weight-a.weight;});
    return{schema:'emomusic-realtime-v1',updated_at:stamp,source:'random_fallback',scores:scores,curve:fallbackCurve.slice(),prompts:{ts:stamp,items:items},dimensions:EMOTION_DIMENSIONS.map(function(item){return{key:item.key,negative:item.negative,positive:item.positive};}),analysis_running:false,generation_paused:false,face_detected:!!latestLandmarks,camera_status:'情绪 API 未就绪 · 本地随机向量'};
  }
  function faceCropRect(landmarks,sourceWidth,sourceHeight,padding){
    sourceWidth=Math.max(1,Number(sourceWidth)||1);sourceHeight=Math.max(1,Number(sourceHeight)||1);padding=clamp(padding==null?.2:padding,0,.6);
    var xs=[],ys=[];(landmarks||[]).forEach(function(point){var x=Number(point&&point.x),y=Number(point&&point.y);if(isFinite(x)&&isFinite(y)){xs.push(clamp(x,0,1));ys.push(clamp(y,0,1));}});
    if(xs.length<20)return null;
    var minX=Math.min.apply(Math,xs)*sourceWidth,maxX=Math.max.apply(Math,xs)*sourceWidth,minY=Math.min.apply(Math,ys)*sourceHeight,maxY=Math.max.apply(Math,ys)*sourceHeight;
    var faceWidth=Math.max(1,maxX-minX),faceHeight=Math.max(1,maxY-minY),size=Math.max(faceWidth,faceHeight)*(1+padding*2),centerX=(minX+maxX)/2,centerY=(minY+maxY)/2-faceHeight*.04;
    size=Math.min(sourceWidth,sourceHeight,Math.max(1,size));var x=clamp(centerX-size/2,0,sourceWidth-size),y=clamp(centerY-size/2,0,sourceHeight-size);
    return{x:Math.round(x),y:Math.round(y),width:Math.max(1,Math.round(size)),height:Math.max(1,Math.round(size))};
  }
  function captureVlmFrame(){
    if(!video||video.readyState<2||!video.videoWidth||!video.videoHeight)throw new Error('VLM_CAMERA_NOT_READY');
    var crop=faceCropRect(latestLandmarks,video.videoWidth,video.videoHeight,.2);if(!crop)throw new Error('FACE_NOT_DETECTED');
    var outputSize=Math.min(512,crop.width,crop.height);outputSize=Math.max(1,Math.round(outputSize));
    if(!vlmCaptureCanvas)vlmCaptureCanvas=document.createElement('canvas');
    vlmCaptureCanvas.width=outputSize;vlmCaptureCanvas.height=outputSize;
    var captureContext=vlmCaptureCanvas.getContext('2d',{alpha:false});
    // Browser video pixels are decoded into an RGB canvas; JPEG serialization
    // therefore sends a standard RGB/sRGB face crop rather than OpenCV BGR.
    captureContext.drawImage(video,crop.x,crop.y,crop.width,crop.height,0,0,outputSize,outputSize);
    return vlmCaptureCanvas.toDataURL('image/jpeg',.72);
  }
  function telemetryFromVlm(result,date){
    date=date||new Date();var analysis=result&&result.analysis||{},scores=analysis.scores||{},stamp=date.toLocaleTimeString('zh-CN',{hour12:false});
    vlmCurve.push({ts:stamp,value:compositeEmotionValue(scores)});vlmCurve=vlmCurve.slice(-120);
    return{schema:'emomusic-realtime-v1',updated_at:stamp,source:'vlm',scores:scores,curve:vlmCurve.slice(),prompts:{ts:stamp,items:Array.isArray(analysis.prompts)?analysis.prompts.slice(0,8):[]},dimensions:EMOTION_DIMENSIONS.map(function(item){return{key:item.key,negative:item.negative,positive:item.positive};}),analysis_running:false,generation_paused:false,face_detected:!!latestLandmarks,camera_status:'SiliconFlow VLM 在线',model:result&&result.model||'',summary:analysis.summary||''};
  }
  function vlmErrorText(result){var code=String(result&&result.error||'VLM_REQUEST_FAILED');if(code==='SILICONFLOW_API_KEY_MISSING')return'SiliconFlow API Key 未配置';if(code==='VLM_CAMERA_NOT_READY'||code==='FACE_NOT_DETECTED')return'等待摄像头识别人脸';if(code==='VLM_TIMEOUT')return'SiliconFlow 请求超时';if(code==='VLM_SCORE_ALL_NEGATIVE')return'VLM 返回五项全负异常值，已拒收';if(/^VLM_HTTP_/.test(code))return'SiliconFlow 请求失败 '+code.replace('VLM_HTTP_','HTTP ')+(result&&result.providerError?' · '+result.providerError:'');return code;}
  function telemetrySourceState(mode,ready,faceActive){if(faceActive===false)return{state:'offline',label:'未检测到人脸，情绪生成已停止',title:'等待识别人脸 · 情绪生成已停止'};return mode==='random'?{state:'random',label:'随机情绪模式，点击切换到 SiliconFlow VLM',title:'随机生成 · 点击恢复 SiliconFlow VLM'}:ready?{state:'ready',label:'SiliconFlow VLM 已就绪，点击切换到随机情绪',title:'SiliconFlow VLM 已就绪 · 点击使用随机生成'}:{state:'offline',label:'SiliconFlow VLM 未就绪，点击切换到随机情绪',title:'SiliconFlow VLM 未就绪'+(telemetryError?' · '+telemetryError:'')};}
  function syncTelemetrySource(){if(!hud)return;var button=hud.querySelector('[data-telemetry-source]');if(!button)return;var state=telemetrySourceState(settings.telemetryMode,vlmReady,hasDetectedFace());button.dataset.state=state.state;button.setAttribute('aria-label',state.label);button.setAttribute('aria-pressed',settings.telemetryMode==='random'?'true':'false');button.title=state.title;}
  function ensureHud(){if(hud)return hud;hud=document.createElement('aside');hud.className='emomusic-telemetry';hud.setAttribute('aria-label','EmoMusic 实时情绪遥测');hud.innerHTML='<header><div><strong>情绪遥测</strong><span>EMOTION SIGNAL ARRAY</span></div><button type="button" class="emomusic-source-light" data-telemetry-source data-state="offline" aria-label="VLM API 未就绪，点击切换到随机情绪" aria-pressed="false" title="VLM API 未就绪 · 当前自动随机回退"></button></header><section class="emomusic-vector"><label>情绪向量</label><svg viewBox="0 0 200 200" role="img" aria-label="五维情绪方向箭头"><defs><marker id="emomusic-arrow-positive" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M1 1L8 4.5L1 8" fill="none" stroke="#35d4f4" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"></path></marker><marker id="emomusic-arrow-negative" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M1 1L8 4.5L1 8" fill="none" stroke="#ff7b6b" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"></path></marker></defs><circle class="emomusic-vector-grid" cx="100" cy="100" r="74"></circle><circle class="emomusic-vector-grid" cx="100" cy="100" r="37"></circle><circle class="emomusic-vector-core" cx="100" cy="100" r="6"></circle><path class="emomusic-vector-axis" d="M18 100H182M100 18V182"></path><g data-vector-arrows></g></svg></section><section class="emomusic-telemetry-grid"><div><label>情感曲线</label><svg viewBox="0 0 260 72" preserveAspectRatio="none"><path class="emomusic-chart-zero" d="M0 36H260"></path><path class="emomusic-curve-line" data-curve d=""></path></svg></div><div class="emomusic-radar-cell"><label>提示词雷达</label><svg viewBox="0 0 140 140" role="img" aria-label="提示词权重雷达，外圈为标签，内圈为数值"><polygon class="emomusic-radar-grid" points="70,32 106.1,58.3 92.3,100.7 47.7,100.7 33.9,58.3"></polygon><circle cx="70" cy="70" r="19" class="emomusic-radar-grid"></circle><polygon class="emomusic-radar-value" data-radar points=""></polygon><g class="emomusic-radar-inner-labels" data-radar-inner-labels></g><g class="emomusic-radar-outer-labels" data-radar-outer-labels></g></svg></div></section><div class="emomusic-tags" data-tags><em>暂无音乐提示词</em></div><footer><span>ANALYSIS TICK</span><b data-time>--:--:--</b></footer>';hud.querySelector('[data-telemetry-source]').onclick=toggleTelemetrySource;document.getElementById('canvas-container').appendChild(hud);syncTelemetrySource();return hud;}
  function animateHud(now){if(!hud||!telemetry||!settings.telemetry)return;now=Number(now)||performance.now();var dt=hudMotion.lastAt?Math.min(.12,Math.max(0,(now-hudMotion.lastAt)/1000)):1/60,alpha=1-Math.exp(-dt*7);hudMotion.lastAt=now;EMOTION_DIMENSIONS.forEach(function(item){hudMotion.scores[item.key]=smoothValue(hudMotion.scores[item.key],telemetry.scores&&telemetry.scores[item.key],alpha);});hudMotion.curve=smoothCurve(hudMotion.curve,telemetry.curve||[],alpha);var targetPrompts=telemetry.prompts&&telemetry.prompts.items||[];hudMotion.prompts=smoothPrompts(hudMotion.prompts,targetPrompts,alpha);hud.querySelector('[data-vector-arrows]').innerHTML=vectorArrowMarkup(hudMotion.scores);hud.querySelector('[data-curve]').setAttribute('d',sparkPath(hudMotion.curve,260,72));hud.querySelector('[data-radar]').setAttribute('points',radarPoints(hudMotion.prompts,38,70));hud.querySelector('[data-radar-inner-labels]').innerHTML=radarLabelMarkup(hudMotion.prompts,false);hud.querySelector('[data-radar-outer-labels]').innerHTML=radarLabelMarkup(hudMotion.prompts,true);hud.querySelector('[data-tags]').innerHTML=hudMotion.prompts.slice(0,5).map(function(item){return'<span>'+esc(item.tag)+'<b>'+Number(item.weight||0).toFixed(1)+'</b></span>';}).join('')||'<em>暂无音乐提示词</em>';}
  function clearHudEmotion(){hudMotion={scores:{},curve:[],prompts:[],lastAt:0};if(!hud)return;hud.querySelector('[data-vector-arrows]').innerHTML='';hud.querySelector('[data-curve]').setAttribute('d','');hud.querySelector('[data-radar]').setAttribute('points','');hud.querySelector('[data-radar-inner-labels]').innerHTML='';hud.querySelector('[data-radar-outer-labels]').innerHTML='';hud.querySelector('[data-tags]').innerHTML='<em>等待识别人脸</em>';hud.querySelector('[data-time]').textContent='--:--:--';}
  function pauseEmotionGeneration(){telemetry=null;telemetryAt=0;telemetryError='等待摄像头识别人脸';vlmReady=false;fallbackScores=null;clearHudEmotion();renderHud();setPanelStatus('未检测到人脸 · 情绪生成已停止');}
  function renderHud(){if(!hud)return;hud.classList.toggle('active',active&&settings.telemetry);syncTelemetrySource();if(!telemetry){clearHudEmotion();return;}hud.querySelector('[data-time]').textContent=telemetry.updated_at||'--:--:--';animateHud(performance.now());}
  function toggleTelemetrySource(){settings.telemetryMode=settings.telemetryMode==='random'?'vlm':'random';if(settings.telemetryMode==='random'&&hasDetectedFace()){telemetry=createRandomTelemetry();telemetryAt=Date.now();}else if(!hasDetectedFace())pauseEmotionGeneration();else vlmReady=false;renderHud();scheduleTelemetry(true);setPanelStatus(!hasDetectedFace()?'未检测到人脸 · 情绪生成已停止':settings.telemetryMode==='random'?'已切换为随机情绪生成':'已切换为 SiliconFlow VLM 情绪检测');}
  async function fetchTelemetry(){
    if(!active||!settings.telemetry)return;
    if(!hasDetectedFace()){pauseEmotionGeneration();scheduleTelemetry(false);return;}
    if(settings.telemetryMode==='random'){telemetry=createRandomTelemetry();telemetryAt=Date.now();telemetryError='';renderHud();scheduleTelemetry(false);return;}
    try{
      if(!window.desktopWindow||typeof window.desktopWindow.analyzeEmomusicFrame!=='function')throw new Error('ELECTRON_VLM_BRIDGE_UNAVAILABLE');
      var result=await window.desktopWindow.analyzeEmomusicFrame(captureVlmFrame());
      if(!hasDetectedFace())throw new Error('FACE_NOT_DETECTED');
      if(!result||!result.ok){var requestError=new Error(result&&result.error||'VLM_REQUEST_FAILED');requestError.result=result;throw requestError;}
      telemetry=telemetryFromVlm(result);telemetryAt=Date.now();telemetryError='';vlmReady=true;fallbackScores=null;renderHud();setPanelStatus('SiliconFlow VLM 在线 · '+(result.model||'视觉模型'));
    }catch(error){
      vlmReady=false;telemetryError=vlmErrorText(error&&error.result||{error:error&&error.message});if(!hasDetectedFace()){pauseEmotionGeneration();}else{telemetry=createRandomTelemetry();telemetryAt=Date.now();renderHud();setPanelStatus(telemetryError+' · 当前使用随机回退');}
    }finally{scheduleTelemetry(false);}
  }
  function scheduleTelemetry(now){clearTimeout(telemetryTimer);if(active&&settings.telemetry)telemetryTimer=setTimeout(fetchTelemetry,now?40:clamp(settings.pollSeconds,1,60)*1000);}

  function range(key,label,min,max,step){return'<label class="emomusic-range"><span>'+label+'<output>'+Number(settings[key]).toFixed(step<1?2:0)+'</output></span><input type="range" min="'+min+'" max="'+max+'" step="'+step+'" value="'+settings[key]+'" data-setting="'+key+'"></label>';}
  function toggle(key,label){return'<label class="emomusic-switch"><span>'+label+'</span><input type="checkbox" data-setting="'+key+'"'+(settings[key]?' checked':'')+'><i></i></label>';}
  function select(key,label,items){return'<label class="emomusic-select"><span>'+label+'</span><select data-setting="'+key+'">'+items.map(function(item){return'<option value="'+esc(item.value)+'"'+(settings[key]===item.value?' selected':'')+'>'+esc(item.label)+'</option>';}).join('')+'</select></label>';}
  function setPanelStatus(text){if(panel)panel.querySelector('[role=status]').textContent=text;}
  function syncPanel(){if(!panel)return;panel.querySelectorAll('[data-setting]').forEach(function(input){var key=input.dataset.setting;if(input.type==='checkbox')input.checked=!!settings[key];else input.value=settings[key];var output=input.closest('.emomusic-range')&&input.closest('.emomusic-range').querySelector('output');if(output)output.textContent=Number(settings[key]).toFixed(Number(input.step)<1?2:0);});panel.querySelectorAll('[data-mode]').forEach(function(btn){btn.setAttribute('aria-pressed',btn.dataset.mode===settings.mode?'true':'false');});}
  async function listSaved(loadLatest,selectedName){var select=panel.querySelector('[data-saved]');if(!window.desktopWindow||!window.desktopWindow.visualPresets){select.innerHTML='<option>桌面版可读取已保存参数</option>';select.disabled=true;return;}var result=await window.desktopWindow.visualPresets('list','emomusic');if(!result.ok)throw new Error(result.error);if(!result.items.length){select.innerHTML='<option value="">暂无已保存参数</option>';select.disabled=true;setPanelStatus('暂无已保存参数 · 当前使用默认值');return;}select.innerHTML=result.items.map(function(item,index){return'<option value="'+esc(item.name)+'">'+esc(item.name.replace(/^\d+-/,'').replace(/\.json$/,''))+(index===0?' · 最新':'')+'</option>';}).join('');select.disabled=false;var available=result.items.some(function(item){return item.name===selectedName;});select.value=available?selectedName:result.items[0].name;if(loadLatest)await loadSaved(select.value);}
  async function loadSaved(name){name=name||panel.querySelector('[data-saved]').value;if(!name)return;var result=await window.desktopWindow.visualPresets('read','emomusic',name);if(!result.ok)throw new Error(result.error);var previousProfile=settings.cameraProfile;settings=normalizeSettings(result.value||{});syncPanel();scheduleTelemetry(true);if(previousProfile!==settings.cameraProfile)restartCameraForProfile();setPanelStatus('已读取：'+name.replace(/^\d+-/,'').replace(/\.json$/,''));}
  function setMode(mode){
    if(['particles','mesh','surface'].indexOf(mode)<0)return false;
    settings.mode=mode;syncPanel();
    window.dispatchEvent(new CustomEvent('mineradio-emomusic-mode-change',{detail:{mode:mode}}));
    return true;
  }
  function calibrateGaze(){
    if(!gazeState.valid){setPanelStatus('校准失败：请睁眼注视屏幕中央');return false;}
    settings.gazeCenterX=gazeState.rawX;settings.gazeCenterY=gazeState.rawY;gazeState.x=clamp(settings.gazeOffsetX,-1,1);gazeState.y=clamp(settings.gazeOffsetY,-1,1);gazeState.direction=gazeDirection(gazeState.x,gazeState.y,settings.gazeDeadzone);syncPanel();setPanelStatus('视线中心已校准，手动偏置已保留');return true;
  }
  function resetGazeCalibration(){settings.gazeCenterX=0;settings.gazeCenterY=0;syncPanel();setPanelStatus('已恢复默认视线中心');}
  function restartCameraForProfile(){if(active||starting||stream||faceMesh)cleanup(false);failure='';setPanelStatus('摄像头配置将在当前场景重新启动');}
  function ensurePanel(){
    if(panel||!document.getElementById||!document.getElementById('fx-panel'))return;
    var slot=document.createElement('div');slot.id='external-emomusic-controls';slot.className='external-visual-controls';panel=document.createElement('section');panel.className='emomusic-controls';
    panel.innerHTML='<div class="emomusic-control-head"><div><strong>情绪场参数</strong><span>EMOMUSIC SIGNAL LAB</span></div></div>'+
      '<div class="emomusic-mode" role="group" aria-label="显示模式"><button type="button" data-mode="particles">粒子</button><button type="button" data-mode="mesh">官方 Face Mesh</button><button type="button" data-mode="surface">拟合表面</button></div>'+
      '<details open><summary>面部材质</summary>'+range('particleSize','粒子尺寸',.45,2.4,.05)+range('meshLineWidth','网格线宽',.35,2.6,.05)+range('meshDensity','Mesh 点密度',1,5,1)+range('surfaceOpacity','表面不透明度',.15,1,.05)+range('surfaceSpecular','表面高光',0,2,.05)+toggle('surfaceMeshOverlay','Surface 显示 Mesh 点和线')+range('particleBrightness','粒子亮度响应',0,2.5,.05)+'</details>'+
      '<details open><summary>RMS 峰值动态</summary>'+range('peakSensitivity','峰值检测灵敏度',.4,2.5,.05)+toggle('ripple','峰值触发涟漪')+range('rippleStrength','垂直跳动幅度',0,1.8,.05)+range('motionStrength','跳动总强度',0,2.4,.05)+range('rippleSpeed','向外传播速度',.35,2,.05)+range('rippleWidth','波前宽度',.01,2,.01)+toggle('shake','峰值触发画面抖动')+range('shakeStrength','画面抖动强度',0,1.8,.05)+toggle('flash','峰值触发环境闪烁')+range('flashStrength','环境闪烁强度',0,1.6,.05)+'</details>'+
      '<details open><summary>RMS 峰值色散</summary>'+toggle('dispersion','峰值触发色散')+range('dispersionEffectLow','峰值最低色散',0,12,.1)+range('dispersionEffectHigh','峰值最高色散',0,12,.1)+'</details>'+
      '<details open><summary>瞳孔与视线 · 轻量</summary>'+toggle('eyeTracking','识别瞳孔中心与视线')+toggle('gazeOverlay','显示双眼瞳孔标记')+select('cameraProfile','摄像头占用',[{value:'eco',label:CAMERA_PROFILES.eco.label},{value:'balanced',label:CAMERA_PROFILES.balanced.label},{value:'detail',label:CAMERA_PROFILES.detail.label}])+range('gazeSmoothing','稳定滤波',.05,.8,.05)+range('gazeDeadzone','中央死区',.03,.35,.01)+range('gazeOffsetX','水平视线偏置',-.6,.6,.01)+range('gazeOffsetY','垂直视线偏置',-.6,.6,.01)+'<p class="emomusic-eye-note">先注视中央完成校准，再用偏置微调；水平正值向右，垂直正值向下。偏置不会被重新校准覆盖。</p><div class="emomusic-eye-actions"><button type="button" data-gaze-calibrate>注视中央并校准</button><button type="button" data-gaze-reset>重置校准</button></div></details>'+
      '<details><summary>射线与星河</summary>'+toggle('lasers','眼部方向射线')+select('laserDirection','射线方向绑定',[{value:'gaze',label:'瞳孔检测法向'},{value:'face',label:'面部朝向'},{value:'lyrics',label:'锁定三维歌词进度位置'}])+range('laserStrength','射线音频响应',0,1.8,.05)+range('laserWidth','射线粗细',.4,8,.1)+range('laserLength','射线长度',.4,1.8,.05)+toggle('galaxy','复用星河预设')+range('galaxyDensity','星河强度',.15,1.5,.05)+'</details>'+
      '<details><summary>实时数据</summary>'+toggle('telemetry','情绪遥测面板')+range('pollSeconds','SiliconFlow VLM 检测间隔（秒）',1,60,1)+'<p class="emomusic-eye-note">桌面主进程按 SiliconFlow 官方视觉接口直接联网；密钥仅从 SILICONFLOW_API_KEY 或加密的 AI 配置读取，不进入页面存储。</p></details>'+
      '<div class="emomusic-save"><input data-name maxlength="64" placeholder="命名当前参数"><button type="button" data-save>保存</button></div><select data-saved aria-label="已保存的 EmoMusic 参数"><option>读取预设中…</option></select><div role="status" class="external-visual-status">参数实时生效</div>';
    slot.appendChild(panel);document.getElementById('fx-panel').appendChild(slot);
    panel.querySelectorAll('[data-mode]').forEach(function(btn){btn.onclick=function(){setMode(btn.dataset.mode);};});
    panel.addEventListener('input',function(e){var input=e.target.closest&&e.target.closest('[data-setting]');if(!input)return;var key=input.dataset.setting,previous=settings[key];settings[key]=input.type==='checkbox'?input.checked:input.type==='range'?Number(input.value):input.value;if(key==='dispersionBandLowHz'&&settings.dispersionBandLowHz>=settings.dispersionBandHighHz)settings.dispersionBandHighHz=Math.min(800,settings.dispersionBandLowHz+10);if(key==='dispersionBandHighHz'&&settings.dispersionBandHighHz<=settings.dispersionBandLowHz)settings.dispersionBandLowHz=Math.max(20,settings.dispersionBandHighHz-10);if(key==='dispersionTriggerLow'&&settings.dispersionTriggerLow>=settings.dispersionTriggerHigh)settings.dispersionTriggerHigh=Math.min(1,settings.dispersionTriggerLow+.01);if(key==='dispersionTriggerHigh'&&settings.dispersionTriggerHigh<=settings.dispersionTriggerLow)settings.dispersionTriggerLow=Math.max(0,settings.dispersionTriggerHigh-.01);if(key==='dispersionEffectLow'&&settings.dispersionEffectLow>settings.dispersionEffectHigh)settings.dispersionEffectHigh=settings.dispersionEffectLow;if(key==='dispersionEffectHigh'&&settings.dispersionEffectHigh<settings.dispersionEffectLow)settings.dispersionEffectLow=settings.dispersionEffectHigh;settings=normalizeSettings(settings);syncPanel();if(key==='pollSeconds'||key==='telemetry')scheduleTelemetry(true);if(key==='cameraProfile'&&previous!==settings.cameraProfile)restartCameraForProfile();if(key==='eyeTracking'&&!settings.eyeTracking)gazeState=createGazeState();renderHud();});
    panel.querySelector('[data-saved]').onchange=function(){loadSaved().catch(function(error){setPanelStatus('读取失败：'+error.message);});};
    panel.querySelector('[data-save]').onclick=async function(){this.disabled=true;try{if(!window.desktopWindow||!window.desktopWindow.visualPresets)throw new Error('请在桌面版保存');var result=await window.desktopWindow.visualPresets('save','emomusic',panel.querySelector('[data-name]').value||'EmoMusic',settings);if(!result.ok)throw new Error(result.error);await listSaved(false,result.name);setPanelStatus('已保存到：'+result.directory);}catch(error){setPanelStatus('保存失败：'+error.message);}finally{this.disabled=false;}};
    panel.querySelector('[data-gaze-calibrate]').onclick=calibrateGaze;
    panel.querySelector('[data-gaze-reset]').onclick=resetGazeCalibration;
    syncPanel();listSaved(true).catch(function(error){setPanelStatus('读取失败：'+error.message);});
  }

  function rotate(dx,dy){if(!active)return false;view.targetYaw=clamp(view.targetYaw+Number(dx||0)*.0034,-1.18,1.18);view.targetPitch=clamp(view.targetPitch+Number(dy||0)*.0032,-.72,.72);return true;}
  function galaxyState(frameFx){var current=frameFx||(typeof fx==='object'&&fx);return{active:!!(current&&Number(current.preset)===PRESET_INDEX&&settings.galaxy),strength:clamp(settings.galaxyDensity,.15,1.5)};}
  function update(_dt,frame){var wants=!!(frame&&frame.fx&&Number(frame.fx.preset)===PRESET_INDEX);ensureCanvas();ensurePanel();canvas.classList.toggle('active',wants);document.body.classList.toggle('emomusic-active',wants);if(hud)hud.classList.toggle('active',wants&&settings.telemetry);if(!wants){if(active||starting||video||stream||faceMesh)cleanup(true);else{canvas.classList.remove('active');document.body.classList.remove('emomusic-active');if(hud)hud.classList.remove('active');}failure='';return;}if(!hostVisible()){if(active||starting||stream)cleanup(false);draw(frame);return;}if(!active&&!starting&&!failure)start();draw(frame);}
  ensurePanel();
  document.addEventListener('visibilitychange',function(){if(!hostVisible()&&(active||starting||stream))cleanup(false);});window.addEventListener('pagehide',function(){cleanup(true);});window.addEventListener('resize',function(){lastCanvasWidth=lastCanvasHeight=0;});
  return { update:update, rotate:rotate, stop:function(){cleanup(true);}, setMode:setMode, currentMode:function(){return settings.mode;}, galaxyState:galaxyState, getGaze:function(){return clone(gazeState);}, calibrateGaze:calibrateGaze, cameraConstraints:cameraConstraints, eyeMeasurement:eyeMeasurement, estimateGaze:estimateGaze, applyGazeOffset:applyGazeOffset, gazeDirection:gazeDirection, estimateFaceOrientation:estimateFaceOrientation, lyricProgressScreenTarget:lyricProgressScreenTarget, parallelLyricRay:parallelLyricRay, laserPeakFlash:laserPeakFlash, interpolateMesh:interpolateMesh, meshTriangles:meshTriangles, sourceAspect:sourceAspect, projectFacePoint:projectFacePoint, faceCropRect:faceCropRect, timeDomainRms:timeDomainRms, frequencyBandRms:frequencyBandRms, linearThresholdMap:linearThresholdMap, peakPowerMap:peakPowerMap, smoothValue:smoothValue, smoothCurve:smoothCurve, smoothPrompts:smoothPrompts, vectorArrowMarkup:vectorArrowMarkup, radarLabelMarkup:radarLabelMarkup, telemetrySourceState:telemetrySourceState, telemetryFromVlm:telemetryFromVlm, createRmsPeakState:createRmsPeakState, stepRmsPeakDetector:stepRmsPeakDetector, compositeEmotionValue:compositeEmotionValue, createRandomTelemetry:createRandomTelemetry, presetIndex:PRESET_INDEX, defaults:clone(defaults), radarPoints:radarPoints, sparkPath:sparkPath };
})();

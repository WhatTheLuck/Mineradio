'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('node:assert/strict');

const appRoot = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(appRoot, rel), 'utf8');
const source = read('public/js/modules/02-visual/17-emomusic-face-mesh.js');
const archive = read('public/js/modules/07-fx/00-preset-archive-data.js');
const loader = read('public/js/index-loader.js');
const loop = read('public/js/modules/11-main-loop.js');
const presets = read('public/js/modules/07-fx/04-preset-grid-uniforms.js');
const css = read('public/css/index.css');

const context = {
  console,
  window: { addEventListener() {} },
  document: { addEventListener() {}, hidden: false },
  performance: { now: () => 0 }
};
vm.createContext(context);
vm.runInContext(source, context, { filename: '17-emomusic-face-mesh.js' });

let migratedPayload = '';
const legacyContext = {
  console,
  window: { addEventListener() {} },
  document: { addEventListener() {}, hidden: false },
  performance: { now: () => 0 },
  localStorage: {
    getItem(key) {
      return key === 'mineradio-emomusic-visual-v2'
        ? JSON.stringify({ mode: 'particles', lasers: true, faceGlowStrength: 1.7, dispersionStrength: 0.5 })
        : null;
    },
    setItem(key, value) { if (key === 'mineradio-emomusic-visual-v3') migratedPayload = value; }
  }
};
vm.createContext(legacyContext);
vm.runInContext(source, legacyContext, { filename: '17-emomusic-face-mesh-migration.js' });
const migrated = JSON.parse(migratedPayload);
assert.equal(migrated.mode, 'mesh');
assert.equal(migrated.lasers, false);
assert.equal(migrated.particleBrightness, 1.7);
assert.equal(migrated.dispersionEffectHigh, 2.7);

const landmarks = [
  { x: 0, y: 0, z: 0 },
  { x: 1, y: 0, z: 1 },
  { x: 1, y: 1, z: 0 }
];
const dense = context.MineradioEmoMusic.interpolateMesh(landmarks, [[0, 1], [1, 2]], 1, 2);
assert.equal(context.MineradioEmoMusic.presetIndex, 15);
assert.equal(context.MineradioEmoMusic.defaults.mode, 'mesh', 'the official MediaPipe mesh is the default face mode');
assert.equal(context.MineradioEmoMusic.defaults.meshDensity, 3, 'mesh defaults to the complete landmark set while lower and higher levels visibly change point count');
assert.equal(context.MineradioEmoMusic.defaults.surfaceMeshOverlay, false, 'Surface defaults to a clean fitted surface without Mesh points or lines');
assert.equal(context.MineradioEmoMusic.defaults.shake, true, 'RMS peak screen shake is available by default');
assert.equal(context.MineradioEmoMusic.defaults.lasers, false, 'eye-normal lasers default to off');
assert.equal(dense.length, 7, 'two interpolated particles are added per sampled mesh edge');
assert.deepEqual(JSON.parse(JSON.stringify(dense[3])), { x: 1 / 3, y: 0, z: 1 / 3, sourceIndex: 0 });
assert.equal(landmarks.length, 3, 'source landmark array remains unchanged');
assert.equal(context.MineradioEmoMusic.meshTriangles([[0, 1], [1, 2], [2, 0]]).length, 1, 'tessellation edge triplets become one fitted surface triangle');

assert.equal(context.MineradioEmoMusic.sourceAspect(960, 720), 4 / 3, 'the actual camera frame aspect ratio is preserved');
assert.equal(context.MineradioEmoMusic.sourceAspect(0, 0), 4 / 3, 'camera aspect has a stable pre-stream fallback');
const projected = context.MineradioEmoMusic.projectFacePoint(
  { x: 0.6, y: 0.6, z: 0.1 },
  { cx: 0.5, cy: 0.5 },
  2,
  4 / 3
);
assert.ok(Math.abs(Math.abs(projected.x / projected.y) - 4 / 3) < 1e-12, 'equal normalized x/y offsets recover the camera pixel aspect before projection');
assert.ok(Math.abs(Math.abs(projected.z / projected.y) - 4 / 3) < 1e-12, 'MediaPipe z keeps the same physical scale as x');

const gazeLandmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
function setEye(indices, cx, cy) {
  gazeLandmarks[indices.corners[0]] = { x: cx - 0.1, y: cy, z: 0 };
  gazeLandmarks[indices.corners[1]] = { x: cx + 0.1, y: cy, z: 0 };
  gazeLandmarks[indices.lids[0]] = { x: cx, y: cy - 0.03, z: 0 };
  gazeLandmarks[indices.lids[1]] = { x: cx, y: cy + 0.03, z: 0 };
  gazeLandmarks[indices.center] = { x: cx, y: cy, z: 0 };
  indices.ring.forEach((index, ringIndex) => {
    const angle = ringIndex * Math.PI / 2;
    gazeLandmarks[index] = { x: cx + Math.cos(angle) * 0.012, y: cy + Math.sin(angle) * 0.012, z: 0 };
  });
}
const eyeDefs = [
  { corners: [33, 133], lids: [159, 145], center: 468, ring: [469, 470, 471, 472] },
  { corners: [362, 263], lids: [386, 374], center: 473, ring: [474, 475, 476, 477] }
];
setEye(eyeDefs[0], 0.38, 0.42);
setEye(eyeDefs[1], 0.62, 0.42);
const centeredGaze = context.MineradioEmoMusic.estimateGaze(gazeLandmarks, 4 / 3, { x: 0, y: 0 }, 0.12);
assert.equal(centeredGaze.valid, true, 'two open eyes produce a valid lightweight gaze sample');
assert.ok(Math.abs(centeredGaze.x) < 1e-12 && Math.abs(centeredGaze.y) < 1e-12);
assert.equal(centeredGaze.direction, '中央');
assert.equal(centeredGaze.pupils.length, 2, 'both refined iris centers are exposed as pupil-center proxies');
gazeLandmarks[468].x -= 0.035;
gazeLandmarks[473].x -= 0.035;
const rightGaze = context.MineradioEmoMusic.estimateGaze(gazeLandmarks, 4 / 3, { x: 0, y: 0 }, 0.12);
assert.ok(rightGaze.x > 0.12, 'raw webcam x is mirrored into performer-relative gaze direction');
assert.equal(rightGaze.direction, '右');
assert.equal(context.MineradioEmoMusic.gazeDirection(-0.5, -0.5, 0.12), '上左');
assert.deepEqual(JSON.parse(JSON.stringify(context.MineradioEmoMusic.cameraConstraints('eco'))), {
  audio: false,
  video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 24 } }
});
assert.equal(context.MineradioEmoMusic.defaults.cameraProfile, 'eco');
assert.equal(Object.prototype.hasOwnProperty.call(context.MineradioEmoMusic.defaults, 'gazeSampleMs'), false, 'gaze calculation is no longer independently frame-limited');
assert.equal(context.MineradioEmoMusic.laserPeakFlash(0, 1, 1), 0, 'no RMS peak envelope means no laser');
assert.equal(context.MineradioEmoMusic.laserPeakFlash(1, 0, 1), 0, 'zero peak strength means no laser');
assert.ok(context.MineradioEmoMusic.laserPeakFlash(0.8, 1.2, 1.4) > context.MineradioEmoMusic.laserPeakFlash(0.3, 0.5, 1.4), 'stronger RMS peaks produce brighter and wider laser flashes');

const rms = context.MineradioEmoMusic.timeDomainRms(new Uint8Array([128, 255, 128, 1]));
assert.ok(rms > 0.69 && rms < 0.71, 'RMS is calculated from the raw time-domain waveform');
const lowBins = new Uint8Array(1024);
lowBins[3] = 255;
lowBins[4] = 255;
assert.ok(context.MineradioEmoMusic.frequencyBandRms(lowBins, 44100, 2048, 45, 100) > 0.7, 'low-frequency RMS respects the configured Hz band');
assert.equal(context.MineradioEmoMusic.linearThresholdMap(0.11, 0.12, 0.48, 2, 6), 0, 'dispersion is completely off below its lower trigger');
assert.equal(context.MineradioEmoMusic.linearThresholdMap(0.12, 0.12, 0.48, 2, 6), 0, 'dispersion remains off exactly at its lower trigger');
assert.ok(Math.abs(context.MineradioEmoMusic.linearThresholdMap(0.30, 0.12, 0.48, 2, 6) - 4) < 1e-12, 'dispersion maps linearly between configured effect bounds');
assert.equal(context.MineradioEmoMusic.linearThresholdMap(0.8, 0.12, 0.48, 2, 6), 6, 'dispersion clamps to its upper effect bound');
assert.equal(context.MineradioEmoMusic.peakPowerMap(0.48, 2, 6), 2, 'the weakest accepted RMS peak maps to the minimum effect strength');
assert.equal(context.MineradioEmoMusic.peakPowerMap(1.5, 2, 6), 6, 'the strongest RMS peak maps to the maximum effect strength');
assert.equal(context.MineradioEmoMusic.smoothValue(0, 1, 0.2), 0.2, 'telemetry values interpolate instead of jumping to each API update');
const smoothCurve = context.MineradioEmoMusic.smoothCurve([{ ts: 'a', value: 0 }], [{ ts: 'a', value: 1 }, { ts: 'b', value: -1 }], 0.25);
assert.equal(smoothCurve[0].value, 0.25, 'existing emotion-curve points ease toward their new values');
assert.ok(smoothCurve[1].value > -1 && smoothCurve[1].value < 0.25, 'new emotion-curve points enter from the previous displayed value');
const smoothPrompts = context.MineradioEmoMusic.smoothPrompts([], [{ tag: 'bright warmth', weight: 4 }], 0.25);
assert.equal(smoothPrompts[0].weight, 1, 'radar weights ease in from zero');
assert.match(context.MineradioEmoMusic.vectorArrowMarkup({ tension_relaxation: -1 }), /Tension/);
assert.match(context.MineradioEmoMusic.vectorArrowMarkup({ tension_relaxation: 1 }), /Relaxation/);
assert.match(context.MineradioEmoMusic.vectorArrowMarkup({ tension_relaxation: 1 }), /emomusic-vector-arrow-glow/, 'emotion vectors use layered curved arrows');
assert.match(context.MineradioEmoMusic.radarLabelMarkup([{ tag: 'bright warmth', weight: 4 }], true), /bright warmth/, 'radar outer labels expose prompt names');
assert.match(context.MineradioEmoMusic.radarLabelMarkup([{ tag: 'bright warmth', weight: 4 }], false), />4\.0</, 'radar inner labels expose prompt weights');
const peakState = context.MineradioEmoMusic.createRmsPeakState();
[0.02, 0.05, 0.18, 0.31].forEach((value, index) => {
  assert.equal(context.MineradioEmoMusic.stepRmsPeakDetector(peakState, value, index * 0.02).hit, false);
});
const peak = context.MineradioEmoMusic.stepRmsPeakDetector(peakState, 0.24, 0.08);
assert.equal(peak.hit, true, 'a falling edge after a local RMS maximum triggers one ripple');
assert.ok(peak.power > 0.45, 'RMS peak magnitude drives ripple power');

const positiveVector = Object.fromEntries([
  'tension_relaxation', 'anger_calmness', 'irritation_leisure', 'sadness_happiness', 'sleepiness_energy'
].map(key => [key, 1]));
assert.equal(context.MineradioEmoMusic.compositeEmotionValue(positiveVector), 1);
const fallback = context.MineradioEmoMusic.createRandomTelemetry(() => 0.75, new Date('2026-09-15T12:00:00Z'));
assert.equal(fallback.source, 'random_fallback');
assert.equal(fallback.dimensions.length, 5);
assert.equal(fallback.prompts.items.length, 5);
assert.equal(fallback.curve.length, 1);
assert.equal(fallback.curve[0].value, context.MineradioEmoMusic.compositeEmotionValue(fallback.scores), 'emotion curve is calculated from the same random vector');

assert.match(archive, /name:\s*'EmoMusic'[\s\S]{0,220}FACE MESH/);
assert.match(archive, /presetDisplayOrder\s*=\s*\[0,\s*15,/);
assert.match(loader, /17-emomusic-face-mesh\.js/);
assert.match(loop, /MineradioEmoMusic\.update\(dt,/);
assert.match(loop, /Number\(fx\.preset\)\s*===\s*15/);
assert.match(source, /@mediapipe\/face_mesh\//);
assert.match(source, /MEDIAPIPE_ROOT \+ 'face_mesh\.js'/);
assert.match(source, /FACEMESH_TESSELATION/);
assert.match(source, /FACEMESH_RIGHT_IRIS/);
assert.match(source, /FACEMESH_LEFT_IRIS/);
assert.match(source, /mineradio-gaze-update/);
assert.match(source, /注视中央并校准/);
assert.match(source, /瞳孔中心与 Face Mesh 每帧同步/);
assert.match(source, /cameraConstraints\(settings\.cameraProfile\)/);
assert.match(source, /getUserMedia\(cameraConstraints\(settings\.cameraProfile\)\)/);
assert.match(source, /video\.videoWidth/);
assert.match(source, /video\.videoHeight/);
assert.match(source, /faceW\s*=\s*Math\.max\(\.12,\s*maxX\s*-\s*minX\)\s*\*\s*inputAspect/);
assert.doesNotMatch(source, /point\.z[^;\n]*\*\s*1\.9/, 'depth no longer has a separate exaggeration that distorts the original coordinate ratio');
assert.match(source, /stream\.getTracks\(\)\.forEach/);
assert.match(source, /mode:\s*'mesh'/);
assert.match(source, /drawMeshMode/);
assert.match(source, /drawSurfaceMode/);
assert.match(source, /drawLasers/);
assert.match(source, /meshHopDistances/);
assert.match(source, /meshDensity:\s*3/);
assert.match(source, /Mesh 点密度/);
assert.match(source, /drawDenseMeshPoints/);
assert.match(source, /drawCircularPupils/);
assert.match(source, /surfaceMeshOverlay:\s*false/);
assert.match(source, /Surface 显示 Mesh 点和线/);
assert.doesNotMatch(source, /\[255,48,48\]|\[48,255,48\]/, 'mesh and surface overlays no longer mark the eyes red and green');
assert.match(source, /angleDown:\s*200/);
assert.match(source, /angleDown:\s*235/);
assert.match(source, /angleDown:\s*270/);
assert.match(source, /angleDown:\s*305/);
assert.match(source, /angleDown:\s*340/);
assert.match(source, /data-vector-arrows/);
assert.doesNotMatch(source, /data-status/, 'the upper-right emotion API status copy is removed');
assert.match(source, /createRandomTelemetry/);
assert.match(source, /faceAudioLight/);
assert.doesNotMatch(source, /function faceNormal/, 'laser direction no longer follows the face normal');
assert.match(source, /gazeState\.x\*1\.35/);
assert.match(source, /peakEnvelope<=\.001\|\|peakPower<=0/, 'laser rendering is completely skipped outside an RMS peak envelope');
assert.match(source, /range\('laserWidth','射线粗细',\.4,8,\.1\)/, 'laser width exposes the expanded maximum');
assert.doesNotMatch(source, /var origin=\{x:0,y:0\}/, 'no gaze direction marker is drawn between the two eyes');
assert.doesNotMatch(source, /gazeSampleMs/, 'pupil and gaze estimation run on every Face Mesh result');
assert.doesNotMatch(source, /ribbons\s*=|updateRibbons|drawGalaxy/, 'legacy bottom ribbons and duplicate 2D galaxy are removed');
assert.match(source, /dispersionEffectLow/);
assert.match(source, /dispersionEffectHigh/);
assert.match(source, /peakPowerMap\(peakVisualState\.power,settings\.dispersionEffectLow,settings\.dispersionEffectHigh\)/, 'dispersion is driven by the shared RMS peak magnitude');
assert.match(source, /peakPowerMap\(peakVisualState\.power,0,settings\.shakeStrength\)/, 'screen shake is driven by the same RMS peak magnitude');
assert.match(source, /data-radar-inner-labels/);
assert.match(source, /data-radar-outer-labels/);
assert.doesNotMatch(source, /t\s*=\s*t\s*\*\s*t\s*\*\s*\(3\s*-\s*2\s*\*\s*t\)/, 'dispersion no longer uses a smoothstep curve');
assert.match(source, /rippleStrength/);
assert.match(source, /rippleSpeed/);
assert.match(source, /rippleWidth/);
assert.match(source, /flashStrength/);
assert.match(source, /particleBrightness/);
assert.doesNotMatch(source, /drawFaceAura/, 'face-wide radial aura is removed');
assert.doesNotMatch(source, /var wave\s*=\s*Math\.sin/, 'particles have no perpetual sine jump');
assert.match(source, /laserWidth/);
assert.match(source, /laserLength/);
assert.match(source, /api\/realtime_state/);
assert.match(source, /visualPresets\('save','emomusic'/);
assert.match(read('desktop/visual-preset-store.js'), /'emomusic'/);
assert.match(read('public/js/modules/02-visual/00-pointer-cover-particles.js'), /MineradioEmoMusic\.rotate\(dx,\s*dy\)/);
assert.match(read('public/js/modules/02-visual/00-pointer-cover-particles.js'), /MineradioEmoMusic\.galaxyState/);
assert.match(loop, /uniforms\.uPreset\.value\s*=\s*emomusicGalaxyActive\s*\?\s*5\s*:\s*fx\.preset/, 'EmoMusic reuses the exact Star River shader preset');
assert.match(loop, /visualRotation:\s*particles\s*&&\s*particles\.rotation/, 'EmoMusic receives the exact shared lyric-particle rotation');
assert.match(loop, /timeDomainData:\s*timeDomainData/, 'EmoMusic receives the raw waveform for RMS peak detection');
assert.match(loop, /frequencyData:\s*frequencyData/, 'the frame contract remains backward compatible for external visual consumers');
assert.match(source, /view\.targetYaw\s*=\s*clamp\(Number\(frame\.visualRotation\.y\)/);
assert.match(source, /targetYaw=clamp\(view\.targetYaw\+Number\(dx\|\|0\)\*\.0034/, 'face drag follows the same horizontal direction and gain as lyric particle rotation');
assert.match(presets, /data-emomusic-mode/);
assert.match(presets, /applyEmomusicMode/);
assert.match(read('public/js/modules/07-fx/09-console-workspace.js'), /external-emomusic-controls/);
assert.match(css, /#emomusic-face-canvas/);
assert.match(css, /\.emomusic-telemetry/);
assert.match(css, /\.emomusic-mode-submenu/);
assert.match(css, /\.emomusic-eye-actions/);

console.log('OK emomusic-face-mesh');

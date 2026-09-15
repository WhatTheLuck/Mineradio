'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('lyrics keep a more readable vertical rhythm', () => {
  const defaults = read('public/js/modules/00-state/04-fx-defaults.js');
  const rows = read('public/js/modules/02-visual/12-lyrics-row-layers.js');
  assert.match(defaults, /lyricLineHeight:\s*1\.08/);
  assert.match(rows, /lyricContextSpreadValue\(\) - 1\) \* 0\.44/);
  assert.match(rows, /0\.86, 1\.55/);
});

test('magnetic pointer and preset shortcuts return to center and bind every bundled preset', () => {
  const visualizer = read('public/vendor/source-visuals/space/src/visualizer.js');
  const external = read('public/js/modules/02-visual/16-cyber-space-presets.js');
  const grid = read('public/js/modules/07-fx/04-preset-grid-uniforms.js');
  const catalog = require('../public/vendor/source-visuals/catalog.json');
  assert.match(visualizer, /onPointerLeave[\s\S]*this\.pointerActiveUntil = 0;[\s\S]*this\.pointer\[0\] = 0;[\s\S]*this\.pointer\[1\] = 0;/);
  assert.equal(catalog.space.length, 16);
  assert.match(external, /sourcePresetNames:sourcePresetNames/);
  assert.match(external, /applySourcePreset:applySourcePreset/);
  assert.match(grid, /sourcePresetNames\('space'\)/);
  assert.match(grid, /class="space-preset-option/);
  assert.match(grid, /aria-expanded=/);
});

test('right-click tag deletion persists and realtime FFT keeps only light smoothing', () => {
  const core = require('../public/js/modules/00-state/12-smart-favorites-state.js');
  const ui = read('public/js/modules/05-playback/14a-ai-playback.js');
  const graph = read('public/js/modules/05-playback/08-audio-graph-controls.js');
  const loop = read('public/js/modules/11-main-loop.js');
  const restored = core.sanitizeSmartFavoritesState({ tags: [], deletedTags: ['jazz'] });
  assert.equal(restored.tags.some(tag => tag.value === 'jazz'), false);
  assert.deepEqual(restored.deletedTags, ['jazz']);
  assert.equal((ui.match(/addEventListener\('contextmenu'/g) || []).length, 2);
  assert.match(ui, /removeSmartAiTag/);
  assert.match(graph, /analyser\.smoothingTimeConstant = 0\.24/);
  assert.match(loop, /smoothBass = env\([\s\S]*0\.42, 0\.085\)/);
  assert.match(loop, /smoothEnergy = env\([\s\S]*0\.30, 0\.065\)/);
});

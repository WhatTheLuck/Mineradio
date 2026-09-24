'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { sanitizeSmartFavoritesState } = require('../public/js/modules/00-state/12-smart-favorites-state.js');

test('MuQ pause choice survives state normalization', () => {
  assert.equal(sanitizeSmartFavoritesState({ muqPaused: true }).muqPaused, true);
  assert.equal(sanitizeSmartFavoritesState({}).muqPaused, false);
});

test('MuQ pause keeps completed embeddings and resumes the remaining queue', async () => {
  const timers = new Map();
  let nextTimer = 0;
  let finishFirst;
  const firstResult = new Promise(resolve => { finishFirst = resolve; });
  const calls = [];
  const status = { dataset: {}, setAttribute() {} };
  const tracks = ['a', 'b', 'c'].map(key => ({ key }));
  const state = { tags: [], tracks: [], muqPaused: false };
  const sandbox = {
    document: { getElementById: id => id === 'smart-ai-analysis-status' ? status : null },
    setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    playMode: 'ai', playQueue: tracks, smartFavoritesState: state,
    smartMuqAudioVectors: {}, smartMuqAudioFingerprints: {},
    smartTrackKey: track => track.key,
    smartMuqFingerprint: track => track.key + '-fp',
    smartFavoritesBridge: () => ({
      embedMuqAudio() {},
      getMuqStatus: async () => ({ available: true }),
      getMuqAudioCache: async () => ({ entries: {} }),
    }),
    smartMuqEmbedTrack: async track => {
      calls.push(track.key);
      return track.key === 'a' ? firstResult : [1, 0];
    },
    saveSmartFavoritesState() {},
    loadSmartFavoritesState: async () => state,
    renderSmartAiControlBar() {},
    renderSmartAiPlaylist() {},
    safeRenderQueuePanel() {},
    dedupeSmartFavoriteTracks: tracks => tracks,
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/modules/05-playback/03b-smart-favorites-ui.js'), 'utf8'), sandbox);
  await Promise.resolve();

  sandbox.queueSmartFavoriteAnalysis(tracks);
  assert.equal(sandbox.smartFavoritesAnalysisQueue.length, 3);
  sandbox.toggleSmartFavoriteAnalysis();
  assert.equal(state.muqPaused, true);
  assert.equal(timers.size, 0, 'pause cancels the pending batch timer');
  assert.equal(sandbox.smartFavoritesAnalysisQueue.length, 3, 'pause does not clear the queue');
  sandbox.toggleSmartFavoriteAnalysis();
  const next = timers.values().next().value;
  timers.clear();
  const running = next();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['a']);
  sandbox.toggleSmartFavoriteAnalysis();
  finishFirst([1, 0]);
  await running;
  assert.equal(timers.size, 0, 'the current song finishes without starting the next one');
  assert.equal(sandbox.smartFavoritesAnalysisQueue.length, 2);
  assert.deepEqual(sandbox.smartMuqAudioVectors.a, [1, 0]);

  sandbox.toggleSmartFavoriteAnalysis();
  assert.equal(timers.size, 1);
  const resumed = timers.values().next().value;
  timers.clear();
  await resumed();
  assert.deepEqual(calls, ['a', 'b'], 'resume starts with the next unprocessed song');
  assert.deepEqual(sandbox.smartMuqAudioVectors.a, [1, 0], 'the completed embedding is retained');
  const last = timers.values().next().value;
  timers.clear();
  await last();
  assert.deepEqual(calls, ['a', 'b', 'c']);
  sandbox.toggleSmartFavoriteAnalysis();
  sandbox.toggleSmartFavoriteAnalysis();
  assert.equal(timers.size, 0, 'resuming after completion does not schedule a new encoding pass');
  assert.deepEqual(calls, ['a', 'b', 'c']);
});

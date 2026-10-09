'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function setup(bridge) {
  const elements = {};
  const sandbox = {
    window: { addEventListener() {} },
    document: { addEventListener() {}, getElementById(id) { if (!id.startsWith('song-gene-')) return null; return elements[id] || (elements[id] = { dataset: {}, setAttribute() {}, focus() {} }); } },
    smartTrackKey: t => t.key || '', smartTrackDurationSeconds: t => t.duration || 0,
    smartFavoritesBridge: () => bridge, escHtml: s => String(s).replace(/</g, '&lt;'),
    playQueue: [], currentIdx: -1,
  };
  vm.createContext(sandbox);
  for (const file of ['14a-ai-playback.js', '14b-song-gene-catalog.js', '14c-song-gene.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/modules/05-playback', file), 'utf8'), sandbox);
  }
  return { s: sandbox, elements };
}
test('fixed vocabulary is unique, complete across API batches, and ranks the top ten', async () => {
  const batches = [];
  const { s } = setup({ embedMuqTexts: async tags => {
    batches.push(tags.length);
    return { ok: true, vectors: Object.fromEntries(tags.map((t, i) => [t.value, [1, i + 1]])) };
  } });
  assert.ok(s.SONG_GENE_STYLES.length >= 150);
  assert.equal(new Set(s.SONG_GENE_STYLES.map(t => t.value)).size, s.SONG_GENE_STYLES.length);
  await s.ensureSongGeneTexts();
  await s.ensureSongGeneTexts();
  assert.equal(batches.reduce((a, b) => a + b), s.SONG_GENE_STYLES.length);
  assert.ok(batches.every(n => n <= 80));
  const rows = s.rankSongGene([1, 1]);
  assert.equal(rows.length, 10);
  assert.ok(rows.every((r, i) => !i || rows[i - 1].score >= r.score));
});
test('audio is shared in flight, persisted cache is reused, changed fingerprints re-encode', async () => {
  let encodes = 0, release;
  const { s } = setup({ getMuqAudioCache: async () => ({ entries: { disk: { fingerprint: 'muq-mulan-large:fp16-placeholder:24k:middle-third:10s:v6|disk|0|', vector: [0, 1] } } }) });
  s.smartMuqEmbedTrack = async () => { encodes++; return new Promise(resolve => { release = resolve; }); };
  const a = s.smartMuqEnsureAudio({ key: 'a' });
  const b = s.smartMuqEnsureAudio({ key: 'a' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(encodes, 1); release([1, 0]); await Promise.all([a, b]);
  await s.smartMuqEnsureAudio({ key: 'a' });
  assert.equal(encodes, 1);
  assert.deepEqual(await s.smartMuqEnsureAudio({ key: 'disk' }), [0, 1]);
  const changed = s.smartMuqEnsureAudio({ key: 'a', duration: 123 });
  await new Promise(resolve => setImmediate(resolve)); release([0, 1]); await changed;
  assert.equal(encodes, 2);
});
test('switching tracks or closing rejects late results, errors are retryable', async () => {
  let release;
  const { s, elements } = setup({ embedMuqAudio() {}, getMuqStatus: async () => ({ available: true }) });
  s.smartMuqEnsureAudio = () => new Promise(resolve => { release = resolve; });
  s.ensureSongGeneTexts = async () => {};
  s.rankSongGene = () => Array.from({ length: 10 }, () => ({ tag: { label: 'Rock' }, score: .5 }));
  s.songGeneEnabled = true; s.songGeneTrack = { key: 'a', name: 'A' };
  const old = s.analyzeSongGene(); await new Promise(resolve => setImmediate(resolve));
  s.updateSongGeneTrack({ key: 'b', name: 'B' });
  release([1, 0]); await old;
  assert.equal(s.songGeneRows.length, 0);
  s.toggleSongGene(false);
  assert.equal(elements['song-gene-panel'].hidden, true);
  s.smartMuqEnsureAudio = async () => { throw new Error('offline'); };
  s.songGeneEnabled = true;
  await s.analyzeSongGene();
  assert.equal(s.songGeneState, 'error'); assert.equal(elements['song-gene-retry'].hidden, false);
  s.smartMuqEnsureAudio = async () => [1, 0];
  await s.analyzeSongGene();
  assert.equal(s.songGeneState, 'ready'); assert.equal(s.songGeneRows.length, 10);
  assert.match(elements['song-gene-bars'].innerHTML, /50%/);
});

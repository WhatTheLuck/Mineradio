'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const core = require('../public/js/modules/00-state/12-smart-favorites-state.js');
const { SmartFavoritesStore } = require('../desktop/smart-favorites-store.js');

const merged = core.dedupeSmartFavoriteTracks([
  { provider: 'qq', id: 'qq-1', name: 'Blue Hour', artist: 'Mineradio', duration: 201, manualTags: ['学习'] },
  { provider: 'netease', id: 'ne-1', name: 'Blue Hour', artist: 'Mineradio', duration: 202, genre: ['Jazz'] },
  { provider: 'qq', id: 'qq-2', name: 'Blue Hour (Live)', artist: 'Mineradio', duration: 201 },
]);
assert.strictEqual(merged.length, 2, 'cross-platform duplicates merge while Live remains distinct');
assert.strictEqual(merged[0].sourceVariants.length, 2, 'merged track retains both provider variants');
assert.deepStrictEqual(merged[0].manualTags, ['study'], 'manual tags are normalized and retained');
assert.strictEqual(core.dedupeSmartFavoriteTracks([
  { provider: 'qq', id: 'same-provider-a', name: 'One', artist: 'A', duration: 180 },
  { provider: 'qq', id: 'same-provider-b', name: 'One', artist: 'A', duration: 180 },
]).length, 2, 'different IDs from the same provider remain distinct');

const eligible = core.scoreAiCandidate(
  { manualTags: ['study'], genre: ['jazz'], artist: 'A', album: 'B' },
  { required: ['study'], preferred: ['jazz'], recentKeys: [] }
);
const excluded = core.scoreAiCandidate(
  { genre: ['jazz'] },
  { required: ['study'], preferred: ['jazz'], recentKeys: [] }
);
assert.strictEqual(eligible.eligible, true, 'required manual tag can satisfy hard filter');
assert.strictEqual(excluded.eligible, false, 'missing required tag is a hard exclusion');
assert.strictEqual(core.scoreAiCandidate({ onlineIntentTags: ['study'] }, { required: ['study'] }).eligible, false, 'search intent alone cannot satisfy a required tag');
assert.ok(eligible.score > 10, 'manual and provider matches receive positive weight');
assert.strictEqual(core.scoreAiCandidate({ genre: ['jazz'], excludedTags: ['jazz'] }, { required: ['jazz'] }).eligible, false, 'a removed song tag no longer satisfies AI filters');

const baseTrack = { provider: 'qq', id: 'same', name: 'Same', artist: 'Artist', duration: 180 };
const recent = core.scoreAiCandidate(baseTrack, { recentKeys: [core.smartTrackKey(baseTrack)] });
const fresh = core.scoreAiCandidate(baseTrack, { recentKeys: [] });
assert.ok(recent.score < fresh.score, 'recently played tracks are down-ranked');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-smart-favorites-'));
const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from('protected:' + value, 'utf8'),
  decryptString: value => value.toString('utf8').replace(/^protected:/, ''),
};

try {
  const store = new SmartFavoritesStore({ userDataPath: tempRoot, safeStorage: fakeSafeStorage });
  assert.strictEqual(store.saveState({ tracks: merged, tags: [] }).ok, true, 'state persists through main-process store');
  assert.strictEqual(store.publicState().state.tracks.length, 2, 'saved smart playlist can be restored');
  const configured = store.configureLlm({ apiKey: 'test-secret', baseUrl: 'https://example.invalid/v1', model: 'test-model' });
  assert.strictEqual(configured.configured, true, 'complete LLM settings are accepted');
  assert.strictEqual(configured.apiKey, undefined, 'credential status never returns the API key');
  const credentialText = fs.readFileSync(path.join(tempRoot, 'smart-favorites-llm.json'), 'utf8');
  assert.ok(!credentialText.includes('test-secret'), 'credential file does not contain plaintext API key');
  assert.strictEqual(store.clearLlmCredential().hasKey, false, 'saved credential can be removed');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

const loader = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'index-loader.js'), 'utf8');
const controls = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'modules', '05-playback', '14-player-controls.js'), 'utf8');
const queuePanel = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'modules', '06-lyrics', '01-playlist-panel-shell.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const preload = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'preload.js'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.js'), 'utf8');
const aiPlayback = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'modules', '05-playback', '14a-ai-playback.js'), 'utf8');
const uploadDragdrop = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'modules', '06-lyrics', '05-upload-dragdrop.js'), 'utf8');
assert.ok(loader.includes('12-smart-favorites-state.js') && loader.includes('14a-ai-playback.js'), 'new modules are loaded');
assert.match(controls, /var modes = \['loop', 'shuffle', 'single'\]/, 'playback-order cycling contains only the three normal order modes');
assert.ok(html.includes('id="ai-play-mode-btn"') && html.includes('id="smart-ai-control-bar"') && html.includes('id="smart-favorites-api-key"'), 'AI has a dedicated toggle, bar, and secure credential entry');
assert.ok(html.includes('id="control-song-tags"'), 'the current-track area exposes editable tags');
assert.match(html, /control-title[\s\S]*control-song-tags/, 'the tag drop area sits below the current song title in its metadata column');
assert.match(aiPlayback, /setCurrentSmartTagDropTarget\(true\)/, 'dragging a tag reveals the current-song tag arrangement as its target');
assert.match(uploadDragdrop, /isSmartTagDrag[\s\S]*text\/mineradio-tag/, 'internal tag drags are excluded from the global file-drop overlay');
assert.match(queuePanel, /queueSmartFavoriteAnalysis\(playQueue\)/, 'known queued songs automatically enter tag analysis');
assert.ok(preload.includes("ipcRenderer.invoke('mineradio-smart-favorites-analyze'") && main.includes("ipcMain.handle('mineradio-smart-favorites-analyze'"), 'LLM calls cross the trusted Electron bridge');
assert.ok(!preload.includes('MINERADIO_LLM_API_KEY'), 'renderer bridge never reads the environment API key');

console.log('smart favorites and AI playback tests passed');

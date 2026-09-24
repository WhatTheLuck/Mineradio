'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { MuqRecommendation, textForTag, cosine, rankTracks, CACHE_VERSION } = require('../desktop/muq-recommendation');
const playerHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
assert.match(playerHtml, /id="smart-ai-add-style"[\s\S]*?id="smart-ai-style-input"/);
assert.match(playerHtml, /id="smart-ai-add-scene"[\s\S]*?id="smart-ai-scene-input"/);
assert.ok(!playerHtml.includes('smart-ai-tag-kind'), 'the detached tag-kind selector is removed');

assert.strictEqual(textForTag({ value: 'driving', label: '开车', kind: 'scene' }).text, '适合在开车时听的音乐');
assert.strictEqual(textForTag({ value: 'rock', label: '摇滚', kind: 'style' }).text, '摇滚');
assert.strictEqual(textForTag({ value: 'emoji', label: 'a'.repeat(79) + '🎵', kind: 'style' }).text, 'a'.repeat(79) + '🎵');
assert.strictEqual(cosine([1, 0], [0, 1]), 0);
assert.strictEqual(cosine([1, 0], [1, 0]), 1);
assert.ok(CACHE_VERSION.includes('24k'));

const tracks = ['a', 'b', 'c', 'd'].map(key => ({ key }));
const audio = { a: [1, 0], b: [0.9, 0.1], c: [0.1, 0.9], d: [0, 1] };
const text = { rock: [1, 0], study: [0, 1] };
const results = rankTracks(tracks, audio, [
  { value: 'rock', state: 'required' },
  { value: 'study', state: 'preferred' },
], text);
assert.ok(results.length > 0 && results.length < tracks.length, 'required match filters the playlist');
assert.ok(results.every(row => row.key === 'a' || row.key === 'b'), 'all results satisfy the required rock tag');
assert.strictEqual(rankTracks(tracks, audio, [{ value: 'rock', state: 'required' }, { value: 'study', state: 'required' }], text).length, 0, 'incompatible required tags yield no recommendation');

const renderer = {
  document: { getElementById: () => null },
  smartFavoritesState: { tags: [{ value: 'rock', label: '摇滚', kind: 'style', state: 'required' }, { value: 'study', label: '学习', kind: 'scene', state: 'preferred' }], history: [] },
  playQueue: tracks,
  currentIdx: -1,
  smartTrackKey: track => track.key,
  smartTrackAllTags: () => [],
  escHtml: value => String(value),
  playMode: 'ai',
  smartFavoritesAnalysisAttempts: {},
  playToggleBusy: false,
  smartFavoritesAnalysisQueue: [],
  smartFavoritesAnalysisBusy: false,
};
vm.createContext(renderer);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/modules/05-playback/14a-ai-playback.js'), 'utf8'), renderer);
Object.assign(renderer.smartMuqAudioVectors, audio);
Object.assign(renderer.smartMuqTextVectors, text);
const renderedOrder = Array.from(renderer.smartMuqRank(), row => row.track.key);
assert.deepStrictEqual(renderedOrder, results.map(row => row.key), 'renderer and main ranking agree');
assert.ok(renderer.smartQueueTagHtml(tracks[0], false).includes('MuQ · 摇滚'), 'encoded track shows a distinct inferred tag');
assert.ok(renderer.smartQueueTagHtml(tracks[2], false).includes('MuQ · 学习'), 'inference follows audio similarity');
assert.ok(renderer.smartQueueTagHtml(tracks[0], false).includes('<b>摇滚</b> 100%'), 'selected tag relevance is shown per track');
assert.ok(renderer.smartQueueTagHtml(tracks[0], false).includes('<b>学习</b> 0%'), 'relevance is clamped to the displayed percentage range');
assert.ok(renderer.smartQueueTagHtml({ key: 'missing' }, false).includes('MuQ 待编码'), 'missing audio is identified as pending');
assert.ok(renderer.smartQueueTagHtml({ key: 'missing' }, false).includes('计算中'), 'missing embedding never appears as a zero score');
renderer.smartFavoritesAnalysisAttempts.missing = true;
assert.ok(renderer.smartQueueTagHtml({ key: 'missing' }, false).includes('MuQ 编码失败'), 'failed audio is identified separately');
renderer.currentIdx = 0;
renderer.queueSmartFavoriteAnalysis = () => true;
renderer.smartMuqEnsureTexts = () => new Promise(() => {});
renderer.forcePlaybackControlsInteractive = () => {};
renderer.saveSmartFavoritesState = () => {};
renderer.playQueueAt = index => { renderer.playedIndex = index; return Promise.resolve(); };
renderer.showToast = () => {};
renderer.smartAiAnalysisStatus = message => { renderer.errorStatus = message; };
assert.strictEqual(renderer.playAiNextTrack(true), true, 'cached recommendation switches synchronously: ' + renderer.errorStatus);
assert.strictEqual(renderer.playedIndex, 1);
Object.keys(renderer.smartMuqAudioVectors).forEach(key => { delete renderer.smartMuqAudioVectors[key]; });
assert.strictEqual(renderer.playAiNextTrack(true), true, 'pending encoding falls back without waiting: ' + renderer.errorStatus);
assert.strictEqual(renderer.playedIndex, 2);
assert.strictEqual(renderer.playAiNextTrack(true), true, 'rapid repeated skips remain available');
assert.strictEqual(renderer.playedIndex, 3);

function addTagControl() {
  const input = { value: '', focus() { this.focused = true; } };
  const trigger = { hidden: false, setAttribute() {}, focus() { this.focused = true; } };
  const editor = { hidden: true, querySelector: () => input };
  const shell = { querySelector: selector => selector === '.smart-ai-add-trigger' ? trigger : editor };
  return { input, trigger, editor, shell };
}
const styleControl = addTagControl();
const sceneControl = addTagControl();
const controls = {
  'smart-ai-add-style': styleControl.shell,
  'smart-ai-style-input': styleControl.input,
  'smart-ai-add-scene': sceneControl.shell,
  'smart-ai-scene-input': sceneControl.input,
};
renderer.document.getElementById = id => controls[id] || null;
renderer.normalizeAiTag = value => value;
renderer.uniqueAiTags = values => values;
renderer.prefetchSmartAiOnlineCandidates = () => {};
renderer.renderSmartAiControlBar = () => {};
renderer.openSmartAiTagInput('scene');
assert.strictEqual(sceneControl.editor.hidden, false, 'scene add chip opens an inline editor');
sceneControl.input.value = '天地玄黄宇宙洪荒日月盈昃';
renderer.limitSmartAiTagInput(sceneControl.input, { isComposing: true });
assert.strictEqual(sceneControl.input.value.length, 12, 'composition is not truncated mid-input');
let prevented = false;
renderer.addSmartAiTagFromInput({ key: 'Enter', isComposing: true, preventDefault() { prevented = true; } }, 'scene');
assert.strictEqual(prevented, false, 'IME Enter does not submit the tag');
renderer.addSmartAiTagFromInput({ key: 'Enter', preventDefault() { prevented = true; } }, 'scene');
const addedScene = renderer.smartFavoritesState.tags.at(-1);
assert.strictEqual(addedScene.label, '天地玄黄宇宙洪荒日月', 'custom labels are limited to ten Chinese characters');
assert.strictEqual(addedScene.kind, 'scene');
assert.strictEqual(sceneControl.editor.hidden, true, 'submitted editor closes');
renderer.openSmartAiTagInput('style');
styleControl.input.value = '电子摇滚';
renderer.addSmartAiTagFromInput({ key: 'Enter', preventDefault() {} }, 'style');
assert.strictEqual(renderer.smartFavoritesState.tags.at(-1).kind, 'style', 'style chip creates a style tag');
(async () => {
  const client = Object.create(MuqRecommendation.prototype);
  client.cache = { text: {} };
  client.save = () => {};
  let attempts = 0;
  client.request = async (_kind, payload) => {
    assert.strictEqual(payload.text, '适合在学习时听的音乐');
    if (++attempts === 1) throw new Error('TextEncodeInput must be Union[TextInputSequence, Tuple[InputSequence, InputSequence]]');
    return [1, 0];
  };
  assert.deepStrictEqual(await client.texts([{ value: 'study', label: '学习', kind: 'scene' }]), { study: [1, 0] });
  assert.strictEqual(attempts, 2, 'transient tokenizer rejection is retried once');
  console.log('MuQ ranking tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });

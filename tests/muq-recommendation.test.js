'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { MuqRecommendation, textForTag, cosine, rankTracks, CACHE_VERSION } = require('../desktop/muq-recommendation');

assert.strictEqual(textForTag({ value: 'driving', label: '开车', kind: 'scene' }).text, '适合在开车时听的音乐');
assert.strictEqual(textForTag({ value: 'rock', label: '摇滚', kind: 'style' }).text, '摇滚');
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
};
vm.createContext(renderer);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/modules/05-playback/14a-ai-playback.js'), 'utf8'), renderer);
Object.assign(renderer.smartMuqAudioVectors, audio);
Object.assign(renderer.smartMuqTextVectors, text);
const renderedOrder = Array.from(renderer.smartMuqRank(), row => row.track.key);
assert.deepStrictEqual(renderedOrder, results.map(row => row.key), 'renderer and main ranking agree');
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

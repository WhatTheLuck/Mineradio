'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const MODEL_ID = 'OpenMuQ/MuQ-MuLan-large';
const CACHE_VERSION = 'muq-mulan-large:fp16-placeholder:24k:middle-third:10s:v6';
const SCENES = new Set(['学习', '开车', '工作', '运动', '跑步', '睡眠', '通勤', '做饭', '阅读', '冥想', '旅行', '聚会', '夜晚', 'study', 'driving', 'work', 'workout', 'sleep', 'commute', 'night']);

function textForTag(tag) {
  const label = String(tag && (tag.label || tag.value) || '').trim().slice(0, 80);
  const kind = tag && (tag.kind === 'scene' || tag.kind === 'style') ? tag.kind : (SCENES.has(label.toLowerCase()) ? 'scene' : 'style');
  return { value: String(tag && tag.value || label).slice(0, 80), kind, text: kind === 'scene' ? `适合在${label}时听的音乐` : label };
}

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return NaN;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : NaN;
}

function rankTracks(tracks, audioVectors, tags, textVectors, history = [], limit = 50) {
  const selected = (tags || []).filter(t => t.state === 'required' || t.state === 'preferred');
  const required = selected.filter(t => t.state === 'required');
  const rows = (tracks || []).map(track => {
    const vector = audioVectors[track.key];
    if (!vector) return null;
    const matches = {};
    for (const tag of selected) {
      const value = cosine(vector, textVectors[tag.value]);
      if (!Number.isFinite(value)) return null;
      matches[tag.value] = value;
    }
    return { key: track.key, matches, track };
  }).filter(Boolean);
  // Relative threshold: a mandatory tag must be among its strongest matches in the current playlist.
  const floors = {};
  for (const tag of required) {
    const values = rows.map(r => r.matches[tag.value]).sort((a, b) => b - a);
    floors[tag.value] = values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * 0.35) - 1))];
  }
  return rows.filter(row => required.every(tag => row.matches[tag.value] >= floors[tag.value]))
    .map(row => {
      const affinity = selected.length ? selected.reduce((sum, tag) => sum + row.matches[tag.value] * (tag.state === 'required' ? 1.5 : 1), 0) / selected.reduce((sum, tag) => sum + (tag.state === 'required' ? 1.5 : 1), 0) : 0;
      const recentIndex = history.lastIndexOf(row.key);
      const repeatPenalty = recentIndex < 0 ? 0 : 0.08 / (history.length - recentIndex);
      return { key: row.key, score: affinity - repeatPenalty, matches: row.matches };
    }).sort((a, b) => b.score - a.score).slice(0, limit);
}

class MuqRecommendation {
  constructor(options = {}) {
    this.userDataPath = options.userDataPath;
    this.runtimePath = options.runtimePath || path.join(__dirname, '..', 'build', 'muq-placeholder-bundle', 'muq-worker.exe');
    this.modelPath = options.modelPath || path.join(__dirname, '..', 'build', 'muq-placeholder-bundle', 'model');
    this.cachePath = path.join(this.userDataPath, 'muq-embeddings.json');
    this.cache = { version: CACHE_VERSION, audio: {}, text: {} };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
      if (parsed.version === CACHE_VERSION) this.cache = parsed;
    } catch (_) {}
    this.pending = new Map();
    this.nextId = 0;
    this.stdout = '';
    this.stderr = '';
    this.worker = null;
  }
  status() { const cache = path.join(path.dirname(this.modelPath), 'hf-cache'); return { ok: true, available: fs.existsSync(this.runtimePath) && fs.existsSync(path.join(this.modelPath, 'model.safetensors')) && fs.existsSync(path.join(cache, 'models--OpenMuQ--MuQ-large-msd-iter')) && fs.existsSync(path.join(cache, 'models--xlm-roberta-base')), model: MODEL_ID, cachedAudio: Object.keys(this.cache.audio).length }; }
  save() {
    const tmp = `${this.cachePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.cache));
    fs.renameSync(tmp, this.cachePath);
  }
  start() {
    if (this.worker && !this.worker.killed) return;
    if (!this.status().available) throw new Error('MUQ_RUNTIME_NOT_BUNDLED');
    this.worker = spawn(this.runtimePath, [this.modelPath], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, MINERADIO_MUQ_EXPANDED_ROOT: path.join(this.userDataPath, 'muq-expanded-v6') } });
    this.worker.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk.toString('utf8')).slice(-1000); });
    this.worker.stdout.on('data', chunk => {
      this.stdout += chunk.toString('utf8');
      let end;
      while ((end = this.stdout.indexOf('\n')) >= 0) {
        const line = this.stdout.slice(0, end); this.stdout = this.stdout.slice(end + 1);
        try {
          const result = JSON.parse(line);
          const pending = this.pending.get(result.id);
          if (!pending) continue;
          this.pending.delete(result.id);
          result.error ? pending.reject(new Error(result.error)) : pending.resolve(result.vector);
        } catch (_) {}
      }
    });
    this.worker.on('error', error => {
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear(); this.worker = null;
    });
    this.worker.on('exit', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('MUQ_WORKER_EXITED: ' + this.stderr.slice(-250)));
      this.pending.clear(); this.worker = null;
    });
  }
  request(kind, payload) {
    this.start();
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('MUQ_TIMEOUT')); }, 120000);
      this.pending.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
      this.worker.stdin.write(JSON.stringify({ id, kind, ...payload }) + '\n');
    });
  }
  async audio(key, fingerprint, pcm) {
    if (!key || !fingerprint) throw new Error('INVALID_AUDIO_ID');
    const cached = this.cache.audio[key];
    if (cached && cached.fingerprint === fingerprint) return cached.vector;
    const samples = pcm instanceof Float32Array ? pcm : new Float32Array(pcm);
    if (samples.length < 24000 || samples.length > 240000) throw new Error('INVALID_AUDIO_SAMPLE');
    const vector = await this.request('audio', { pcm: Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength).toString('base64') });
    this.cache.audio[key] = { fingerprint, vector, at: Date.now() };
    this.save();
    return vector;
  }
  async texts(tags) {
    const vectors = {};
    for (const raw of tags.slice(0, 80)) {
      const tag = textForTag(raw);
      if (!tag.value || !tag.text) continue;
      const key = `${tag.kind}:${tag.text}`;
      if (!this.cache.text[key]) {
        let vector;
        try { vector = await this.request('text', { text: tag.text }); }
        catch (error) {
          if (!/TextEncodeInput|TextinputSequence/i.test(String(error && error.message))) throw error;
          vector = await this.request('text', { text: tag.text });
        }
        this.cache.text[key] = { vector, at: Date.now() };
        this.save();
      }
      vectors[tag.value] = this.cache.text[key].vector;
    }
    return vectors;
  }
  audioCache(keys) {
    const output = {};
    for (const key of keys.slice(0, 10000)) if (this.cache.audio[key]) output[key] = this.cache.audio[key];
    return output;
  }
}

module.exports = { MuqRecommendation, CACHE_VERSION, textForTag, cosine, rankTracks };

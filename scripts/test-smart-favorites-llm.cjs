'use strict';

const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');
const { SmartFavoritesStore } = require('../desktop/smart-favorites-store');

// safeStorage is tied to Chromium's user-data directory. Point this helper at
// the same directory as Mineradio before Electron becomes ready, otherwise a
// valid saved key looks undecryptable and the diagnostic reports a false
// LLM_NOT_CONFIGURED result.
app.setName('Mineradio');
const mineradioUserDataPath = path.join(app.getPath('appData'), 'Mineradio');
app.setPath('userData', mineradioUserDataPath);
let cacheRoot = fs.existsSync('D:\\') ? 'D:\\MineradioCache' : path.join(mineradioUserDataPath, 'cache');
try {
  const saved = JSON.parse(fs.readFileSync(path.join(mineradioUserDataPath, 'cache-settings.json'), 'utf8'));
  if (saved && path.isAbsolute(saved.rootPath)) cacheRoot = saved.rootPath;
} catch (_) { }
app.setPath('sessionData', path.join(cacheRoot, 'chromium', 'Mineradio'));

app.whenReady().then(async () => {
  const store = new SmartFavoritesStore({
    userDataPath: mineradioUserDataPath,
    safeStorage,
  });
  let result;
  if (process.env.MINERADIO_LLM_SAVE_MODEL) {
    result = store.configureLlm({ model: process.env.MINERADIO_LLM_SAVE_MODEL });
  } else if (process.env.MINERADIO_LLM_TEST_LIST_MODELS === '1') {
    const config = store.readCredential();
    if (!config.apiKey || !config.baseUrl) {
      result = { ok: false, error: 'LLM_NOT_CONFIGURED' };
    } else {
      const response = await fetch(config.baseUrl.replace(/\/+$/, '') + '/models', {
        headers: { authorization: 'Bearer ' + config.apiKey },
      });
      const body = await response.json();
      const ids = Array.isArray(body && body.data) ? body.data.map(item => String(item && item.id || '')) : [];
      result = { ok: response.ok, status: response.status, models: ids.filter(id => /qwen|deepseek|glm/i.test(id)).slice(0, 80) };
    }
  } else if (process.env.MINERADIO_LLM_TEST_ANALYZE === '1') {
    const snapshot = store.readSnapshot();
    const tracks = snapshot && snapshot.state && Array.isArray(snapshot.state.tracks)
      ? snapshot.state.tracks.slice(0, Math.max(1, Math.min(8, Number(process.env.MINERADIO_LLM_TEST_TRACKS) || 1)))
      : [];
    const requestedTags = snapshot && snapshot.state && Array.isArray(snapshot.state.tags)
      ? snapshot.state.tags.map(tag => String(tag && tag.value || '').trim()).filter(Boolean)
      : [];
    result = await store.analyzeTracks(tracks.map(track => ({
      key: String(track.provider || track.source || 'netease') + ':' + String(track.id || track.songId || track.mid || ''),
      title: track.name || track.title || '',
      artist: track.artist || '',
      album: track.album || '',
      duration: track.duration || track.durationMs || track.dt || 0,
      genre: track.genre || track.genres || [],
      style: track.style || track.styles || [],
      mood: track.mood || track.moods || [],
      scene: track.scene || track.scenes || [],
      tags: track.tags || [],
      description: track.description || '',
    })), requestedTags);
  } else {
    result = await store.testLlmConnection({ timeoutMs: Number(process.env.MINERADIO_LLM_TEST_TIMEOUT_MS) || 20000 });
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  app.quit();
}).catch(error => {
  process.stderr.write(JSON.stringify({ ok: false, stage: 'startup', error: error && error.message || String(error) }) + '\n');
  app.quit();
});

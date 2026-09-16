'use strict';

const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');
const { SmartFavoritesStore } = require('../desktop/smart-favorites-store');
const { EmomusicVlmClient } = require('../desktop/emomusic-vlm-client');

app.setName('Mineradio');
const mineradioUserDataPath = path.join(app.getPath('appData'), 'Mineradio');
app.setPath('userData', mineradioUserDataPath);
let cacheRoot = fs.existsSync('D:\\') ? 'D:\\MineradioCache' : path.join(mineradioUserDataPath, 'cache');
try {
  const saved = JSON.parse(fs.readFileSync(path.join(mineradioUserDataPath, 'cache-settings.json'), 'utf8'));
  if (saved && path.isAbsolute(saved.rootPath)) cacheRoot = saved.rootPath;
} catch (_) { }
app.setPath('sessionData', path.join(cacheRoot, 'chromium', 'Mineradio'));

function imageDataUrl(imagePath) {
  const extension = path.extname(imagePath).toLowerCase();
  const mime = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
  return 'data:' + mime + ';base64,' + fs.readFileSync(imagePath).toString('base64');
}

app.whenReady().then(async () => {
  const imagePath = path.resolve(process.argv[2] || '');
  if (!imagePath || !fs.existsSync(imagePath)) throw new Error('Usage: electron scripts/test-emomusic-vlm.cjs <face-image>');
  const store = new SmartFavoritesStore({ userDataPath: mineradioUserDataPath, safeStorage });
  const client = new EmomusicVlmClient({ credentialProvider: () => store.readCredential() });
  const result = await client.analyzeFrame(imageDataUrl(imagePath));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  app.quit();
}).catch(error => {
  process.stderr.write(JSON.stringify({ ok: false, stage: 'startup', error: error && error.message || String(error) }) + '\n');
  app.quit();
});

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
if (!fs.existsSync(electron)) {
  console.log('[SKIP] Electron executable not installed.');
  process.exit(0);
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-i18n-'));
const child = path.join(temp, 'smoke.js');
fs.writeFileSync(child, `
const fs = require('fs');
const http = require('http');
const path = require('path');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.MINERADIO_I18N_TEMP);
const root = process.env.MINERADIO_I18N_ROOT;
const html = '<!doctype html><html lang="zh-CN"><body>' +
  '<button data-language-switch>EN</button><span id="label">播放</span>' +
  '<span id="song" class="search-result-title" title="歌手详情">播放</span>' +
  '<span id="count">12 首 · 正在播放 3</span>' +
  '<textarea placeholder="搜索歌曲、歌手..."></textarea><div id="dynamic"></div>' +
  '<script src="/i18n.js"></' + 'script></body></html>';
const server = http.createServer((req, res) => {
  const file = req.url === '/i18n.js' ? 'i18n.js' : req.url === '/js/i18n.en.json' ? 'i18n.en.json' : null;
  if (!file) { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html); return; }
  res.setHeader('content-type', file.endsWith('.json') ? 'application/json' : 'text/javascript');
  res.end(fs.readFileSync(path.join(root, 'public', 'js', file)));
});
async function waitFor(win, expression) {
  for (let i = 0; i < 60; i++) {
    if (await win.webContents.executeJavaScript(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Timed out: ' + expression);
}
app.whenReady().then(() => server.listen(0, '127.0.0.1', async () => {
  try {
    const url = 'http://127.0.0.1:' + server.address().port + '/';
    const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } });
    await win.loadURL(url);
    await win.webContents.executeJavaScript("document.querySelector('[data-language-switch]').click()");
    await waitFor(win, "document.getElementById('label').textContent === 'Play'");
    await waitFor(win, "document.getElementById('count').textContent === '12 songs · Playing 3'");
    const translated = await win.webContents.executeJavaScript("(() => { document.getElementById('dynamic').innerHTML = '<button title=\\\"热键设置\\\">下一首</button>'; return { lang: document.documentElement.lang, song: document.getElementById('song').textContent, title: document.getElementById('song').title, placeholder: document.querySelector('textarea').placeholder }; })()");
    await waitFor(win, "document.querySelector('#dynamic button').textContent === 'Next song'");
    if (translated.lang !== 'en' || translated.song !== '播放' || translated.title === '歌手详情' || translated.placeholder === '搜索歌曲、歌手...') throw new Error('Metadata, UI attributes or lang changed incorrectly');
    await win.webContents.executeJavaScript("document.querySelector('[data-language-switch]').click()");
    await waitFor(win, "document.getElementById('label').textContent === '播放' && document.getElementById('count').textContent === '12 首 · 正在播放 3' && document.querySelector('#dynamic button').textContent === '下一首'");
    await win.webContents.executeJavaScript("document.querySelector('[data-language-switch]').click()");
    await win.reload();
    await waitFor(win, "document.getElementById('label').textContent === 'Play'");
    console.log('MINERADIO_I18N_QA:OK');
    server.close(() => app.exit(0));
  } catch (error) {
    console.error('MINERADIO_I18N_QA:' + (error && error.stack || error));
    server.close(() => app.exit(1));
  }
})).catch(error => { console.error(error); app.exit(1); });
`, 'utf8');

try {
  const result = spawnSync(electron, [child], {
    cwd: root,
    env: { ...process.env, MINERADIO_I18N_ROOT: root, MINERADIO_I18N_TEMP: temp },
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout || String(result.error));
  assert.match(result.stdout, /MINERADIO_I18N_QA:OK/);
  console.log('[OK] English switching, dynamic UI, metadata isolation and persistence.');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { LocalMusicLibrary } = require('../desktop/local-music-library');
const { BuiltInPlaylistLibrary, BUNDLED_MUSIC_PLAYLIST_ID } = require('../desktop/built-in-playlist-library');
const { syncBundledMusic } = require('../desktop/bundled-music');

test('bundled MP3s become an offline local playlist and remain stable across restarts', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-bundled-music-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const appPath = path.join(root, 'app');
  const userDataPath = path.join(root, 'user');
  fs.mkdirSync(path.join(appPath, 'music'), { recursive: true });
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(path.join(appPath, 'music', '离线歌曲.mp3'), Buffer.from('test audio bytes'));
  const makeLibraries = () => ({
    localMusicLibrary: new LocalMusicLibrary({
      userDataPath,
      parseMetadata: async () => ({ common: { title: '离线歌曲', artist: '测试歌手' }, format: { duration: 12 } }),
    }),
    builtInPlaylistLibrary: new BuiltInPlaylistLibrary({ userDataPath }),
  });
  const first = makeLibraries();
  const seeded = await syncBundledMusic({ appPath, userDataPath, ...first });
  assert.equal(seeded.count, 1);
  assert.equal(seeded.skipped, false);
  const playlist = first.builtInPlaylistLibrary.listSync().playlists.find((item) => item.id === BUNDLED_MUSIC_PLAYLIST_ID);
  assert.equal(playlist.name, '本地音乐');
  assert.equal(playlist.trackCount, 1);
  const track = first.builtInPlaylistLibrary.page(playlist.id).tracks[0];
  assert.equal(track.name, '离线歌曲');
  assert.match(track.localUrl, /^mineradio-local:\/\/audio\//);
  const response = await first.localMusicLibrary.mediaResponse(new Request(track.localUrl, { headers: { Range: 'bytes=0-3' } }));
  assert.equal(response.status, 206);
  assert.equal(await response.text(), 'test');
  const second = makeLibraries();
  const repeated = await syncBundledMusic({ appPath, userDataPath, ...second });
  assert.equal(repeated.skipped, true);
  assert.equal(second.builtInPlaylistLibrary.page(playlist.id).total, 1);
});

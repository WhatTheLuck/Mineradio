const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { BUNDLED_MUSIC_PLAYLIST_ID } = require('./built-in-playlist-library');
const { localFileId } = require('./local-music-library');

const STATE_FILE = 'bundled-music-state.json';

async function syncBundledMusic({ appPath, userDataPath, localMusicLibrary, builtInPlaylistLibrary }) {
  const directory = path.join(appPath, 'music');
  let entries;
  try {
    entries = (await fs.promises.readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.mp3')
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  } catch (error) {
    if (error.code === 'ENOENT') return { ok: true, count: 0, skipped: true };
    throw error;
  }
  if (!entries.length) return { ok: true, count: 0, skipped: true };
  const files = await Promise.all(entries.map(async (entry) => {
    const filePath = path.join(directory, entry.name);
    const stat = await fs.promises.stat(filePath);
    return { path: filePath, relativePath: entry.name, size: stat.size };
  }));
  const signature = crypto.createHash('sha256')
    .update(JSON.stringify(files.map(({ path: filePath, size }) => [filePath, size])))
    .digest('hex');
  const statePath = path.join(userDataPath, STATE_FILE);
  let previous = {};
  try { previous = JSON.parse(await fs.promises.readFile(statePath, 'utf8')); } catch (_) {}
  const playlistExists = builtInPlaylistLibrary.playlists.some((item) => item.id === BUNDLED_MUSIC_PLAYLIST_ID);
  const allIndexed = files.every((file) => localMusicLibrary.records.has(localFileId(file.path)));
  if (previous.signature === signature && playlistExists && allIndexed) {
    return { ok: true, count: files.length, skipped: true };
  }
  const imported = await localMusicLibrary.importFiles(files, { replace: false });
  if (!imported.ok || (imported.failures && imported.failures.length)) {
    throw new Error(`BUNDLED_MUSIC_IMPORT_FAILED: ${JSON.stringify(imported.failures || [])}`);
  }
  const bundledPaths = new Set(files.map((file) => path.resolve(file.path).toLowerCase()));
  const tracks = localMusicLibrary.order
    .map((id) => localMusicLibrary.records.get(id))
    .filter((record) => record && bundledPaths.has(path.resolve(record.audioPath).toLowerCase()))
    .map((record) => localMusicLibrary.serializeRecord(record));
  if (tracks.length !== files.length) throw new Error('BUNDLED_MUSIC_TRACK_COUNT_MISMATCH');
  await builtInPlaylistLibrary.syncBundledMusic(tracks);
  const temporary = `${statePath}.${process.pid}.tmp`;
  try {
    await fs.promises.writeFile(temporary, JSON.stringify({ signature, count: tracks.length }), 'utf8');
    await fs.promises.rename(temporary, statePath);
  } catch (error) {
    try { await fs.promises.unlink(temporary); } catch (_) {}
    throw error;
  }
  return { ok: true, count: tracks.length, skipped: false };
}

module.exports = { syncBundledMusic };

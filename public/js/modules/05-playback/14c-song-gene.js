'use strict';

var songGeneEnabled = false;
var songGeneTrack = null;
var songGeneFingerprint = '';
var songGeneRevision = 0;
var songGeneTexts = Object.create(null);
var songGeneTextRequest = null;
var songGeneRows = [];
var songGeneState = 'idle';
var songGeneError = '';

function songGeneEnglish() { return window.MineradioI18n && window.MineradioI18n.getLanguage() === 'en'; }
function songGeneCopy(zh, en) { return songGeneEnglish() ? en : zh; }

async function ensureSongGeneTexts() {
  if (SONG_GENE_STYLES.every(function (tag) { return songGeneTexts[tag.value]; })) return songGeneTexts;
  if (songGeneTextRequest) return songGeneTextRequest;
  songGeneTextRequest = (async function () {
    // Desktop API accepts at most 80 texts. Batches also preserve partial progress on retry.
    for (var i = 0; i < SONG_GENE_STYLES.length; i += 32) {
      var tags = SONG_GENE_STYLES.slice(i, i + 32).filter(function (tag) { return !songGeneTexts[tag.value]; });
      if (!tags.length) continue;
      var result = await smartFavoritesBridge().embedMuqTexts(tags.map(function (tag) { return { value: tag.value, label: tag.prompt, kind: 'style' }; }));
      if (!result || !result.ok) throw new Error(result && result.error || 'MuQ text encoding failed');
      tags.forEach(function (tag) {
        if (!result.vectors || !result.vectors[tag.value]) throw new Error('Incomplete style vectors');
        songGeneTexts[tag.value] = result.vectors[tag.value];
      });
    }
    return songGeneTexts;
  })().finally(function () { songGeneTextRequest = null; });
  return songGeneTextRequest;
}

function rankSongGene(vector) {
  return SONG_GENE_STYLES.map(function (tag) { return { tag: tag, score: smartMuqCosine(vector, songGeneTexts[tag.value]) }; })
    .filter(function (row) { return isFinite(row.score); })
    .sort(function (a, b) { return b.score - a.score; }).slice(0, 10);
}

function renderSongGene() {
  var panel = document.getElementById('song-gene-panel');
  var button = document.getElementById('song-gene-btn');
  if (!panel || !button) return;
  panel.hidden = !songGeneEnabled;
  button.setAttribute('aria-pressed', String(songGeneEnabled));
  button.setAttribute('aria-expanded', String(songGeneEnabled));
  button.title = songGeneCopy('歌曲基因分析', 'Song DNA analysis');
  button.setAttribute('aria-label', button.title);
  panel.dataset.state = songGeneState;
  document.getElementById('song-gene-heading').textContent = songGeneCopy('歌曲基因', 'Song DNA');
  document.getElementById('song-gene-close').title = songGeneCopy('关闭歌曲基因分析', 'Close Song DNA analysis');
  document.getElementById('song-gene-close').setAttribute('aria-label', document.getElementById('song-gene-close').title);
  var track = songGeneTrack || {};
  document.getElementById('song-gene-title').textContent = track.name || track.title || songGeneCopy('还没有播放歌曲', 'No song playing');
  document.getElementById('song-gene-artist').textContent = track.artist || songGeneCopy('未知作者', 'Unknown artist');
  document.getElementById('song-gene-album').textContent = track.album || songGeneCopy('未知专辑', 'Unknown album');
  document.getElementById('song-gene-caption').textContent = songGeneCopy('风格相似度 · 非占比', 'Style similarity · not a composition');
  var status = songGeneState === 'loading' ? songGeneCopy('正在分析音乐与风格…', 'Comparing music and styles…') :
    songGeneState === 'error' ? songGeneCopy('分析失败：', 'Analysis failed: ') + songGeneError :
    songGeneState === 'ready' ? songGeneCopy('匹配前 10 · ', 'Top 10 · ') + SONG_GENE_STYLES.length + songGeneCopy(' 种固定风格', ' fixed styles') :
    songGeneCopy('播放一首歌曲，探索它的风格基因', 'Play a song to explore its musical DNA');
  document.getElementById('song-gene-status').textContent = status;
  document.getElementById('song-gene-retry').hidden = songGeneState !== 'error';
  document.getElementById('song-gene-retry').textContent = songGeneCopy('重试分析', 'Retry analysis');
  document.getElementById('song-gene-bars').innerHTML = songGeneRows.map(function (row) {
    var percent = smartMuqRelevancePercent(row.score);
    var label = songGeneEnglish() ? row.tag.english : row.tag.label;
    return '<li><div class="song-gene-label"><span>' + escHtml(label) + '</span><b>' + percent + '%</b></div>' +
      '<div class="song-gene-bar" role="meter" aria-label="' + escHtml(label) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + percent + '"><span style="width:' + percent + '%"></span></div></li>';
  }).join('');
}

async function analyzeSongGene() {
  var track = songGeneTrack, revision = ++songGeneRevision;
  songGeneRows = []; songGeneError = '';
  if (!songGeneEnabled || !track || !smartTrackKey(track)) { songGeneState = 'idle'; renderSongGene(); return; }
  songGeneState = 'loading'; renderSongGene();
  try {
    var bridge = smartFavoritesBridge();
    if (!bridge || typeof bridge.embedMuqAudio !== 'function') throw new Error(songGeneCopy('请使用带 MuQ 模型的桌面版', 'Use the desktop app with the MuQ model'));
    var status = await bridge.getMuqStatus();
    if (!status || !status.available) throw new Error(songGeneCopy('MuQ 模型不可用，请检查桌面版模型文件', 'MuQ model unavailable; check the desktop model files'));
    // Audio first; a quick track change never queues encoding for every intervening song.
    if (!songGeneEnabled || revision !== songGeneRevision) return;
    var vector = await smartMuqEnsureAudio(track);
    if (!songGeneEnabled || revision !== songGeneRevision) return;
    await ensureSongGeneTexts();
    if (!songGeneEnabled || revision !== songGeneRevision) return;
    songGeneRows = rankSongGene(vector);
    if (songGeneRows.length !== 10) throw new Error('Invalid style similarity vectors');
    songGeneState = 'ready';
  } catch (error) {
    if (!songGeneEnabled || revision !== songGeneRevision) return;
    songGeneState = 'error'; songGeneError = error && error.message || String(error);
  }
  renderSongGene();
}

function updateSongGeneTrack(track) {
  if (track && !track.name && !track.title && !track.id && !track.localUrl) track = null;
  var fingerprint = track && smartTrackKey(track) ? smartMuqFingerprint(track) : '';
  songGeneTrack = track;
  if (fingerprint === songGeneFingerprint) { if (songGeneEnabled) renderSongGene(); return; }
  songGeneFingerprint = fingerprint;
  ++songGeneRevision; songGeneRows = []; songGeneState = 'idle';
  if (songGeneEnabled) void analyzeSongGene();
}

function toggleSongGene(force) {
  songGeneEnabled = typeof force === 'boolean' ? force : !songGeneEnabled;
  ++songGeneRevision;
  if (songGeneEnabled) {
    songGeneTrack = (typeof currentLocalSong !== 'undefined' && currentLocalSong) || (playQueue && playQueue[currentIdx]) || null;
    songGeneFingerprint = songGeneTrack ? smartMuqFingerprint(songGeneTrack) : '';
    void analyzeSongGene();
  } else {
    renderSongGene();
    document.getElementById('song-gene-btn').focus();
  }
}

window.addEventListener('mineradio-language-change', renderSongGene);
document.addEventListener('keydown', function (event) {
  if (event.key === 'Escape' && songGeneEnabled) toggleSongGene(false);
});
renderSongGene();

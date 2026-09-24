'use strict';

var smartAiOnlineRequest = null;
var smartAiDraggingTag = '';
var smartAiBasePlayMode = 'loop';
var smartMuqAudioVectors = Object.create(null);
var smartMuqAudioFingerprints = Object.create(null);
var smartMuqTextVectors = Object.create(null);
var smartMuqTextRequest = null;

function smartMuqFingerprint(track) {
  return ['muq-mulan-large:fp16-placeholder:24k:middle-third:10s:v6', smartTrackKey(track), smartTrackDurationSeconds(track), track.localUrl || ''].join('|');
}

async function smartMuqEmbedTrack(track, fingerprint) {
  var bridge = smartFavoritesBridge();
  var url = track.localUrl || '';
  if (!url) {
    var resolved = await resolveAlbumGaplessPlaybackData(track);
    if (!resolved || !resolved.url || resolved.trial) throw new Error('没有可采样的完整音频');
    url = '/api/audio?url=' + encodeURIComponent(resolved.url);
  }
  var response = await fetch(url);
  if (!response.ok) throw new Error('音频读取失败 '+response.status);
  var encoded = await response.arrayBuffer();
  var decodeContext = new (window.AudioContext || window.webkitAudioContext)();
  var decoded;
  try { decoded = await decodeContext.decodeAudioData(encoded); }
  finally { await decodeContext.close(); }
  var seconds = Math.min(10, decoded.duration);
  if (!isFinite(seconds) || seconds < 1) throw new Error('音频太短');
  var start = Math.max(0, Math.min(decoded.duration - seconds, decoded.duration / 3));
  var frames = Math.max(24000, Math.round(seconds * 24000));
  var offline = new OfflineAudioContext(1, frames, 24000);
  var source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start(0, start, seconds);
  var sample = await offline.startRendering();
  var pcm = sample.getChannelData(0);
  var result = await bridge.embedMuqAudio(smartTrackKey(track), fingerprint, pcm);
  if (!result || !result.ok) throw new Error(result && result.error || 'MuQ 音频编码失败');
  return result.vector;
}

function smartMuqTags() {
  return (smartFavoritesState.tags || []).filter(function (tag) { return tag.state !== 'neutral'; }).map(function (tag) {
    return { value: tag.value, label: tag.label, kind: tag.kind || (/^(study|driving|work|workout|sleep|commute|night)$/.test(tag.value) ? 'scene' : 'style'), state: tag.state };
  });
}

function smartMuqAllTags() {
  return (smartFavoritesState.tags || []).map(function (tag) {
    return { value: tag.value, label: tag.label, kind: tag.kind || (/^(study|driving|work|workout|sleep|commute|night)$/.test(tag.value) ? 'scene' : 'style') };
  });
}

async function smartMuqEnsureTexts() {
  if (smartMuqTextRequest) return smartMuqTextRequest;
  var tags = smartMuqAllTags();
  if (!tags.length) return;
  smartMuqTextRequest = smartFavoritesBridge().embedMuqTexts(tags).then(function (result) {
    if (!result || !result.ok) throw new Error(result && result.error || 'MuQ 文本编码失败');
    Object.assign(smartMuqTextVectors, result.vectors);
    if (typeof safeRenderQueuePanel === 'function') safeRenderQueuePanel('muq-texts-ready');
  }).finally(function () { smartMuqTextRequest = null; });
  return smartMuqTextRequest;
}

function smartMuqCosine(a, b) {
  if (!a || !b || a.length !== b.length) return NaN;
  var sum = 0, aa = 0, bb = 0;
  for (var i = 0; i < a.length; i++) { sum += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return aa && bb ? sum / Math.sqrt(aa * bb) : NaN;
}

function smartMuqRelevancePercent(score) {
  return Math.max(0, Math.min(100, Math.round(score * 100)));
}

function smartMuqRank() {
  var tags = smartMuqTags();
  var required = tags.filter(function (tag) { return tag.state === 'required'; });
  var rows = (playQueue || []).map(function (track, index) {
    var audioVector = smartMuqAudioVectors[smartTrackKey(track)];
    if (!audioVector) return null;
    var matches = Object.create(null);
    for (var i = 0; i < tags.length; i++) {
      var match = smartMuqCosine(audioVector, smartMuqTextVectors[tags[i].value]);
      if (!isFinite(match)) return null;
      matches[tags[i].value] = match;
    }
    return { track: track, index: index, matches: matches };
  }).filter(Boolean);
  var floors = Object.create(null);
  required.forEach(function (tag) {
    var values = rows.map(function (row) { return row.matches[tag.value]; }).sort(function (a, b) { return b - a; });
    floors[tag.value] = values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * .35) - 1))];
  });
  return rows.filter(function (row) {
    return required.every(function (tag) { return row.matches[tag.value] >= floors[tag.value]; });
  }).map(function (row) {
    var weights = tags.reduce(function (sum, tag) { return sum + (tag.state === 'required' ? 1.5 : 1); }, 0);
    var affinity = weights ? tags.reduce(function (sum, tag) { return sum + row.matches[tag.value] * (tag.state === 'required' ? 1.5 : 1); }, 0) / weights : 0;
    var history = smartFavoritesState.history || [];
    var last = history.lastIndexOf(smartTrackKey(row.track));
    row.score = affinity - (last < 0 ? 0 : .08 / (history.length - last));
    return row;
  }).sort(function (a, b) { return b.score - a.score; });
}

function renderSmartAiPlaylist() {
  var root = document.getElementById('smart-ai-recommend-list');
  if (!root) return;
  var rows = smartMuqRank().filter(function (row) { return row.index !== currentIdx; }).slice(0, 12);
  root.innerHTML = rows.map(function (row, index) {
    return '<button type="button" data-muq-index="'+row.index+'"><b>'+(index+1)+'</b><span>'+escHtml(row.track.name || row.track.title || '未知歌曲')+'</span><small>'+smartMuqRelevancePercent(row.score)+'%</small></button>';
  }).join('') || '<span class="smart-ai-recommend-empty">正在分析歌单音频…</span>';
}

function playSmartAiRecommendation(index) {
  var track = playQueue[Number(index)];
  if (track) playSmartAiSelection(track, true, 'next');
}

function smartAiTagStateLabel(state) {
  return state === 'required' ? '必须满足' : (state === 'preferred' ? '尽量满足' : '不选');
}

function smartAiTagButtonHtml(tag) {
  var state = normalizeAiTagState(tag.state);
  return '<button type="button" draggable="true" class="smart-ai-tag" data-smart-ai-tag="' + escHtml(tag.value) + '" data-state="' + state + '" data-kind="' + (tag.kind === 'scene' ? 'scene' : 'style') + '" aria-label="' + escHtml(tag.label) + '，' + smartAiTagStateLabel(state) + '" title="点击切换筛选状态；右键删除；拖到当前播放栏可添加给歌曲">' +
    '<span>' + escHtml(tag.label) + '</span><i aria-hidden="true">' + (state === 'required' ? '必须' : (state === 'preferred' ? '尽量' : '')) + '</i></button>';
}

function smartTagLabel(value) {
  var tag = (smartFavoritesState.tags || []).find(function (item) { return item.value === value; });
  return tag && tag.label || value;
}

function smartTrackKnownTags(song) {
  return typeof smartTrackAllTags === 'function' ? smartTrackAllTags(song) : [];
}

function smartMuqInferredTags(song) {
  var vector = song && smartMuqAudioVectors[smartTrackKey(song)];
  if (!vector) return [];
  return (smartFavoritesState.tags || []).map(function (tag) {
    return { tag: tag, score: smartMuqCosine(vector, smartMuqTextVectors[tag.value]) };
  }).filter(function (row) { return isFinite(row.score); })
    .sort(function (a, b) { return b.score - a.score; }).slice(0, 2);
}

function smartQueueTagHtml(song, compact) {
  if (playMode !== 'ai') return '';
  var audioVector = song && smartMuqAudioVectors[smartTrackKey(song)];
  var selected = smartMuqTags();
  var relevance = selected.map(function (tag) {
    var score = smartMuqCosine(audioVector, smartMuqTextVectors[tag.value]);
    var value = isFinite(score) ? smartMuqRelevancePercent(score) + '%' : '计算中';
    return '<span class="queue-ai-relevance-item" title="' + escHtml(tag.label) + ' · MuQ 音频与标签的余弦相关度"><b>' + escHtml(tag.label) + '</b> ' + value + '</span>';
  }).join('');
  var relevanceHtml = relevance ? '<span class="queue-ai-relevance' + (compact ? ' compact' : '') + '">' + relevance + '</span>' : '';
  var tags = smartTrackKnownTags(song);
  if (!tags.length) {
    var inferred = smartMuqInferredTags(song);
    if (inferred.length) return relevanceHtml + '<span class="queue-ai-tags' + (compact ? ' compact' : '') + '">' + inferred.map(function (row) {
      return '<span class="queue-ai-tag" data-source="muq" title="MuQ 音频相似度推断，未保存为人工标注">MuQ · ' + escHtml(row.tag.label || row.tag.value) + '</span>';
    }).join('') + '</span>';
    var key = song && smartTrackKey(song);
    var status = key && smartMuqAudioVectors[key] ? 'MuQ 已编码 · 无可用标签' :
      (key && smartFavoritesAnalysisAttempts[key] ? 'MuQ 编码失败' : 'MuQ 待编码');
    return relevanceHtml + '<span class="queue-ai-tags empty">' + status + '</span>';
  }
  return relevanceHtml + '<span class="queue-ai-tags' + (compact ? ' compact' : '') + '">' + tags.map(function (value) {
    var config = (smartFavoritesState.tags || []).find(function (item) { return item.value === value; });
    var active = config && config.state !== 'neutral';
    return '<span class="queue-ai-tag" data-active="' + (active ? 'true' : 'false') + '" data-state="' + (config ? normalizeAiTagState(config.state) : 'neutral') + '">' + escHtml(smartTagLabel(value)) + '</span>';
  }).join('') + '</span>';
}

function renderCurrentSmartTags() {
  var root = document.getElementById('control-song-tags');
  if (!root) return;
  var song = currentIdx >= 0 && playQueue[currentIdx] || null;
  var tags = smartTrackKnownTags(song);
  root.classList.toggle('empty', !tags.length);
  root.innerHTML = tags.length ? tags.map(function (value) {
    return '<button type="button" class="control-song-tag" data-current-song-tag="' + escHtml(value) + '" title="点击或右键删除标签 ' + escHtml(smartTagLabel(value)) + '"><span>' + escHtml(smartTagLabel(value)) + '</span><i aria-hidden="true">×</i></button>';
  }).join('') : '<span class="control-song-tags-hint">拖入上方标签，为当前歌曲标注</span>';
}

function removeCurrentSmartTag(value) {
  var song = currentIdx >= 0 && playQueue[currentIdx] || null;
  if (!song || !removeSmartTrackTag(song, value)) return;
  renderCurrentSmartTags();
  renderSmartAiPlaylist();
  safeRenderQueuePanel('smart-tag-removed');
  showToast('已从当前歌曲移除标签“' + smartTagLabel(value) + '”');
}

function bindCurrentSmartTagDrop() {
  var root = document.getElementById('control-song-tags');
  if (!root || root.dataset.bound === '1') return;
  root.dataset.bound = '1';
  root.addEventListener('click', function (event) {
    var button = event.target.closest('[data-current-song-tag]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    removeCurrentSmartTag(button.getAttribute('data-current-song-tag'));
  });
  root.addEventListener('contextmenu', function (event) {
    var button = event.target.closest('[data-current-song-tag]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    removeCurrentSmartTag(button.getAttribute('data-current-song-tag'));
  });
  root.addEventListener('dragover', function (event) { if (smartAiDraggingTag) { event.preventDefault(); if(event.dataTransfer)event.dataTransfer.dropEffect='copy';root.classList.add('drop-ready'); } });
  root.addEventListener('dragleave', function (event) { if (!root.contains(event.relatedTarget)) root.classList.remove('drop-ready'); });
  root.addEventListener('drop', function (event) {
    event.preventDefault();
    root.classList.remove('drop-ready');
    var song = currentIdx >= 0 && playQueue[currentIdx] || null;
    var value = smartAiDraggingTag || (event.dataTransfer && event.dataTransfer.getData('text/mineradio-tag'));
    if (!song || !value || !setSmartTrackManualTag(song, value)) return;
    renderCurrentSmartTags();
    safeRenderQueuePanel('smart-tag-added');
    showToast('已为当前歌曲添加标签“' + smartTagLabel(value) + '”');
  });
}

function setCurrentSmartTagDropTarget(active) {
  var root = document.getElementById('control-song-tags');
  if (!root) return;
  root.classList.toggle('drop-target-active', !!active);
  if (!active) root.classList.remove('drop-ready');
}

function renderSmartAiControlBar() {
  var bar = document.getElementById('smart-ai-control-bar');
  if (!bar) return;
  var tags = document.getElementById('smart-ai-tags');
  if (tags) {
    var tagItems = document.getElementById('smart-ai-tag-items');
    if (tagItems) tagItems.innerHTML = (smartFavoritesState.tags || []).map(smartAiTagButtonHtml).join('');
    tags.querySelectorAll('[data-smart-ai-tag]').forEach(function (button) {
      button.addEventListener('click', function () { cycleSmartAiTag(button.getAttribute('data-smart-ai-tag')); });
      button.addEventListener('contextmenu', function (event) {
        event.preventDefault();
        event.stopPropagation();
        removeSmartAiTag(button.getAttribute('data-smart-ai-tag'));
      });
      button.addEventListener('dragstart', function (event) {
        smartAiDraggingTag = button.getAttribute('data-smart-ai-tag');
        button.classList.add('smart-ai-dragging');
        setCurrentSmartTagDropTarget(true);
        if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData('text/mineradio-tag', smartAiDraggingTag); }
      });
      button.addEventListener('dragend', function () { smartAiDraggingTag = ''; button.classList.remove('smart-ai-dragging'); setCurrentSmartTagDropTarget(false); });
    });
  }
  document.querySelectorAll('[data-smart-ai-scope]').forEach(function (button) {
    var active = button.getAttribute('data-smart-ai-scope') === smartFavoritesState.scope;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  updateAiControlVisibility();
  bindCurrentSmartTagDrop();
  renderCurrentSmartTags();
}

function removeSmartAiTag(value) {
  value = normalizeAiTag(value);
  var tag = (smartFavoritesState.tags || []).find(function (item) { return item.value === value; });
  if (!tag) return;
  var label = tag.label || value;
  smartFavoritesState.tags = smartFavoritesState.tags.filter(function (item) { return item.value !== value; });
  smartFavoritesState.deletedTags = uniqueAiTags((smartFavoritesState.deletedTags || []).concat([value]));
  saveSmartFavoritesState('delete-filter-tag', true);
  renderSmartAiControlBar();
  if (typeof safeRenderQueuePanel === 'function') safeRenderQueuePanel('smart-filter-tag-deleted');
  showToast('已删除标签“' + label + '”');
  prefetchSmartAiOnlineCandidates();
}

function updateAiControlVisibility() {
  var bar = document.getElementById('smart-ai-control-bar');
  if (!bar) return;
  var visible = playMode === 'ai';
  var direct=document.getElementById('ai-play-mode-btn');
  if(direct){direct.classList.toggle('active',visible);direct.setAttribute('aria-pressed',String(visible));}
  bar.hidden = !visible;
  bar.setAttribute('aria-hidden', visible ? 'false' : 'true');
  var bottom = document.getElementById('bottom-bar');
  if (bottom) bottom.classList.toggle('ai-mode', visible);
}

function cycleSmartAiTag(value) {
  var tag = (smartFavoritesState.tags || []).find(function (item) { return item.value === value; });
  if (!tag) return;
  tag.state = tag.state === 'neutral' ? 'preferred' : (tag.state === 'preferred' ? 'required' : 'neutral');
  saveSmartFavoritesState('tag-state', true);
  renderSmartAiControlBar();
  if (typeof safeRenderQueuePanel === 'function') safeRenderQueuePanel('smart-filter-changed');
  prefetchSmartAiOnlineCandidates();
  smartMuqEnsureTexts().then(renderSmartAiPlaylist).catch(function (error) { smartAiAnalysisStatus(error.message); });
}

function openSmartAiTagInput(kind) {
  if (kind !== 'style' && kind !== 'scene') return;
  closeSmartAiTagInput(kind === 'style' ? 'scene' : 'style');
  var shell = document.getElementById('smart-ai-add-' + kind);
  if (!shell) return;
  var trigger = shell.querySelector('.smart-ai-add-trigger');
  var editor = shell.querySelector('.smart-ai-add-editor');
  trigger.hidden = true;
  trigger.setAttribute('aria-expanded', 'true');
  editor.hidden = false;
  editor.querySelector('input').focus();
}

function closeSmartAiTagInput(kind, restoreFocus) {
  var shell = document.getElementById('smart-ai-add-' + kind);
  if (!shell) return;
  var trigger = shell.querySelector('.smart-ai-add-trigger');
  var editor = shell.querySelector('.smart-ai-add-editor');
  editor.hidden = true;
  editor.querySelector('input').value = '';
  trigger.hidden = false;
  trigger.setAttribute('aria-expanded', 'false');
  if (restoreFocus) trigger.focus();
}

function limitSmartAiTagInput(input, event) {
  if (input && !(event && event.isComposing)) input.value = Array.from(input.value).slice(0, 10).join('');
}

function addSmartAiTagFromInput(event, kind) {
  if (!event || event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeSmartAiTagInput(kind, true);
    return;
  }
  if (event.key !== 'Enter') return;
  event.preventDefault();
  var input = document.getElementById('smart-ai-' + kind + '-input');
  if (!input) return;
  var label = Array.from(String(input.value || '').trim().replace(/^#+/, '')).slice(0, 10).join('');
  var value = normalizeAiTag(label);
  if (!label || !value) return;
  var existing = smartFavoritesState.tags.find(function (tag) { return tag.value === value; });
  if (existing) existing.state = existing.state === 'neutral' ? 'preferred' : existing.state;
  else smartFavoritesState.tags.push({ label: label, value: value, kind: kind, state: 'preferred', preset: false });
  smartFavoritesState.deletedTags = uniqueAiTags(smartFavoritesState.deletedTags || []).filter(function (tag) { return tag !== value; });
  closeSmartAiTagInput(kind, true);
  saveSmartFavoritesState('new-tag', true);
  renderSmartAiControlBar();
  prefetchSmartAiOnlineCandidates();
  smartMuqEnsureTexts().then(renderSmartAiPlaylist).catch(function (error) { smartAiAnalysisStatus(error.message); });
}

function setSmartAiScope(scope) {
  if (!/^(private|online|mixed)$/.test(scope)) return;
  smartFavoritesState.scope = scope;
  saveSmartFavoritesState('scope', true);
  renderSmartAiControlBar();
  if (scope !== 'private') prefetchSmartAiOnlineCandidates();
}

function smartAiContext() {
  var active = smartActiveTagContext();
  var current = currentIdx >= 0 && playQueue[currentIdx] || null;
  return {
    required: active.required,
    preferred: active.preferred,
    recentKeys: (smartFavoritesState.history || []).slice(-16),
    lastTrack: current,
    energyTarget: null
  };
}

function smartAiWeightedPick(tracks, context) {
  var currentKey = currentIdx >= 0 && playQueue[currentIdx] ? smartTrackKey(playQueue[currentIdx]) : '';
  var scored = (tracks || []).filter(Boolean).map(function (track) {
    return { track: track, result: scoreAiCandidate(track, context) };
  }).filter(function (entry) {
    return entry.result.eligible && (smartTrackKey(entry.track) !== currentKey || tracks.length === 1);
  }).sort(function (a, b) { return b.result.score - a.result.score; }).slice(0, SMART_FAVORITES_TOP_N);
  if (!scored.length) return null;
  var floor = scored[scored.length - 1].result.score;
  var weights = scored.map(function (entry) { return Math.max(0.25, entry.result.score - floor + 1); });
  var total = weights.reduce(function (sum, weight) { return sum + weight; }, 0);
  var cursor = Math.random() * total;
  for (var i = 0; i < scored.length; i++) {
    cursor -= weights[i];
    if (cursor <= 0) return scored[i].track;
  }
  return scored[0].track;
}

function smartAiQueryInfo() {
  var active = smartActiveTagContext();
  var values = uniqueAiTags(active.required.concat(active.preferred));
  var labels = values.map(function (value) {
    var tag = smartFavoritesState.tags.find(function (item) { return item.value === value; });
    return tag && tag.label || value;
  });
  return { values: values, query: labels.join(' ') };
}

function smartAiOnlineProviders() {
  var providers = ['netease'];
  if (qqLoginStatus && qqLoginStatus.loggedIn) providers.push('qq');
  if (kugouLoginStatus && kugouLoginStatus.loggedIn) providers.push('kugou');
  if (qishuiLoginStatus && qishuiLoginStatus.loggedIn) providers.push('qishui');
  if (spotifyLoginStatus && spotifyLoginStatus.loggedIn) providers.push('spotify');
  return providers.slice(0, 3);
}

function smartAiOnlineCacheKey(queryInfo) {
  return uniqueAiTags(queryInfo && queryInfo.values || []).sort().join('+') || 'daily';
}

function smartAiCachedOnlineCandidates(queryInfo) {
  var entry = smartFavoritesState.onlineCache && smartFavoritesState.onlineCache[smartAiOnlineCacheKey(queryInfo)];
  if (!entry || Date.now() - Number(entry.cachedAt || 0) > SMART_FAVORITES_ONLINE_CACHE_TTL) return null;
  return Array.isArray(entry.tracks) ? entry.tracks : [];
}

async function fetchSmartAiOnlineCandidates(force) {
  var queryInfo = smartAiQueryInfo();
  var cached = !force && smartAiCachedOnlineCandidates(queryInfo);
  if (cached) return cached;
  if (smartAiOnlineRequest) return smartAiOnlineRequest;
  if (!queryInfo.query) {
    var daily = homeDiscoverState && Array.isArray(homeDiscoverState.songs) ? homeDiscoverState.songs.slice(0, 36).map(cloneSong) : [];
    smartFavoritesState.onlineCache[smartAiOnlineCacheKey(queryInfo)] = { cachedAt: Date.now(), tracks: daily };
    saveSmartFavoritesState('online-daily-cache', false);
    return daily;
  }
  smartAiOnlineRequest = Promise.allSettled(smartAiOnlineProviders().map(function (provider) {
    return apiJson(searchProviderUrl(provider, queryInfo.query, 18, 0), { timeoutMs: 14000 });
  })).then(function (settled) {
    var tracks = [];
    settled.forEach(function (entry) {
      if (entry.status !== 'fulfilled') return;
      (entry.value && entry.value.songs || []).forEach(function (song) {
        var clone = cloneSong(song);
        clone.onlineIntentTags = queryInfo.values.slice();
        tracks.push(clone);
      });
    });
    tracks = dedupeSmartFavoriteTracks(tracks).slice(0, 72);
    smartFavoritesState.onlineCache[smartAiOnlineCacheKey(queryInfo)] = { cachedAt: Date.now(), tracks: tracks };
    saveSmartFavoritesState('online-cache', false);
    queueSmartFavoriteAnalysis(tracks.slice(0, 24));
    return tracks;
  }).finally(function () { smartAiOnlineRequest = null; });
  return smartAiOnlineRequest;
}

function prefetchSmartAiOnlineCandidates() {
  queueSmartFavoriteAnalysis(playQueue || []);
  smartMuqEnsureTexts().then(renderSmartAiPlaylist).catch(function (error) { smartAiAnalysisStatus(error.message); });
  if(typeof schedulePlaylistQueueHydration==='function')schedulePlaylistQueueHydration(0,'ai-complete-playlist');
  return;

}

function smartAiRememberCurrent() {
  var current = currentIdx >= 0 && playQueue[currentIdx];
  if (!current) return;
  var key = smartTrackKey(current);
  var history = smartFavoritesState.history || [];
  if (!history.length || history[history.length - 1] !== key) history.push(key);
  smartFavoritesState.history = history.slice(-100);
}

function smartAiFindTrack(key) {
  var pools = [playQueue || [], smartFavoritesState.tracks || []];
  Object.keys(smartFavoritesState.onlineCache || {}).forEach(function (cacheKey) {
    var entry = smartFavoritesState.onlineCache[cacheKey];
    if (entry && Array.isArray(entry.tracks)) pools.push(entry.tracks);
  });
  for (var i = 0; i < pools.length; i++) {
    var found = pools[i].find(function (track) { return smartTrackKey(track) === key; });
    if (found) return found;
  }
  return null;
}

function playSmartAiSelection(track, userInitiated, historyMode) {
  if (!track) return false;
  var index = playQueue.findIndex(function (candidate) { return smartTrackKey(candidate) === smartTrackKey(track); });
  if (index < 0) { playQueue.push(cloneSong(track)); index = playQueue.length - 1; }
  if (historyMode !== 'previous') smartFavoritesState.history.push(smartTrackKey(track));
  smartFavoritesState.history = smartFavoritesState.history.slice(-100);
  saveSmartFavoritesState('ai-history', false);
  currentIdx = index;
  var opts = userInitiated ? { manual: true, suppressPlayFailureNotice: true, aiSelection: true } : { suppressPlayFailureNotice: true, aiSelection: true };
  Promise.resolve(playQueueAt(index, opts)).finally(forcePlaybackControlsInteractive);
  queueSmartFavoriteAnalysis([track]);
  return true;
}

function playAiNextTrack(userInitiated) {
  try { return selectAiNextTrack(userInitiated); }
  catch (error) {
    smartAiAnalysisStatus('MuQ 推荐失败：'+(error && error.message || '模型不可用'));
    showToast('MuQ 推荐暂不可用');
    return false;
  }
}

function selectAiNextTrack(userInitiated) {
  playToggleBusy = false;
  forcePlaybackControlsInteractive();
  var pool = playQueue || [];
  if (!pool.length) return false;
  queueSmartFavoriteAnalysis(pool);
  smartMuqEnsureTexts().then(renderSmartAiPlaylist).catch(function (error) { smartAiAnalysisStatus('MuQ 文本编码失败：' + error.message); });
  var selectedRow = smartMuqRank().find(function (row) { return row.index !== currentIdx; });
  var selected = selectedRow && selectedRow.track;
  if (!selected) {
    var incomplete = smartFavoritesAnalysisQueue.length || smartFavoritesAnalysisBusy ||
      pool.some(function (track) { return !smartMuqAudioVectors[smartTrackKey(track)]; }) ||
      smartMuqTags().some(function (tag) { return !smartMuqTextVectors[tag.value]; });
    if (!incomplete) {
      showToast('没有已编码歌曲同时满足全部“必须”标签');
      return false;
    }
    selected = pool[(currentIdx + 1) % pool.length];
  }
  smartAiRememberCurrent();
  return playSmartAiSelection(selected, userInitiated, 'next');
}

function playAiPreviousTrack(userInitiated) {
  var history = smartFavoritesState.history || [];
  var current = currentIdx >= 0 && playQueue[currentIdx] ? smartTrackKey(playQueue[currentIdx]) : '';
  while (history.length && history[history.length - 1] === current) history.pop();
  var key = history.pop();
  smartFavoritesState.history = history;
  if (!key) { showToast('AI 播放历史里还没有上一首'); return false; }
  var track = smartAiFindTrack(key);
  if (!track) { showToast('上一首已不在当前可用曲库'); return false; }
  saveSmartFavoritesState('ai-history-back', false);
  return playSmartAiSelection(track, userInitiated, 'previous');
}

function toggleAiPlayMode(){
  var enabling=playMode!=='ai';
  if(!enabling) playMode=smartAiBasePlayMode;
  else {
    smartAiBasePlayMode=/^(loop|shuffle|single)$/.test(playMode)?playMode:'loop';
    playMode='ai';
    if (typeof clearAlbumGaplessPreload === 'function') clearAlbumGaplessPreload('play-mode-ai');
    if (typeof resetCuefieldAutoMix === 'function') resetCuefieldAutoMix('play-mode-ai');
    prefetchSmartAiOnlineCandidates();
  }
  syncActiveAudioRepeatMode(audio);
  updatePlayModeButton(true);
  queueSmartFavoriteAnalysis(playQueue||[]);
  if (typeof safeRenderQueuePanel === 'function') safeRenderQueuePanel('ai-mode-toggle');
  showToast(enabling?'AI 播放已开启':'AI 播放已关闭');
}

renderSmartAiControlBar();

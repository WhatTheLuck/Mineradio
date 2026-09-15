'use strict';

var smartFavoritesDraftSources = Object.create(null);
var smartFavoritesSyncBusy = false;
var smartFavoritesAnalysisQueue = [];
var smartFavoritesAnalysisBusy = false;
var smartFavoritesAnalysisTimer = 0;
var smartFavoritesAnalysisPromise = null;
var smartMetadataRequests = Object.create(null);
var smartFavoritesAnalysisAttempts = Object.create(null);

function smartAnalysisTags() { return (smartFavoritesState.tags || []).map(function(tag){return tag.value;}).sort(); }
function smartAnalysisSignature() { return JSON.stringify(smartAnalysisTags()); }
function smartAiAnalysisStatus(message) {
  var node = document.getElementById('smart-ai-analysis-status');
  if (node) node.textContent = message;
}

function smartAnalysisAvailability(tracks) {
  var rows = (tracks || []).filter(Boolean);
  var count = function (test) { return rows.filter(test).length; };
  var named = count(function (track) { return !!(track.name || track.title); });
  var artists = count(function (track) { return !!track.artist; });
  var albums = count(function (track) { return !!track.album; });
  var providerTags = count(function (track) { return smartTrackProviderTags(track).length > 0; });
  var rich = count(function (track) { return !!(track.year || track.language || track.description); });
  return rows.length + ' 首：标题 ' + named + '、歌手 ' + artists + '、专辑 ' + albums + '、已有标签 ' + providerTags + '、补充信息 ' + rich;
}

function retrySmartFavoriteAnalysis() {
  var tracks = (playQueue || []).length ? playQueue : smartFavoritesState.tracks;
  smartFavoritesAnalysisQueue = [];
  smartFavoritesAnalysisAttempts = Object.create(null);
  smartAiAnalysisStatus('准备重试 · ' + smartAnalysisAvailability(tracks));
  queueSmartFavoriteAnalysis(tracks);
}

async function enrichSmartTrack(track) {
  var url = typeof albumDetailUrlForSong === 'function' ? albumDetailUrlForSong(track) : '';
  if (!url) return track;
  var cache = smartFavoritesState.metadataCache || (smartFavoritesState.metadataCache = {});
  var cached = cache[url];
  if (!cached || Date.now() - cached.at > (cached.failed ? 60000 : 30*86400000)) {
    if (!smartMetadataRequests[url]) smartMetadataRequests[url] = apiJson(url, {timeoutMs:8000}).then(function(result){
      if (!result || result.error) throw new Error('元数据不可用');
      var album=result.album||{};
      var date=album.year||album.releaseDate||album.publishTime||'';
      var year=typeof date==='number'&&date>1000000000?new Date(date).getFullYear():String(date).slice(0,4);
      return cache[url]={at:Date.now(),album:{genre:album.genre||album.genres||[],tags:album.tags||[],language:album.language||'',year:year,description:String(album.description||album.introduction||'').slice(0,1800)},tracks:(result.songs||[]).map(function(song){return {key:smartTrackKey(song),metadata:smartAnalysisPayload(song)};})};
    }).catch(function(){return cache[url]={at:Date.now(),failed:true};}).finally(function(){delete smartMetadataRequests[url];});
    cached=await smartMetadataRequests[url];
  }
  if (cached.failed) return track;
  var match=(cached.tracks||[]).find(function(row){return row.key===smartTrackKey(track);});
  var metadata=Object.assign({},cached.album);
  Object.keys(match&&match.metadata||{}).forEach(function(key){var value=match.metadata[key];if(value&&(!Array.isArray(value)||value.length))metadata[key]=value;});
  ['genre','style','tags','language','year','description'].forEach(function(key){if(metadata[key]&&(!Array.isArray(metadata[key])||metadata[key].length)&&(!track[key]||Array.isArray(track[key])&&!track[key].length))track[key]=metadata[key];});
  return track;
}

function smartPlaylistKey(playlist) {
  return smartTrackProvider(playlist) + ':' + String(playlist && playlist.id || '');
}

function smartPlaylistIsLiked(playlist) {
  if (!playlist) return false;
  return !!(playlist.virtual || Number(playlist.specialType || 0) === 5 || /我喜欢|我的喜欢|喜欢的音乐|收藏歌曲|liked\s*(songs|music)?|favorites?/i.test(String(playlist.name || '')));
}

function smartPlaylistProviderLabel(provider) {
  return provider === 'qq' ? 'QQ' : (provider === 'spotify' ? 'SP' : (provider === 'kugou' ? 'KG' : (provider === 'qishui' ? 'QS' : (provider === 'mineradio' ? 'MR' : 'NE'))));
}

function smartPlaylistCatalog() {
  var rows = (userPlaylists || []).filter(function (playlist) { return playlist && playlist.id; });
  return rows.map(function (playlist, index) { return { playlist: playlist, index: index, liked: smartPlaylistIsLiked(playlist) }; })
    .sort(function (a, b) {
      if (a.liked !== b.liked) return a.liked ? -1 : 1;
      if (smartTrackProvider(a.playlist) !== smartTrackProvider(b.playlist)) return smartTrackProvider(a.playlist).localeCompare(smartTrackProvider(b.playlist));
      return a.index - b.index;
    }).map(function (entry) { return entry.playlist; });
}

function smartFavoritesModalMask() { return document.getElementById('smart-favorites-modal'); }

function smartFavoritesStatus(text, tone) {
  var node = document.getElementById('smart-favorites-status');
  if (!node) return;
  node.textContent = text || '';
  node.dataset.tone = tone || '';
}

function smartFavoriteSelectedKeys() {
  return Object.keys(smartFavoritesDraftSources).filter(function (key) { return !!smartFavoritesDraftSources[key]; });
}

function renderSmartFavoritesSources() {
  var root = document.getElementById('smart-favorites-source-list');
  if (!root) return;
  var rows = smartPlaylistCatalog();
  if (!rows.length) {
    root.innerHTML = '<div class="smart-favorites-empty"><strong>还没有可选歌单</strong><span>请先登录音乐平台或创建 Mineradio 本地歌单。</span></div>';
    return;
  }
  root.innerHTML = rows.map(function (playlist) {
    var key = smartPlaylistKey(playlist);
    var checked = !!smartFavoritesDraftSources[key];
    var provider = smartTrackProvider(playlist);
    var cover = playlist.cover ? '<img src="' + escHtml(coverUrlWithSize(playlist.cover, 96)) + '" alt="" loading="lazy">' : '<span class="smart-source-placeholder">' + smartPlaylistProviderLabel(provider) + '</span>';
    return '<label class="smart-source-row' + (checked ? ' selected' : '') + '">' +
      '<input type="checkbox" data-smart-source="' + escHtml(key) + '"' + (checked ? ' checked' : '') + '>' + cover +
      '<span class="smart-source-copy"><strong>' + escHtml(playlist.name || '未命名歌单') + '</strong><small>' + escHtml(playlistProviderName(provider)) + (playlist.trackCount ? ' · ' + playlist.trackCount + ' 首' : '') + '</small></span>' +
      (smartPlaylistIsLiked(playlist) ? '<span class="smart-source-priority">优先</span>' : '') + '<span class="smart-source-check" aria-hidden="true"></span></label>';
  }).join('');
  root.querySelectorAll('[data-smart-source]').forEach(function (input) {
    input.addEventListener('change', function () {
      smartFavoritesDraftSources[input.getAttribute('data-smart-source')] = !!input.checked;
      input.closest('.smart-source-row').classList.toggle('selected', !!input.checked);
      updateSmartFavoritesModalSummary();
    });
  });
}

function updateSmartFavoritesModalSummary() {
  var selected = smartFavoriteSelectedKeys().length;
  var count = smartFavoritesState.tracks.length;
  var summary = document.getElementById('smart-favorites-summary');
  var play = document.getElementById('smart-favorites-play');
  var sync = document.getElementById('smart-favorites-sync');
  if (summary) summary.textContent = selected + ' 个来源 · ' + count + ' 首去重歌曲';
  if (play) play.disabled = count < 1 || smartFavoritesSyncBusy;
  if (sync) sync.disabled = selected < 1 || smartFavoritesSyncBusy;
}

async function openSmartFavoritesHome(options) {
  options = options || {};
  await loadSmartFavoritesState();
  smartFavoritesDraftSources = Object.create(null);
  (smartFavoritesState.sources || []).forEach(function (source) { smartFavoritesDraftSources[source.provider + ':' + source.playlistId] = true; });
  var mask = smartFavoritesModalMask();
  if (!mask) return;
  mask.classList.toggle('llm-settings-mode',!!options.settings);
  document.getElementById('smart-favorites-heading').textContent=options.settings?'AI 播放设置':'合并收藏夹';
  if (typeof showGsapModal === 'function') showGsapModal(mask);
  else mask.classList.add('show');
  mask.setAttribute('aria-hidden', 'false');
  renderSmartFavoritesSources();
  updateSmartFavoritesModalSummary();
  refreshSmartFavoritesLlmStatus();
  if (options.settings) {
    var settings = document.getElementById('smart-favorites-llm-settings');
    if (settings) settings.open = true;
    setTimeout(function () { var key = document.getElementById('smart-favorites-api-key'); if (key) key.focus(); }, 120);
  } else {
    setTimeout(function () { var first = mask.querySelector('input, button'); if (first) first.focus(); }, 120);
  }
  if (typeof refreshUserPlaylists === 'function') {
    Promise.resolve(refreshUserPlaylists(false)).then(function () { renderSmartFavoritesSources(); updateSmartFavoritesModalSummary(); });
  }
}

function closeSmartFavoritesModal() {
  var mask = smartFavoritesModalMask();
  if (!mask || smartFavoritesSyncBusy) return;
  if (typeof closeGsapModal === 'function') closeGsapModal(mask);
  else mask.classList.remove('show');
  mask.setAttribute('aria-hidden', 'true');
}

function smartSourceFromPlaylist(playlist) {
  return {
    provider: smartTrackProvider(playlist),
    playlistId: String(playlist.id || ''),
    playlistName: String(playlist.name || ''),
    liked: smartPlaylistIsLiked(playlist),
    lastSyncAt: 0
  };
}

async function fetchAllSmartSourceTracks(source) {
  var tracks = [];
  var offset = 0;
  var limit = source.provider === 'spotify' ? 100 : 96;
  var rounds = 0;
  while (rounds++ < 200) {
    var result = await fetchPlaylistTracksPage(source.provider, source.playlistId, { offset: offset, limit: limit }, { timeoutMs: 18000 });
    var page = result && Array.isArray(result.tracks) ? result.tracks : [];
    page.forEach(function (track) {
      var clone = cloneSong(track);
      if (!clone.provider && !clone.source) clone.provider = source.provider;
      clone.smartSourceKeys = Array.from(new Set((clone.smartSourceKeys || []).concat([source.provider + ':' + source.playlistId])));
      tracks.push(clone);
    });
    var nextOffset = Number(result && result.nextOffset);
    if (!isFinite(nextOffset) || nextOffset <= offset) nextOffset = offset + page.length;
    var total = Number(result && (result.total || result.playlist && result.playlist.trackCount)) || 0;
    var hasMore = result && result.hasMore === true;
    if (!hasMore && total > nextOffset && page.length) hasMore = true;
    if (!page.length || !hasMore) break;
    offset = nextOffset;
  }
  return tracks;
}

function mergeSmartTracksWithCachedAnnotations(nextTracks, previousTracks) {
  var previous = previousTracks || [];
  return dedupeSmartFavoriteTracks(nextTracks).map(function (track) {
    var cached = previous.find(function (old) {
      return smartTrackKey(old) === smartTrackKey(track) || smartTrackSoftKey(old) === smartTrackSoftKey(track) || smartTracksSoftEqual(old, track) ||
        (old.sourceVariants || []).some(function (variant) { return variant.provider + ':' + variant.trackId === smartTrackKey(track); });
    });
    return cached ? mergeSmartTrack(cached, track) : track;
  });
}

async function createMergedFavorites() {
  if(smartFavoritesSyncBusy)return;
  var input=document.getElementById('merged-playlist-name');
  var name=String(input&&input.value||'').trim()||'合并收藏夹';
  if(!await syncSmartFavorites())return;
  smartFavoritesSyncBusy=true;updateSmartFavoritesModalSummary();
  try {
    var result=await window.desktopWindow.createMergedPlaylist(name,smartFavoritesState.tracks);
    if(!result||!result.ok)throw new Error(result&&result.error||'创建失败');
    await refreshBuiltInPlaylists(true);
    smartFavoritesStatus('已建立「'+name+'」，可在收藏夹中打开播放。','success');
  }catch(error){smartFavoritesStatus(error.message,'error');}
  finally{smartFavoritesSyncBusy=false;updateSmartFavoritesModalSummary();}
}

async function syncSmartFavorites() {
  if (smartFavoritesSyncBusy) return false;
  var selectedKeys = smartFavoriteSelectedKeys();
  if (!selectedKeys.length) { smartFavoritesStatus('至少选择一个歌单来源。', 'error'); return false; }
  var catalog = smartPlaylistCatalog();
  var sources = selectedKeys.map(function (key) {
    var playlist = catalog.find(function (item) { return smartPlaylistKey(item) === key; });
    return playlist ? smartSourceFromPlaylist(playlist) : null;
  }).filter(Boolean);
  smartFavoritesSyncBusy = true;
  updateSmartFavoritesModalSummary();
  smartFavoritesStatus('正在合并歌单并检查重复歌曲…', 'loading');
  var previousTracks = smartFavoritesState.tracks.slice();
  var collected = [];
  var failures = [];
  for (var i = 0; i < sources.length; i += 3) {
    var batch = sources.slice(i, i + 3);
    var settled = await Promise.allSettled(batch.map(fetchAllSmartSourceTracks));
    settled.forEach(function (entry, index) {
      var source = batch[index];
      if (entry.status === 'fulfilled') {
        source.lastSyncAt = Date.now();
        collected = collected.concat(entry.value || []);
      } else {
        failures.push(source.playlistName || source.playlistId);
        previousTracks.forEach(function (track) {
          if ((track.smartSourceKeys || []).indexOf(source.provider + ':' + source.playlistId) >= 0) collected.push(track);
        });
      }
    });
  }
  if(failures.length){smartFavoritesSyncBusy=false;updateSmartFavoritesModalSummary();smartFavoritesStatus('以下来源读取失败，请重试：'+failures.join('、'),'error');return false;}
  smartFavoritesState.sources = sources;
  smartFavoritesState.tracks = mergeSmartTracksWithCachedAnnotations(collected, previousTracks);
  smartFavoritesState.lastSyncAt = Date.now();
  saveSmartFavoritesState('sync', true);
  smartFavoritesSyncBusy = false;
  renderSmartFavoritesSources();
  updateSmartFavoritesModalSummary();
  renderSmartAiControlBar();
  if (typeof renderHomeDashboardQuickCards === 'function') renderHomeDashboardQuickCards();
  smartFavoritesStatus(failures.length ? ('已保留失败来源的上次数据：' + failures.join('、')) : ('同步完成：' + smartFavoritesState.tracks.length + ' 首去重歌曲。'), failures.length ? 'warning' : 'success');
  queueSmartFavoriteAnalysis(smartFavoritesState.tracks);
  return true;
}

function playSmartFavorites() {
  if (!smartFavoritesState.tracks.length) { smartFavoritesStatus('合并收藏夹还是空的，请先同步来源。', 'error'); return false; }
  playQueue = smartFavoritesState.tracks.map(cloneSong);
  currentIdx = 0;
  safeRenderQueuePanel('smart-favorites');
  safeShelfRebuild('smart-favorites', true);
  closeSmartFavoritesModal();
  forcePlaybackControlsInteractive();
  Promise.resolve(playQueueAt(0, { manual: true, context: { type: 'smart-favorites', playlistName: '合并收藏夹' } })).catch(function () { });
  showToast('已载入合并收藏夹 · ' + playQueue.length + ' 首');
  return true;
}

function smartAnalysisPayload(track) {
  return {
    key: smartTrackKey(track), title: track.name || track.title || '', artist: track.artist || '', album: track.album || '',
    year: track.year || '', duration: track.duration || track.durationMs || track.dt || 0, language: track.language || '',
    genre: track.genre || track.genres || [], style: track.style || track.styles || [], mood: track.mood || track.moods || [],
    scene: track.scene || track.scenes || [], activity: track.activity || track.activities || [], tags: track.tags || [], description:track.description||''
  };
}

function queueSmartFavoriteAnalysis(tracks) {
  var bridge = smartFavoritesBridge();
  if (!bridge || typeof bridge.analyzeSmartFavoriteTracks !== 'function') return false;
  var queued = Object.create(null);
  smartFavoritesAnalysisQueue.forEach(function (track) { queued[smartTrackKey(track)] = true; });
  (tracks || []).forEach(function (track) {
    var key = smartTrackKey(track);
    var cached=(smartFavoritesState.analysisCache||{})[key];
    if(cached&&cached.signature===smartAnalysisSignature()){track.llmTags=cached.analysis;track.llmTagSignature=cached.signature;}
    if (!key || queued[key] || track.llmTagSignature===smartAnalysisSignature()) return;
    queued[key] = true;
    smartFavoritesAnalysisQueue.push(track);
  });
  scheduleSmartFavoriteAnalysis(220);
  return true;
}

function scheduleSmartFavoriteAnalysis(delay) {
  if (smartFavoritesAnalysisBusy || smartFavoritesAnalysisTimer || !smartFavoritesAnalysisQueue.length) return;
  smartFavoritesAnalysisTimer = setTimeout(runSmartFavoriteAnalysisBatch, Math.max(100, Number(delay) || 0));
}

function runSmartFavoriteAnalysisBatch() {
  if(smartFavoritesAnalysisPromise)return smartFavoritesAnalysisPromise;
  smartFavoritesAnalysisPromise=performSmartFavoriteAnalysisBatch().finally(function(){smartFavoritesAnalysisPromise=null;});
  return smartFavoritesAnalysisPromise;
}

async function performSmartFavoriteAnalysisBatch() {
  smartFavoritesAnalysisTimer = 0;
  if (smartFavoritesAnalysisBusy || !smartFavoritesAnalysisQueue.length) return;
  var bridge = smartFavoritesBridge();
  if (!bridge || typeof bridge.analyzeSmartFavoriteTracks !== 'function') return;
  smartFavoritesAnalysisBusy = true;
  var batch = smartFavoritesAnalysisQueue.splice(0, 4);
  var tags=smartAnalysisTags(),signature=JSON.stringify(tags);
  smartAiAnalysisStatus('正在分析 '+batch.length+' 首，等待 '+smartFavoritesAnalysisQueue.length+' 首…');
  try {
    await Promise.all(batch.map(enrichSmartTrack));
    var result = await bridge.analyzeSmartFavoriteTracks(batch.map(smartAnalysisPayload),tags);
    var completed = Object.create(null);
    (result && result.results || []).forEach(function (entry) {
      completed[entry.key] = true;
      delete smartFavoritesAnalysisAttempts[entry.key];
      var track = smartFavoritesState.tracks.find(function (candidate) { return smartTrackKey(candidate) === entry.key; });
      if (track) track.llmTags = entry.analysis;
      smartFavoritesState.analysisCache[entry.key]={analysis:entry.analysis,signature:signature,at:Date.now()};
      batch.concat(playQueue||[]).forEach(function(candidate){if(smartTrackKey(candidate)===entry.key){candidate.llmTags=entry.analysis;candidate.llmTagSignature=signature;}});
      Object.keys(smartFavoritesState.onlineCache || {}).forEach(function (cacheKey) {
        var online = smartFavoritesState.onlineCache[cacheKey];
        var candidate = online && (online.tracks || []).find(function (item) { return smartTrackKey(item) === entry.key; });
        if (candidate) candidate.llmTags = entry.analysis;
      });
    });
    var unresolved = batch.filter(function (track) { return !completed[smartTrackKey(track)]; });
    var retryable = [];
    unresolved.forEach(function (track) {
      var key = smartTrackKey(track);
      var attempts = (smartFavoritesAnalysisAttempts[key] || 0) + 1;
      smartFavoritesAnalysisAttempts[key] = attempts;
      if (result && result.ok && attempts < 3) retryable.push(track);
    });
    if (retryable.length) smartFavoritesAnalysisQueue = retryable.concat(smartFavoritesAnalysisQueue);
    if (result && result.results && result.results.length) saveSmartFavoritesState('llm-tags', false);
    if (result && result.available === false) smartFavoritesAnalysisQueue = [];
    if (result && result.ok) {
      smartAiAnalysisStatus('标签已缓存 · '+Object.keys(smartFavoritesState.analysisCache).length+' 首'+(retryable.length?' · 本批漏回 '+retryable.length+' 首，自动拆小重试':(unresolved.length?' · '+unresolved.length+' 首连续漏回，已跳过':''))+' · 待处理 '+smartFavoritesAnalysisQueue.length+' 首');
    } else {
      smartAiAnalysisStatus('标签分析已暂停：'+(result&&result.error||'服务不可用')+' · '+smartAnalysisAvailability(batch)+' · 请检查模型后点击重试');
    }
    if(result&&!result.ok)smartFavoritesAnalysisQueue=[];
    if(result&&result.available===false)smartAiAnalysisStatus('请先配置 LLM；仍可使用手工标签');
    ['analysisCache','metadataCache'].forEach(function(key){var cache=smartFavoritesState[key];var keys=Object.keys(cache);if(keys.length>6000)keys.sort(function(a,b){return (cache[b].at||0)-(cache[a].at||0);}).slice(6000).forEach(function(k){delete cache[k];});});
    saveSmartFavoritesState('analysis-cache',false);
  } catch (error) { smartAiAnalysisStatus('标签分析已暂停：'+(error&&error.message||'服务不可用')+' · '+smartAnalysisAvailability(batch)+' · 请检查模型后点击重试');smartFavoritesAnalysisQueue=[]; }
  smartFavoritesAnalysisBusy = false;
  if (typeof renderSmartAiControlBar === 'function') renderSmartAiControlBar();
  if (typeof renderCurrentSmartTags === 'function') renderCurrentSmartTags();
  if (typeof safeRenderQueuePanel === 'function') safeRenderQueuePanel('smart-tags-updated');
  if (smartFavoritesAnalysisQueue.length) scheduleSmartFavoriteAnalysis(1400);
}

async function refreshSmartFavoritesLlmStatus() {
  var bridge = smartFavoritesBridge();
  var node = document.getElementById('smart-favorites-llm-status');
  if (!node) return;
  if (!bridge || typeof bridge.getSmartFavoritesLlmStatus !== 'function') { node.textContent = '仅桌面版支持安全保存 LLM Key'; node.dataset.ready = 'false'; return; }
  var result = await bridge.getSmartFavoritesLlmStatus().catch(function () { return null; });
  if (!result || !result.ok) { node.textContent = '无法读取 LLM 配置'; node.dataset.ready = 'false'; return; }
  node.textContent = result.configured ? ('已配置 · ' + result.model) : (result.hasKey ? '还需填写 Base URL 和模型' : '未配置，播放器仍可使用手工和平台标签');
  node.dataset.ready = result.configured ? 'true' : 'false';
  var base = document.getElementById('smart-favorites-base-url');
  var model = document.getElementById('smart-favorites-model');
  if (base && !base.value) base.value = result.baseUrl || '';
  if (model && !model.value) model.value = result.model || '';
}

async function saveSmartFavoritesLlmSettings() {
  var bridge = smartFavoritesBridge();
  if (!bridge || typeof bridge.configureSmartFavoritesLlm !== 'function') { smartFavoritesStatus('当前环境不支持安全保存 API Key。', 'error'); return; }
  var keyInput = document.getElementById('smart-favorites-api-key');
  var baseInput = document.getElementById('smart-favorites-base-url');
  var modelInput = document.getElementById('smart-favorites-model');
  var result = await bridge.configureSmartFavoritesLlm({ apiKey: keyInput && keyInput.value || '', baseUrl: baseInput && baseInput.value || '', model: modelInput && modelInput.value || '' }).catch(function () { return null; });
  if (keyInput) keyInput.value = '';
  if (!result || !result.ok) { smartFavoritesStatus('LLM 配置保存失败，系统安全存储不可用。', 'error'); return; }
  smartFavoritesStatus(result.configured ? 'LLM 配置已安全保存。' : '配置已保存，但还缺少必要字段。', result.configured ? 'success' : 'warning');
  refreshSmartFavoritesLlmStatus();
  if (result.configured) queueSmartFavoriteAnalysis(playQueue.concat(smartFavoritesState.tracks));
}

async function clearSmartFavoritesLlmKey() {
  var bridge = smartFavoritesBridge();
  if (!bridge || typeof bridge.clearSmartFavoritesLlm !== 'function') return;
  await bridge.clearSmartFavoritesLlm().catch(function () { });
  smartFavoritesStatus('已移除本机保存的 API Key。', 'success');
  refreshSmartFavoritesLlmStatus();
}

function smartFavoritesLlmTestSummary(result) {
  if (!result) return '测试失败：桌面进程没有返回结果。';
  if (result.ok) return 'LLM 响应正常 · DNS ' + result.dnsMs + 'ms · 模型目录 ' + result.catalogMs + 'ms · 首包 ' + result.headersMs + 'ms · 总计 ' + result.totalMs + 'ms';
  if (result.error === 'LLM_NOT_CONFIGURED') return '测试失败：请先保存完整的 API Key、Base URL 和模型。';
  if (result.modelListed === false) return '测试失败：当前服务的模型目录中没有配置的模型 ' + (result.model || '') + '。';
  if (result.stage === 'catalog-timeout') return '测试超时：域名可解析，但模型目录接口没有及时响应，请检查服务可用性。';
  if (result.stage === 'headers-timeout') return '测试超时：域名和模型目录均可访问，但 ' + result.totalMs + 'ms 内聊天接口未返回响应头；通常是模型排队或冷启动。';
  if (result.stage === 'body-timeout') return '测试超时：已收到响应头，但正文生成超过 ' + result.totalMs + 'ms；通常是模型推理过慢。';
  if (result.stage === 'dns') return '测试失败：域名解析异常（' + result.error + '）。';
  if (result.stage === 'http') return '测试失败：服务返回 HTTP ' + result.status + (result.providerError ? ' · ' + result.providerError : '') + '，请检查 Key、模型名称和额度。';
  return '测试失败：' + (result.error || '未知错误') + '（阶段：' + (result.stage || 'unknown') + '）。';
}

async function testSmartFavoritesLlmResponse() {
  var bridge = smartFavoritesBridge();
  var button = document.getElementById('smart-favorites-llm-test');
  if (!bridge || typeof bridge.testSmartFavoritesLlm !== 'function') { smartFavoritesStatus('当前环境不支持单独测试 LLM。', 'error'); return; }
  if (button) { button.disabled = true; button.textContent = '测试中…'; }
  smartFavoritesStatus('正在发送最小响应请求，不会触发歌曲分析…', 'warning');
  try {
    var result = await bridge.testSmartFavoritesLlm().catch(function () { return null; });
    smartFavoritesStatus(smartFavoritesLlmTestSummary(result), result && result.ok ? 'success' : 'error');
  } finally {
    if (button) { button.disabled = false; button.textContent = '单独测试响应'; }
  }
}

function bindSmartFavoritesModal() {
  var mask = smartFavoritesModalMask();
  if (!mask || mask.dataset.bound === '1') return;
  mask.dataset.bound = '1';
  mask.addEventListener('click', function (event) { if (event.target === mask) closeSmartFavoritesModal(); });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && mask.classList.contains('show')) closeSmartFavoritesModal();
  });
}

loadSmartFavoritesState().then(function () {
  bindSmartFavoritesModal();
  renderSmartAiControlBar();
  if (typeof renderHomeDashboardQuickCards === 'function') renderHomeDashboardQuickCards();
  var knownTracks = dedupeSmartFavoriteTracks([].concat(smartFavoritesState.tracks || [], typeof playQueue !== 'undefined' ? playQueue : []));
  if ((smartFavoritesState.tags || []).length && knownTracks.length) queueSmartFavoriteAnalysis(knownTracks);
});

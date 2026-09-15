'use strict';

var SMART_FAVORITES_STORE_KEY = 'mineradio-smart-favorites-v1';
var SMART_FAVORITES_ONLINE_CACHE_TTL = 30 * 60 * 1000;
var SMART_FAVORITES_MIX_PRIVATE_RATIO = 0.7;
var SMART_FAVORITES_TOP_N = 8;
var SMART_FAVORITES_DEFAULT_TAGS = ['放松', '爵士', '学习', '开车', '浪漫', '工作', '运动', '夜晚'];
var SMART_FAVORITES_TAG_ALIASES = {
  '放松': 'relaxed', '轻松': 'relaxed', 'relax': 'relaxed', 'relaxed': 'relaxed', 'chill': 'relaxed',
  '爵士': 'jazz', '爵士乐': 'jazz', 'jazz': 'jazz',
  '学习': 'study', '学习时': 'study', 'study': 'study', 'focus': 'focus', '专注': 'focus',
  '开车': 'driving', '驾驶': 'driving', 'drive': 'driving', 'driving': 'driving',
  '浪漫': 'romantic', '浪漫氛围': 'romantic', 'romance': 'romantic', 'romantic': 'romantic',
  '工作': 'work', '办公': 'work', 'work': 'work',
  '运动': 'workout', '健身': 'workout', '跑步': 'workout', 'workout': 'workout', 'sport': 'workout',
  '夜晚': 'night', '深夜': 'night', 'night': 'night',
  '流行': 'pop', 'pop': 'pop', '摇滚': 'rock', 'rock': 'rock', '古典': 'classical', 'classical': 'classical',
  '民谣': 'folk', 'folk': 'folk', '电子': 'electronic', 'electronic': 'electronic', '嘻哈': 'hip-hop', 'hiphop': 'hip-hop',
  '安静': 'calm', '平静': 'calm', 'calm': 'calm', '快乐': 'happy', '开心': 'happy', 'happy': 'happy',
  '伤感': 'sad', '悲伤': 'sad', 'sad': 'sad', '治愈': 'healing', 'healing': 'healing',
  '睡眠': 'sleep', '助眠': 'sleep', 'sleep': 'sleep', '通勤': 'commute', 'commute': 'commute'
};

function smartFavoritesDefaultState() {
  return {
    version: 1,
    sources: [],
    tracks: [],
    tags: SMART_FAVORITES_DEFAULT_TAGS.map(function (label) { return { label: label, value: normalizeAiTag(label), state: 'neutral', preset: true }; }),
    deletedTags: [],
    scope: 'private',
    history: [],
    onlineCache: {},
    metadataCache: {},
    analysisCache: {},
    lastSyncAt: 0,
    updatedAt: 0
  };
}

function normalizeAiTag(value) {
  var raw = String(value == null ? '' : value).normalize ? String(value == null ? '' : value).normalize('NFKC').trim().toLowerCase() : String(value == null ? '' : value).trim().toLowerCase();
  raw = raw.replace(/^[#\s]+|[#\s]+$/g, '').replace(/[\s_]+/g, '-');
  return SMART_FAVORITES_TAG_ALIASES[raw] || raw.slice(0, 48);
}

function normalizeAiTagState(value) {
  return value === 'preferred' || value === 'required' ? value : 'neutral';
}

function uniqueAiTags(values) {
  var seen = Object.create(null);
  var output = [];
  (Array.isArray(values) ? values : (values == null ? [] : [values])).forEach(function (value) {
    if (typeof value === 'string' && /[,，/|]/.test(value)) {
      value.split(/[,，/|]+/).forEach(function (part) {
        var nested = normalizeAiTag(part);
        if (nested && !seen[nested]) { seen[nested] = true; output.push(nested); }
      });
      return;
    }
    var tag = normalizeAiTag(value);
    if (tag && !seen[tag]) { seen[tag] = true; output.push(tag); }
  });
  return output;
}

function smartTextNorm(value) {
  var raw = String(value == null ? '' : value);
  if (raw.normalize) raw = raw.normalize('NFKC');
  return raw.toLowerCase().replace(/[\s·・,，。.!！?？'"“”‘’|_/]+/g, '').trim();
}

function smartTitleNorm(song) {
  var title = String(song && (song.name || song.title) || '');
  title = title.replace(/[（(【\[].*?(?:live|remix|mix|acoustic|instrumental|伴奏|纯音乐|现场|演唱会|混音|不插电).*?[）)】\]]/ig, '');
  title = title.replace(/\b(?:live|remix|acoustic|instrumental|demo|sped\s*up|slowed)\b|现场版|演唱会版|混音版|不插电版|伴奏版|纯音乐版/ig, '');
  return smartTextNorm(title);
}

function smartVersionSignature(song) {
  var source = String(song && (song.name || song.title) || '').toLowerCase();
  var found = [];
  [
    ['live', /\blive\b|现场|演唱会/], ['remix', /\bremix\b|重混|混音|dj版/],
    ['acoustic', /\bacoustic\b|不插电|木吉他版/], ['instrumental', /\binstrumental\b|伴奏|纯音乐/],
    ['cover', /\bcover\b|翻唱/], ['demo', /\bdemo\b|试听版/], ['sped', /sped\s*up|加速版/], ['slowed', /slowed|慢速版/]
  ].forEach(function (entry) { if (entry[1].test(source)) found.push(entry[0]); });
  return found.sort().join('+');
}

function smartTrackProvider(song) {
  return String(song && (song.provider || song.source) || 'netease').toLowerCase();
}

function smartTrackId(song) {
  return String(song && (song.id || song.trackId || song.mid || song.hash || song.localFileId || song.localKey) || '');
}

function smartTrackDurationSeconds(song) {
  var raw = Number(song && (song.duration || song.durationMs || song.dt) || 0);
  if (!isFinite(raw) || raw <= 0) return 0;
  return raw > 10000 ? Math.round(raw / 1000) : Math.round(raw);
}

function smartTrackKey(song) {
  var id = smartTrackId(song);
  if (id) return smartTrackProvider(song) + ':' + id;
  return 'soft:' + smartTrackSoftKey(song);
}

function smartTrackSoftKey(song) {
  return [smartTitleNorm(song), smartTextNorm(song && song.artist), smartTrackDurationSeconds(song), smartVersionSignature(song)].join('|');
}

function smartTracksSoftEqual(a, b) {
  if (!a || !b) return false;
  if (smartTitleNorm(a) !== smartTitleNorm(b) || smartTextNorm(a.artist) !== smartTextNorm(b.artist)) return false;
  if (smartVersionSignature(a) !== smartVersionSignature(b)) return false;
  var durationA = smartTrackDurationSeconds(a);
  var durationB = smartTrackDurationSeconds(b);
  return !durationA || !durationB ? durationA === durationB : Math.abs(durationA - durationB) <= 2;
}

function smartSourceVariant(song) {
  return { provider: smartTrackProvider(song), trackId: smartTrackId(song), quality: String(song && (song.quality || song.level) || '') };
}

function mergeSmartTrack(existing, incoming) {
  var merged = Object.assign({}, existing || {}, incoming || {});
  merged.sourceVariants = [];
  var seen = Object.create(null);
  var variants = [];
  (existing && existing.sourceVariants || []).concat(incoming && incoming.sourceVariants || [], [smartSourceVariant(existing), smartSourceVariant(incoming)]).forEach(function (variant) {
    if (!variant || !variant.provider || !variant.trackId) return;
    var key = variant.provider + ':' + variant.trackId;
    if (seen[key]) return;
    seen[key] = true;
    variants.push(variant);
  });
  merged.sourceVariants = variants;
  merged.smartSourceKeys = Array.from(new Set((existing && existing.smartSourceKeys || []).concat(incoming && incoming.smartSourceKeys || [])));
  merged.manualTags = uniqueAiTags((existing && existing.manualTags || []).concat(incoming && incoming.manualTags || []));
  merged.excludedTags = uniqueAiTags((existing && existing.excludedTags || []).concat(incoming && incoming.excludedTags || []));
  if (existing && existing.llmTags && !incoming.llmTags) merged.llmTags = existing.llmTags;
  return merged;
}

function dedupeSmartFavoriteTracks(tracks) {
  var output = [];
  var exact = Object.create(null);
  (tracks || []).forEach(function (raw) {
    if (!raw) return;
    var song = Object.assign({}, raw);
    var exactKey = smartTrackId(song) ? smartTrackProvider(song) + ':' + smartTrackId(song) : '';
    var index = exactKey && exact[exactKey] != null ? exact[exactKey] : -1;
    if (index < 0) index = output.findIndex(function (candidate) {
      if (smartTrackId(song) && smartTrackId(candidate) && smartTrackProvider(candidate) === smartTrackProvider(song)) return false;
      return smartTracksSoftEqual(candidate, song);
    });
    if (index >= 0) output[index] = mergeSmartTrack(output[index], song);
    else {
      song.sourceVariants = [smartSourceVariant(song)].filter(function (variant) { return !!variant.trackId; });
      output.push(song);
      index = output.length - 1;
    }
    if (exactKey) exact[exactKey] = index;
  });
  return output;
}

function sanitizeSmartFavoritesState(raw) {
  var defaults = smartFavoritesDefaultState();
  raw = raw && typeof raw === 'object' ? raw : {};
  var deletedTags = uniqueAiTags(raw.deletedTags || []);
  var tags = Array.isArray(raw.tags) ? raw.tags.map(function (tag) {
    if (!tag) return null;
    var label = String(tag.label || tag.value || '').trim().slice(0, 32);
    var value = normalizeAiTag(tag.value || label);
    return label && value ? { label: label, value: value, state: normalizeAiTagState(tag.state), preset: !!tag.preset } : null;
  }).filter(function (tag) { return tag && deletedTags.indexOf(tag.value) < 0; }) : [];
  SMART_FAVORITES_DEFAULT_TAGS.slice().reverse().forEach(function (label) {
    var value = normalizeAiTag(label);
    if (deletedTags.indexOf(value) < 0 && !tags.some(function (tag) { return tag.value === value; })) tags.unshift({ label: label, value: value, state: 'neutral', preset: true });
  });
  return {
    version: 1,
    sources: Array.isArray(raw.sources) ? raw.sources.filter(Boolean).slice(0, 200) : [],
    tracks: dedupeSmartFavoriteTracks(Array.isArray(raw.tracks) ? raw.tracks : []),
    tags: tags.slice(0, 80),
    deletedTags: deletedTags.slice(0, 80),
    scope: /^(private|online|mixed)$/.test(raw.scope) ? raw.scope : defaults.scope,
    history: Array.isArray(raw.history) ? raw.history.filter(Boolean).slice(-100) : [],
    onlineCache: raw.onlineCache && typeof raw.onlineCache === 'object' ? raw.onlineCache : {},
    metadataCache: raw.metadataCache && typeof raw.metadataCache === 'object' ? raw.metadataCache : {},
    analysisCache: raw.analysisCache && typeof raw.analysisCache === 'object' ? raw.analysisCache : {},
    lastSyncAt: Number(raw.lastSyncAt) || 0,
    updatedAt: Number(raw.updatedAt) || 0
  };
}

function readSmartFavoritesFallback() {
  try { return sanitizeSmartFavoritesState(JSON.parse(localStorage.getItem(SMART_FAVORITES_STORE_KEY) || 'null')); }
  catch (_) { return smartFavoritesDefaultState(); }
}

var smartFavoritesState = readSmartFavoritesFallback();
var smartFavoritesLoaded = false;
var smartFavoritesSaveTimer = 0;
var smartFavoritesLoadPromise = null;

function smartFavoritesBridge() {
  return window.desktopWindow && typeof window.desktopWindow.readSmartFavorites === 'function' ? window.desktopWindow : null;
}

function loadSmartFavoritesState() {
  if (smartFavoritesLoadPromise) return smartFavoritesLoadPromise;
  var bridge = smartFavoritesBridge();
  smartFavoritesLoadPromise = bridge
    ? Promise.resolve(bridge.readSmartFavorites()).then(function (result) {
      if (result && result.ok && result.state) smartFavoritesState = sanitizeSmartFavoritesState(result.state);
      smartFavoritesLoaded = true;
      return smartFavoritesState;
    }).catch(function () { smartFavoritesLoaded = true; return smartFavoritesState; })
    : Promise.resolve().then(function () { smartFavoritesLoaded = true; return smartFavoritesState; });
  return smartFavoritesLoadPromise;
}

function saveSmartFavoritesState(reason, immediate) {
  smartFavoritesState.updatedAt = Date.now();
  if (smartFavoritesSaveTimer) clearTimeout(smartFavoritesSaveTimer);
  function commit() {
    smartFavoritesSaveTimer = 0;
    var snapshot = sanitizeSmartFavoritesState(smartFavoritesState);
    smartFavoritesState = snapshot;
    var bridge = smartFavoritesBridge();
    if (bridge && typeof bridge.saveSmartFavorites === 'function') {
      Promise.resolve(bridge.saveSmartFavorites(snapshot)).catch(function () { });
    } else {
      try { localStorage.setItem(SMART_FAVORITES_STORE_KEY, JSON.stringify(snapshot)); } catch (_) { }
    }
  }
  if (immediate) commit();
  else smartFavoritesSaveTimer = setTimeout(commit, 180);
  return reason || '';
}

function smartTrackProviderTags(track) {
  var values = [];
  ['genre', 'genres', 'style', 'styles', 'mood', 'moods', 'scene', 'scenes', 'activity', 'activities', 'tags'].forEach(function (key) {
    var value = track && track[key];
    if (Array.isArray(value)) values = values.concat(value);
    else if (value) values.push(value);
  });
  return uniqueAiTags(values);
}

function smartTrackLlmTags(track) {
  var value = track && track.llmTags || {};
  return uniqueAiTags([].concat(value.genres || [], value.styles || [], value.moods || [], value.scenes || [], value.activities || [], value.matches || [], value.language || []));
}

function smartTrackAllTags(track) {
  var annotation = typeof findSmartFavoriteTrack === 'function' ? findSmartFavoriteTrack(track) : null;
  var source = annotation || track || {};
  var excluded = uniqueAiTags([].concat(source.excludedTags || [], track && track.excludedTags || []));
  return uniqueAiTags([].concat(
    source.manualTags || [], track && track.manualTags || [],
    smartTrackProviderTags(source), smartTrackProviderTags(track),
    smartTrackLlmTags(source), smartTrackLlmTags(track)
  )).filter(function (tag) { return excluded.indexOf(tag) < 0; });
}

function smartActiveTagContext() {
  var context = { required: [], preferred: [] };
  (smartFavoritesState.tags || []).forEach(function (tag) {
    if (tag.state === 'required') context.required.push(tag.value);
    else if (tag.state === 'preferred') context.preferred.push(tag.value);
  });
  return context;
}

function smartTagMatch(tag, sets, allowDiscovery) {
  if (!tag) return false;
  return sets.manual.indexOf(tag) >= 0 || sets.provider.indexOf(tag) >= 0 || sets.llm.indexOf(tag) >= 0 || (!!allowDiscovery && sets.discovery.indexOf(tag) >= 0);
}

function scoreAiCandidate(track, context) {
  var annotation = typeof findSmartFavoriteTrack === 'function' ? findSmartFavoriteTrack(track) : null;
  if (annotation && annotation !== track) track = Object.assign({}, track, {
    manualTags: uniqueAiTags([].concat(track.manualTags || [], annotation.manualTags || [])),
    excludedTags: uniqueAiTags([].concat(track.excludedTags || [], annotation.excludedTags || []))
  });
  context = context || {};
  var required = uniqueAiTags(context.required || []);
  var preferred = uniqueAiTags(context.preferred || []);
  var sets = {
    manual: uniqueAiTags(track && track.manualTags || []),
    provider: smartTrackProviderTags(track),
    llm: smartTrackLlmTags(track),
    discovery: uniqueAiTags(track && track.onlineIntentTags || [])
  };
  var excluded = uniqueAiTags(track && track.excludedTags || []);
  ['manual', 'provider', 'llm'].forEach(function (key) {
    sets[key] = sets[key].filter(function (tag) { return excluded.indexOf(tag) < 0; });
  });
  for (var i = 0; i < required.length; i++) {
    if (!smartTagMatch(required[i], sets, false)) return { eligible: false, score: -Infinity, matched: [] };
  }
  var score = required.length * 8;
  var matched = [];
  required.concat(preferred).forEach(function (tag) {
    var weight = required.indexOf(tag) >= 0 ? 1.3 : 1;
    if (sets.manual.indexOf(tag) >= 0) { score += 10 * weight; matched.push(tag); }
    else if (sets.provider.indexOf(tag) >= 0) { score += 6 * weight; matched.push(tag); }
    else if (sets.llm.indexOf(tag) >= 0) { score += 4 * Math.max(0.2, Number(track && track.llmTags && track.llmTags.confidence) || 0.5) * weight; matched.push(tag); }
    else if (sets.discovery.indexOf(tag) >= 0) { score += 2.5 * weight; matched.push(tag); }
  });
  var recent = context.recentKeys || [];
  var key = smartTrackKey(track);
  var recentIndex = recent.lastIndexOf(key);
  if (recentIndex >= 0) score -= Math.max(3, 14 - (recent.length - 1 - recentIndex) * 2);
  var last = context.lastTrack || null;
  if (last && smartTextNorm(last.artist) && smartTextNorm(last.artist) === smartTextNorm(track && track.artist)) score -= 4;
  if (last && smartTextNorm(last.album) && smartTextNorm(last.album) === smartTextNorm(track && track.album)) score -= 2;
  if (track && track.llmTags && isFinite(Number(track.llmTags.energy)) && isFinite(Number(context.energyTarget))) {
    score -= Math.abs(Number(track.llmTags.energy) - Number(context.energyTarget)) * 2;
  }
  return { eligible: true, score: score, matched: uniqueAiTags(matched) };
}

function findSmartFavoriteTrack(song) {
  if (!song) return null;
  var exact = smartTrackKey(song);
  var soft = smartTrackSoftKey(song);
  return (smartFavoritesState.tracks || []).find(function (item) {
    if (smartTrackKey(item) === exact) return true;
    if ((item.sourceVariants || []).some(function (variant) { return variant.provider + ':' + variant.trackId === exact; })) return true;
    return smartTrackSoftKey(item) === soft || smartTracksSoftEqual(item, song);
  }) || null;
}

function setSmartTrackManualTag(song, tagValue) {
  var record = findSmartFavoriteTrack(song);
  if (!record && song) {
    record = Object.assign({}, song, { manualTags: [], sourceVariants: [smartSourceVariant(song)] });
    smartFavoritesState.tracks.push(record);
  }
  if (!record) return false;
  var value = normalizeAiTag(tagValue);
  if (!value) return false;
  record.excludedTags = uniqueAiTags(record.excludedTags || []).filter(function (tag) { return tag !== value; });
  record.manualTags = uniqueAiTags((record.manualTags || []).concat([value]));
  song.manualTags=record.manualTags.slice();
  song.excludedTags=record.excludedTags.slice();
  saveSmartFavoritesState('manual-tag', true);
  return true;
}

function removeSmartTrackTag(song, tagValue) {
  var record = findSmartFavoriteTrack(song);
  if (!record && song) {
    record = Object.assign({}, song, { manualTags: uniqueAiTags(song.manualTags || []), excludedTags: uniqueAiTags(song.excludedTags || []), sourceVariants: [smartSourceVariant(song)] });
    smartFavoritesState.tracks.push(record);
  }
  if (!record || !song) return false;
  var value = normalizeAiTag(tagValue);
  if (!value) return false;
  record.manualTags = uniqueAiTags(record.manualTags || []).filter(function (tag) { return tag !== value; });
  record.excludedTags = uniqueAiTags((record.excludedTags || []).concat([value]));
  song.manualTags = record.manualTags.slice();
  song.excludedTags = record.excludedTags.slice();
  saveSmartFavoritesState('remove-track-tag', true);
  return true;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeAiTag: normalizeAiTag,
    smartTrackKey: smartTrackKey,
    smartTrackSoftKey: smartTrackSoftKey,
    smartTracksSoftEqual: smartTracksSoftEqual,
    smartVersionSignature: smartVersionSignature,
    dedupeSmartFavoriteTracks: dedupeSmartFavoriteTracks,
    scoreAiCandidate: scoreAiCandidate,
    smartTrackAllTags: smartTrackAllTags,
    sanitizeSmartFavoritesState: sanitizeSmartFavoritesState
  };
}

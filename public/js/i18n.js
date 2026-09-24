/* UI-only language switching. Music metadata, lyrics and user input remain as supplied. */
(function () {
  'use strict';

  var STORE_KEY = 'mineradio-ui-language';
  var language = 'zh-CN';
  try { if (localStorage.getItem(STORE_KEY) === 'en') language = 'en'; } catch (e) { }

  var catalog = Object.create(null);
  var fragments = Object.create(null);
  var textState = new WeakMap();
  var attrState = new WeakMap();
  var attrs = ['title', 'aria-label', 'placeholder', 'alt'];
  var contentSelector = '[data-i18n-skip], [data-language-switch], script, style, option[value="user"], ' +
    '.lyric-line, .lyrics-line, .lyric-word, .song-title, .track-title, .track-artist, .artist-name, ' +
    '.playlist-name, .album-name, .queue-track-title, .queue-track-artist, .mini-queue-name, ' +
    '.mini-queue-artist, .qi-name, .queue-artist-link, .pl-detail-row-title, ' +
    '.pl-detail-row-artist, .pl-detail-title, .pl-name, .search-result-title, ' +
    '.search-artist-link, #search-input, #custom-lyric-input, #collect-new-name, ' +
    '#track-title, #track-artist, #control-title-text, #control-artist, #thumb-artist, ' +
    '#home-today-artist, #home-next-title, .home-ranking-entry-title, ' +
    '#merged-playlist-name, #login-easter-unlock-phrase, .comment-text, .comment-user-name';
  var han = /[\u3400-\u9fff]/;
  var dynamicLabels = [
    [/^([\d/]+) 首 · 正在播放 (\d+)$/, function (m) { return m[1] + ' songs · Playing ' + m[2]; }],
    [/^(\d+) 首去重歌曲 · (\d+) 个来源$/, function (m) { return m[1] + ' unique songs · ' + m[2] + ' sources'; }],
    [/^已加载全部 (\d+) 首$/, function (m) { return 'All ' + m[1] + ' songs loaded'; }],
    [/^部分歌单载入失败 · 已显示 (\d+) 个$/, function (m) { return 'Some playlists failed to load · Showing ' + m[1]; }],
    [/^全部每日推荐，共 (\d+) 首$/, function (m) { return 'All daily recommendations, ' + m[1] + ' songs'; }],
    [/^([\d/]+) 首 · (.+)$/, function (m) { return m[1] + ' songs · ' + m[2]; }],
    [/^(\d+) 项 · (.+)$/, function (m) { return m[1] + ' items · ' + m[2]; }],
    [/^([\d/]+) 首$/, function (m) { return m[1] + ' songs'; }],
    [/^(\d+) 分钟$/, function (m) { return m[1] + ' min'; }],
    [/^(\d+) 项$/, function (m) { return m[1] + ' items'; }],
    [/^(\d+) 赞$/, function (m) { return m[1] + ' likes'; }],
  ];

  function skipped(element) {
    return !element || (element.closest && !!element.closest(contentSelector)) ||
      (element.isContentEditable === true);
  }

  function ignoredSubtree(element) {
    return !element || (element.closest && !!element.closest('[data-i18n-skip], [data-language-switch], script, style')) ||
      (element.isContentEditable === true);
  }

  function addFragments() {
    Object.keys(catalog).forEach(function (source) {
      if (source.length < 2 || source.length > 100 || !han.test(source.charAt(0)) || han.test(catalog[source])) return;
      var first = source.charAt(0);
      (fragments[first] || (fragments[first] = [])).push(source);
    });
    Object.keys(fragments).forEach(function (first) {
      fragments[first].sort(function (a, b) { return b.length - a.length; });
    });
  }

  function english(source) {
    var trimmed = source.trim();
    if (!han.test(trimmed)) return source;
    if (catalog[trimmed]) return source.replace(trimmed, catalog[trimmed]);
    for (var patternIndex = 0; patternIndex < dynamicLabels.length; patternIndex++) {
      var pattern = dynamicLabels[patternIndex];
      var match = trimmed.match(pattern[0]);
      if (match) return source.replace(trimmed, pattern[1](match));
    }
    // Runtime messages often join a fixed UI phrase with a count or a filename.
    var output = '';
    for (var i = 0; i < source.length;) {
      var candidates = fragments[source.charAt(i)] || [];
      var match = '';
      for (var j = 0; j < candidates.length; j++) {
        if (source.startsWith(candidates[j], i)) { match = candidates[j]; break; }
      }
      if (match) {
        output += catalog[match];
        i += match.length;
      } else {
        output += source.charAt(i++);
      }
    }
    return han.test(output) ? source : output;
  }

  ['alert', 'confirm', 'prompt'].forEach(function (method) {
    var original = window[method];
    if (typeof original !== 'function') return;
    window[method] = function (message) {
      var args = Array.prototype.slice.call(arguments);
      if (language === 'en') args[0] = english(String(message));
      return original.apply(window, args);
    };
  });

  function translateText(node) {
    if (skipped(node.parentElement) || (node.parentElement && node.parentElement.closest('textarea'))) return;
    var current = node.nodeValue;
    var state = textState.get(node);
    if (language === 'en') {
      if (state && current === state.en) return;
      var source = state && current === state.zh ? state.zh : current;
      var translated = english(source);
      if (translated !== source) {
        textState.set(node, { zh: source, en: translated });
        node.nodeValue = translated;
      }
    } else if (state && current === state.en) {
      node.nodeValue = state.zh;
    }
  }

  function translateAttrs(element) {
    if (ignoredSubtree(element)) return;
    var saved = attrState.get(element) || Object.create(null);
    attrs.forEach(function (name) {
      if (!element.hasAttribute(name)) return;
      var current = element.getAttribute(name);
      var state = saved[name];
      if (language === 'en') {
        if (state && current === state.en) return;
        var source = state && current === state.zh ? state.zh : current;
        var translated = english(source);
        if (translated !== source) {
          saved[name] = { zh: source, en: translated };
          element.setAttribute(name, translated);
        }
      } else if (state && current === state.en) {
        element.setAttribute(name, state.zh);
      }
    });
    attrState.set(element, saved);
  }

  function scan(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) { translateText(root); return; }
    if (root.nodeType !== Node.ELEMENT_NODE || ignoredSubtree(root)) return;
    translateAttrs(root);
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      var node = walker.currentNode;
      if (node.nodeType === Node.TEXT_NODE) translateText(node);
      else translateAttrs(node);
    }
  }

  function updateButtons() {
    document.querySelectorAll('[data-language-switch]').forEach(function (button) {
      var nextEnglish = language !== 'en';
      button.textContent = nextEnglish ? 'EN' : '中文';
      button.title = nextEnglish ? 'Switch to English' : '切换为中文';
      button.setAttribute('aria-label', button.title);
      button.setAttribute('aria-pressed', String(!nextEnglish));
    });
    var easterPhrase = document.getElementById('login-easter-unlock-phrase');
    if (easterPhrase) {
      var pieces = language === 'en' ? ['WOR', 'LD', 'PE', 'ACE'] : ['世', '界', '和', '平'];
      easterPhrase.querySelectorAll('span').forEach(function (span, index) { span.textContent = pieces[index]; });
    }
    document.documentElement.lang = language;
  }

  function setLanguage(next) {
    language = next === 'en' ? 'en' : 'zh-CN';
    try { localStorage.setItem(STORE_KEY, language); } catch (e) { }
    updateButtons();
    scan(document.body);
    window.dispatchEvent(new CustomEvent('mineradio-language-change', { detail: { language: language } }));
  }

  document.addEventListener('click', function (event) {
    if (event.target.closest && event.target.closest('[data-language-switch]')) {
      event.preventDefault();
      event.stopPropagation();
      setLanguage(language === 'en' ? 'zh-CN' : 'en');
    }
  }, true);

  updateButtons();
  fetch('js/i18n.en.json').then(function (response) {
    if (!response.ok) throw new Error('Language catalog unavailable');
    return response.json();
  }).then(function (data) {
    catalog = data;
    addFragments();
    scan(document.body);
    new MutationObserver(function (changes) {
      changes.forEach(function (change) {
        if (change.type === 'characterData') translateText(change.target);
        else if (change.type === 'attributes') translateAttrs(change.target);
        else change.addedNodes.forEach(scan);
      });
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: attrs });
  }).catch(function (error) { console.warn('[i18n]', error.message); });

  window.MineradioI18n = { getLanguage: function () { return language; }, setLanguage: setLanguage };
})();

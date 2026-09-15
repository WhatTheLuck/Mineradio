var spacePresetMenuOpen = false;
var activeSpaceSourcePreset = '';

function spaceSourcePresetMenuHtml() {
  var api = window.MineradioExternalVisuals;
  var names = api && typeof api.sourcePresetNames === 'function' ? api.sourcePresetNames('space') : [];
  return '<div class="space-preset-submenu' + (spacePresetMenuOpen ? ' open' : '') + '" id="space-preset-submenu" role="group" aria-label="星际磁流体预设">' + names.map(function (name, index) {
    var active = name === activeSpaceSourcePreset;
    return '<button type="button" class="space-preset-option' + (active ? ' active' : '') + '" data-space-source-preset="' + index + '" aria-pressed="' + active + '" onclick="applySpaceSourcePreset(event,' + index + ')"><span>' + name + '</span><small>MAGNETIC</small></button>';
  }).join('') + '</div>';
}

function emomusicModeMenuHtml() {
  var api = window.MineradioEmoMusic;
  var current = api && typeof api.currentMode === 'function' ? api.currentMode() : 'particles';
  return '<div class="emomusic-mode-submenu" role="group" aria-label="EmoMusic 面部形态">' + [
    { id: 'particles', label: '粒子' },
    { id: 'mesh', label: 'Mesh' },
    { id: 'surface', label: 'Surface' }
  ].map(function (item) {
    var active = current === item.id;
    return '<button type="button" class="emomusic-mode-option' + (active ? ' active' : '') + '" data-emomusic-mode="' + item.id + '" aria-pressed="' + active + '" onclick="applyEmomusicMode(event,\'' + item.id + '\')">' + item.label + '</button>';
  }).join('') + '</div>';
}

function handlePresetCardClick(preset) {
  if (Number(preset) === 14) spacePresetMenuOpen = !spacePresetMenuOpen;
  else spacePresetMenuOpen = false;
  setPreset(preset);
  refreshPresetGrid();
}

function applySpaceSourcePreset(event, index) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  var api = window.MineradioExternalVisuals;
  if (!api || typeof api.applySourcePreset !== 'function') return;
  if (fx.preset !== 14) setPreset(14);
  activeSpaceSourcePreset = api.applySourcePreset('space', index) || '';
  spacePresetMenuOpen = true;
  refreshPresetGrid();
}

function applyEmomusicMode(event, mode) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  if (fx.preset !== 15) setPreset(15);
  if (window.MineradioEmoMusic && typeof MineradioEmoMusic.setMode === 'function') MineradioEmoMusic.setMode(mode);
  refreshPresetGrid();
}

function buildPresetGrid() {
  var grid = document.getElementById('preset-grid');
  if (!grid) return;
  var seen = {};
  var order = presetDisplayOrder.filter(function (id) {
    var ok = id >= 0 && id < presetMeta.length && !seen[id];
    seen[id] = true;
    return ok;
  });
  presetMeta.forEach(function (_, id) {
    if (!seen[id]) order.push(id);
  });
  grid.innerHTML = order.map(function (i) {
    var p = presetMeta[i];
    var name = p.nameHtml || p.name;
    var desc = p.descHtml || p.desc;
    var cardClass = p.premiumVisual ? ' preset-card-premium' : '';
    var cardStyle = p.premiumVisual
      ? ' style="--preset-accent:' + p.accent + ';--preset-accent-2:' + p.accent2 + '"'
      : '';
    var card = '<button type="button" class="preset-card' + cardClass + '" data-preset="' + i + '"' + cardStyle + ' onclick="handlePresetCardClick(' + i + ')"' + (i === 14 ? ' aria-expanded="' + spacePresetMenuOpen + '" aria-controls="space-preset-submenu"' : '') + '>' +
      '<div class="pc-icon">' + presetIcons[i] + '</div>' +
      '<div class="pc-name">' + name + '</div>' +
      '<div class="pc-desc">' + desc + '</div>' +
      '</button>';
    if (i === 14) return '<div class="preset-card-group space-preset-card-group">' + card + spaceSourcePresetMenuHtml() + '</div>';
    if (i === 15) return '<div class="preset-card-group emomusic-preset-card-group">' + card + emomusicModeMenuHtml() + '</div>';
    return card;
  }).join('');
  refreshPresetGrid();
}
function refreshPresetGrid() {
  document.querySelectorAll('.preset-card').forEach(function (el) {
    el.classList.toggle('active', Number(el.dataset.preset) === fx.preset);
  });
  var spaceCard = document.querySelector('.preset-card[data-preset="14"]');
  if (spaceCard) spaceCard.setAttribute('aria-expanded', spacePresetMenuOpen ? 'true' : 'false');
  var menu = document.getElementById('space-preset-submenu');
  if (menu) menu.classList.toggle('open', spacePresetMenuOpen);
  document.querySelectorAll('[data-space-source-preset]').forEach(function (button) {
    var api = window.MineradioExternalVisuals;
    var names = api && typeof api.sourcePresetNames === 'function' ? api.sourcePresetNames('space') : [];
    var active = names[Number(button.dataset.spaceSourcePreset)] === activeSpaceSourcePreset;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  var emomusicMode = window.MineradioEmoMusic && typeof MineradioEmoMusic.currentMode === 'function' ? MineradioEmoMusic.currentMode() : 'particles';
  document.querySelectorAll('[data-emomusic-mode]').forEach(function (button) {
    var active = button.dataset.emomusicMode === emomusicMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

window.addEventListener('mineradio-external-presets-ready', buildPresetGrid);
window.addEventListener('mineradio-external-preset-change', function (event) {
  if (event.detail && event.detail.kind === 'space') activeSpaceSourcePreset = event.detail.name || '';
  refreshPresetGrid();
});
window.addEventListener('mineradio-emomusic-mode-change', refreshPresetGrid);
function triggerPresetParticleTransition(fromPreset, toPreset) {
  presetTransition.active = true;
  presetTransition.start = uniforms.uTime.value;
  presetTransition.duration = toPreset === 5 ? 0.30 : 0.24;
  presetTransition.from = fromPreset;
  presetTransition.to = toPreset;
  var newVisual = toPreset >= 4;
  var wallpaperFlow = toPreset === 5;
  uniforms.uScatter.value = Math.max(uniforms.uScatter.value, fx.scatter + (newVisual ? (wallpaperFlow ? 0.008 : 0.024) : 0.12));
  uniforms.uBurstAmt.value = Math.max(uniforms.uBurstAmt.value, wallpaperFlow ? 0.05 : 0.15);
  camPunch = Math.max(camPunch, wallpaperFlow ? 0.04 : 0.12);
  for (var i = 0; i < 3; i++) {
    triggerRipple((Math.random() - 0.5) * 3.4, (Math.random() - 0.5) * 3.4, 0.58 + Math.random() * 0.32);
  }
  var card = document.querySelector('.preset-card[data-preset="' + toPreset + '"]');
  if (card) {
    card.classList.remove('switching');
    void card.offsetWidth;
    card.classList.add('switching');
    setTimeout(function () { card.classList.remove('switching'); }, 760);
  }
}
function tickPresetTransition() {
  if (!presetTransition.active) return;
  var raw = (uniforms.uTime.value - presetTransition.start) / presetTransition.duration;
  var t = Math.max(0, Math.min(1, raw));
  var wave = Math.sin(t * Math.PI);
  var newVisual = presetTransition.to >= 4;
  var wallpaperFlow = presetTransition.to === 5;
  uniforms.uScatter.value = Math.max(uniforms.uScatter.value, fx.scatter + wave * (newVisual ? (wallpaperFlow ? 0.008 : 0.026) : 0.16));
  uniforms.uBurstAmt.value = Math.max(uniforms.uBurstAmt.value, wave * (wallpaperFlow ? 0.045 : (newVisual ? 0.12 : 0.15)));
  uniforms.uPointScale.value = fx.point * (1 + wave * (wallpaperFlow ? 0.016 : 0.048));
  if (raw >= 1) {
    presetTransition.active = false;
    syncFxUniforms();
  }
}
function setPreset(p, opts) {
  opts = opts || {};
  p = Math.max(0, Math.min(presetMeta.length - 1, Number(p) || 0));
  var prev = fx.preset;
  var changed = prev !== p;
  fx.preset = p;
  if (changed && prev === SKULL_PRESET_INDEX && p !== SKULL_PRESET_INDEX) clearSkullPresetResidue();
  if (p === SKULL_PRESET_INDEX) loadSkullParticleAsset();
  if (changed && window.MineradioSonicTopography) MineradioSonicTopography.onPresetChange(prev, p, { scene: scene, fx: fx });
  if (changed && window.MineradioSonicWorkshop) MineradioSonicWorkshop.onPresetChange(prev, p, { scene: scene, fx: fx });
  uniforms.uPreset.value = p;
  refreshPresetGrid();
  if (typeof updateSonicSeriesControlVisibility === 'function') updateSonicSeriesControlVisibility();
  if (typeof updateSonicWorkshopColorControls === 'function') updateSonicWorkshopColorControls();
  if (changed && !opts.skipTransition) triggerPresetParticleTransition(prev, p);
  // 每个预设对应的相机基线 (改 userOrbit)
  if (changed && !opts.preserveCamera) {
    if (p === 5) {
      captureCurrentOrbitAsBaseline();
      requestStageLyricCameraSnap(12);
    } else if (typeof applyPresetOrbitBaseline === 'function') {
      applyPresetOrbitBaseline(p);
    }
  }
  if (changed && !opts.silent) showToast('视觉预设: ' + presetMeta[p].name);
  var shouldCommitPlaybackPreset = !!opts.commitPlaybackPreset || !opts.noSave;
  if (shouldCommitPlaybackPreset) {
    playbackVisualPreset = p;
    startupVisualPreviewActive = false;
  }
  if (!opts.noSave) {
    saveLyricLayout({ user: !opts.silent, reason: 'preset' });
  }
}

function syncFxUniforms() {
  uniforms.uPreset.value = fx.preset;
  uniforms.uIntensity.value = fx.intensity;
  uniforms.uDepth.value = fx.depth;
  uniforms.uPointScale.value = fx.point;
  uniforms.uSpeed.value = fx.speed;
  uniforms.uTwist.value = fx.twist;
  uniforms.uColorBoost.value = fx.color;
  uniforms.uScatter.value = fx.scatter;
  uniforms.uCoverRes.value = normalizeCoverResolution(fx.coverResolution);
  uniforms.uBgFade.value = fx.bgFade;
  uniforms.uBloomStrength.value = fx.bloom ? fx.bloomStrength : 0;
  if (uniforms.uBackdropAdapt) uniforms.uBackdropAdapt.value = fx.coverBackdropAdapt !== false
    ? clampRange(Number(fx.lyricBackgroundAdapt) || 0, 0, 1)
    : 0;
  if (bloomParticles) bloomParticles.visible = fx.bloom && fx.bloomStrength > 0.01;
  uniforms.uEdgeEnabled.value = fx.edge ? 1 : 0;
  if (uniforms.uTintColor) uniforms.uTintColor.value.set(normalizeHexColor(fx.visualTintColor || '#9db8cf'));
  if (uniforms.uTintStrength) uniforms.uTintStrength.value = fx.visualTintMode === 'custom' ? 0.42 : 0;
  syncSkullParticleColors();
}

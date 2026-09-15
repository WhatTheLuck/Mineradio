import "./style.css";
import { AudioInput } from "./audio.js";
import { MagneticVisualizer } from "./visualizer.js";

const presetModules = import.meta.glob("../presets/*.json", { eager: true, import: "default" });
const presets = Object.entries(presetModules).map(([path, data]) => ({
  id: path.split("/").pop().replace(/\.json$/i, ""),
  data
})).sort((a, b) => a.id.localeCompare(b.id, "zh-CN"));

const $ = selector => document.querySelector(selector);
const canvas = $("#visualizer");
const panel = $("#control-panel");
const showControls = $("#show-controls");
const audioPlayer = $("#audio-player");
const fileInput = $("#file-input");
const errorMessage = $("#error-message");
let visualizer;

try {
  visualizer = new MagneticVisualizer(canvas);
} catch (error) {
  showError(error.message);
}

const setState = state => {
  $("#source-name").textContent = state.name;
  $("#status-text").textContent = state.detail;
  $("#status-dot").classList.toggle("is-live", state.active);
  $("#stop-button").disabled = !state.active;
  document.querySelectorAll(".source-button").forEach(button => button.classList.toggle("is-active", button.id.startsWith(state.type || "__")));
  if (!state.active) audioPlayer.hidden = true;
};

const audio = new AudioInput(metrics => visualizer?.setMetrics(metrics), setState);

const microphoneButton = $("#mic-button");
const desktopButton = $("#desktop-button");
const microphoneAvailable = Boolean(
  navigator.mediaDevices?.getUserMedia
  || navigator.getUserMedia
  || navigator.webkitGetUserMedia
  || navigator.mozGetUserMedia
);
if (!microphoneAvailable) {
  microphoneButton.disabled = true;
  microphoneButton.querySelector("small").textContent = "此浏览器不支持";
} else if (!globalThis.isSecureContext) {
  microphoneButton.querySelector("small").textContent = "需要 HTTPS 安全连接";
}
if (!navigator.mediaDevices?.getDisplayMedia) {
  desktopButton.disabled = true;
  desktopButton.querySelector("small").textContent = "此设备不支持";
}

const visualDefaults = visualizer?.getParameters() || {};
const audioDefaults = audio.getParameters();
const saved = (() => { try { return JSON.parse(localStorage.getItem("magnetic:settings") || "{}"); } catch { return {}; } })();
const controlUpdaters = new Map();
const controlInputs = new Map();
let presetSelect;
let applyingPreset = false;
let refreshConditionalControls = () => {};

const number = (label, target, key, min, max, step) => ({ label, target, key, type: "number", min, max, step });
const color = (label, key) => ({ label, target: "visual", key, type: "color" });
const rangePair = (label, target, lowerKey, upperKey, min, max, step) => ({ label, target, lowerKey, upperKey, type: "rangePair", min, max, step });
const toggle = (label, target, key) => ({ label, target, key, type: "toggle" });
const parameterGroups = [
  ["流体", [
    number("球体数量", "visual", "sphereCount", 1, 80, 1),
    number("融合度", "visual", "liquidFusion", .05, 5, .01),
    number("主体透明度", "visual", "liquidAlpha", 0, 1, .01), number("中心浓度", "visual", "centerConcentration", 0, 5, .01),
    color("主体颜色", "liquidColor")
  ]],
  ["音频特征输入范围", [
    number("FFT 尺寸", "audio", "fftSize", 32, 32768, 32),
    rangePair("低频范围 Hz", "audio", "bassFrom", "bassTo", 10, 4000, 1),
    rangePair("中频范围 Hz", "audio", "midFrom", "midTo", 100, 12000, 1),
    rangePair("整体音量输入", "visual", "levelInputMin", "levelInputMax", 0, 1, .001),
    rangePair("低频输入", "visual", "bassInputMin", "bassInputMax", 0, 1, .001),
    rangePair("中频输入", "visual", "midInputMin", "midInputMax", 0, 1, .001),
    number("信号阈值", "audio", "signalThreshold", 0, .1, .0005),
    { label: "逐帧低频响应", type: "live", id: "live-bass" }, { label: "逐帧中频响应", type: "live", id: "live-mid" },
    { label: "总音量 RMS", type: "live", id: "live-level" }
  ]],
  ["视觉输出范围", [
    rangePair("球体大小（低频）", "visual", "sphereSizeMin", "sphereSizeMax", .05, 6, .01),
    rangePair("中心核大小（低频）", "visual", "coreSizeMin", "coreSizeMax", .001, 1, .001),
    rangePair("整体大小（总音量）", "visual", "overallSizeMin", "overallSizeMax", .1, 3, .01),
    rangePair("球体距离（低频）", "visual", "sphereDistanceMin", "sphereDistanceMax", 0, 5, .01),
    rangePair("边缘强度（中频）", "visual", "edgeIntensityMin", "edgeIntensityMax", 0, 8, .01),
    { label: "实时球体大小（低频）", type: "live", id: "live-sphere-size" }, { label: "实时中心核大小（低频）", type: "live", id: "live-core-size" },
    { label: "实时整体大小（总音量）", type: "live", id: "live-overall-size" }, { label: "实时球体距离（低频）", type: "live", id: "live-sphere-distance" },
    { label: "实时边缘强度（中频）", type: "live", id: "live-edge" }
  ]],
  ["运动", [
    number("基础速度", "visual", "baseSpeed", 0, 5, .01), number("有声速度倍率", "visual", "audioSpeedMultiplier", 0, 5, .01),
    toggle("光标引力", "visual", "pointerAttractionEnabled"),
    number("光标吸引力", "visual", "pointerAttraction", 0, 2, .005),
    number("光标引力半径", "visual", "pointerRadius", .1, 10, .1)
  ]],
  ["边缘", [
    toggle("随机连续变色", "visual", "randomEdgeColorsEnabled"),
    number("变色速度（次/秒）", "visual", "randomEdgeColorSpeed", 0, 1, .01),
    toggle("边缘单色", "visual", "singleEdgeColorEnabled"),
    toggle("自动渐变旋转", "visual", "autoGradientRotationEnabled"),
    number("旋转速度（°/秒）", "visual", "autoGradientRotationSpeed", -180, 180, .1),
    color("边缘颜色 A", "edgeColor1"), color("边缘颜色 B", "edgeColor2"),
    number("边缘宽度", "visual", "edgeWidth", 0, 3, .01),
    number("渐变旋转", "visual", "gradientRotation", -360, 360, 1), number("边缘平滑", "visual", "edgeSmoothness", 0, 3, .01)
  ]],
  ["高光 A", [
    color("颜色", "highlightColor1"), number("强度", "visual", "highlightIntensity1", 0, 5, .01),
    number("集中度", "visual", "highlightConcentration1", 0, 300, 1), number("水平角", "visual", "horizontalAngle1", -360, 360, 1),
    number("垂直角", "visual", "verticalAngle1", -360, 360, 1)
  ]],
  ["高光 B", [
    color("颜色", "highlightColor2"), number("强度", "visual", "highlightIntensity2", 0, 5, .01),
    number("集中度", "visual", "highlightConcentration2", 0, 300, 1), number("水平角", "visual", "horizontalAngle2", -360, 360, 1),
    number("垂直角", "visual", "verticalAngle2", -360, 360, 1)
  ]],
  ["相机与画布", [
    number("相机距离", "visual", "cameraDistance", .1, 20, .01), number("相机水平角", "visual", "angleX", -45, 45, .1),
    number("相机垂直角", "visual", "angleY", -45, 45, .1), number("光标跟随幅度", "visual", "hoverAmplitude", 0, 2, .01),
    number("像素预算 MP", "visual", "pixelBudgetMP", .25, 20, .25), number("设备倍率上限", "visual", "deviceScaleMax", .5, 4, .1),
    number("目标帧率", "visual", "targetFps", 0, 120, 1), number("最低自适应分辨率", "visual", "adaptiveResolutionMin", .35, 1, .05),
    { label: "实时帧率", type: "live", id: "live-fps" }, { label: "自适应倍率", type: "live", id: "live-render-scale" },
    { label: "帧缓冲", type: "live", id: "live-resolution" }, { label: "整体位置", type: "live", id: "live-position" }
  ]]
];

const rgbToHex = rgb => `#${rgb.map(value => Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, "0")).join("")}`;
const hexToRgb = hex => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
const getValue = row => row.target === "visual" ? visualDefaults[row.key] : audioDefaults[row.key];
const controlKey = (target, key) => `${target}.${key}`;
const markCustom = () => {
  if (applyingPreset || !presetSelect) return;
  presetSelect.value = "__custom";
  localStorage.removeItem("magnetic:preset");
};
const applyValue = (row, value, persist = true) => {
  if (row.target === "visual") visualizer?.setParameter(row.key, value);
  if (row.target === "audio") audio.setParameter(row.key, value);
  if (persist) {
    saved[controlKey(row.target, row.key)] = value;
    localStorage.setItem("magnetic:settings", JSON.stringify(saved));
    markCustom();
  }
};

const settings = $("#settings");
parameterGroups.forEach(([title, rows], groupIndex) => {
  const details = document.createElement("details");
  details.className = "parameter-group";
  details.open = groupIndex < 3;
  const summary = document.createElement("summary");
  summary.innerHTML = `<span>${title}</span><small>${rows.length} 项</small>`;
  details.append(summary);
  const grid = document.createElement("div");
  grid.className = "parameter-grid";
  rows.forEach(definition => {
    const rowElement = document.createElement("div");
    rowElement.className = `parameter-row${definition.type === "rangePair" ? " is-wide is-range-pair" : ""}${definition.type === "toggle" ? " is-toggle" : ""}`;
    const label = document.createElement("label");
    label.textContent = definition.label;
    rowElement.append(label);
    if (definition.type === "live") {
      const output = document.createElement("strong");
      output.id = definition.id;
      output.textContent = definition.id === "live-resolution" ? "初始化中" : definition.id === "live-position" ? "0.00, 0.00" : "0.000";
      rowElement.append(output);
    } else if (definition.type === "rangePair") {
      const readRangeValue = key => Number(saved[`${definition.target}.${key}`] ?? getValue({ target: definition.target, key }));
      let lowerValue = readRangeValue(definition.lowerKey);
      let upperValue = readRangeValue(definition.upperKey);
      if (lowerValue > upperValue) [lowerValue, upperValue] = [upperValue, lowerValue];

      const controls = document.createElement("div");
      controls.className = "range-pair-controls";
      const values = document.createElement("div");
      values.className = "range-pair-values";
      const lowerNumber = document.createElement("input");
      const upperNumber = document.createElement("input");
      for (const [input, boundary] of [[lowerNumber, "下界"], [upperNumber, "上界"]]) {
        Object.assign(input, { type: "number", min: definition.min, max: definition.max, step: definition.step });
        input.setAttribute("aria-label", `${definition.label}${boundary}`);
      }
      values.append(lowerNumber, upperNumber);

      const slider = document.createElement("div");
      slider.className = "dual-range";
      const lowerRange = document.createElement("input");
      const upperRange = document.createElement("input");
      for (const [input, boundary] of [[lowerRange, "下界滑块"], [upperRange, "上界滑块"]]) {
        Object.assign(input, { type: "range", min: definition.min, max: definition.max, step: definition.step });
        input.setAttribute("aria-label", `${definition.label}${boundary}`);
      }
      slider.append(lowerRange, upperRange);
      controls.append(values, slider);

      const sync = (changed, rawValue, persist = true) => {
        const value = Math.min(definition.max, Math.max(definition.min, Number(rawValue)));
        if (!Number.isFinite(value)) return;
        if (changed === "lower") lowerValue = Math.min(value, upperValue);
        else upperValue = Math.max(value, lowerValue);
        lowerNumber.value = lowerRange.value = lowerValue;
        upperNumber.value = upperRange.value = upperValue;
        const span = Math.max(Number.EPSILON, definition.max - definition.min);
        slider.style.setProperty("--range-start", `${(lowerValue - definition.min) / span * 100}%`);
        slider.style.setProperty("--range-end", `${(upperValue - definition.min) / span * 100}%`);
        applyValue({ target: definition.target, key: definition.lowerKey }, lowerValue, persist);
        applyValue({ target: definition.target, key: definition.upperKey }, upperValue, persist);
      };
      lowerNumber.addEventListener("input", () => sync("lower", lowerNumber.valueAsNumber));
      upperNumber.addEventListener("input", () => sync("upper", upperNumber.valueAsNumber));
      lowerRange.addEventListener("input", () => sync("lower", lowerRange.valueAsNumber));
      upperRange.addEventListener("input", () => sync("upper", upperRange.valueAsNumber));
      const renderExternal = () => {
        lowerNumber.value = lowerRange.value = lowerValue;
        upperNumber.value = upperRange.value = upperValue;
        const span = Math.max(Number.EPSILON, definition.max - definition.min);
        slider.style.setProperty("--range-start", `${(lowerValue - definition.min) / span * 100}%`);
        slider.style.setProperty("--range-end", `${(upperValue - definition.min) / span * 100}%`);
      };
      controlUpdaters.set(controlKey(definition.target, definition.lowerKey), value => { lowerValue = Number(value); renderExternal(); });
      controlUpdaters.set(controlKey(definition.target, definition.upperKey), value => { upperValue = Number(value); renderExternal(); });
      sync("lower", lowerValue, false);
      rowElement.append(controls);
    } else {
      let value = saved[`${definition.target}.${definition.key}`] ?? getValue(definition);
      const input = document.createElement("input");
      input.type = definition.type === "toggle" ? "checkbox" : definition.type;
      input.setAttribute("aria-label", definition.label);
      if (definition.type === "number") {
        Object.assign(input, { min: definition.min, max: definition.max, step: definition.step, value });
      } else if (definition.type === "color") input.value = rgbToHex(value);
      else if (definition.type === "toggle") input.checked = Boolean(value);
      else input.value = value;
      const commit = () => {
        const next = definition.type === "color" ? hexToRgb(input.value) : definition.type === "number" ? input.valueAsNumber : definition.type === "toggle" ? input.checked : input.value;
        if (definition.type !== "number" || Number.isFinite(next)) {
          applyValue(definition, next);
          refreshConditionalControls();
        }
      };
      input.addEventListener("input", commit);
      input.addEventListener("change", commit);
      rowElement.append(input);
      controlInputs.set(controlKey(definition.target, definition.key), input);
      applyValue(definition, definition.type === "color" && typeof value === "string" ? hexToRgb(value) : value, false);
      controlUpdaters.set(controlKey(definition.target, definition.key), next => {
        if (definition.type === "color") input.value = rgbToHex(next);
        else if (definition.type === "toggle") input.checked = Boolean(next);
        else input.value = next;
      });
    }
    grid.append(rowElement);
  });
  details.append(grid);
  settings.append(details);
});

refreshConditionalControls = () => {
  const params = visualizer?.getParameters();
  if (!params) return;
  const disable = (key, disabled) => {
    const input = controlInputs.get(controlKey("visual", key));
    if (input) input.disabled = disabled;
  };
  disable("randomEdgeColorSpeed", !params.randomEdgeColorsEnabled);
  disable("autoGradientRotationEnabled", false);
  disable("autoGradientRotationSpeed", !params.autoGradientRotationEnabled);
  disable("edgeColor2", params.singleEdgeColorEnabled);
};
refreshConditionalControls();

presetSelect = $("#preset-select");
const presetNameInput = $("#preset-name");
presetSelect.append(new Option("自定义", "__custom"));
presets.forEach(preset => presetSelect.append(new Option(preset.id, preset.id)));

const applyPreset = preset => {
  if (!preset?.data || typeof preset.data !== "object") return;
  applyingPreset = true;
  const groups = {
    visual: {
      pointerAttractionEnabled: false,
      randomEdgeColorsEnabled: false,
      randomEdgeColorSpeed: 0.08,
      singleEdgeColorEnabled: false,
      autoGradientRotationEnabled: false,
      autoGradientRotationSpeed: 6,
      ...(preset.data.visual || {})
    },
    audio: preset.data.audio || {}
  };
  for (const [target, values] of Object.entries(groups)) {
    for (const [key, value] of Object.entries(values)) {
      applyValue({ target, key }, value, false);
      saved[controlKey(target, key)] = value;
      controlUpdaters.get(controlKey(target, key))?.(value);
    }
  }
  localStorage.setItem("magnetic:settings", JSON.stringify(saved));
  localStorage.setItem("magnetic:preset", preset.id);
  presetSelect.value = preset.id;
  applyingPreset = false;
  refreshConditionalControls();
};

presetSelect.addEventListener("change", () => {
  const preset = presets.find(candidate => candidate.id === presetSelect.value);
  if (preset) {
    applyPreset(preset);
    presetNameInput.value = preset.data.name || preset.id;
    localStorage.setItem("magnetic:preset-name", presetNameInput.value);
  }
});

const activePreset = localStorage.getItem("magnetic:preset");
presetSelect.value = presets.some(preset => preset.id === activePreset) ? activePreset : "__custom";
const selectedPreset = presets.find(preset => preset.id === presetSelect.value);
presetNameInput.value = localStorage.getItem("magnetic:preset-name") || selectedPreset?.data.name || selectedPreset?.id || "";
presetNameInput.addEventListener("input", () => {
  localStorage.setItem("magnetic:preset-name", presetNameInput.value);
});

$("#reset-settings").addEventListener("click", () => {
  localStorage.removeItem("magnetic:settings");
  location.reload();
});

const downloadPreset = (payload, safeFileName) => {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeFileName}.json`;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const saveSettings = async () => {
  const presetName = presetNameInput.value.trim() || "magnetic-preset";
  const safeFileName = presetName
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/[. ]+$/g, "")
    .slice(0, 64) || "magnetic-preset";
  presetNameInput.value = presetName;
  localStorage.setItem("magnetic:preset-name", presetName);
  const payload = {
    schema: "magnetic-visualizer-settings",
    version: 2,
    name: presetName,
    savedAt: new Date().toISOString(),
    visual: visualizer?.getParameters() || {},
    audio: audio.getParameters()
  };
  const button = $("#save-settings");
  button.disabled = true;
  button.textContent = "保存中";
  let savedLocally = false;
  try {
    const response = await fetch("/api/presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error("本地保存接口不可用");
    const result = await response.json();
    savedLocally = result.ok === true;
  } catch {
    downloadPreset(payload, safeFileName);
  }

  if (savedLocally) {
    const existingPreset = presets.find(preset => preset.id === safeFileName);
    if (existingPreset) existingPreset.data = payload;
    else {
      presets.push({ id: safeFileName, data: payload });
      presetSelect.append(new Option(safeFileName, safeFileName));
    }
    presetSelect.value = safeFileName;
    localStorage.setItem("magnetic:preset", safeFileName);
  }

  button.disabled = false;
  button.textContent = savedLocally ? "已存入 presets" : "已下载 JSON";
  clearTimeout(button.resetLabelTimer);
  button.resetLabelTimer = setTimeout(() => { button.textContent = "保存 JSON"; }, 1400);
};

$("#save-settings").addEventListener("click", saveSettings);
presetNameInput.addEventListener("keydown", event => {
  if (event.key === "Enter") saveSettings();
});

const originalSetMetrics = visualizer?.setMetrics.bind(visualizer);
if (visualizer) visualizer.setMetrics = metrics => {
  originalSetMetrics(metrics);
  window.dispatchEvent(new CustomEvent("magnetic:audio-metrics", { detail: metrics }));
  $("#live-bass").textContent = metrics.bass.toFixed(3);
  $("#live-mid").textContent = metrics.mid.toFixed(3);
  $("#live-level").textContent = metrics.level.toFixed(3);
};

setInterval(() => {
  const status = visualizer?.getStatus();
  if (!status) return;
  $("#live-resolution").textContent = status.resolution;
  $("#live-fps").textContent = status.fps.toFixed(1);
  $("#live-render-scale").textContent = `${Math.round(status.renderScale * 100)}%`;
  $("#live-position").textContent = status.position;
  $("#live-sphere-size").textContent = status.sphereSize.toFixed(3);
  $("#live-core-size").textContent = status.coreSize.toFixed(3);
  $("#live-overall-size").textContent = status.overallSize.toFixed(3);
  $("#live-sphere-distance").textContent = status.sphereDistance.toFixed(3);
  $("#live-edge").textContent = status.edgeIntensity.toFixed(3);
}, 250);

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = false;
  $("#status-dot")?.classList.add("is-error");
  clearTimeout(showError.timer);
  showError.timer = setTimeout(() => { errorMessage.hidden = true; $("#status-dot")?.classList.remove("is-error"); }, 6000);
}

async function run(action) {
  errorMessage.hidden = true;
  try { await action(); } catch (error) {
    if (error.name === "NotAllowedError") showError("麦克风权限未授予。请在浏览器的网站设置中允许麦克风后重试。");
    else if (error.name === "NotFoundError") showError("没有找到可用麦克风，请检查设备连接和系统权限。");
    else if (error.name === "NotReadableError") showError("麦克风正被其他应用占用，或系统拒绝浏览器读取。关闭占用应用后重试。");
    else showError(error.message || "无法连接音频来源。");
  }
}

$("#file-button").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) run(() => audio.useFile(file, audioPlayer));
  fileInput.value = "";
});
const pauseFile = () => { audioPlayer.pause(); audioPlayer.hidden = true; };
desktopButton.addEventListener("click", () => run(async () => { pauseFile(); await audio.useDesktop(); }));
microphoneButton.addEventListener("click", () => run(async () => { pauseFile(); await audio.useMicrophone(); }));
$("#stop-button").addEventListener("click", async () => { audioPlayer.pause(); audioPlayer.removeAttribute("src"); await audio.stop(); });
audioPlayer.addEventListener("ended", () => audio.stop());

function setPanelVisible(visible) {
  panel.classList.toggle("is-hidden", !visible);
  showControls.hidden = visible;
  localStorage.setItem("magnetic:panel", visible ? "visible" : "hidden");
}

$("#hide-controls").addEventListener("click", () => setPanelVisible(false));
showControls.addEventListener("click", () => setPanelVisible(true));

const query = new URLSearchParams(location.search);
let previewBackgroundObjectUrl = null;

if (query.get("preview") === "1") {
  const root = document.documentElement;
  const backgroundControls = $("#preview-background-controls");
  const backgroundStatus = $("#preview-background-status");
  const backgroundColor = $("#preview-background-color");
  const backgroundFileButton = $("#preview-background-file-button");
  const backgroundFile = $("#preview-background-file");
  const backgroundFit = $("#preview-background-fit");
  const backgroundButtons = [...document.querySelectorAll("[data-preview-background]")];
  let previewBackgroundMode = "solid";
  let previewBackgroundFileName = "";

  root.classList.add("preview-transparency", "preview-background-solid");
  backgroundControls.hidden = false;
  root.style.setProperty("--preview-background-color", backgroundColor.value);

  const setPreviewBackgroundMode = mode => {
    if (mode === "image" && !previewBackgroundObjectUrl) return;
    previewBackgroundMode = mode;
    root.classList.toggle("preview-background-solid", mode === "solid");
    root.classList.toggle("preview-background-image", mode === "image");
    backgroundButtons.forEach(button => {
      const active = button.dataset.previewBackground === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    backgroundFileButton.classList.toggle("is-active", mode === "image");
    backgroundFileButton.setAttribute("aria-pressed", String(mode === "image"));
    backgroundFit.disabled = mode !== "image";
    backgroundStatus.textContent = mode === "checker"
      ? "透明棋盘格"
      : mode === "solid"
        ? `纯色 ${backgroundColor.value.toUpperCase()}`
        : previewBackgroundFileName;
  };

  setPreviewBackgroundMode(previewBackgroundMode);

  backgroundButtons.forEach(button => button.addEventListener("click", () => {
    setPreviewBackgroundMode(button.dataset.previewBackground);
  }));

  backgroundColor.addEventListener("input", () => {
    root.style.setProperty("--preview-background-color", backgroundColor.value);
    setPreviewBackgroundMode("solid");
  });

  backgroundFileButton.addEventListener("click", () => backgroundFile.click());
  backgroundFile.addEventListener("change", () => {
    const file = backgroundFile.files?.[0];
    backgroundFile.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showError("请选择 PNG、JPEG、WebP 等图片文件。");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      showError("背景图片不能超过 25 MB，请压缩后重试。");
      return;
    }

    const nextObjectUrl = URL.createObjectURL(file);
    const probe = new Image();
    probe.onload = () => {
      if (previewBackgroundObjectUrl) URL.revokeObjectURL(previewBackgroundObjectUrl);
      previewBackgroundObjectUrl = nextObjectUrl;
      previewBackgroundFileName = file.name;
      root.style.setProperty("--preview-background-image", `url("${nextObjectUrl}")`);
      setPreviewBackgroundMode("image");
    };
    probe.onerror = () => {
      URL.revokeObjectURL(nextObjectUrl);
      showError("无法读取这张图片，请换一个文件重试。");
    };
    probe.src = nextObjectUrl;
  });

  backgroundFit.addEventListener("change", () => {
    root.style.setProperty("--preview-background-size", backgroundFit.value);
  });
}
if (query.get("embed") === "1" || localStorage.getItem("magnetic:panel") === "hidden") setPanelVisible(false);

window.addEventListener("beforeunload", () => {
  audio.stop();
  if (previewBackgroundObjectUrl) URL.revokeObjectURL(previewBackgroundObjectUrl);
});

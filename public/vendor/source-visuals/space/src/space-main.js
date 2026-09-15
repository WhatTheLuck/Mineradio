import "./space-style.css";
import { Starfield, DEFAULT_STARFIELD_CONFIG } from "./starfield.js";
import { RealtimeSpectrogram } from "./spectrogram.js";

const STORAGE_KEY = "space-venom:starfield";
const PRESET_KEY = "space-venom:starfield-preset";
const PRESET_NAME_KEY = "space-venom:starfield-preset-name";
const BRIGHTNESS_CONTROL_MAX = 10;
const $ = selector => document.querySelector(selector);
const presetModules = import.meta.glob("../starfield-presets/*.json", { eager: true, import: "default" });
const starfieldPresets = Object.entries(presetModules).map(([path, data]) => ({
  id: path.split("/").pop().replace(/\.json$/i, ""),
  data
})).filter(preset => preset.data?.schema === "space-venom-starfield-settings" && preset.data?.starfield);
const saved = (() => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
  catch { return {}; }
})();

const starfield = new Starfield($("#starfield"), saved);
const spectrogram = new RealtimeSpectrogram($("#star-spectrum-history"), $("#star-spectrum-overlay"), $("#star-spectrum-range"));
const controls = $("#star-controls");
const controlUpdaters = new Map();
let applyingPreset = false;
let presetSelect;

const rangePair = (key, upperKey, label, min, max, step) => ({ key, upperKey, label, min, max, step, type: "rangePair" });
const definitions = [
  { type: "section", label: "音频响应" },
  { ...rangePair("bassFrom", "bassTo", "独立低频范围 Hz", 10, 4000, 1), spectrumRange: true },
  rangePair("bassInputMin", "bassInputMax", "低频映射（阈值 / 饱和）", 0, 1, 0.001),
  { key: "cruiseSpeed", label: "巡航速度（阈值以下）", min: 0, max: 5, step: 0.05 },
  { key: "quietBrightness", label: "安静亮度（阈值以下）", min: 0, max: BRIGHTNESS_CONTROL_MAX, step: 0.01 },
  { key: "cruiseTrailLength", label: "巡航星轨长度（阈值以下）", min: 0, max: 4, step: 0.05 },
  { ...rangePair("speedMin", "speedMax", "飞行速度映射（下界 / 上界）", 0, 30, 0.05), floorKey: "cruiseSpeed" },
  { ...rangePair("brightnessMin", "brightnessMax", "亮度映射（下界 / 上界）", 0, BRIGHTNESS_CONTROL_MAX, 0.01), floorKey: "quietBrightness" },
  { ...rangePair("trailLengthMin", "trailLengthMax", "星轨长度映射（下界 / 上界）", 0, 4, 0.05), floorKey: "cruiseTrailLength" },
  { key: "live", label: "实时低频 / 速度 / 星轨", type: "live" },
  { type: "section", label: "星空外观" },
  { key: "enabled", label: "启用星空", type: "checkbox" },
  { key: "density", label: "星体密度", min: 80, max: 2200, step: 20 },
  { key: "starSize", label: "星体尺寸", min: 0.4, max: 5, step: 0.05 },
  { key: "spread", label: "视野扩散", min: 0.4, max: 1.8, step: 0.01 },
  { key: "viewDistance", label: "视野距离（裁切缩放）", min: 0.25, max: 4, step: 0.05 },
  { key: "color", label: "星体颜色", type: "color" }
];

const mappingDependencies = Object.freeze({
  cruiseSpeed: ["speedMin", "speedMax"],
  quietBrightness: ["brightnessMin", "brightnessMax"],
  cruiseTrailLength: ["trailLengthMin", "trailLengthMax"]
});
const refreshControls = keys => {
  const parameters = starfield.getParameters();
  for (const key of keys) controlUpdaters.get(key)?.(parameters[key]);
};

const persist = () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(starfield.getParameters()));
  if (!applyingPreset && presetSelect) {
    presetSelect.value = "__custom";
    localStorage.removeItem(PRESET_KEY);
  }
};

definitions.forEach(definition => {
  if (definition.type === "section") {
    const heading = document.createElement("h3");
    heading.className = "star-control-section";
    heading.textContent = definition.label;
    controls.append(heading);
    return;
  }
  const row = document.createElement("label");
  row.className = `star-control${definition.type === "checkbox" || definition.type === "color" || definition.type === "live" ? " is-compact" : ""}${definition.type === "rangePair" ? " is-range-pair" : ""}`;
  const name = document.createElement("span");
  name.textContent = definition.label;
  const current = starfield.getParameters()[definition.key];
  if (definition.type === "live") {
    const output = document.createElement("output");
    output.id = "star-live-response";
    output.value = "0.000 / 0.00 / 0.00";
    row.append(name, output);
    controls.append(row);
    return;
  }

  const input = document.createElement("input");

  if (definition.type === "rangePair") {
    const upperCurrent = starfield.getParameters()[definition.upperKey];
    const wrapper = document.createElement("div");
    wrapper.className = "star-range-pair";
    const values = document.createElement("div");
    values.className = "star-range-values";
    const lowerNumber = document.createElement("input");
    const upperNumber = document.createElement("input");
    const slider = document.createElement("div");
    slider.className = "star-dual-range";
    const lowerRange = document.createElement("input");
    const upperRange = document.createElement("input");
    for (const [control, boundary] of [[lowerNumber, "下界"], [upperNumber, "上界"]]) {
      Object.assign(control, { type: "number", min: definition.min, max: definition.max, step: definition.step });
      control.setAttribute("aria-label", `${definition.label}${boundary}`);
    }
    for (const [control, boundary] of [[lowerRange, "下界滑块"], [upperRange, "上界滑块"]]) {
      Object.assign(control, { type: "range", min: definition.min, max: definition.max, step: definition.step });
      control.setAttribute("aria-label", `${definition.label}${boundary}`);
    }
    let lowerValue = Math.min(Number(current), Number(upperCurrent));
    let upperValue = Math.max(Number(current), Number(upperCurrent));
    const render = () => {
      const floorValue = definition.floorKey
        ? Math.max(definition.min, Number(starfield.getParameters()[definition.floorKey]) || 0)
        : definition.min;
      lowerNumber.min = lowerRange.min = floorValue;
      lowerNumber.title = definition.floorKey
        ? `下界不能低于${definitions.find(item => item.key === definition.floorKey)?.label || "默认值"} ${floorValue}`
        : "";
      lowerNumber.value = lowerRange.value = lowerValue;
      upperNumber.value = upperRange.value = upperValue;
      const span = definition.max - definition.min;
      slider.style.setProperty("--range-start", `${(lowerValue - definition.min) / span * 100}%`);
      slider.style.setProperty("--range-end", `${(upperValue - definition.min) / span * 100}%`);
      const endpointsOverlap = Math.abs(lowerValue - upperValue) < Number(definition.step) * 0.5;
      const lowerCanMoveDown = lowerValue > floorValue;
      lowerRange.style.zIndex = endpointsOverlap && lowerCanMoveDown ? "5" : "3";
      upperRange.style.zIndex = endpointsOverlap && !lowerCanMoveDown ? "5" : "4";
      slider.classList.toggle("has-overlapping-endpoints", endpointsOverlap);
    };
    const sync = (boundary, value) => {
      if (!Number.isFinite(value)) return;
      const dynamicMinimum = boundary === "lower" && definition.floorKey
        ? Math.max(definition.min, Number(starfield.getParameters()[definition.floorKey]) || 0)
        : definition.min;
      const bounded = Math.min(definition.max, Math.max(dynamicMinimum, value));
      if (boundary === "lower") lowerValue = Math.min(bounded, upperValue);
      else upperValue = Math.max(bounded, lowerValue);
      render();
      starfield.setParameter(definition.key, lowerValue);
      starfield.setParameter(definition.upperKey, upperValue);
      const normalized = starfield.getParameters();
      lowerValue = Number(normalized[definition.key]);
      upperValue = Number(normalized[definition.upperKey]);
      render();
      if (definition.spectrumRange) spectrogram.setRange(lowerValue, upperValue, boundary);
      persist();
    };
    lowerNumber.addEventListener("input", () => sync("lower", lowerNumber.valueAsNumber));
    upperNumber.addEventListener("input", () => sync("upper", upperNumber.valueAsNumber));
    lowerRange.addEventListener("input", () => sync("lower", lowerRange.valueAsNumber));
    upperRange.addEventListener("input", () => sync("upper", upperRange.valueAsNumber));
    if (definition.spectrumRange) {
      for (const [control, boundary] of [[lowerNumber, "lower"], [lowerRange, "lower"], [upperNumber, "upper"], [upperRange, "upper"]]) {
        control.addEventListener("focus", () => spectrogram.setRange(lowerValue, upperValue, boundary));
        control.addEventListener("blur", () => spectrogram.setRange(lowerValue, upperValue, null));
        control.addEventListener("pointerdown", () => spectrogram.setRange(lowerValue, upperValue, boundary));
        control.addEventListener("pointerup", () => spectrogram.setRange(lowerValue, upperValue, null));
      }
    }
    values.append(lowerNumber, upperNumber);
    slider.append(lowerRange, upperRange);
    wrapper.append(values, slider);
    row.append(name, wrapper);
    render();
    const updatePair = () => {
      const parameters = starfield.getParameters();
      lowerValue = Math.min(Number(parameters[definition.key]), Number(parameters[definition.upperKey]));
      upperValue = Math.max(Number(parameters[definition.key]), Number(parameters[definition.upperKey]));
      render();
      if (definition.spectrumRange) spectrogram.setRange(lowerValue, upperValue, null);
    };
    controlUpdaters.set(definition.key, updatePair);
    controlUpdaters.set(definition.upperKey, updatePair);
    if (definition.spectrumRange) spectrogram.setRange(lowerValue, upperValue, null);
    controls.append(row);
    return;
  } else if (definition.type === "checkbox") {
    input.type = "checkbox";
    input.checked = Boolean(current);
  } else if (definition.type === "color") {
    input.type = "color";
    input.value = current;
  } else {
    input.type = "range";
    Object.assign(input, { min: definition.min, max: definition.max, step: definition.step, value: current });
  }

  input.setAttribute("aria-label", definition.label);
  row.append(name);
  let readout;

  if (!definition.type) {
    readout = document.createElement("output");
    readout.value = current;
    const rail = document.createElement("div");
    rail.className = "star-control-rail";
    rail.append(input, readout);
    row.append(rail);
    input.addEventListener("input", () => {
      const value = input.valueAsNumber;
      readout.value = value;
      starfield.setParameter(definition.key, value);
      refreshControls([definition.key, ...(mappingDependencies[definition.key] || [])]);
      persist();
    });
  } else {
    row.append(input);
    input.addEventListener("input", () => {
      starfield.setParameter(definition.key, definition.type === "checkbox" ? input.checked : input.value);
      refreshControls([definition.key, ...(mappingDependencies[definition.key] || [])]);
      persist();
    });
  }
  controlUpdaters.set(definition.key, value => {
    if (definition.type === "checkbox") input.checked = Boolean(value);
    else input.value = value;
    if (readout) readout.value = value;
  });
  controls.append(row);
});

presetSelect = $("#star-preset-select");
const presetNameInput = $("#star-preset-name");
const savePresetButton = $("#save-stars");
presetSelect.append(new Option("自定义", "__custom"));
starfieldPresets.forEach(preset => presetSelect.append(new Option(preset.data.name || preset.id, preset.id)));

const applyStarfieldPreset = preset => {
  const values = preset?.data?.starfield;
  if (!values || typeof values !== "object") return;
  applyingPreset = true;
  for (const key of Object.keys(DEFAULT_STARFIELD_CONFIG)) {
    if (!(key in values)) continue;
    starfield.setParameter(key, values[key]);
  }
  refreshControls(Object.keys(DEFAULT_STARFIELD_CONFIG));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(starfield.getParameters()));
  localStorage.setItem(PRESET_KEY, preset.id);
  presetSelect.value = preset.id;
  presetNameInput.value = preset.data.name || preset.id;
  localStorage.setItem(PRESET_NAME_KEY, presetNameInput.value);
  applyingPreset = false;
};

presetSelect.addEventListener("change", () => {
  const preset = starfieldPresets.find(candidate => candidate.id === presetSelect.value);
  if (preset) applyStarfieldPreset(preset);
  else localStorage.removeItem(PRESET_KEY);
});

const activePreset = localStorage.getItem(PRESET_KEY);
presetSelect.value = starfieldPresets.some(preset => preset.id === activePreset) ? activePreset : "__custom";
const selectedPreset = starfieldPresets.find(preset => preset.id === presetSelect.value);
presetNameInput.value = localStorage.getItem(PRESET_NAME_KEY) || selectedPreset?.data.name || selectedPreset?.id || "";
presetNameInput.addEventListener("input", () => localStorage.setItem(PRESET_NAME_KEY, presetNameInput.value));

const downloadStarfieldPreset = (payload, safeFileName) => {
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

const saveStarfieldPreset = async () => {
  if (savePresetButton.disabled) return;
  const presetName = presetNameInput.value.trim() || "starfield-preset";
  const safeFileName = presetName
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/[. ]+$/g, "")
    .slice(0, 64) || "starfield-preset";
  presetNameInput.value = presetName;
  localStorage.setItem(PRESET_NAME_KEY, presetName);
  const payload = {
    schema: "space-venom-starfield-settings",
    version: 1,
    name: presetName,
    savedAt: new Date().toISOString(),
    starfield: starfield.getParameters()
  };

  savePresetButton.disabled = true;
  savePresetButton.textContent = "保存中";
  let savedLocally = false;
  try {
    const response = await fetch("/api/starfield-presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error("星空预设保存接口不可用");
    const result = await response.json();
    savedLocally = result.ok === true;
  } catch {
    downloadStarfieldPreset(payload, safeFileName);
  }

  if (savedLocally) {
    const existingPreset = starfieldPresets.find(preset => preset.id === safeFileName);
    if (existingPreset) {
      existingPreset.data = payload;
      const option = [...presetSelect.options].find(candidate => candidate.value === safeFileName);
      if (option) option.textContent = presetName;
    } else {
      starfieldPresets.push({ id: safeFileName, data: payload });
      presetSelect.append(new Option(presetName, safeFileName));
    }
    presetSelect.value = safeFileName;
    localStorage.setItem(PRESET_KEY, safeFileName);
  }

  savePresetButton.disabled = false;
  savePresetButton.textContent = savedLocally ? "已存入文件夹" : "已下载 JSON";
  clearTimeout(savePresetButton.resetLabelTimer);
  savePresetButton.resetLabelTimer = setTimeout(() => { savePresetButton.textContent = "保存"; }, 1600);
};

savePresetButton.addEventListener("click", saveStarfieldPreset);
presetNameInput.addEventListener("keydown", event => {
  if (event.key === "Enter") saveStarfieldPreset();
});

const panel = $("#star-panel");
const showButton = $("#show-star-controls");
const setPanelVisible = visible => {
  panel.classList.toggle("is-hidden", !visible);
  panel.setAttribute("aria-hidden", String(!visible));
  showButton.hidden = visible;
  localStorage.setItem("space-venom:star-panel", visible ? "visible" : "hidden");
};

$("#hide-star-controls").addEventListener("click", () => setPanelVisible(false));
showButton.addEventListener("click", () => setPanelVisible(true));
$("#reset-stars").addEventListener("click", () => {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(PRESET_KEY);
  location.reload();
});
window.addEventListener("magnetic:audio-metrics", event => {
  starfield.setAudioMetrics(event.detail);
  spectrogram.push(event.detail.spectrum);
});
window.addEventListener("beforeunload", () => {
  starfield.destroy();
  spectrogram.destroy();
});

setInterval(() => {
  const status = starfield.getStatus();
  const parameters = starfield.getParameters();
  const saturated = status.bass >= Number(parameters.bassInputMax) && status.bass > 0;
  const updateMeter = (selector, value, outputSelector, displayValue = value, meterMax = 1) => {
    const meter = $(selector);
    const track = meter.querySelector(".star-meter-track");
    const numericValue = Math.max(0, Number(value) || 0);
    const bounded = Math.min(1, numericValue / meterMax);
    meter.style.setProperty("--meter-value", bounded);
    track.setAttribute("aria-valuenow", Math.min(meterMax, numericValue).toFixed(3));
    $(outputSelector).value = typeof displayValue === "number" ? displayValue.toFixed(3) : displayValue;
  };
  const threshold = Math.min(1, Math.max(0, Number(parameters.bassInputMin) || 0));
  const saturation = Math.min(1, Math.max(0, Number(parameters.bassInputMax) || 0));
  const quiet = status.bass < threshold;
  const bassMeter = $("#star-bass-meter");
  bassMeter.style.setProperty("--threshold", threshold);
  bassMeter.style.setProperty("--saturation", saturation);
  $("#star-live-threshold").value = threshold.toFixed(3);
  $("#star-live-saturation").value = saturation.toFixed(3);
  updateMeter("#star-bass-meter", status.bass, "#star-live-bass", `${status.bass.toFixed(3)} → ${status.intensity.toFixed(3)}`);
  bassMeter.querySelector(".star-meter-track").setAttribute(
    "aria-valuetext",
    `低频 ${status.bass.toFixed(3)}，映射强度 ${status.intensity.toFixed(3)}，阈值 ${threshold.toFixed(3)}，饱和点 ${saturation.toFixed(3)}`
  );
  updateMeter("#star-brightness-meter", status.brightness, "#star-live-brightness", status.brightness, BRIGHTNESS_CONTROL_MAX);
  bassMeter.classList.toggle("is-saturated", saturated);
  $("#star-brightness-meter").classList.toggle("is-saturated", saturated);
  $("#star-meter-note").textContent = saturated
    ? `低频已达饱和点 ${saturation.toFixed(3)}；调高饱和值可恢复动态。`
    : quiet
      ? `低频低于阈值，使用巡航速度 ${Number(parameters.cruiseSpeed).toFixed(2)}、安静亮度 ${Number(parameters.quietBrightness).toFixed(2)} 和巡航星轨 ${Number(parameters.cruiseTrailLength).toFixed(2)}。`
      : `阈值 ${threshold.toFixed(3)} 至饱和点 ${saturation.toFixed(3)} 之间线性映射。`;
  $("#star-meter-note").classList.toggle("is-warning", saturated);
  $("#star-live-response").value = `${status.bass.toFixed(3)} / ${status.speed.toFixed(2)} / ${status.trailLength.toFixed(2)}`;
}, 120);

if (localStorage.getItem("space-venom:star-panel") === "hidden") setPanelVisible(false);

await import("./main.js");

// Keep Venom's global reset behavior intuitive on the combined page.
$("#reset-settings").addEventListener("click", () => {
  localStorage.removeItem(STORAGE_KEY);
}, { capture: true });

if (!Object.keys(saved).length) localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_STARFIELD_CONFIG));

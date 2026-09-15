export function calculateBassResponse(lowBass, upperBass) {
  // Keep the analysed feature in its natural 0..1 domain. Visual calibration
  // is performed later by explicit user-selected input and output bounds.
  return Math.min(1, Math.max(0, lowBass * 0.62 + upperBass * 0.38));
}

export function calculateMidResponse(midBand) {
  return Math.min(1, Math.max(0, midBand));
}

export function buildMicrophoneConstraints(supported = {}) {
  const audio = {};
  if (supported.echoCancellation) audio.echoCancellation = false;
  if (supported.noiseSuppression) audio.noiseSuppression = false;
  if (supported.autoGainControl) audio.autoGainControl = false;
  if (supported.channelCount) audio.channelCount = { ideal: 1 };
  return Object.keys(audio).length ? { audio } : { audio: true };
}

export class AudioInput {
  constructor(onMetrics, onState) {
    this.onMetrics = onMetrics;
    this.onState = onState;
    this.context = null;
    this.analyser = null;
    this.source = null;
    this.mediaElementSource = null;
    this.stream = null;
    this.url = null;
    this.frame = 0;
    this.data = null;
    this.waveform = null;
    this.readBand = (fromHz, toHz) => this.band(fromHz, toHz);
    this.smoothed = this.createEmptyMetrics();
    this.signalActive = false;
    this.activeState = null;
    this.params = {
      fftSize: 2048,
      bassFrom: 35,
      bassTo: 220,
      midFrom: 250,
      midTo: 2500,
      signalThreshold: 0.0025
    };
  }

  createEmptyMetrics() {
    return {
      bass: 0,
      mid: 0,
      level: 0,
      hasAudio: false,
      spectrum: new Array(16).fill(0),
      sampleBand: this.readBand
    };
  }

  async ensureContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("当前浏览器不支持 Web Audio API。");
    if (!this.context) this.context = new AudioContextClass({ latencyHint: "interactive" });
    if (this.context.state === "suspended") await this.context.resume();
    if (this.context.state !== "running") throw new Error(`音频引擎未启动（${this.context.state}）。请点击页面后重试。`);
  }

  async getUserMedia(constraints) {
    if (!globalThis.isSecureContext) {
      throw new Error("手机实时声音需要 HTTPS 安全连接；请通过 HTTPS 地址打开页面后重试。");
    }
    if (navigator.mediaDevices?.getUserMedia) return navigator.mediaDevices.getUserMedia(constraints);
    const legacyGetUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
    if (!legacyGetUserMedia) throw new Error("当前手机浏览器不支持实时麦克风输入，请使用最新版 Safari、Chrome 或 Edge。");
    return new Promise((resolve, reject) => legacyGetUserMedia.call(navigator, constraints, resolve, reject));
  }

  createAnalyser() {
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = this.params.fftSize;
    // SceneScript applies its own exact frame-time smoothing. Avoid a second browser smoothing pass.
    this.analyser.smoothingTimeConstant = 0;
    this.data = new Uint8Array(this.analyser.frequencyBinCount);
    this.waveform = new Uint8Array(this.analyser.fftSize);
    return this.analyser;
  }

  setParameter(key, value) {
    if (!(key in this.params)) return;
    const next = Number(value);
    if (!Number.isFinite(next)) return;
    this.params[key] = key === "fftSize" ? Math.min(32768, Math.max(32, 2 ** Math.round(Math.log2(next)))) : next;
    if (key === "fftSize" && this.analyser) {
      this.analyser.fftSize = this.params.fftSize;
      this.data = new Uint8Array(this.analyser.frequencyBinCount);
      this.waveform = new Uint8Array(this.analyser.fftSize);
    }
  }

  getParameters() { return { ...this.params }; }

  emitState(state) {
    this.activeState = state.active ? { ...state } : null;
    this.onState?.(state);
  }

  async useFile(file, audioElement) {
    await this.stop();
    await this.ensureContext();
    this.url = URL.createObjectURL(file);
    audioElement.src = this.url;
    audioElement.hidden = false;
    if (!this.mediaElementSource) this.mediaElementSource = this.context.createMediaElementSource(audioElement);
    this.source = this.mediaElementSource;
    const analyser = this.createAnalyser();
    this.source.connect(analyser);
    analyser.connect(this.context.destination);
    await audioElement.play();
    this.startAnalysis();
    this.emitState({ active: true, type: "file", name: file.name, detail: "已连接，正在检测音频信号…" });
  }

  async useMicrophone() {
    await this.stop();
    await this.ensureContext();
    const supported = navigator.mediaDevices?.getSupportedConstraints?.() || {};
    const constraints = buildMicrophoneConstraints(supported);
    try {
      this.stream = await this.getUserMedia(constraints);
    } catch (error) {
      if (error.name !== "TypeError" || constraints.audio === true) throw error;
      this.stream = await this.getUserMedia({ audio: true });
    }
    await this.ensureContext();
    const track = this.stream.getAudioTracks()[0];
    if (!track) {
      this.stream.getTracks().forEach(item => item.stop());
      this.stream = null;
      throw new Error("浏览器已授权，但没有返回可用的麦克风音轨。");
    }
    track.addEventListener("ended", () => this.stop());
    this.source = this.context.createMediaStreamSource(this.stream);
    this.source.connect(this.createAnalyser());
    this.startAnalysis();
    const label = track.label?.trim();
    this.emitState({ active: true, type: "mic", name: label || "实时麦克风", detail: "已连接，正在检测手机周围声音…" });
  }

  async useDesktop() {
    await this.stop();
    await this.ensureContext();
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error("当前浏览器不支持桌面音频共享；手机端请改用“实时声音”。");
    }
    this.stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    const tracks = this.stream.getAudioTracks();
    if (!tracks.length) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
      throw new Error("没有收到桌面音频。请在共享窗口中勾选“同时共享音频”。");
    }
    this.stream.getVideoTracks().forEach(track => { track.enabled = false; });
    tracks[0].addEventListener("ended", () => this.stop());
    this.source = this.context.createMediaStreamSource(this.stream);
    this.source.connect(this.createAnalyser());
    this.startAnalysis();
    this.emitState({ active: true, type: "desktop", name: "桌面音频", detail: "已连接，正在检测音频信号…" });
  }

  band(fromHz, toHz) {
    if (!this.context || !this.data) return 0;
    const nyquist = this.context.sampleRate / 2;
    const start = Math.max(0, Math.floor(fromHz / nyquist * this.data.length));
    const end = Math.min(this.data.length, Math.ceil(toHz / nyquist * this.data.length));
    let total = 0;
    for (let i = start; i < end; i++) total += this.data[i];
    return total / Math.max(1, end - start) / 255;
  }

  startAnalysis() {
    cancelAnimationFrame(this.frame);
    const tick = () => {
      if (!this.analyser) return;
      this.analyser.getByteFrequencyData(this.data);
      this.analyser.getByteTimeDomainData(this.waveform);
      const spectrum = [];
      const minHz = 20;
      const maxHz = Math.min(20000, this.context.sampleRate / 2);
      for (let index = 0; index < 16; index++) {
        const from = minHz * Math.pow(maxHz / minHz, index / 16);
        const to = minHz * Math.pow(maxHz / minHz, (index + 1) / 16);
        spectrum.push(this.band(from, to));
      }
      let squareSum = 0;
      for (let index = 0; index < this.waveform.length; index++) {
        const sample = (this.waveform[index] - 128) / 128;
        squareSum += sample * sample;
      }
      const level = Math.sqrt(squareSum / this.waveform.length);
      // Expose raw, bounded audio features. Their user-defined input ranges are
      // mapped linearly to visual output ranges by MagneticVisualizer.
      const split = this.params.bassFrom + (this.params.bassTo - this.params.bassFrom) * 0.34;
      const lowBass = this.band(this.params.bassFrom, split);
      const upperBass = this.band(split, this.params.bassTo);
      const bass = calculateBassResponse(lowBass, upperBass);
      const mid = calculateMidResponse(this.band(this.params.midFrom, this.params.midTo));
      this.smoothed.bass = bass;
      this.smoothed.mid = mid;
      this.smoothed.level = level;
      this.smoothed.hasAudio = level > this.params.signalThreshold || spectrum.some(value => value > this.params.signalThreshold * 4.8);
      this.smoothed.spectrum = spectrum;
      if (this.activeState && this.signalActive !== this.smoothed.hasAudio) {
        this.signalActive = this.smoothed.hasAudio;
        this.emitState({
          ...this.activeState,
          detail: this.signalActive ? "音频信号正常，画面正在响应" : "已连接，但暂未检测到声音"
        });
      }
      this.onMetrics(this.smoothed);
      this.frame = requestAnimationFrame(tick);
    };
    tick();
  }

  async stop() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (this.source) { try { this.source.disconnect(); } catch {} }
    if (this.stream) this.stream.getTracks().forEach(track => track.stop());
    if (this.url) URL.revokeObjectURL(this.url);
    this.source = null;
    this.stream = null;
    this.analyser = null;
    this.data = null;
    this.waveform = null;
    this.url = null;
    this.signalActive = false;
    this.activeState = null;
    this.smoothed = this.createEmptyMetrics();
    this.onMetrics(this.smoothed);
    this.onState?.({ active: false, type: null, name: "等待音频", detail: "选择一种输入方式" });
  }
}

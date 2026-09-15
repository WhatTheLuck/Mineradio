const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const SPECTRUM_MIN_HZ = 20;
export const SPECTRUM_MAX_HZ = 20000;

export const frequencyToPosition = (frequency, minHz = SPECTRUM_MIN_HZ, maxHz = SPECTRUM_MAX_HZ) => {
  const safeFrequency = clamp(Number(frequency) || minHz, minHz, maxHz);
  return Math.log(safeFrequency / minHz) / Math.log(maxHz / minHz);
};

export const interpolateSpectrum = (spectrum, position) => {
  if (!Array.isArray(spectrum) || spectrum.length === 0) return 0;
  const scaled = clamp(position, 0, 1) * (spectrum.length - 1);
  const lower = Math.floor(scaled);
  const upper = Math.min(spectrum.length - 1, lower + 1);
  const mix = scaled - lower;
  return clamp(Number(spectrum[lower]) * (1 - mix) + Number(spectrum[upper]) * mix || 0, 0, 1);
};

const energyColor = energy => {
  const value = Math.pow(clamp(energy, 0, 1), 0.68);
  const red = Math.round(5 + value * value * 126);
  const green = Math.round(10 + value * 201);
  const blue = Math.round(18 + value * 237);
  return `rgb(${red}, ${green}, ${blue})`;
};

const formatFrequency = value => value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : `${Math.round(value)}`;

export class RealtimeSpectrogram {
  constructor(historyCanvas, overlayCanvas, rangeOutput) {
    this.historyCanvas = historyCanvas;
    this.overlayCanvas = overlayCanvas;
    this.rangeOutput = rangeOutput;
    this.history = historyCanvas.getContext("2d", { alpha: false });
    this.overlay = overlayCanvas.getContext("2d");
    this.fromHz = 35;
    this.toHz = 220;
    this.activeBoundary = null;
    this.lastFrame = 0;
    this.resizeObserver = new ResizeObserver(() => this.drawOverlay());
    this.resizeObserver.observe(overlayCanvas);
    this.clear();
  }

  clear() {
    this.history.fillStyle = "#071019";
    this.history.fillRect(0, 0, this.historyCanvas.width, this.historyCanvas.height);
    this.drawOverlay();
  }

  push(spectrum, time = performance.now()) {
    if (!Array.isArray(spectrum) || time - this.lastFrame < 40) return;
    this.lastFrame = time;
    const { width, height } = this.historyCanvas;
    this.history.drawImage(this.historyCanvas, 0, 1, width, height - 1, 0, 0, width, height - 1);
    for (let x = 0; x < width; x++) {
      this.history.fillStyle = energyColor(interpolateSpectrum(spectrum, x / Math.max(1, width - 1)));
      this.history.fillRect(x, height - 1, 1, 1);
    }
  }

  setRange(fromHz, toHz, activeBoundary = this.activeBoundary) {
    this.fromHz = Math.min(Number(fromHz), Number(toHz));
    this.toHz = Math.max(Number(fromHz), Number(toHz));
    this.activeBoundary = activeBoundary;
    this.rangeOutput.textContent = `${formatFrequency(this.fromHz)}-${formatFrequency(this.toHz)} Hz`;
    this.drawOverlay();
  }

  drawOverlay() {
    const { width, height } = this.overlayCanvas;
    const fromX = frequencyToPosition(this.fromHz) * width;
    const toX = frequencyToPosition(this.toHz) * width;
    this.overlay.clearRect(0, 0, width, height);
    this.overlay.fillStyle = "rgba(139, 217, 255, .10)";
    this.overlay.fillRect(fromX, 0, Math.max(1, toX - fromX), height);
    for (const [boundary, x, value] of [["lower", fromX, this.fromHz], ["upper", toX, this.toHz]]) {
      const active = boundary === this.activeBoundary;
      this.overlay.strokeStyle = active ? "#f2fbff" : "rgba(139, 217, 255, .9)";
      this.overlay.lineWidth = active ? 3 : 1.5;
      this.overlay.beginPath();
      this.overlay.moveTo(x, 0);
      this.overlay.lineTo(x, height);
      this.overlay.stroke();
      if (active) {
        const label = `${formatFrequency(value)} Hz`;
        this.overlay.font = '600 18px "Cascadia Mono", monospace';
        const labelWidth = this.overlay.measureText(label).width + 12;
        const labelX = clamp(x - labelWidth / 2, 2, width - labelWidth - 2);
        this.overlay.fillStyle = "rgba(5, 10, 16, .88)";
        this.overlay.fillRect(labelX, 4, labelWidth, 28);
        this.overlay.fillStyle = "#f2fbff";
        this.overlay.fillText(label, labelX + 6, 24);
      }
    }
  }

  destroy() {
    this.resizeObserver.disconnect();
  }
}

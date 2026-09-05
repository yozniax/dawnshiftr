import { playableUrl } from "./radio.js";

export class AudioEngine {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = "auto";
    this.audio.playsInline = true;
    if (typeof location === "undefined" || location.protocol === "chrome-extension:") {
      this.audio.crossOrigin = "anonymous";
    }
    this.ctx = null;
    this.source = null;
    this.gainNode = null;
    this.analyser = null;
    this._freq = null;
    this._wave = null;
    this.listeners = new Map();
    this.currentUrl = null;
    this._graphPromise = null;
    this._ignore = false;
    this.bindAudioEvents();
  }

  on(event, fn) {
    const list = this.listeners.get(event) || [];
    list.push(fn);
    this.listeners.set(event, list);
    return () => {
      this.listeners.set(
        event,
        (this.listeners.get(event) || []).filter((x) => x !== fn)
      );
    };
  }

  emit(event, payload) {
    for (const fn of this.listeners.get(event) || []) fn(payload);
  }

  bindAudioEvents() {
    const a = this.audio;
    a.addEventListener("playing", () => {
      this._ignore = false;
      this.emit("status", "playing");
    });
    a.addEventListener("pause", () => {
      if (this._ignore) return;
      if (!a.ended) this.emit("status", "paused");
    });
    a.addEventListener("waiting", () => {
      if (this._ignore) return;
      this.emit("status", "buffering");
    });
    a.addEventListener("stalled", () => {
      if (this._ignore) return;
      this.emit("status", "buffering");
    });
    a.addEventListener("ended", () => {
      if (this._ignore) return;
      this.emit("ended");
    });
    a.addEventListener("error", () => {
      const code = a.error?.code;
      if (code === 1) return;
      this._ignore = false;
      this.emit("error", code === 4 ? "format / network" : "playback failed");
    });
    a.addEventListener("timeupdate", () => {
      this.emit("time", {
        live: !Number.isFinite(a.duration) || a.duration === Infinity,
      });
    });
  }

  async ensureGraph() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") await this.ctx.resume();
      return;
    }
    if (this._graphPromise) {
      await this._graphPromise;
      if (this.ctx?.state === "suspended") await this.ctx.resume();
      return;
    }
    this._graphPromise = this._buildGraph();
    try {
      await this._graphPromise;
    } catch (err) {
      this._graphPromise = null;
      throw err;
    }
  }

  async _buildGraph() {
    this.ctx = new AudioContext();
    this.source = this.ctx.createMediaElementSource(this.audio);
    this.gainNode = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.minDecibels = -90;
    this.analyser.maxDecibels = -18;
    this.analyser.smoothingTimeConstant = 0.18;
    this._freq = new Uint8Array(this.analyser.frequencyBinCount);
    this._wave = new Uint8Array(this.analyser.fftSize);
    this.source.connect(this.analyser);
    this.analyser.connect(this.gainNode);
    this.gainNode.connect(this.ctx.destination);
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  getSpectrum(bars = 7) {
    const out = new Array(bars).fill(0);
    if (this.ctx?.state === "suspended") void this.ctx.resume();
    if (!this.analyser || !this._freq) return out;
    this.analyser.getByteFrequencyData(this._freq);
    const n = this._freq.length;
    const virtual = bars + 1;
    let freqPeak = 0;
    for (let i = 0; i < bars; i++) {
      const vi = i + 1;
      const lo = Math.max(1, Math.floor((vi / virtual) * n * 0.72));
      const hi = Math.max(lo + 2, Math.floor(((vi + 1) / virtual) * n * 0.72));
      let peak = 0;
      for (let j = lo; j < hi && j < n; j++) {
        if (this._freq[j] > peak) peak = this._freq[j];
      }
      out[i] = peak / 255;
      if (out[i] > freqPeak) freqPeak = out[i];
    }
    if (freqPeak >= 0.02) {
      const gain = freqPeak < 0.7 ? Math.min(12, 1.05 / freqPeak) : 1.35;
      for (let i = 0; i < bars; i++) out[i] = Math.min(1, out[i] * gain);
      return out;
    }
    this.analyser.getByteTimeDomainData(this._wave);
    let rms = 0;
    for (let i = 0; i < this._wave.length; i++) {
      const v = (this._wave[i] - 128) / 128;
      rms += v * v;
    }
    rms = Math.sqrt(rms / this._wave.length);
    if (rms < 0.01) return out;
    const now = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 180;
    for (let i = 0; i < bars; i++) {
      const wobble = 0.45 + 0.55 * Math.abs(Math.sin(now + i * 0.85));
      out[i] = Math.min(1, rms * 4.5 * wobble);
    }
    return out;
  }

  setGain(linear) {
    const v = Math.max(0, Math.min(1, linear));
    this.audio.volume = 1;
    if (this.gainNode) this.gainNode.gain.value = v;
    else this.audio.volume = v;
  }

  async load(url) {
    await this.ensureGraph();
    this._ignore = true;
    this.currentUrl = url;
    try {
      this.audio.pause();
    } catch {
      /* empty */
    }
    this.audio.src = playableUrl(url);
    this.audio.load();
    this.emit("status", "buffering");
  }

  async play() {
    await this.ensureGraph();
    if (this.ctx?.state === "suspended") await this.ctx.resume();
    try {
      await this.audio.play();
    } catch (err) {
      throw err;
    }
  }

  pause() {
    this.audio.pause();
  }

  stop() {
    this.audio.pause();
    try {
      this.audio.currentTime = 0;
    } catch {
      /* live */
    }
    this.emit("status", "stopped");
  }
}

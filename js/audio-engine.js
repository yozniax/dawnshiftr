import { playableUrl } from "./radio.js";

export class AudioEngine {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = "auto";
    this.audio.crossOrigin = "anonymous";
    this.ctx = null;
    this.source = null;
    this.gainNode = null;
    this.analyser = null;
    this._freq = null;
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
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.45;
    this._freq = new Uint8Array(this.analyser.frequencyBinCount);
    this.source.connect(this.gainNode);
    this.gainNode.connect(this.ctx.destination);
    this.gainNode.connect(this.analyser);
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  getSpectrum(bars = 9) {
    const out = new Array(bars).fill(0);
    if (!this.analyser || !this._freq) return out;
    if (this._freq.length !== this.analyser.frequencyBinCount) {
      this._freq = new Uint8Array(this.analyser.frequencyBinCount);
    }
    this.analyser.getByteFrequencyData(this._freq);
    const n = this._freq.length;
    const usable = Math.max(bars * 2, Math.floor(n * 0.58));
    for (let i = 0; i < bars; i++) {
      const t0 = i / bars;
      const t1 = (i + 1) / bars;
      const lo = Math.floor(t0 ** 1.25 * usable);
      const hi = Math.max(lo + 3, Math.floor(t1 ** 1.25 * usable));
      let peak = 0;
      for (let j = lo; j < hi && j < n; j++) {
        if (this._freq[j] > peak) peak = this._freq[j];
      }
      out[i] = peak / 255;
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
    this.audio.crossOrigin = "anonymous";
    this.audio.src = playableUrl(url);
    this.audio.load();
    this.emit("status", "buffering");
  }

  async play() {
    await this.ensureGraph();
    try {
      await this.audio.play();
    } catch (err) {
      if (this.audio.crossOrigin && this.currentUrl) {
        this.audio.crossOrigin = null;
        const t = this.audio.currentTime;
        this.audio.load();
        this.audio.currentTime = t;
        await this.audio.play();
        this.emit("status", "playing");
        return;
      }
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

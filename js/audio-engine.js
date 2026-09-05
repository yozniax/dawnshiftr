import { EQ_BANDS } from "./eq.js";
import { playableUrl } from "./radio.js";

export class AudioEngine {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = "auto";
    this.audio.crossOrigin = "anonymous";
    this.ctx = null;
    this.source = null;
    this.filters = [];
    this.gainNode = null;
    this.analyser = null;
    this.freqData = null;
    this.timeData = null;
    this.corsFailed = false;
    this.listeners = new Map();
    this.currentUrl = null;
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
    a.addEventListener("playing", () => this.emit("status", "playing"));
    a.addEventListener("pause", () => {
      if (!a.ended) this.emit("status", "paused");
    });
    a.addEventListener("waiting", () => this.emit("status", "buffering"));
    a.addEventListener("stalled", () => this.emit("status", "buffering"));
    a.addEventListener("ended", () => this.emit("ended"));
    a.addEventListener("error", () => {
      const code = a.error?.code;
      this.emit("error", code === 4 ? "format / network" : "playback failed");
    });
    a.addEventListener("timeupdate", () => {
      this.emit("time", {
        currentTime: a.currentTime || 0,
        duration: Number.isFinite(a.duration) ? a.duration : 0,
        live: !Number.isFinite(a.duration) || a.duration === Infinity,
      });
    });
  }

  async ensureGraph() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") await this.ctx.resume();
      return;
    }
    this.ctx = new AudioContext();
    this.source = this.ctx.createMediaElementSource(this.audio);
    let node = this.source;
    this.filters = EQ_BANDS.map((freq) => {
      const f = this.ctx.createBiquadFilter();
      f.type = "peaking";
      f.frequency.value = freq;
      f.Q.value = 1.1;
      f.gain.value = 0;
      node.connect(f);
      node = f;
      return f;
    });
    this.gainNode = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.72;
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    this.timeData = new Uint8Array(this.analyser.fftSize);
    node.connect(this.gainNode);
    this.gainNode.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  setEq(gains) {
    if (!this.filters.length) return;
    gains.forEach((db, i) => {
      if (this.filters[i]) this.filters[i].gain.value = db;
    });
  }

  setVolumeDb(db, fade = 1) {
    const linear = (db <= -30 ? 0 : Math.pow(10, db / 20)) * Math.max(0, Math.min(1, fade));
    this.audio.volume = 1;
    if (this.gainNode) this.gainNode.gain.value = linear;
    else this.audio.volume = Math.min(1, linear);
  }

  setSpeed(rate) {
    this.audio.playbackRate = Math.max(0.25, Math.min(2, rate));
  }

  async load(url, { cors = true } = {}) {
    await this.ensureGraph();
    this.currentUrl = url;
    this.corsFailed = false;
    this.audio.crossOrigin = cors ? "anonymous" : null;
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
        this.corsFailed = true;
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
      /* live streams */
    }
    this.emit("status", "stopped");
  }

  seek(seconds) {
    if (!Number.isFinite(this.audio.duration)) return;
    this.audio.currentTime = Math.max(0, Math.min(this.audio.duration, seconds));
  }

  getAnalyser() {
    if (!this.analyser || this.corsFailed) return null;
    this.analyser.getByteFrequencyData(this.freqData);
    this.analyser.getByteTimeDomainData(this.timeData);
    return { freq: this.freqData, time: this.timeData };
  }

  snapshot() {
    return {
      currentTime: this.audio.currentTime || 0,
      duration: Number.isFinite(this.audio.duration) ? this.audio.duration : 0,
      live: !Number.isFinite(this.audio.duration) || this.audio.duration === Infinity,
      paused: this.audio.paused,
    };
  }
}

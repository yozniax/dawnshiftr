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

  async playGong() {
    await this.ensureGraph();
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.55, now + 0.018);
    master.gain.exponentialRampToValueAtTime(0.22, now + 0.35);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 4.8);
    master.connect(ctx.destination);

    const strike = ctx.createBufferSource();
    const noiseLen = Math.floor(ctx.sampleRate * 0.12);
    const noise = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / noiseLen, 3);
    }
    strike.buffer = noise;
    const strikeFilter = ctx.createBiquadFilter();
    strikeFilter.type = "bandpass";
    strikeFilter.frequency.setValueAtTime(1800, now);
    strikeFilter.frequency.exponentialRampToValueAtTime(420, now + 0.2);
    strikeFilter.Q.value = 0.7;
    const strikeGain = ctx.createGain();
    strikeGain.gain.setValueAtTime(0.9, now);
    strikeGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    strike.connect(strikeFilter);
    strikeFilter.connect(strikeGain);
    strikeGain.connect(master);
    strike.start(now);
    strike.stop(now + 0.3);

    const partials = [
      { f: 92, g: 0.55, d: 4.6 },
      { f: 138, g: 0.28, d: 3.8 },
      { f: 184, g: 0.22, d: 3.4 },
      { f: 247, g: 0.16, d: 2.8 },
      { f: 311, g: 0.12, d: 2.4 },
      { f: 412, g: 0.08, d: 1.9 },
      { f: 523, g: 0.05, d: 1.5 },
      { f: 740, g: 0.035, d: 1.1 },
    ];
    for (const p of partials) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(p.f * 1.035, now);
      osc.frequency.exponentialRampToValueAtTime(p.f, now + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(p.g, now + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, now + p.d);
      osc.connect(g);
      g.connect(master);
      osc.start(now);
      osc.stop(now + p.d + 0.05);
    }
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

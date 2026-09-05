import { EQ_BANDS } from "./eq.js";
import { isWebPreview, playableUrl } from "./radio.js";

export class AudioEngine {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = "none";
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
    this.wantPlaying = false;
    this.reconnecting = false;
    this.reconnectTimer = 0;
    this.stalls = 0;
    this.didPlay = false;
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

  isLive() {
    const d = this.audio.duration;
    return !Number.isFinite(d) || d === Infinity || d === 0;
  }

  bindAudioEvents() {
    const a = this.audio;
    a.addEventListener("playing", () => {
      this.stalls = 0;
      this.reconnecting = false;
      this.didPlay = true;
      clearTimeout(this.reconnectTimer);
      this.emit("status", "playing");
    });
    a.addEventListener("pause", () => {
      if (!a.ended && this.wantPlaying === false) this.emit("status", "paused");
    });
    a.addEventListener("waiting", () => {
      if (this.wantPlaying) this.emit("status", "buffering");
      if (this.didPlay) this.scheduleReconnect();
    });
    a.addEventListener("stalled", () => {
      if (this.didPlay) this.scheduleReconnect();
    });
    a.addEventListener("ended", () => {
      if (this.wantPlaying && this.isLive()) {
        this.reconnect();
        return;
      }
      this.wantPlaying = false;
      this.emit("ended");
    });
    a.addEventListener("error", () => {
      if (this.wantPlaying && this.isLive() && this.stalls < 8) {
        this.reconnect();
        return;
      }
      const code = a.error?.code;
      this.emit("error", code === 4 ? "format / network" : "playback failed");
    });
    a.addEventListener("timeupdate", () => {
      this.emit("time", {
        currentTime: a.currentTime || 0,
        duration: Number.isFinite(a.duration) ? a.duration : 0,
        live: this.isLive(),
      });
    });
  }

  scheduleReconnect() {
    if (!this.wantPlaying || this.reconnecting || !this.isLive()) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.reconnect(), 1800);
  }

  async reconnect() {
    if (!this.wantPlaying || !this.currentUrl || this.reconnecting) return;
    this.reconnecting = true;
    this.stalls += 1;
    clearTimeout(this.reconnectTimer);
    this.emit("status", "buffering");
    try {
      const url = playableUrl(this.currentUrl);
      this.audio.removeAttribute("src");
      this.audio.src = url;
      this.audio.load();
      await this.audio.play();
    } catch {
      this.reconnecting = false;
      if (this.wantPlaying && this.stalls < 8) {
        this.reconnectTimer = setTimeout(() => this.reconnect(), 1500 * this.stalls);
      }
    }
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

  setVolumeDb(db) {
    const linear = db <= -30 ? 0 : Math.pow(10, db / 20);
    this.audio.volume = 1;
    if (this.gainNode) this.gainNode.gain.value = linear;
    else this.audio.volume = Math.min(1, linear);
  }

  setSpeed(rate) {
    this.audio.playbackRate = Math.max(0.25, Math.min(2, rate));
  }

  async load(url, { cors } = {}) {
    await this.ensureGraph();
    this.currentUrl = url;
    this.stalls = 0;
    this.didPlay = false;
    this.reconnecting = false;
    clearTimeout(this.reconnectTimer);
    const useCors = cors ?? !isWebPreview();
    this.corsFailed = !useCors;
    if (useCors) this.audio.crossOrigin = "anonymous";
    else this.audio.removeAttribute("crossorigin");
    this.audio.src = playableUrl(url);
    this.audio.load();
    this.emit("status", "buffering");
  }

  async play() {
    await this.ensureGraph();
    this.wantPlaying = true;
    try {
      await this.audio.play();
    } catch (err) {
      if (this.audio.crossOrigin && this.currentUrl) {
        this.corsFailed = true;
        this.audio.removeAttribute("crossorigin");
        this.audio.src = playableUrl(this.currentUrl);
        this.audio.load();
        await this.audio.play();
        this.emit("status", "playing");
        return;
      }
      this.wantPlaying = false;
      throw err;
    }
  }

  pause() {
    this.wantPlaying = false;
    clearTimeout(this.reconnectTimer);
    this.audio.pause();
  }

  stop() {
    this.wantPlaying = false;
    clearTimeout(this.reconnectTimer);
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
      live: this.isLive(),
      paused: this.audio.paused,
    };
  }
}

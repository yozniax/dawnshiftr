import { playableUrl } from "./radio.js";

export class AudioEngine {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = "auto";
    this.audio.crossOrigin = "anonymous";
    this.ctx = null;
    this.source = null;
    this.gainNode = null;
    this.corsFailed = false;
    this.listeners = new Map();
    this.currentUrl = null;
    this._cueBuffer = null;
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
    this.source.connect(this.gainNode);
    this.gainNode.connect(this.ctx.destination);
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  setGain(linear) {
    const v = Math.max(0, Math.min(1, linear));
    this.audio.volume = 1;
    if (this.gainNode) this.gainNode.gain.value = v;
    else this.audio.volume = v;
  }

  async load(url, { cors = true } = {}) {
    await this.ensureGraph();
    this._ignore = true;
    this.currentUrl = url;
    this.corsFailed = false;
    try {
      this.audio.pause();
    } catch {
      /* empty */
    }
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
      /* live */
    }
    this.emit("status", "stopped");
  }

  async playCue() {
    await this.ensureGraph();
    if (!this._cueBuffer) {
      const url = new URL("../assets/time-is-up.mp3", import.meta.url).href;
      const res = await fetch(url);
      if (!res.ok) throw new Error("sleep cue missing");
      this._cueBuffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this._cueBuffer;
    const gain = this.ctx.createGain();
    gain.gain.value = 1;
    src.connect(gain);
    gain.connect(this.ctx.destination);
    src.start();
  }
}

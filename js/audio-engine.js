import { playableUrl } from "./radio.js";

export const NOISE_FILTERS = {
  low: { type: "lowpass", frequency: 220, Q: 0.7, gain: 1.7 },
  mid: { type: "bandpass", frequency: 1100, Q: 0.65, gain: 2.1 },
  high: { type: "highpass", frequency: 5200, Q: 0.75, gain: 1.15 },
};

function makeWhiteNoise(ctx, seconds = 2) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

export class AudioEngine {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = "auto";
    this.audio.crossOrigin = "anonymous";
    this.ctx = null;
    this.source = null;
    this.inputGain = null;
    this.toneNodes = [];
    this.gainNode = null;
    this.analyser = null;
    this.freqData = null;
    this.timeData = null;
    this.corsFailed = false;
    this.listeners = new Map();
    this.currentUrl = null;
    this._noiseKind = null;
    this._noiseSrc = null;
    this._noiseFilter = null;
    this._noiseGain = null;
    this._noiseTick = 0;
    this._noiseBuffer = null;
    this._cueBuffer = null;
    this._graphPromise = null;
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
      if (!this._noiseKind) this.emit("status", "playing");
    });
    a.addEventListener("pause", () => {
      if (!a.ended && !this._noiseKind) this.emit("status", "paused");
    });
    a.addEventListener("waiting", () => {
      if (!this._noiseKind) this.emit("status", "buffering");
    });
    a.addEventListener("stalled", () => {
      if (!this._noiseKind) this.emit("status", "buffering");
    });
    a.addEventListener("ended", () => this.emit("ended"));
    a.addEventListener("error", () => {
      if (this._noiseKind) return;
      const code = a.error?.code;
      this.emit("error", code === 4 ? "format / network" : "playback failed");
    });
    a.addEventListener("timeupdate", () => {
      if (this._noiseKind) return;
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
    this.inputGain = this.ctx.createGain();
    this.source.connect(this.inputGain);

    const bass = this.ctx.createBiquadFilter();
    bass.type = "lowshelf";
    bass.frequency.value = 120;
    const mid = this.ctx.createBiquadFilter();
    mid.type = "peaking";
    mid.frequency.value = 1000;
    mid.Q.value = 0.9;
    const treble = this.ctx.createBiquadFilter();
    treble.type = "highshelf";
    treble.frequency.value = 6500;
    this.toneNodes = [bass, mid, treble];

    this.inputGain.connect(bass);
    bass.connect(mid);
    mid.connect(treble);

    this.gainNode = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.78;
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    this.timeData = new Uint8Array(this.analyser.fftSize);
    treble.connect(this.gainNode);
    this.gainNode.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  setTone({ bass = 0, mid = 0, treble = 0 } = {}) {
    if (this.toneNodes.length < 3) return;
    this.toneNodes[0].gain.value = bass;
    this.toneNodes[1].gain.value = mid;
    this.toneNodes[2].gain.value = treble;
  }

  setGain(linear) {
    const v = Math.max(0, Math.min(1, linear));
    this.audio.volume = 1;
    if (this.gainNode) this.gainNode.gain.value = v;
    else this.audio.volume = v;
  }

  async load(url, { cors = true } = {}) {
    await this.ensureGraph();
    this.stopNoise({ keepKind: false });
    this.currentUrl = url;
    this.corsFailed = false;
    this.audio.crossOrigin = cors ? "anonymous" : null;
    this.audio.src = playableUrl(url);
    this.audio.load();
    this.emit("status", "buffering");
  }

  async play() {
    await this.ensureGraph();
    if (this._noiseKind) {
      await this.playNoise(this._noiseKind);
      return;
    }
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
    if (this._noiseKind) {
      this.stopNoise({ keepKind: true });
      this.emit("status", "paused");
    }
  }

  stop() {
    this.stopNoise({ keepKind: false });
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

  stopNoise({ keepKind = false } = {}) {
    if (this._noiseTick) {
      clearInterval(this._noiseTick);
      this._noiseTick = 0;
    }
    if (this._noiseSrc) {
      try {
        this._noiseSrc.stop();
      } catch {
        /* already stopped */
      }
      try {
        this._noiseSrc.disconnect();
      } catch {
        /* disconnected */
      }
      this._noiseSrc = null;
    }
    if (this._noiseFilter) {
      try {
        this._noiseFilter.disconnect();
      } catch {
        /* disconnected */
      }
      this._noiseFilter = null;
    }
    if (this._noiseGain) {
      try {
        this._noiseGain.disconnect();
      } catch {
        /* disconnected */
      }
      this._noiseGain = null;
    }
    if (!keepKind) this._noiseKind = null;
  }

  async playNoise(kind) {
    const spec = NOISE_FILTERS[kind];
    if (!spec) return;
    await this.ensureGraph();
    this.audio.pause();
    this.stopNoise({ keepKind: false });
    this._noiseKind = kind;
    if (!this._noiseBuffer) this._noiseBuffer = makeWhiteNoise(this.ctx);
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = spec.type;
    filter.frequency.value = spec.frequency;
    filter.Q.value = spec.Q;
    const gain = this.ctx.createGain();
    gain.gain.value = spec.gain;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.inputGain);
    src.start();
    this._noiseSrc = src;
    this._noiseFilter = filter;
    this._noiseGain = gain;
    const started = Date.now();
    this.emit("status", "playing");
    this.emit("time", { currentTime: 0, duration: 0, live: true });
    this._noiseTick = setInterval(() => {
      this.emit("time", {
        currentTime: (Date.now() - started) / 1000,
        duration: 0,
        live: true,
      });
    }, 400);
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

  getAnalyser() {
    if (!this.analyser || this.corsFailed) return null;
    this.analyser.getByteFrequencyData(this.freqData);
    this.analyser.getByteTimeDomainData(this.timeData);
    return { freq: this.freqData, time: this.timeData };
  }
}

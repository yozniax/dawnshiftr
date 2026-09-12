import { playableUrl } from "./radio.js";
import { JcbaSession, isJcbaUrl, jcbaStationId } from "./jcba.js";

const MEDIA_SESSION_ACTIONS = [
  "play",
  "pause",
  "stop",
  "seekbackward",
  "seekforward",
  "seekto",
  "previoustrack",
  "nexttrack",
  "skipad",
];

/** Mix with YouTube / other tabs instead of taking exclusive playback. */
export function applyAmbientAudioSession(nav = globalThis.navigator) {
  if (!nav) return false;
  let applied = false;
  try {
    if (nav.audioSession) {
      nav.audioSession.type = "ambient";
      applied = true;
    }
  } catch {
    /* unsupported */
  }
  try {
    const session = nav.mediaSession;
    if (session) {
      session.metadata = null;
      session.playbackState = "none";
      for (const action of MEDIA_SESSION_ACTIONS) {
        try {
          session.setActionHandler(action, null);
        } catch {
          /* unknown action */
        }
      }
      applied = true;
    }
  } catch {
    /* unsupported */
  }
  return applied;
}

/** Map analyser bins onto 7 log-spaced bands (bass → treble). */
export function freqBytesToBands(freq, bars = 7, sampleRate = 44100) {
  const n = freq?.length || 0;
  const out = new Array(bars).fill(0);
  if (!n) return out;
  const nyquist = sampleRate / 2;
  const minHz = 50;
  const maxHz = Math.min(16000, nyquist * 0.92);
  const logMin = Math.log(minHz);
  const logSpan = Math.log(maxHz) - logMin;
  for (let i = 0; i < bars; i++) {
    const loHz = Math.exp(logMin + (i / bars) * logSpan);
    const hiHz = Math.exp(logMin + ((i + 1) / bars) * logSpan);
    const lo = Math.max(0, Math.floor((loHz / nyquist) * n));
    const hi = Math.min(n, Math.max(lo + 1, Math.ceil((hiHz / nyquist) * n)));
    let peak = 0;
    let sum = 0;
    for (let j = lo; j < hi; j++) {
      const v = freq[j] || 0;
      sum += v;
      if (v > peak) peak = v;
    }
    const avg = sum / (hi - lo);
    out[i] = Math.min(1, (peak * 0.72 + avg * 0.28) / 255);
  }
  return out;
}

export class AudioEngine {
  constructor() {
    applyAmbientAudioSession();
    this.audio = new Audio();
    this.audio.preload = "auto";
    this.audio.playsInline = true;
    this.audio.disableRemotePlayback = true;
    if (typeof location === "undefined" || location.protocol === "chrome-extension:") {
      this.audio.crossOrigin = "anonymous";
    }
    this.ctx = null;
    this.source = null;
    this.gainNode = null;
    this.analyser = null;
    this._freq = null;
    this.listeners = new Map();
    this.currentUrl = null;
    this._graphPromise = null;
    this._ignore = false;
    this._jcba = null;
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
    applyAmbientAudioSession();
    this.ctx = new AudioContext();
    this.source = this.ctx.createMediaElementSource(this.audio);
    this.gainNode = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.minDecibels = -85;
    this.analyser.maxDecibels = -18;
    this.analyser.smoothingTimeConstant = 0.45;
    this._freq = new Uint8Array(this.analyser.frequencyBinCount);
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
    return freqBytesToBands(this._freq, bars, this.ctx.sampleRate || 44100);
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
    this.stopJcba();
    if (isJcbaUrl(url)) {
      try {
        this.audio.pause();
      } catch {
        /* empty */
      }
      this.audio.removeAttribute("src");
      this.emit("status", "buffering");
      try {
        await this.startJcba(url);
      } catch (err) {
        this._ignore = false;
        this.emit("error", err.message || "jcba failed");
      }
      return;
    }
    try {
      this.audio.pause();
    } catch {
      /* empty */
    }
    if (typeof location !== "undefined" && location.protocol === "chrome-extension:") {
      this.audio.crossOrigin = "anonymous";
    }
    this.audio.src = playableUrl(url);
    this.audio.load();
    this.emit("status", "buffering");
  }

  async startJcba(url) {
    const stationId = jcbaStationId(url);
    const session = new JcbaSession(this.ctx, this.analyser);
    this._jcba = session;
    let announced = false;
    session.onPlaying = () => {
      if (announced || this._jcba !== session) return;
      announced = true;
      this._ignore = false;
      this.emit("status", "playing");
    };
    session.onError = (msg) => {
      if (this._jcba !== session) return;
      this._ignore = false;
      this.emit("error", msg || "jcba failed");
    };
    await session.start(stationId);
  }

  stopJcba() {
    this._jcba?.stop();
    this._jcba = null;
  }

  async play() {
    applyAmbientAudioSession();
    await this.ensureGraph();
    if (this.ctx?.state === "suspended") await this.ctx.resume();
    if (isJcbaUrl(this.currentUrl)) {
      if (!this._jcba) await this.startJcba(this.currentUrl);
      return;
    }
    try {
      await this.audio.play();
    } catch (err) {
      throw err;
    }
    applyAmbientAudioSession();
  }

  pause() {
    if (this._jcba) {
      this.stopJcba();
      this.emit("status", "paused");
      return;
    }
    this.audio.pause();
  }

  stop() {
    this.stopJcba();
    this.audio.pause();
    try {
      this.audio.currentTime = 0;
    } catch {
      /* live */
    }
    this.emit("status", "stopped");
  }
}

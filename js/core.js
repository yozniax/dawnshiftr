import { AudioEngine } from "./audio-engine.js";
import { clampTone, TONE_DEFAULT } from "./eq.js";
import { featuredTracks, resolveClick, unwrapStreamUrl } from "./radio.js";
import { THEME_NAMES } from "./themes.js";
import { loadPersisted, savePersisted } from "./storage.js";

export const SLEEP_PRESETS = [60, 55, 30, 25, 10, 5, 3, 1];
export const FADE_MS = 15_000;
export const NOISE_PRESETS = [
  { id: "low", label: "低域", title: "ホワイトノイズ · 低域" },
  { id: "mid", label: "中域", title: "ホワイトノイズ · 中域" },
  { id: "high", label: "高域", title: "ホワイトノイズ · 高域" },
];

export function trackKey(t) {
  return t?.id || t?.url || "";
}

function seededNotes(playlist) {
  const seeds = [
    [0, "夜作業向け。テンポが安定して、ボーカルが少ない"],
    [3, "寝る前。空間が広く、変化が少ない"],
    [6, "集中用のドローン。声はほぼ入らない"],
  ];
  const notes = {};
  for (const [i, text] of seeds) {
    const t = playlist[i];
    if (!t) continue;
    notes[trackKey(t)] = {
      text,
      title: t.title,
      url: t.url,
      id: t.id,
      kind: t.kind || "radio",
      updatedAt: 1,
    };
  }
  return notes;
}

export function defaultState() {
  const playlist = featuredTracks();
  return {
    playlist,
    index: 0,
    cursor: 0,
    playing: false,
    status: "stopped",
    currentTime: 0,
    duration: 0,
    live: true,
    volume: 80,
    tone: { ...TONE_DEFAULT },
    theme: "lamp",
    favorites: [],
    notes: seededNotes(playlist),
    error: "",
    nowPlaying: "",
    sleepMinutes: null,
    sleepEndsAt: null,
    sleepRemainingMs: 0,
    noiseId: null,
  };
}

export function isExtension() {
  return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
}

export class PlayerCore {
  constructor(engine) {
    this.engine = engine || new AudioEngine();
    this.state = defaultState();
    this.listeners = new Set();
    this._loadedUrl = null;
    this._skips = 0;
    this._sleepIv = 0;
    this._lastSleepSec = -1;
    this._sleepDone = false;
    this.engine.on("status", (status) => {
      this.state.status = status;
      this.state.playing = status === "playing";
      if (status === "playing") {
        this.state.error = "";
        this._skips = 0;
      }
      this.broadcast();
    });
    this.engine.on("time", (t) => {
      this.state.currentTime = t.currentTime;
      this.state.duration = t.duration;
      this.state.live = t.live;
      this.broadcast("time");
    });
    this.engine.on("ended", () => this.next({ fromEnded: true }));
    this.engine.on("error", (msg) => {
      if (this._skips < 6 && this.state.playlist.length > 1) {
        this._skips += 1;
        void this.next({ autoSkip: true });
        return;
      }
      this.state.status = "error";
      this.state.playing = false;
      this.state.error = msg;
      this.broadcast();
    });
  }

  subscribe(fn) {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  broadcast(kind = "state") {
    for (const fn of this.listeners) fn(this.state, kind);
  }

  async hydrate() {
    const saved = await loadPersisted();
    if (saved.theme && THEME_NAMES.includes(saved.theme)) this.state.theme = saved.theme;
    if (saved.tone && typeof saved.tone === "object") {
      this.state.tone = {
        bass: clampTone(saved.tone.bass),
        mid: clampTone(saved.tone.mid),
        treble: clampTone(saved.tone.treble),
      };
    }
    if (typeof saved.volume === "number") this.state.volume = Math.max(0, Math.min(100, saved.volume));
    if (Array.isArray(saved.favorites)) this.state.favorites = saved.favorites;
    if (saved.notes && typeof saved.notes === "object") this.state.notes = saved.notes;
    if (typeof saved.sleepEndsAt === "number" && saved.sleepEndsAt > Date.now()) {
      this.state.sleepEndsAt = saved.sleepEndsAt;
      this.state.sleepMinutes = saved.sleepMinutes ?? null;
      this.startSleepLoop();
      this.armSleepAlarm();
    }
    if (Array.isArray(saved.playlist) && saved.playlist.length) {
      this.state.playlist = saved.playlist;
      this.state.index = Math.min(saved.index ?? 0, saved.playlist.length - 1);
      this.state.cursor = this.state.index;
    }
    this.applyAudioSettings();
    this.broadcast();
  }

  persist() {
    const s = this.state;
    return savePersisted({
      theme: s.theme,
      tone: s.tone,
      volume: s.volume,
      favorites: s.favorites,
      notes: s.notes,
      sleepEndsAt: s.sleepEndsAt,
      sleepMinutes: s.sleepMinutes,
      playlist: s.playlist.map(({ blob, file, _blobUrl, ...rest }) => rest),
      index: s.index,
    });
  }

  applyAudioSettings() {
    this.engine.setTone(this.state.tone);
    this.applyVolume();
  }

  sleepRemaining() {
    if (!this.state.sleepEndsAt) return null;
    return Math.max(0, this.state.sleepEndsAt - Date.now());
  }

  fadeAmount() {
    const remaining = this.sleepRemaining();
    if (remaining == null) return 1;
    if (remaining >= FADE_MS) return 1;
    return remaining / FADE_MS;
  }

  applyVolume() {
    this.engine.setGain((this.state.volume / 100) * this.fadeAmount());
  }

  startSleepLoop() {
    this.stopSleepLoop();
    this.tickSleep();
    this._sleepIv = setInterval(() => this.tickSleep(), 250);
  }

  stopSleepLoop() {
    if (this._sleepIv) clearInterval(this._sleepIv);
    this._sleepIv = 0;
    this._lastSleepSec = -1;
  }

  tickSleep() {
    const remaining = this.sleepRemaining();
    if (remaining == null) {
      this.stopSleepLoop();
      return;
    }
    this.applyVolume();
    this.state.sleepRemainingMs = remaining;
    const sec = Math.ceil(remaining / 1000);
    if (sec !== this._lastSleepSec) {
      this._lastSleepSec = sec;
      this.broadcast("sleep");
    }
    if (remaining <= 0) this.finishSleepTimer();
  }

  setSleepTimer(minutes) {
    const mins = Number(minutes);
    if (!SLEEP_PRESETS.includes(mins)) return;
    this.state.sleepMinutes = mins;
    this.state.sleepEndsAt = Date.now() + mins * 60_000;
    this.state.sleepRemainingMs = mins * 60_000;
    this._sleepDone = false;
    this.startSleepLoop();
    this.armSleepAlarm();
    this.persist();
    this.broadcast();
  }

  clearSleepTimer() {
    this.stopSleepLoop();
    this.clearSleepAlarm();
    this.state.sleepMinutes = null;
    this.state.sleepEndsAt = null;
    this.state.sleepRemainingMs = 0;
    this.applyVolume();
    this.persist();
    this.broadcast();
  }

  finishSleepTimer() {
    if (this._sleepDone) return;
    this._sleepDone = true;
    this.stopSleepLoop();
    this.clearSleepAlarm();
    this.state.sleepMinutes = null;
    this.state.sleepEndsAt = null;
    this.state.sleepRemainingMs = 0;
    this.stop();
    this.applyVolume();
    this.persist();
    this.broadcast();
    void this.engine.playCue();
  }

  armSleepAlarm() {
    if (typeof chrome === "undefined" || !chrome.alarms || !this.state.sleepEndsAt) return;
    chrome.alarms.clear("sleep-stop");
    chrome.alarms.create("sleep-stop", { when: this.state.sleepEndsAt });
  }

  clearSleepAlarm() {
    if (typeof chrome === "undefined" || !chrome.alarms) return;
    chrome.alarms.clear("sleep-stop");
  }

  unlock() {
    return this.engine.ensureGraph();
  }

  current() {
    return this.state.playlist[this.state.index] || null;
  }

  noteFor(track) {
    const key = trackKey(track);
    return key ? this.state.notes[key] || null : null;
  }

  setStationNote(track, text) {
    if (!track) return;
    const key = trackKey(track);
    if (!key) return;
    const trimmed = String(text || "").trim();
    const next = { ...this.state.notes };
    if (!trimmed) delete next[key];
    else {
      next[key] = {
        text: trimmed,
        title: track.title || next[key]?.title || key,
        url: track.url || next[key]?.url || "",
        id: track.id || key,
        kind: track.kind || "radio",
        updatedAt: Date.now(),
      };
    }
    this.state.notes = next;
    this.persist();
    this.broadcast();
  }

  notedStations() {
    return Object.values(this.state.notes)
      .filter((n) => n?.url)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .map((n) => ({
        id: n.id,
        title: n.title,
        url: n.url,
        kind: n.kind || "radio",
      }));
  }

  loadNotedStations() {
    const tracks = this.notedStations();
    if (!tracks.length) return;
    return this.setPlaylist(tracks);
  }

  async playNoise(id) {
    const preset = NOISE_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    if (this.state.noiseId === id && this.state.status === "playing") {
      this.stop();
      return;
    }
    this.state.noiseId = id;
    this.state.nowPlaying = preset.title;
    this.state.error = "";
    this.state.live = true;
    this.state.duration = 0;
    this.state.currentTime = 0;
    this._loadedUrl = `noise:${id}`;
    await this.engine.playNoise(id);
    this.applyAudioSettings();
    this.state.playing = true;
    this.state.status = "playing";
    this.broadcast();
  }

  async playIndex(i, { autoplay = true, autoSkip = false } = {}) {
    if (!this.state.playlist.length) return;
    if (!autoSkip) this._skips = 0;
    this.state.noiseId = null;
    this.state.index = ((i % this.state.playlist.length) + this.state.playlist.length) % this.state.playlist.length;
    this.state.cursor = this.state.index;
    const track = this.current();
    this.state.nowPlaying = track.title;
    this.state.error = "";
    let url = track.url;
    if (track.file instanceof Blob) {
      if (track._blobUrl) URL.revokeObjectURL(track._blobUrl);
      track._blobUrl = URL.createObjectURL(track.file);
      url = track._blobUrl;
    } else {
      const resolved = await resolveClick(track.id);
      if (resolved) url = resolved;
      url = await unwrapStreamUrl(url);
    }
    await this.engine.load(url);
    this.applyAudioSettings();
    this._loadedUrl = url;
    if (autoplay) {
      try {
        await this.engine.play();
        this.state.playing = true;
        this.state.status = "playing";
      } catch {
        this.state.playing = false;
        this.state.status = "paused";
      }
    }
    this.broadcast();
    this.persist();
  }

  async toggle() {
    if (this.state.status === "playing") {
      this.engine.pause();
      this.state.playing = false;
      this.state.status = "paused";
      this.broadcast();
      return;
    }
    if (this.state.noiseId) {
      try {
        await this.engine.playNoise(this.state.noiseId);
        this.state.playing = true;
        this.state.status = "playing";
      } catch (err) {
        this.state.error = err.message || "play failed";
        this.state.status = "error";
      }
      this.broadcast();
      return;
    }
    if (this._loadedUrl) {
      try {
        await this.engine.play();
      } catch (err) {
        this.state.error = err.message || "play failed";
        this.state.status = "error";
      }
      this.broadcast();
      return;
    }
    await this.playIndex(this.state.index);
  }

  stop() {
    this.engine.stop();
    this.state.noiseId = null;
    this.state.playing = false;
    this.state.status = "stopped";
    this.broadcast();
  }

  async next({ autoSkip = false } = {}) {
    const n = this.state.playlist.length;
    if (!n) return;
    await this.playIndex((this.state.index + 1) % n, { autoSkip });
  }

  async prev() {
    const n = this.state.playlist.length;
    if (!n) return;
    await this.playIndex((this.state.index - 1 + n) % n);
  }

  setVolume(n) {
    this.state.volume = Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
    this.applyVolume();
    this.broadcast();
    this.persist();
  }

  setTone(partial) {
    this.state.tone = {
      bass: clampTone(partial.bass ?? this.state.tone.bass),
      mid: clampTone(partial.mid ?? this.state.tone.mid),
      treble: clampTone(partial.treble ?? this.state.tone.treble),
    };
    this.engine.setTone(this.state.tone);
    this.broadcast();
    this.persist();
  }

  setPlaylist(tracks, { play = true } = {}) {
    this.state.playlist = tracks;
    this.state.index = 0;
    this.state.cursor = 0;
    this.broadcast();
    this.persist();
    if (play && tracks.length) return this.playIndex(0);
  }

  appendTracks(tracks) {
    const seen = new Set(this.state.playlist.map(trackKey));
    const extra = tracks.filter((t) => !seen.has(trackKey(t)));
    this.state.playlist = [...this.state.playlist, ...extra];
    this.broadcast();
    this.persist();
    return extra.length;
  }

  removeAt(i) {
    if (i < 0 || i >= this.state.playlist.length) return;
    const playing = i === this.state.index;
    this.state.playlist = this.state.playlist.filter((_, idx) => idx !== i);
    if (!this.state.playlist.length) {
      this.stop();
      this.state.index = 0;
      this.state.cursor = 0;
      this.broadcast();
      this.persist();
      return;
    }
    if (this.state.index > i) this.state.index -= 1;
    if (this.state.cursor > i) this.state.cursor -= 1;
    this.state.cursor = Math.min(this.state.cursor, this.state.playlist.length - 1);
    this.broadcast();
    this.persist();
    if (playing) this.playIndex(this.state.index);
  }

  toggleFavorite(track = this.state.playlist[this.state.cursor]) {
    if (!track) return;
    const key = trackKey(track);
    const has = this.state.favorites.some((f) => trackKey(f) === key);
    const { file, _blobUrl, blob, ...rest } = track;
    this.state.favorites = has
      ? this.state.favorites.filter((f) => trackKey(f) !== key)
      : [...this.state.favorites, rest];
    this.broadcast();
    this.persist();
  }

  isFavorite(track) {
    const key = trackKey(track);
    return this.state.favorites.some((f) => trackKey(f) === key);
  }

  loadFavorites() {
    if (!this.state.favorites.length) return;
    return this.setPlaylist(this.state.favorites.map((t) => ({ ...t })));
  }

  setTheme(name) {
    this.state.theme = name;
    this.broadcast();
    this.persist();
  }

  cycleTheme() {
    const i = THEME_NAMES.indexOf(this.state.theme);
    this.setTheme(THEME_NAMES[(i + 1) % THEME_NAMES.length]);
  }

  getAnalyser() {
    return this.engine.getAnalyser();
  }

  statePatch(partial) {
    Object.assign(this.state, partial);
    this.broadcast();
  }

  async command(name, ...args) {
    const fn = this[name];
    if (typeof fn !== "function") throw new Error(`unknown command ${name}`);
    return fn.apply(this, args);
  }
}

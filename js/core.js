import { AudioEngine } from "./audio-engine.js";
import { EQ_PRESETS, clampGain, nextPreset } from "./eq.js";
import { featuredTracks, resolveClick, unwrapStreamUrl } from "./radio.js";
import { VIS_MODES } from "./visualizer.js";
import { THEME_NAMES } from "./themes.js";
import { loadPersisted, savePersisted } from "./storage.js";

export const SLEEP_PRESETS = [60, 55, 30, 25, 10, 5, 3, 1];

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
    volumeDb: 0,
    speed: 1,
    shuffle: false,
    repeat: "off",
    eqPreset: "Rock",
    eqGains: [...EQ_PRESETS.Rock],
    eqBand: 0,
    theme: "hackerman",
    visualizer: "spectrum",
    focus: "playlist",
    favorites: [],
    history: [],
    error: "",
    nowPlaying: "",
    helpBar: true,
    sleepMinutes: null,
    sleepEndsAt: null,
    sleepRemainingMs: 0,
  };
}

export function isExtension() {
  return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
}

function trackKey(t) {
  return t?.id || t?.url || "";
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
    if (saved.visualizer && VIS_MODES.includes(saved.visualizer)) {
      this.state.visualizer = saved.visualizer;
    }
    if (saved.eqPreset && EQ_PRESETS[saved.eqPreset]) {
      this.state.eqPreset = saved.eqPreset;
      this.state.eqGains = [...EQ_PRESETS[saved.eqPreset]];
    }
    if (Array.isArray(saved.eqGains) && saved.eqGains.length === 10) {
      this.state.eqGains = saved.eqGains.map(clampGain);
      if (saved.eqPreset === "Custom") this.state.eqPreset = "Custom";
    }
    if (typeof saved.volumeDb === "number") this.state.volumeDb = saved.volumeDb;
    if (typeof saved.speed === "number") this.state.speed = saved.speed;
    if (typeof saved.shuffle === "boolean") this.state.shuffle = saved.shuffle;
    if (saved.repeat) this.state.repeat = saved.repeat;
    if (Array.isArray(saved.favorites)) this.state.favorites = saved.favorites;
    if (Array.isArray(saved.history)) this.state.history = saved.history;
    if (typeof saved.helpBar === "boolean") this.state.helpBar = saved.helpBar;
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
      visualizer: s.visualizer,
      eqPreset: s.eqPreset,
      eqGains: s.eqGains,
      volumeDb: s.volumeDb,
      speed: s.speed,
      shuffle: s.shuffle,
      repeat: s.repeat,
      favorites: s.favorites,
      history: s.history,
      helpBar: s.helpBar,
      sleepEndsAt: s.sleepEndsAt,
      sleepMinutes: s.sleepMinutes,
      playlist: s.playlist.map(({ blob, file, _blobUrl, ...rest }) => rest),
      index: s.index,
    });
  }

  applyAudioSettings() {
    this.engine.setEq(this.state.eqGains);
    this.applyVolume();
    this.engine.setSpeed(this.state.speed);
  }

  sleepRemaining() {
    if (!this.state.sleepEndsAt) return null;
    return Math.max(0, this.state.sleepEndsAt - Date.now());
  }

  fadeAmount() {
    const remaining = this.sleepRemaining();
    if (remaining == null) return 1;
    if (remaining >= 60_000) return 1;
    return remaining / 60_000;
  }

  applyVolume() {
    this.engine.setVolumeDb(this.state.volumeDb, this.fadeAmount());
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
    void this.engine.playGong();
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

  async playIndex(i, { autoplay = true, autoSkip = false } = {}) {
    if (!this.state.playlist.length) return;
    if (!autoSkip) this._skips = 0;
    this.state.index = ((i % this.state.playlist.length) + this.state.playlist.length) % this.state.playlist.length;
    this.state.cursor = this.state.index;
    const track = this.current();
    this.state.nowPlaying = track.title;
    this.state.error = "";
    this.pushHistory(track);
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
    this.state.playing = false;
    this.state.status = "stopped";
    this.broadcast();
  }

  async next({ fromEnded = false, autoSkip = false } = {}) {
    const n = this.state.playlist.length;
    if (!n) return;
    if (this.state.repeat === "one" && fromEnded) {
      await this.playIndex(this.state.index, { autoSkip });
      return;
    }
    if (this.state.shuffle) {
      let i = this.state.index;
      if (n > 1) {
        while (i === this.state.index) i = Math.floor(Math.random() * n);
      }
      await this.playIndex(i, { autoSkip });
      return;
    }
    const next = this.state.index + 1;
    if (next >= n) {
      if (this.state.repeat === "all" || !fromEnded) await this.playIndex(0, { autoSkip });
      else this.stop();
      return;
    }
    await this.playIndex(next, { autoSkip });
  }

  async prev() {
    if (this.state.currentTime > 3 && !this.state.live) {
      this.engine.seek(0);
      return;
    }
    const n = this.state.playlist.length;
    if (!n) return;
    await this.playIndex((this.state.index - 1 + n) % n);
  }

  seekBy(delta) {
    if (this.state.live) return;
    this.engine.seek(this.state.currentTime + delta);
  }

  setVolumeDb(db) {
    this.state.volumeDb = Math.max(-30, Math.min(6, db));
    this.applyVolume();
    this.broadcast();
    this.persist();
  }

  setSpeed(rate) {
    this.state.speed = Math.max(0.25, Math.min(2, Math.round(rate * 4) / 4));
    this.engine.setSpeed(this.state.speed);
    this.broadcast();
    this.persist();
  }

  setEqPreset(name) {
    if (!EQ_PRESETS[name]) return;
    this.state.eqPreset = name;
    this.state.eqGains = [...EQ_PRESETS[name]];
    this.engine.setEq(this.state.eqGains);
    this.broadcast();
    this.persist();
  }

  cycleEq() {
    this.setEqPreset(nextPreset(this.state.eqPreset === "Custom" ? "Flat" : this.state.eqPreset));
  }

  nudgeBand(dir) {
    const i = this.state.eqBand;
    const next = clampGain((this.state.eqGains[i] || 0) + dir);
    this.state.eqGains = this.state.eqGains.map((g, idx) => (idx === i ? next : g));
    this.state.eqPreset = "Custom";
    this.engine.setEq(this.state.eqGains);
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

  moveTrack(from, to) {
    if (to < 0 || to >= this.state.playlist.length) return;
    const list = [...this.state.playlist];
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
    this.state.playlist = list;
    if (this.state.index === from) this.state.index = to;
    else if (from < this.state.index && to >= this.state.index) this.state.index -= 1;
    else if (from > this.state.index && to <= this.state.index) this.state.index += 1;
    this.state.cursor = to;
    this.broadcast();
    this.persist();
  }

  toggleShuffle() {
    this.state.shuffle = !this.state.shuffle;
    this.broadcast();
    this.persist();
  }

  cycleRepeat() {
    const order = ["off", "all", "one"];
    this.state.repeat = order[(order.indexOf(this.state.repeat) + 1) % order.length];
    this.broadcast();
    this.persist();
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

  pushHistory(track) {
    const entry = { ...track, playedAt: Date.now() };
    this.state.history = [entry, ...this.state.history.filter((h) => trackKey(h) !== trackKey(track))].slice(0, 80);
  }

  loadFavorites() {
    if (!this.state.favorites.length) return;
    return this.setPlaylist(this.state.favorites.map((t) => ({ ...t })));
  }

  loadHistory() {
    if (!this.state.history.length) return;
    return this.setPlaylist(this.state.history.map((t) => ({ ...t })));
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

  setVisualizer(name) {
    this.state.visualizer = name;
    this.broadcast();
    this.persist();
  }

  cycleVisualizer() {
    const i = VIS_MODES.indexOf(this.state.visualizer);
    this.setVisualizer(VIS_MODES[(i + 1) % VIS_MODES.length]);
  }

  cycleFocus() {
    const order = ["playlist", "eq", "volume", "speed"];
    this.state.focus = order[(order.indexOf(this.state.focus) + 1) % order.length];
    this.broadcast();
  }

  toggleHelpBar() {
    this.state.helpBar = this.state.helpBar === false;
    this.broadcast();
    this.persist();
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

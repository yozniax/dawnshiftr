import { PlayerCore, isExtension, defaultState } from "./core.js";
import { applyTheme, THEME_NAMES } from "./themes.js";
import { formatGain } from "./eq.js";
import { Visualizer, VIS_MODES } from "./visualizer.js";
import {
  searchStations,
  topStations,
  stationsByCountry,
  featuredTracks,
  loadFromUrl,
  REGIONS,
} from "./radio.js";

function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "00:00";
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function volBar(db) {
  const t = (db + 30) / 36;
  const n = Math.round(t * 10);
  return "█".repeat(n) + "░".repeat(10 - n);
}

function repeatLabel(r) {
  return r === "off" ? "Off" : r === "all" ? "All" : "One";
}

class ExtensionBridge {
  constructor() {
    this.state = defaultState();
    this.listeners = new Set();
    this._analyser = null;
    this.port = chrome.runtime.connect({ name: "ui" });
    this.port.onMessage.addListener((msg) => {
      if (msg?.type === "state") {
        this.state = msg.state;
        for (const fn of this.listeners) fn(this.state);
      }
      if (msg?.type === "analyser") this._analyser = msg.payload;
    });
    this.port.postMessage({ type: "hello" });
  }

  subscribe(fn) {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  async command(name, ...args) {
    this.port.postMessage({ type: "cmd", name, args });
  }

  getAnalyser() {
    return this._analyser;
  }

  isFavorite(track) {
    const key = track?.id || track?.url;
    return this.state.favorites?.some((f) => (f.id || f.url) === key);
  }
}

function wrapLocal(core) {
  return {
    state: core.state,
    subscribe(fn) {
      return core.subscribe((s) => {
        this.state = s;
        fn(s);
      });
    },
    command(name, ...args) {
      if (typeof core[name] === "function") return core[name](...args);
    },
    getAnalyser() {
      return core.getAnalyser();
    },
    isFavorite(track) {
      return core.isFavorite(track);
    },
  };
}

const overlayEl = document.getElementById("overlay");
const toastEl = document.getElementById("toast");
const listEl = document.getElementById("list");
const fileInput = document.getElementById("file-input");

let overlay = null;
let toastTimer = 0;

function toast(text) {
  toastEl.textContent = text;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1400);
}

async function lyricsFor(track) {
  if (!track?.title) return "No track.";
  try {
    const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(track.title)}`);
    if (!res.ok) throw new Error("lrclib");
    const rows = await res.json();
    const hit = rows.find((r) => r.plainLyrics || r.syncedLyrics);
    return hit?.plainLyrics || hit?.syncedLyrics || "No lyrics found.";
  } catch {
    return "Lyrics lookup failed.";
  }
}

function closeOverlay() {
  overlay = null;
  overlayEl.classList.remove("open");
  overlayEl.innerHTML = "";
}

function openOverlay(next) {
  overlay = next;
  overlayEl.classList.add("open");
  renderOverlay();
  const input = overlayEl.querySelector("input");
  if (input) {
    input.focus();
    input.value = overlay.query || "";
  }
}

function renderOverlay() {
  if (!overlay) return;
  const { kind, title, hint, items = [], cursor = 0, query = "", loading, error, body } = overlay;
  if (kind === "help") {
    overlayEl.innerHTML = `<h2>KEYMAP</h2>
      <div class="keys">
        <span>Space</span><span>Play / Pause</span>
        <span>Enter</span><span>Play highlighted</span>
        <span>s</span><span>Stop</span>
        <span>&gt; / &lt;</span><span>Next / Previous</span>
        <span>+ / -</span><span>Volume</span>
        <span>[ / ]</span><span>Speed</span>
        <span>e</span><span>Cycle EQ preset</span>
        <span>h / l</span><span>EQ band</span>
        <span>j / k</span><span>Playlist / EQ gain</span>
        <span>z / r</span><span>Shuffle / Repeat</span>
        <span>t / v</span><span>Theme / Visualizer</span>
        <span>f</span><span>Favorite station</span>
        <span>R</span><span>Radio Browser</span>
        <span>N</span><span>Radio by country</span>
        <span>u</span><span>Load URL</span>
        <span>o</span><span>Open local files</span>
        <span>/</span><span>Filter playlist</span>
        <span>y</span><span>Lyrics</span>
        <span>n</span><span>Favorites playlist</span>
        <span>H</span><span>Recently played</span>
        <span>x</span><span>Remove from playlist</span>
        <span>Tab</span><span>Focus (playlist / EQ / vol / speed)</span>
        <span>?</span><span>This help</span>
      </div>
      <div class="hint" style="margin-top:10px">Esc closes.</div>`;
    return;
  }
  if (kind === "lyrics") {
    overlayEl.innerHTML = `<h2>LYRICS</h2><div class="hint">${hint || ""}</div><div class="lyrics">${escapeHtml(body || "")}</div>`;
    return;
  }
  if (kind === "url") {
    overlayEl.innerHTML = `<h2>LOAD URL</h2>
      <div class="hint">Stream, M3U / PLS playlist, or podcast RSS.</div>
      <input type="text" placeholder="https://…" value="${escapeAttr(query)}" />`;
    bindOverlayInput();
    return;
  }
  overlayEl.innerHTML = `<h2>${escapeHtml(title || kind.toUpperCase())}</h2>
    <div class="hint">${escapeHtml(hint || "↑↓ move · Enter select · Esc close")}</div>
    ${kind === "radio" || kind === "filter" || kind === "theme" || kind === "vis" ? `<input type="search" placeholder="filter…" value="${escapeAttr(query)}" />` : ""}
    <div class="results" id="overlay-results"></div>`;
  const box = overlayEl.querySelector("#overlay-results");
  if (loading) box.innerHTML = `<div class="empty">◌ Loading…</div>`;
  else if (error) box.innerHTML = `<div class="empty err">ERR: ${escapeHtml(error)}</div>`;
  else if (!items.length) box.innerHTML = `<div class="empty">No results.</div>`;
  else {
    box.innerHTML = items
      .map((it, i) => {
        const sub = it.sub ? `<span>${escapeHtml(it.sub)}</span>` : "";
        return `<div class="item ${i === cursor ? "on" : ""}" data-i="${i}"><span>${escapeHtml(it.label)}</span>${sub}</div>`;
      })
      .join("");
    box.querySelectorAll(".item").forEach((el) => {
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        overlay.cursor = Number(el.dataset.i);
        activateOverlay();
      });
    });
    box.querySelector(".item.on")?.scrollIntoView({ block: "nearest" });
  }
  bindOverlayInput();
}

function bindOverlayInput() {
  const input = overlayEl.querySelector("input");
  if (!input || overlay._bound) return;
  overlay._bound = true;
  input.addEventListener("input", () => {
    overlay.query = input.value;
    overlay._bound = false;
    if (overlay.onQuery) overlay.onQuery(overlay.query);
    else renderOverlay();
  });
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttr(s) {
  return escapeHtml(s).replaceAll('"', "&quot;");
}

async function activateOverlay() {
  if (!overlay) return;
  if (overlay.kind === "url") {
    const raw = overlayEl.querySelector("input")?.value?.trim();
    closeOverlay();
    if (!raw) return;
    try {
      const tracks = await loadFromUrl(raw);
      await client.command("setPlaylist", tracks);
      toast(`Loaded ${tracks.length}`);
    } catch (err) {
      toast(err.message || "load failed");
    }
    return;
  }
  const item = overlay.items?.[overlay.cursor];
  if (!item) return;
  if (overlay.onPick) await overlay.onPick(item, overlay.cursor);
}

const surface = new URLSearchParams(location.search).get("surface") || "page";
if (surface === "popup") document.body.classList.add("compact");
if (surface === "window") document.body.classList.add("windowed");

const localCore = isExtension() ? null : new PlayerCore();
const client = isExtension() ? new ExtensionBridge() : wrapLocal(localCore);

if (!isExtension()) localCore.hydrate();

applyTheme(client.state.theme);
const vis = new Visualizer(document.getElementById("viz"));
vis.setMode(client.state.visualizer);
vis.start(
  () => client.getAnalyser(),
  () => client.state.status === "playing"
);

client.subscribe((state) => {
  applyTheme(state.theme);
  vis.setMode(state.visualizer);
  render(state);
  updateMediaSession(state);
});

function render(state) {
  const track = state.playlist[state.index];
  document.getElementById("source-label").textContent = track?.kind === "file" ? "Local" : "Radio";
  document.getElementById("track-title").textContent = track?.title || "No track";
  document.getElementById("glyph").textContent = state.status === "playing" ? "♫" : "·";

  let status = "";
  if (state.status === "error") status = `<span class="err">ERR: ${escapeHtml(state.error || "failed")}</span>`;
  else if (state.status === "buffering") status = "◌ Buffering…";
  else if (state.status === "playing") status = state.live ? "● Streaming" : "▶ Playing";
  else if (state.status === "paused") status = "❚❚ Paused (click to play)";
  else status = "■ Stopped (click to play)";
  const right = state.live ? "LIVE" : fmtTime(state.duration);
  document.getElementById("status-line").innerHTML =
    `${fmtTime(state.currentTime)} / ${right}  ${status}`;

  const bar = document.getElementById("stream-bar");
  const fill = document.getElementById("stream-fill");
  bar.classList.toggle("live", Boolean(state.live) || state.status !== "playing");
  if (state.live || !state.duration) {
    bar.classList.add("live");
    fill.style.width = state.status === "playing" ? "100%" : "0%";
  } else {
    bar.classList.remove("live");
    fill.style.width = `${(state.currentTime / state.duration) * 100}%`;
  }

  const gains = state.eqGains
    .map(
      (g, i) =>
        `<span class="${state.focus === "eq" && i === state.eqBand ? "on" : ""}">${formatGain(g)}</span>`
    )
    .join("");
  document.getElementById("eq-line").innerHTML =
    `EQ [<b>${escapeHtml(state.eqPreset)}</b>] <span class="eq-gains">${gains}</span>`;

  const volOn = state.focus === "volume" ? "on" : "";
  document.getElementById("vol-line").innerHTML =
    `<span class="${volOn}">VOL</span> <span class="bar">${volBar(state.volumeDb)}</span> ${formatGain(state.volumeDb)}dB`;

  document.getElementById("src-line").innerHTML =
    `SRC [<span class="src">Radio</span>] ${state.playlist.length ? state.index + 1 : 0}/${state.playlist.length}
     · SPD [<b class="${state.focus === "speed" ? "on" : ""}">${state.speed}x</b>] · vis ${state.visualizer} · ${state.theme}`;

  const sh = state.shuffle ? "on" : "";
  document.getElementById("playlist-head").innerHTML =
    `▸─ Playlist ── <span class="${sh}">[Shuffle]</span> [Repeat: ${repeatLabel(state.repeat)}] [${state.playlist.length ? state.cursor + 1 : 0}/${state.playlist.length}] ──`;

  if (!state.playlist.length) {
    listEl.innerHTML = `<div class="empty">Empty queue. Press <kbd>R</kbd> for radio, <kbd>o</kbd> for files, <kbd>u</kbd> for a URL.</div>`;
  } else {
    listEl.innerHTML = state.playlist
      .map((t, i) => {
        const playing = i === state.index ? "is-playing" : "";
        const cur = i === state.cursor ? "is-cursor" : "";
        const star = client.isFavorite(t) ? "★" : " ";
        const mark = i === state.index && state.status === "playing" ? "▶" : i === state.index ? "❚" : " ";
        return `<div class="track ${playing} ${cur}" data-i="${i}">
          <span class="mark">${mark}</span>
          <span class="n">${String(i + 1).padStart(2, " ")}</span>
          <span class="name">${escapeHtml(t.title)}</span>
          <span>${star}</span>
        </div>`;
      })
      .join("");
    listEl.querySelectorAll(".track").forEach((el) => {
      el.addEventListener("click", () => {
        const i = Number(el.dataset.i);
        client.command("playIndex", i);
      });
    });
    listEl.querySelector(".is-cursor")?.scrollIntoView({ block: "nearest" });
  }

  document.getElementById("help").style.display = state.helpBar === false ? "none" : "flex";
  document.getElementById("help").innerHTML = `
    <span><kbd>↑↓</kbd> Scroll</span>
    <span><kbd>Enter</kbd> Play</span>
    <span><kbd>Spc</kbd> ▶❚❚</span>
    <span><kbd>f</kbd> Fav</span>
    <span><kbd>R</kbd> Radio</span>
    <span><kbd>t</kbd> Theme</span>
    <span><kbd>?</kbd> Keys</span>`;
}

function moveCursor(delta) {
  const s = client.state;
  if (s.focus === "eq") {
    const next = (s.eqBand + delta + 10) % 10;
    client.command("statePatch", { eqBand: next });
    if (isExtension()) client.command("nudgeBand", 0);
    else {
      localCore.state.eqBand = next;
      localCore.broadcast();
    }
    return;
  }
  if (s.focus === "volume") {
    client.command("setVolumeDb", s.volumeDb + (delta > 0 ? -1 : 1));
    return;
  }
  if (s.focus === "speed") {
    client.command("setSpeed", s.speed + (delta > 0 ? -0.25 : 0.25));
    return;
  }
  const n = s.playlist.length;
  if (!n) return;
  const cursor = (s.cursor + delta + n) % n;
  patchCursor(cursor);
}

function patchCursor(cursor) {
  if (isExtension()) client.command("statePatch", { cursor });
  else {
    localCore.state.cursor = cursor;
    localCore.broadcast();
  }
}

function patchEqBand(eqBand) {
  if (isExtension()) client.command("statePatch", { eqBand });
  else {
    localCore.state.eqBand = eqBand;
    localCore.broadcast();
  }
}

async function openRadio(seed = "") {
  openOverlay({
    kind: "radio",
    title: "RADIO BROWSER",
    hint: "Search 30,000+ stations. Enter play · a append",
    query: seed,
    items: [],
    cursor: 0,
    loading: true,
    async onQuery(q) {
      overlay.loading = true;
      overlay._bound = false;
      renderOverlay();
      try {
        const tracks = q.trim() ? await searchStations({ name: q.trim(), limit: 50 }) : await topStations(40);
        if (overlay?.kind !== "radio") return;
        overlay.loading = false;
        overlay.error = "";
        overlay.items = tracks.map((t) => ({
          label: t.title,
          sub: [t.country, t.bitrate ? `${t.bitrate}k` : "", t.tags?.split(",")[0]].filter(Boolean).join(" · "),
          track: t,
        }));
        overlay.cursor = 0;
        overlay._bound = false;
        renderOverlay();
      } catch (err) {
        overlay.loading = false;
        overlay.error = err.message;
        overlay._bound = false;
        renderOverlay();
      }
    },
    async onPick(item) {
      closeOverlay();
      await client.command("setPlaylist", [item.track, ...client.state.playlist.filter((t) => t.url !== item.track.url)]);
    },
  });
  overlay.onQuery(seed);
}

function openCountries() {
  openOverlay({
    kind: "countries",
    title: "RADIO BY COUNTRY",
    hint: "Enter loads stations as a playlist",
    items: REGIONS.map((r) => ({ label: `${r.name}  (${r.code})`, code: r.code })),
    cursor: 0,
    async onPick(item) {
      overlay.loading = true;
      overlay._bound = false;
      renderOverlay();
      try {
        const tracks = await stationsByCountry(item.code, 60);
        closeOverlay();
        if (!tracks.length) {
          toast("No stations");
          return;
        }
        await client.command("setPlaylist", tracks);
        toast(`${item.code} · ${tracks.length}`);
      } catch (err) {
        overlay.loading = false;
        overlay.error = err.message;
        overlay._bound = false;
        renderOverlay();
      }
    },
  });
}

function openPicker(kind, names, current, onPick, title) {
  const items = names.map((name) => ({ label: name === current ? `▶ ${name}` : `  ${name}`, value: name }));
  openOverlay({
    kind,
    title,
    query: "",
    items,
    cursor: Math.max(0, names.indexOf(current)),
    onQuery(q) {
      const qn = q.toLowerCase();
      overlay.items = names
        .filter((n) => n.toLowerCase().includes(qn))
        .map((name) => ({ label: name === current ? `▶ ${name}` : `  ${name}`, value: name }));
      overlay.cursor = 0;
      overlay._bound = false;
      renderOverlay();
    },
    async onPick(item) {
      closeOverlay();
      await onPick(item.value);
    },
  });
}

document.getElementById("status-line").style.cursor = "pointer";
document.getElementById("status-line").addEventListener("click", () => client.command("toggle"));
document.getElementById("track-title").style.cursor = "pointer";
document.getElementById("track-title").addEventListener("click", () => client.command("toggle"));

document.getElementById("stream-bar").addEventListener("click", (e) => {
  const s = client.state;
  if (s.live || !s.duration) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const t = (e.clientX - rect.left) / rect.width;
  client.command("seekBy", t * s.duration - s.currentTime);
});

fileInput.addEventListener("change", async () => {
  const files = [...fileInput.files];
  fileInput.value = "";
  if (!files.length) return;
  const tracks = files.map((file) => ({
    id: `${file.name}-${file.size}`,
    title: file.name.replace(/\.[^.]+$/, ""),
    url: "",
    file,
    kind: "file",
  }));
  await client.command("setPlaylist", tracks);
  toast(`${tracks.length} files`);
});

document.addEventListener("keydown", async (e) => {
  if (overlay) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeOverlay();
      return;
    }
    if (overlay.kind === "url") {
      if (e.key === "Enter") {
        e.preventDefault();
        overlay.query = overlayEl.querySelector("input")?.value || "";
        await activateOverlay();
      }
      return;
    }
    if (["ArrowDown", "j"].includes(e.key)) {
      e.preventDefault();
      overlay.cursor = Math.min((overlay.items?.length || 1) - 1, (overlay.cursor || 0) + 1);
      overlay._bound = false;
      renderOverlay();
    }
    if (["ArrowUp", "k"].includes(e.key)) {
      e.preventDefault();
      overlay.cursor = Math.max(0, (overlay.cursor || 0) - 1);
      overlay._bound = false;
      renderOverlay();
    }
    if (e.key === "Enter") {
      e.preventDefault();
      await activateOverlay();
    }
    if (e.key === "a" && overlay.kind === "radio" && overlay.items?.[overlay.cursor]) {
      e.preventDefault();
      const t = overlay.items[overlay.cursor].track;
      await client.command("appendTracks", [t]);
      toast("Appended");
    }
    return;
  }

  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;

  const s = client.state;
  const key = e.key;

  if (key === "?" || (e.ctrlKey && key === "k")) {
    e.preventDefault();
    openOverlay({ kind: "help" });
    return;
  }
  if (key === "Escape") return;
  if (key === " ") {
    e.preventDefault();
    client.command("toggle");
    return;
  }
  if (key === "Enter") {
    e.preventDefault();
    client.command("playIndex", s.cursor);
    return;
  }
  if (key === "s" && !e.shiftKey) {
    client.command("stop");
    return;
  }
  if (key === "ArrowDown" || key === "j") {
    e.preventDefault();
    if (s.focus === "eq") client.command("nudgeBand", -1);
    else moveCursor(1);
    return;
  }
  if (key === "ArrowUp" || key === "k") {
    e.preventDefault();
    if (s.focus === "eq") client.command("nudgeBand", 1);
    else moveCursor(-1);
    return;
  }
  if (key === "h" || key === "ArrowLeft") {
    if (s.focus === "eq") {
      e.preventDefault();
      patchEqBand((s.eqBand + 9) % 10);
      return;
    }
    if (key === "ArrowLeft") {
      e.preventDefault();
      client.command("seekBy", e.shiftKey ? -30 : -5);
    }
    return;
  }
  if (key === "l" || key === "ArrowRight") {
    if (s.focus === "eq") {
      e.preventDefault();
      patchEqBand((s.eqBand + 1) % 10);
      return;
    }
    if (key === "ArrowRight") {
      e.preventDefault();
      client.command("seekBy", e.shiftKey ? 30 : 5);
    }
    return;
  }
  if (key === "+" || key === "=") {
    client.command("setVolumeDb", s.volumeDb + 1);
    return;
  }
  if (key === "-" || key === "_") {
    client.command("setVolumeDb", s.volumeDb - 1);
    return;
  }
  if (key === "]") {
    client.command("setSpeed", s.speed + 0.25);
    return;
  }
  if (key === "[") {
    client.command("setSpeed", s.speed - 0.25);
    return;
  }
  if (key === ">" || key === ".") {
    client.command("next");
    return;
  }
  if (key === "<" || key === ",") {
    client.command("prev");
    return;
  }
  if (key === "Tab") {
    e.preventDefault();
    client.command("cycleFocus");
    return;
  }
  if (key === "e") {
    client.command("cycleEq");
    return;
  }
  if (key === "z") {
    client.command("toggleShuffle");
    return;
  }
  if (key === "r" && !e.shiftKey && !e.ctrlKey) {
    client.command("cycleRepeat");
    return;
  }
  if (key === "t" && !e.shiftKey) {
    openPicker("theme", THEME_NAMES, s.theme, (name) => client.command("setTheme", name), "THEME");
    return;
  }
  if (key === "v" && !e.shiftKey && !e.ctrlKey) {
    {
      const modes = VIS_MODES;
      const next = modes[(modes.indexOf(s.visualizer) + 1) % modes.length];
      client.command("cycleVisualizer");
      toast(next);
    }
    return;
  }
  if (key === "V") {
    openPicker("vis", VIS_MODES, s.visualizer, (name) => client.command("setVisualizer", name), "VISUALIZER");
    return;
  }
  if (key === "f") {
    const t = s.playlist[s.cursor];
    client.command("toggleFavorite", t);
    toast("Favorite toggled");
    return;
  }
  if (key === "R") {
    e.preventDefault();
    openRadio();
    return;
  }
  if (key === "N") {
    openCountries();
    return;
  }
  if (key === "u") {
    openOverlay({ kind: "url", query: "" });
    return;
  }
  if (key === "o") {
    fileInput.click();
    return;
  }
  if (key === "/") {
    e.preventDefault();
    openOverlay({
      kind: "filter",
      title: "FILTER PLAYLIST",
      query: "",
      items: s.playlist.map((t, i) => ({ label: t.title, index: i })),
      cursor: 0,
      onQuery(q) {
        const qn = q.toLowerCase();
        overlay.items = s.playlist
          .map((t, i) => ({ label: t.title, index: i }))
          .filter((it) => it.label.toLowerCase().includes(qn));
        overlay.cursor = 0;
        overlay._bound = false;
        renderOverlay();
      },
      onPick(item) {
        closeOverlay();
        patchCursor(item.index);
        client.command("playIndex", item.index);
      },
    });
    return;
  }
  if (key === "y") {
    const track = s.playlist[s.index];
    openOverlay({ kind: "lyrics", hint: track?.title || "", body: "Looking up…" });
    const text = await lyricsFor(track);
    if (overlay?.kind === "lyrics") {
      overlay.body = text;
      renderOverlay();
    }
    return;
  }
  if (key === "n") {
    client.command("loadFavorites");
    toast("Favorites");
    return;
  }
  if (key === "H") {
    client.command("loadHistory");
    toast("History");
    return;
  }
  if (key === "x") {
    client.command("removeAt", s.cursor);
    return;
  }
  if (key === "1" && !e.ctrlKey) {
    client.command("setPlaylist", featuredTracks());
    toast("Featured radio");
    return;
  }
  if (e.ctrlKey && key === "g") {
    client.command("toggleHelpBar");
  }
});

function updateMediaSession(state) {
  if (!("mediaSession" in navigator)) return;
  const track = state.playlist[state.index];
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track?.title || "broamp",
    artist: "broamp",
    album: track?.tags || "Radio",
  });
  navigator.mediaSession.playbackState = state.status === "playing" ? "playing" : "paused";
}

if ("mediaSession" in navigator) {
  navigator.mediaSession.setActionHandler("play", () => client.command("toggle"));
  navigator.mediaSession.setActionHandler("pause", () => client.command("toggle"));
  navigator.mediaSession.setActionHandler("previoustrack", () => client.command("prev"));
  navigator.mediaSession.setActionHandler("nexttrack", () => client.command("next"));
}

document.addEventListener("click", () => {
  if (!isExtension() && client.state.status === "stopped" && !window.__booted) {
    window.__booted = true;
  }
});

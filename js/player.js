import { PlayerCore, isExtension, defaultState, SLEEP_PRESETS, FADE_MS, trackKey } from "./core.js";
import { applyTheme, THEME_NAMES, THEMES } from "./themes.js";
import { searchStations, topStations, stationsByCountry, featuredTracks, loadFromUrl, REGIONS } from "./radio.js";

class ExtensionBridge {
  constructor() {
    this.state = defaultState();
    this.listeners = new Set();
    this.port = chrome.runtime.connect({ name: "ui" });
    this.port.onMessage.addListener((msg) => {
      if (msg?.type === "state") {
        this.state = msg.state;
        for (const fn of this.listeners) fn(this.state, msg.kind);
      }
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

  isFavorite(track) {
    const key = trackKey(track);
    return this.state.favorites?.some((f) => trackKey(f) === key);
  }

  noteFor(track) {
    const key = trackKey(track);
    return key ? this.state.notes?.[key] || null : null;
  }
}

function wrapLocal(core) {
  return {
    state: core.state,
    subscribe(fn) {
      return core.subscribe((s, kind) => {
        this.state = s;
        fn(s, kind);
      });
    },
    command(name, ...args) {
      if (typeof core[name] === "function") return core[name](...args);
    },
    isFavorite(track) {
      return core.isFavorite(track);
    },
    noteFor(track) {
      return core.noteFor(track);
    },
  };
}

const overlayEl = document.getElementById("overlay");
const toastEl = document.getElementById("toast");
const listEl = document.getElementById("list");
const fileInput = document.getElementById("file-input");
const filterEl = document.getElementById("station-filter");

let overlay = null;
let toastTimer = 0;
let listFilter = "";

function toast(text) {
  toastEl.textContent = text;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1400);
}

function closeOverlay() {
  overlay = null;
  overlayEl.classList.remove("open");
  overlayEl.innerHTML = "";
}

function openOverlay(next) {
  overlay = next;
  overlay._shell = null;
  overlay._bound = false;
  overlayEl.classList.add("open");
  renderOverlay();
  const field = overlayEl.querySelector("input, textarea");
  if (field) {
    field.focus();
    if (overlay.query != null && field.tagName === "INPUT") field.value = overlay.query;
  }
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

function fmtSleep(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function noteText(track) {
  return client.noteFor(track)?.text || "";
}

function renderOverlay() {
  if (!overlay) return;
  const { kind, title, hint, query = "", body } = overlay;
  if (kind === "help") {
    overlayEl.innerHTML = `<h2>Keys</h2>
      <div class="keys">
        <span>Space</span><span>Play / pause</span>
        <span>Enter</span><span>Play cursor</span>
        <span>↑ ↓</span><span>Move list</span>
        <span>x</span><span>Hide station</span>
        <span>m</span><span>Edit note</span>
        <span>f</span><span>Favorite</span>
        <span>R</span><span>Tune</span>
        <span>N</span><span>Country</span>
        <span>S</span><span>Sleep</span>
        <span>?</span><span>This help</span>
      </div>
      <div class="hint" style="margin-top:10px">Esc closes</div>`;
    return;
  }
  if (kind === "memo") {
    overlayEl.innerHTML = `<h2>Station note</h2>
      <div class="hint">${escapeHtml(overlay.track?.title || "")}</div>
      <textarea id="memo-text" rows="4" placeholder="e.g. Night work, few vocals">${escapeHtml(body || "")}</textarea>
      <div class="overlay-actions">
        <button type="button" class="primary" data-memo="save">Save</button>
        <button type="button" data-memo="clear">Clear</button>
        <button type="button" data-memo="cancel">Close</button>
      </div>`;
    overlayEl.querySelectorAll("[data-memo]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const act = btn.dataset.memo;
        if (act === "cancel") {
          closeOverlay();
          return;
        }
        const text = act === "clear" ? "" : overlayEl.querySelector("#memo-text")?.value || "";
        client.command("setStationNote", overlay.track, text);
        closeOverlay();
        toast(text.trim() ? "Note saved" : "Note cleared");
      });
    });
    return;
  }
  if (kind === "url") {
    overlayEl.innerHTML = `<h2>Open URL</h2>
      <div class="hint">Stream or M3U / PLS</div>
      <input type="text" placeholder="https://…" value="${escapeAttr(query)}" />`;
    bindOverlayInput();
    return;
  }
  overlayEl.innerHTML = `<h2>${escapeHtml(title || kind.toUpperCase())}</h2>
    <div class="hint">${escapeHtml(hint || "↑↓ move · Enter select · Esc close")}</div>
    ${kind === "radio" ? `<input id="overlay-search" type="search" placeholder="Search…" value="${escapeAttr(query)}" />` : ""}
    <div class="results" id="overlay-results"></div>`;
  bindOverlayInput();
  renderOverlayResults();
}

function renderOverlayResults() {
  if (!overlay) return;
  const box = overlayEl.querySelector("#overlay-results");
  if (!box) return;
  const { items = [], cursor = 0, loading, error } = overlay;
  if (loading) box.innerHTML = `<div class="empty">Loading…</div>`;
  else if (error) box.innerHTML = `<div class="empty err">ERR: ${escapeHtml(error)}</div>`;
  else if (!items.length) box.innerHTML = `<div class="empty">Nothing here.</div>`;
  else {
    box.innerHTML = items
      .map((it, i) => {
        const sub = it.sub ? `<span>${escapeHtml(it.sub)}</span>` : "";
        return `<div class="item ${i === cursor ? "on" : ""}" data-i="${i}"><b>${escapeHtml(it.label)}</b>${sub}</div>`;
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
}

function bindOverlayInput() {
  const input = overlayEl.querySelector("#overlay-search") || overlayEl.querySelector("input[type='text']");
  if (!input || overlay._bound) return;
  overlay._bound = true;
  input.addEventListener("input", () => {
    overlay.query = input.value;
    if (!overlay.onQuery) {
      renderOverlayResults();
      return;
    }
    clearTimeout(overlay._searchTimer);
    if (!overlay.items?.length) {
      overlay.loading = true;
      renderOverlayResults();
    }
    overlay._searchTimer = setTimeout(() => overlay.onQuery(overlay.query), 280);
  });
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
      toast(err.message || "Load failed");
    }
    return;
  }
  if (overlay.kind === "memo") return;
  const item = overlay.items?.[overlay.cursor];
  if (!item) return;
  if (overlay.onPick) await overlay.onPick(item, overlay.cursor);
}

const surface = new URLSearchParams(location.search).get("surface") || "page";
if (surface === "popup" || surface === "window") document.body.classList.add("compact");
if (surface === "window") document.body.classList.add("windowed");

const localCore = isExtension() ? null : new PlayerCore();
const client = isExtension() ? new ExtensionBridge() : wrapLocal(localCore);

if (!isExtension()) localCore.hydrate();

applyTheme(client.state.theme);

client.subscribe((state, kind) => {
  applyTheme(state.theme);
  if (kind === "time" || kind === "sleep" || kind === "meta") renderChrome(state);
  else render(state);
});

function statusCopy(state) {
  if (state.status === "error") return `Error: ${state.error || "can't play"}`;
  if (state.status === "buffering") return "Tuning…";
  if (state.status === "playing") return state.live ? "On air" : "Playing";
  if (state.status === "paused") return "Paused";
  return "Stopped";
}

function renderChrome(state) {
  const track = state.playlist[state.index];
  document.getElementById("source-label").textContent = track?.kind === "file" ? "File" : "Radio";
  document.getElementById("now-kicker").textContent = statusCopy(state);
  document.getElementById("track-title").textContent = track?.title || "Pick a station";
  const song = document.getElementById("song-title");
  const title = state.songTitle;
  if (title) {
    song.textContent = title;
    song.classList.remove("empty");
  } else {
    song.textContent = state.status === "playing" || state.status === "buffering" ? "Waiting for title…" : "No title yet";
    song.classList.add("empty");
  }
  const note = noteText(track);
  const noteEl = document.getElementById("now-note");
  noteEl.textContent = note || "Tap to add a note";
  noteEl.classList.toggle("empty", !note);
  document.getElementById("btn-play").textContent = state.status === "playing" ? "❚❚" : "▶";
  const vol = document.getElementById("vol-slider");
  if (document.activeElement !== vol) vol.value = String(state.volume ?? 80);
  updateSleepClock(state);
}

function render(state) {
  renderChrome(state);
  renderSleepChips(state);
  renderThemes(state);
  renderList(state);
}

function updateSleepClock(state) {
  const remaining = state.sleepEndsAt ? state.sleepRemainingMs || Math.max(0, state.sleepEndsAt - Date.now()) : 0;
  const fading = Boolean(state.sleepEndsAt) && remaining <= FADE_MS;
  const label = document.getElementById("sleep-label");
  const hint = document.getElementById("sleep-hint");
  if (label) {
    label.textContent = state.sleepEndsAt ? `Sleep  ${fmtSleep(remaining)}` : "Sleep";
    label.classList.toggle("counting", Boolean(state.sleepEndsAt));
    label.classList.toggle("fading", fading);
  }
  if (hint) {
    const mode = !state.sleepEndsAt ? "idle" : fading ? "fade" : "on";
    if (hint.dataset.mode !== mode) {
      hint.dataset.mode = mode;
      if (mode === "idle") hint.textContent = "Fade in last 15s";
      else if (mode === "fade") hint.innerHTML = `<button type="button" class="hint-cancel" data-sleep="off">Fading · cancel</button>`;
      else hint.innerHTML = `<button type="button" class="hint-cancel" data-sleep="off">Cancel</button>`;
    }
  }
}

function renderSleepChips(state) {
  const el = document.getElementById("sleep-line");
  const sig = String(state.sleepMinutes ?? "off");
  if (el.dataset.sig === sig && el.childElementCount) return;
  el.dataset.sig = sig;
  el.innerHTML = SLEEP_PRESETS.map((mins) => {
    const on = state.sleepMinutes === mins ? "on" : "";
    return `<button type="button" class="chip ${on}" data-sleep="${mins}">${mins}</button>`;
  }).join("");
}

function renderThemes(state) {
  const el = document.getElementById("theme-dots");
  el.innerHTML = THEME_NAMES.map((name) => {
    const bg = THEMES[name].accent;
    return `<button type="button" class="theme-dot ${state.theme === name ? "on" : ""}" data-theme="${name}" style="background:${bg}" title="${name}"></button>`;
  }).join("");
}

function renderList(state) {
  const q = listFilter.trim().toLowerCase();
  const rows = state.playlist
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => {
      if (!q) return true;
      const memo = noteText(t).toLowerCase();
      return t.title.toLowerCase().includes(q) || memo.includes(q);
    });
  const hiddenN = state.hidden?.length || 0;
  if (!state.playlist.length) {
    listEl.innerHTML = `<div class="empty">No stations.
      ${hiddenN ? `<div><button type="button" id="unhide-all">Show ${hiddenN} hidden</button></div>` : "Tune, country, URL, or a file."}</div>`;
    document.getElementById("unhide-all")?.addEventListener("click", () => client.command("unhideAll"));
    return;
  }
  if (!rows.length) {
    listEl.innerHTML = `<div class="empty">No match for “${escapeHtml(listFilter)}”.</div>`;
    return;
  }
  listEl.innerHTML = rows
    .map(({ t, i }) => {
      const playing = i === state.index ? "is-playing" : "";
      const cur = i === state.cursor ? "is-cursor" : "";
      const memo = noteText(t);
      const star = client.isFavorite(t) ? "★" : "☆";
      return `<div class="track ${playing} ${cur}" data-i="${i}">
        <div>
          <div class="name">${escapeHtml(t.title)}</div>
          <div class="memo ${memo ? "" : "none"}">${escapeHtml(memo || "No note")}</div>
        </div>
        <div class="track-side">
          <button type="button" class="mini" data-fav="${i}" title="Favorite">${star}</button>
          <button type="button" class="mini" data-memo="${i}" title="Note">note</button>
          <button type="button" class="mini hide" data-hide="${i}" title="Hide">x</button>
        </div>
      </div>`;
    })
    .join("");
  listEl.querySelectorAll(".track").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-fav],[data-memo],[data-hide]")) return;
      const i = Number(el.dataset.i);
      client.command("statePatch", { cursor: i });
      client.command("playIndex", i);
    });
  });
  listEl.querySelectorAll("[data-fav]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      client.command("toggleFavorite", state.playlist[Number(btn.dataset.fav)]);
    });
  });
  listEl.querySelectorAll("[data-memo]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openMemo(state.playlist[Number(btn.dataset.memo)]);
    });
  });
  listEl.querySelectorAll("[data-hide]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      client.command("hideStation", Number(btn.dataset.hide));
    });
  });
}

function openMemo(track) {
  if (!track) return;
  openOverlay({ kind: "memo", track, body: noteText(track) });
}

function playPicked(track) {
  client.command("unhideKey", trackKey(track));
  client.command("unlock");
  return client.command("setPlaylist", [track, ...client.state.playlist.filter((t) => t.url !== track.url)]);
}

function openRadio(seed = "") {
  openOverlay({
    kind: "radio",
    title: "Tune",
    hint: "Enter to play · a to append. Notes show under known stations.",
    query: seed,
    items: [],
    cursor: 0,
    loading: true,
    async onQuery(q) {
      const seq = (overlay._seq = (overlay._seq || 0) + 1);
      if (!overlay.items?.length) {
        overlay.loading = true;
        renderOverlayResults();
      }
      try {
        const tracks = q.trim() ? await searchStations({ name: q.trim(), limit: 50 }) : await topStations(40);
        if (overlay?.kind !== "radio" || seq !== overlay._seq) return;
        overlay.loading = false;
        overlay.error = "";
        overlay.items = tracks.map((t) => ({
          label: t.title,
          sub: [noteText(t), t.country, t.bitrate ? `${t.bitrate}k` : ""].filter(Boolean).join(" · "),
          track: t,
        }));
        overlay.cursor = 0;
        renderOverlayResults();
      } catch (err) {
        if (overlay?.kind !== "radio" || seq !== overlay._seq) return;
        overlay.loading = false;
        overlay.error = err.message;
        renderOverlayResults();
      }
    },
    async onPick(item) {
      closeOverlay();
      await playPicked(item.track);
    },
  });
  overlay.onQuery(seed);
}

function openCountries() {
  openOverlay({
    kind: "countries",
    title: "Country",
    hint: "Load stations from a country.",
    items: REGIONS.map((r) => ({ label: r.name, sub: r.code, code: r.code })),
    cursor: 0,
    async onPick(item) {
      overlay.loading = true;
      renderOverlayResults();
      try {
        const tracks = await stationsByCountry(item.code, 60);
        closeOverlay();
        if (!tracks.length) {
          toast("No stations");
          return;
        }
        const keep = ["playing", "buffering", "paused"].includes(client.state.status);
        await client.command("setPlaylist", tracks, { play: !keep });
        toast(keep ? `${item.code} · still playing` : `${item.code} · ${tracks.length}`);
      } catch (err) {
        overlay.loading = false;
        overlay.error = err.message;
        renderOverlayResults();
      }
    },
  });
}

function openSleepPicker() {
  const current = client.state.sleepMinutes;
  const names = [...SLEEP_PRESETS.map(String), "off"];
  openOverlay({
    kind: "sleep",
    title: "Sleep timer",
    hint: "Stops playback. Last ~15 seconds fade, then a voice says The time is up.",
    items: names.map((name) => ({
      label: name === "off" ? "Off" : `${name} min`,
      value: name,
    })),
    cursor: Math.max(0, names.indexOf(current != null ? String(current) : "off")),
    async onPick(item) {
      closeOverlay();
      if (item.value === "off") client.command("clearSleepTimer");
      else client.command("setSleepTimer", Number(item.value));
    },
  });
}

function openNoted() {
  const tracks = Object.values(client.state.notes || {})
    .filter((n) => n?.url)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (!tracks.length) {
    toast("No notes yet");
    return;
  }
  openOverlay({
    kind: "notes",
    title: "Noted stations",
    hint: "Pick a station you already described.",
    items: tracks.map((n) => ({
      label: n.title,
      sub: n.text,
      track: { id: n.id, title: n.title, url: n.url, kind: n.kind || "radio" },
    })),
    cursor: 0,
    async onPick(item) {
      closeOverlay();
      await playPicked(item.track);
    },
  });
}

document.getElementById("track-title").addEventListener("click", () => client.command("toggle"));
document.getElementById("now-note").addEventListener("click", () => {
  openMemo(client.state.playlist[client.state.index]);
});
document.getElementById("btn-play").addEventListener("click", () => client.command("toggle"));
document.getElementById("btn-prev").addEventListener("click", () => client.command("prev"));
document.getElementById("btn-next").addEventListener("click", () => client.command("next"));
document.getElementById("vol-slider").addEventListener("input", (e) => {
  client.command("setVolume", Number(e.target.value));
});

document.querySelector(".now-card").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-sleep]");
  if (!btn) return;
  const value = btn.dataset.sleep;
  if (value === "off") client.command("clearSleepTimer");
  else client.command("setSleepTimer", Number(value));
});

document.getElementById("theme-dots").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-theme]");
  if (btn) client.command("setTheme", btn.dataset.theme);
});

document.querySelector(".toolbar-btns").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === "radio") openRadio();
  if (act === "country") openCountries();
  if (act === "fav") {
    if (!client.state.favorites?.length) toast("No favorites yet");
    else client.command("loadFavorites");
  }
  if (act === "notes") openNoted();
  if (act === "url") openOverlay({ kind: "url", query: "" });
  if (act === "file") fileInput.click();
});

filterEl.addEventListener("input", () => {
  listFilter = filterEl.value;
  renderList(client.state);
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
    if (overlay.kind === "memo") {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        const text = overlayEl.querySelector("#memo-text")?.value || "";
        client.command("setStationNote", overlay.track, text);
        closeOverlay();
        toast("Note saved");
      }
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
    if (e.key === "ArrowDown") {
      e.preventDefault();
      overlay.cursor = Math.min((overlay.items?.length || 1) - 1, (overlay.cursor || 0) + 1);
      renderOverlayResults();
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      overlay.cursor = Math.max(0, (overlay.cursor || 0) - 1);
      renderOverlayResults();
    }
    if (e.key === "Enter") {
      e.preventDefault();
      await activateOverlay();
    }
    if (e.key === "a" && overlay.kind === "radio" && overlay.items?.[overlay.cursor]) {
      e.preventDefault();
      const t = overlay.items[overlay.cursor].track;
      client.command("unhideKey", trackKey(t));
      await client.command("appendTracks", [t]);
      toast("Added");
    }
    return;
  }

  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;

  const s = client.state;
  const key = e.key;

  if (key === "?") {
    e.preventDefault();
    openOverlay({ kind: "help" });
    return;
  }
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
  if (key === "ArrowDown") {
    e.preventDefault();
    client.command("statePatch", { cursor: Math.min(s.playlist.length - 1, s.cursor + 1) });
    return;
  }
  if (key === "ArrowUp") {
    e.preventDefault();
    client.command("statePatch", { cursor: Math.max(0, s.cursor - 1) });
    return;
  }
  if (key === "ArrowRight") {
    client.command("next");
    return;
  }
  if (key === "ArrowLeft") {
    client.command("prev");
    return;
  }
  if (key === "m") {
    openMemo(s.playlist[s.cursor] || s.playlist[s.index]);
    return;
  }
  if (key === "f") {
    client.command("toggleFavorite", s.playlist[s.cursor]);
    toast("Favorite updated");
    return;
  }
  if (key === "S") {
    openSleepPicker();
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
  if (key === "n") {
    if (!s.favorites?.length) toast("No favorites yet");
    else client.command("loadFavorites");
    return;
  }
  if (key === "M") {
    openNoted();
    return;
  }
  if (key === "t") {
    client.command("cycleTheme");
    return;
  }
  if (key === "x") {
    client.command("hideStation", s.cursor);
    return;
  }
  if (key === "1" && !e.ctrlKey) {
    client.command("setPlaylist", featuredTracks());
    toast("Featured");
  }
});

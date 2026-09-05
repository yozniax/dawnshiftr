import { PlayerCore, isExtension, defaultState, SLEEP_PRESETS, FADE_MS, trackKey } from "./core.js";
import { searchStations, stationsByCountry, featuredTracks, REGIONS } from "./radio.js";
import { attachEqVis } from "./eq-vis.js";

class ExtensionBridge {
  constructor() {
    this.state = defaultState();
    this.listeners = new Set();
    this.port = chrome.runtime.connect({ name: "ui" });
    this.port.onMessage.addListener((msg) => {
      if (msg?.type === "analyser") {
        analyserBins = msg.bins || null;
        return;
      }
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
const paneSearchEl = document.getElementById("pane-search");

let overlay = null;
let toastTimer = 0;
let analyserBins = null;
let pane = "index";
let stationsQuery = "";
let stationsItems = [];
let stationsLoading = false;
let stationsError = "";
let stationsSeq = 0;
let historyQuery = "";
let countryStations = null;
let countryLoading = false;
let countryError = "";
let countryCode = "";

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
  overlayEl.classList.add("open");
  renderOverlay();
  const field = overlayEl.querySelector("input, textarea");
  if (field) field.focus();
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

function noteText(track) {
  return client.noteFor(track)?.text || "";
}

function typingInField() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") {
    const type = String(el.getAttribute("type") || "text").toLowerCase();
    return !["button", "submit", "checkbox", "radio", "file", "range", "color", "hidden"].includes(type);
  }
  return Boolean(el.isContentEditable);
}

function renderOverlay() {
  if (!overlay) return;
  const { kind, body } = overlay;
  if (kind === "help") {
    overlayEl.innerHTML = `<h2>Keys</h2>
      <div class="keys">
        <span>Space</span><span>Play / pause</span>
        <span>Enter</span><span>Play cursor</span>
        <span>↑ ↓</span><span>Move list</span>
        <span>x</span><span>Delete / hide</span>
        <span>m</span><span>Note</span>
        <span>f</span><span>Fav</span>
        <span>R</span><span>Stations</span>
        <span>H</span><span>History</span>
        <span>N</span><span>Countries</span>
        <span>n</span><span>Fav pane</span>
        <span>Esc</span><span>Index</span>
        <span>S</span><span>Sleep</span>
        <span>?</span><span>This help</span>
      </div>
      <div class="hint" style="margin-top:10px">Esc closes</div>`;
    return;
  }
  overlayEl.innerHTML = `<h2>Station note</h2>
    <div class="hint">${escapeHtml(overlay.track?.title || "")}</div>
    <textarea id="memo-text" rows="4" placeholder="E.G. NIGHT WORK, FEW VOCALS">${escapeHtml(body || "")}</textarea>
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
}

const surface = new URLSearchParams(location.search).get("surface") || "page";
if (surface === "popup" || surface === "window") document.body.classList.add("compact");
if (surface === "window") document.body.classList.add("windowed");

const localCore = isExtension() ? null : new PlayerCore();
const client = isExtension() ? new ExtensionBridge() : wrapLocal(localCore);

if (!isExtension()) {
  Promise.resolve(localCore.hydrate()).then(() => {
    listEl.focus();
    listEl.querySelector(".track.is-cursor")?.scrollIntoView({ block: "nearest" });
  });
} else {
  listEl.focus();
}

attachEqVis(
  document.getElementById("eq-vis"),
  (n) => {
    if (localCore?.engine?.getSpectrum) return localCore.engine.getSpectrum(n);
    return analyserBins || [];
  },
  () => client.state.status === "playing"
);

client.subscribe((state, kind) => {
  if (kind === "time" || kind === "sleep" || kind === "meta" || kind === "status") {
    renderChrome(state);
    if (pane === "index") updatePlayingHighlight(state);
    else highlightPlayingKeys(state);
    return;
  }
  render(state);
});

function statusCopy(state) {
  if (state.status === "error") return `ERROR: ${state.error || "CAN'T PLAY"}`;
  if (state.status === "buffering") return "TUNING…";
  if (state.status === "playing") return state.live ? "ON AIR" : "PLAYING";
  if (state.status === "paused") return "PAUSED";
  return "STOPPED";
}

function renderChrome(state) {
  const track = state.playlist[state.index];
  const kicker = document.getElementById("now-kicker");
  kicker.textContent = statusCopy(state);
  kicker.classList.toggle("on-air", state.status === "playing" && state.live);
  document.getElementById("track-title").textContent = track?.title || "PICK A STATION";
  const song = document.getElementById("song-title");
  const title = String(state.songTitle || "").trim();
  song.hidden = false;
  song.textContent = title || "\u00a0";
  song.classList.toggle("empty", !title);
  const note = noteText(track);
  const noteEl = document.getElementById("now-note");
  noteEl.hidden = !note;
  noteEl.textContent = note;
  document.getElementById("btn-play").textContent = state.status === "playing" ? "❚❚" : "▶";
  const vol = document.getElementById("vol-slider");
  if (document.activeElement !== vol) vol.value = String(state.volume ?? 80);
  updateSleepClock(state);
}

function render(state) {
  renderChrome(state);
  renderSleepChips(state);
  renderPane(state);
}

function formatSleepRemain(ms) {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function updateSleepClock(state) {
  const remaining = state.sleepEndsAt ? state.sleepRemainingMs || Math.max(0, state.sleepEndsAt - Date.now()) : 0;
  const fading = Boolean(state.sleepEndsAt) && remaining <= FADE_MS;
  const label = document.getElementById("sleep-label");
  if (!label) return;
  if (state.sleepEndsAt) label.textContent = `SLEEPING IN ${formatSleepRemain(remaining)}`;
  else label.textContent = "SLEEP";
  label.classList.toggle("counting", Boolean(state.sleepEndsAt));
  label.classList.toggle("fading", fading);
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

function playingKey(state) {
  return trackKey(state.playlist[state.index]);
}

function updatePlayingHighlight(state) {
  listEl.querySelectorAll(".track").forEach((el) => {
    const i = Number(el.dataset.i);
    el.classList.toggle("is-playing", i === state.index);
    el.classList.toggle("is-cursor", i === state.cursor);
  });
  listEl.querySelector(".track.is-cursor")?.scrollIntoView({ block: "nearest" });
}

function highlightPlayingKeys(state) {
  const key = playingKey(state);
  listEl.querySelectorAll(".track").forEach((el) => {
    el.classList.toggle("is-playing", el.dataset.key === key);
  });
}

function setPane(next) {
  if (pane === next && next === "countries" && countryStations) {
    countryStations = null;
    countryCode = "";
    countryError = "";
    renderPane(client.state);
    return;
  }
  pane = next;
  if (pane === "countries") {
    countryStations = null;
    countryCode = "";
    countryError = "";
  }
  renderPane(client.state);
  if (pane === "stations" || pane === "history") paneSearchEl.focus();
  else listEl.focus();
}

function renderPane(state) {
  document.querySelectorAll("[data-pane]").forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.pane === pane);
  });
  const searchable = pane === "stations" || pane === "history";
  paneSearchEl.hidden = !searchable;
  if (pane === "stations") {
    paneSearchEl.placeholder = "SEARCH STATIONS…";
    if (paneSearchEl.value !== stationsQuery) paneSearchEl.value = stationsQuery;
    renderStations();
  } else if (pane === "history") {
    paneSearchEl.placeholder = "SEARCH HISTORY…";
    if (paneSearchEl.value !== historyQuery) paneSearchEl.value = historyQuery;
    renderHistory();
  } else if (pane === "countries") renderCountries();
  else if (pane === "fav") renderFav(state);
  else renderIndex(state);
}

function listSignature(state) {
  return state.playlist.map((t) => `${trackKey(t)}\u0001${client.isFavorite(t) ? 1 : 0}\u0001${noteText(t)}`).join("\n");
}

function stationRow(t, i, { history = false, queue = false } = {}) {
  const memo = noteText(t);
  const fav = client.isFavorite(t);
  const playing = trackKey(t) === playingKey(client.state) ? "is-playing" : "";
  const cur = queue && i === client.state.cursor ? "is-cursor" : "";
  const del = queue
    ? `<button type="button" class="mini hide" data-hide="${i}">DELETE</button>`
    : `<button type="button" class="mini hide" data-row-act="delete">DELETE</button>`;
  return `<div class="track ${playing} ${cur}" data-i="${i}" data-key="${escapeAttr(trackKey(t))}">
    <div>
      <div class="name">${escapeHtml(t.title)}</div>
      <div class="memo ${memo ? "" : "none"}">${escapeHtml([t.country, memo || "No note"].filter(Boolean).join(" · "))}</div>
    </div>
    <div class="track-side">
      <button type="button" class="mini ${fav ? "on" : ""}" data-row-act="fav">FAV</button>
      <button type="button" class="mini" data-row-act="note">NOTE</button>
      ${del}
    </div>
  </div>`;
}

function bindStationRows(tracks, { history = false, queue = false } = {}) {
  listEl.querySelectorAll(".track").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-row-act],[data-hide],[data-fav],[data-memo]")) return;
      const i = Number(el.dataset.i);
      const track = tracks[i];
      if (queue) client.command("playIndex", i);
      else if (track) {
        const qi = client.state.playlist.findIndex((t) => trackKey(t) === trackKey(track));
        if (qi >= 0) client.command("playIndex", qi);
        else playPicked(track);
      }
    });
  });
  listEl.querySelectorAll("[data-row-act]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const i = Number(btn.closest(".track")?.dataset.i);
      const track = tracks[i];
      if (!track) return;
      const act = btn.dataset.rowAct;
      if (act === "fav") client.command("toggleFavorite", track);
      else if (act === "note") openMemo(track);
      else if (act === "delete") {
        if (history) {
          await client.command("removeHistory", track);
          renderHistory();
        } else if (pane === "fav") {
          client.command("toggleFavorite", track);
        } else {
          const qi = client.state.playlist.findIndex((t) => trackKey(t) === trackKey(track));
          if (qi >= 0) client.command("hideStation", qi);
        }
      }
    });
  });
  listEl.querySelectorAll("[data-hide]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      client.command("hideStation", Number(btn.dataset.hide));
    });
  });
}

function renderIndex(state) {
  const sig = `index\n${listSignature(state)}`;
  if (listEl.dataset.sig === sig && listEl.querySelector(".track")) {
    updatePlayingHighlight(state);
    return;
  }
  listEl.dataset.sig = sig;
  const hiddenN = state.hidden?.length || 0;
  if (!state.playlist.length) {
    listEl.innerHTML = `<div class="empty">No stations.
      ${hiddenN ? `<div><button type="button" id="unhide-all">Show ${hiddenN} hidden</button></div>` : "Stations or countries."}</div>`;
    document.getElementById("unhide-all")?.addEventListener("click", () => client.command("unhideAll"));
    return;
  }
  listEl.innerHTML = state.playlist.map((t, i) => stationRow(t, i, { queue: true })).join("");
  bindStationRows(state.playlist, { queue: true });
  listEl.querySelector(".track.is-cursor")?.scrollIntoView({ block: "nearest" });
}

function renderFav(state) {
  const tracks = state.favorites || [];
  const sig = `fav\n${tracks.map((t) => `${trackKey(t)}\u0001${noteText(t)}`).join("\n")}`;
  listEl.dataset.sig = sig;
  if (!tracks.length) {
    listEl.innerHTML = `<div class="empty">No favorites yet.</div>`;
    return;
  }
  listEl.innerHTML = tracks.map((t, i) => stationRow(t, i)).join("");
  bindStationRows(tracks);
}

function historyItems() {
  return (client.state.history || []).map((t) => t);
}

function historyHaystack(t) {
  return [t.title, t.country, noteText(t)].filter(Boolean).join(" ").toLowerCase();
}

function renderStations() {
  const q = stationsQuery.trim();
  if (stationsLoading) {
    listEl.dataset.sig = "stations-loading";
    listEl.innerHTML = `<div class="empty">LOADING…</div>`;
    return;
  }
  if (stationsError) {
    listEl.dataset.sig = "stations-err";
    listEl.innerHTML = `<div class="empty err">ERR: ${escapeHtml(stationsError)}</div>`;
    return;
  }
  const tracks = q ? stationsItems : [];
  const sig = `stations\n${q}\n${tracks.map((t) => `${trackKey(t)}\u0001${client.isFavorite(t) ? 1 : 0}\u0001${noteText(t)}`).join("\n")}`;
  listEl.dataset.sig = sig;
  if (!tracks.length) {
    listEl.innerHTML = `<div class="empty">${q ? "NOTHING HERE." : "TYPE TO SEARCH ALL STATIONS."}</div>`;
    return;
  }
  listEl.innerHTML = tracks.map((t, i) => stationRow(t, i)).join("");
  bindStationRows(tracks);
}

async function searchStationsPane(q) {
  const seq = ++stationsSeq;
  const text = q.trim();
  stationsQuery = q;
  if (!text) {
    stationsLoading = false;
    stationsError = "";
    stationsItems = [];
    if (pane === "stations") renderStations();
    return;
  }
  stationsLoading = true;
  if (pane === "stations") renderStations();
  try {
    const tracks = await searchStations({ name: text, limit: 50 });
    if (seq !== stationsSeq) return;
    stationsLoading = false;
    stationsError = "";
    stationsItems = tracks;
    if (pane === "stations") renderStations();
  } catch (err) {
    if (seq !== stationsSeq) return;
    stationsLoading = false;
    stationsError = err.message || "search failed";
    if (pane === "stations") renderStations();
  }
}

function renderHistory() {
  const q = historyQuery.trim().toLowerCase();
  const tracks = historyItems().filter((t) => !q || historyHaystack(t).includes(q));
  const sig = `history\n${q}\n${tracks.map((t) => `${trackKey(t)}\u0001${client.isFavorite(t) ? 1 : 0}\u0001${noteText(t)}`).join("\n")}`;
  listEl.dataset.sig = sig;
  if (!historyItems().length) {
    listEl.innerHTML = `<div class="empty">NO HISTORY YET.</div>`;
    return;
  }
  if (!tracks.length) {
    listEl.innerHTML = `<div class="empty">NO MATCH.</div>`;
    return;
  }
  listEl.innerHTML = tracks.map((t, i) => stationRow(t, i, { history: true })).join("");
  bindStationRows(tracks, { history: true });
}

function renderCountries() {
  if (countryLoading) {
    listEl.dataset.sig = "countries-loading";
    listEl.innerHTML = `<div class="empty">LOADING…</div>`;
    return;
  }
  if (countryError) {
    listEl.dataset.sig = "countries-err";
    listEl.innerHTML = `<div class="empty err">ERR: ${escapeHtml(countryError)}</div>`;
    return;
  }
  if (countryStations) {
    const sig = `countries\n${countryCode}\n${countryStations.map((t) => `${trackKey(t)}\u0001${client.isFavorite(t) ? 1 : 0}\u0001${noteText(t)}`).join("\n")}`;
    listEl.dataset.sig = sig;
    if (!countryStations.length) {
      listEl.innerHTML = `<div class="empty">No stations.</div>`;
      return;
    }
    listEl.innerHTML = countryStations.map((t, i) => stationRow(t, i)).join("");
    bindStationRows(countryStations);
    return;
  }
  listEl.dataset.sig = "countries";
  listEl.innerHTML = REGIONS.map(
    (r, i) => `<div class="track" data-i="${i}" data-code="${r.code}">
      <div>
        <div class="name">${escapeHtml(r.name)}</div>
        <div class="memo">${r.code}</div>
      </div>
    </div>`
  ).join("");
  listEl.querySelectorAll(".track").forEach((el) => {
    el.addEventListener("click", () => loadCountry(el.dataset.code));
  });
}

async function loadCountry(code) {
  countryLoading = true;
  countryError = "";
  countryCode = code;
  renderCountries();
  try {
    const tracks = await stationsByCountry(code, 60);
    countryLoading = false;
    if (!tracks.length) {
      countryStations = [];
      toast("No stations");
      renderCountries();
      return;
    }
    countryStations = tracks;
    const keep = isTuned();
    await queueTracks(tracks);
    toast(keep ? `${code} · still playing` : `${code} · ${tracks.length}`);
    renderCountries();
  } catch (err) {
    countryLoading = false;
    countryError = err.message || "load failed";
    renderCountries();
  }
}

function openMemo(track) {
  if (!track) return;
  openOverlay({ kind: "memo", track, body: noteText(track) });
}

function isTuned() {
  return ["playing", "buffering", "paused"].includes(client.state.status);
}

function playPicked(track) {
  client.command("unhideKey", trackKey(track));
  client.command("unlock");
  return client.command("setPlaylist", [track, ...client.state.playlist.filter((t) => t.url !== track.url)]);
}

function queueTracks(tracks) {
  const keep = isTuned();
  return client.command("setPlaylist", tracks, { play: !keep });
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

document.getElementById("sleep-label").addEventListener("click", () => {
  if (client.state.sleepEndsAt) client.command("clearSleepTimer");
});

document.querySelector(".now-card").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-sleep]");
  if (!btn) return;
  const value = btn.dataset.sleep;
  if (value === "off") client.command("clearSleepTimer");
  else client.command("setSleepTimer", Number(value));
});

document.querySelector(".toolbar-btns").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-pane]");
  if (!btn) return;
  setPane(btn.dataset.pane);
});

let searchTimer = 0;
paneSearchEl.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const q = paneSearchEl.value;
  if (pane === "history") {
    historyQuery = q;
    renderHistory();
    return;
  }
  if (pane !== "stations") return;
  if (!q.trim()) {
    searchStationsPane("");
    return;
  }
  searchTimer = setTimeout(() => searchStationsPane(q), 280);
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
    return;
  }

  if (e.key === "Escape" && pane !== "index") {
    e.preventDefault();
    setPane("index");
    return;
  }

  if (typingInField()) return;

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
    if (pane === "index") client.command("playIndex", s.cursor);
    return;
  }
  if (key === "s" && !e.shiftKey) {
    client.command("stop");
    return;
  }
  if (key === "ArrowDown") {
    e.preventDefault();
    if (pane === "index") client.command("statePatch", { cursor: Math.min(s.playlist.length - 1, s.cursor + 1) });
    return;
  }
  if (key === "ArrowUp") {
    e.preventDefault();
    if (pane === "index") client.command("statePatch", { cursor: Math.max(0, s.cursor - 1) });
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
    client.command("setSleepTimer", 10);
    return;
  }
  if (key === "R") {
    e.preventDefault();
    setPane("stations");
    return;
  }
  if (key === "H") {
    e.preventDefault();
    setPane("history");
    return;
  }
  if (key === "N") {
    setPane("countries");
    return;
  }
  if (key === "n") {
    setPane("fav");
    return;
  }
  if (key === "x") {
    if (pane === "index") client.command("hideStation", s.cursor);
    return;
  }
  if (key === "1" && !e.ctrlKey) {
    setPane("index");
    client.command("setPlaylist", featuredTracks());
    toast("Featured");
  }
});

import { PlayerCore, isExtension, defaultState, SLEEP_PRESETS, trackKey, sleepChipLabel } from "./core.js";
import { searchStations, stationsByCountry, popularStations, POPULAR_HEADING, POPULAR_LIMIT, REGIONS } from "./radio.js";
import { attachEqVis } from "./eq-vis.js";
import { isEnabled, setEnabled } from "./telemetry.js";
import { sleepClock, isPomodoro } from "./sleep.js";
import { mergeTracks, trackHaystack as haystackOf, tracksForPane, scrollChildIntoContainer, stepCursor } from "./tracks.js";

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
let pane = "fav";
let stationsQuery = "";
let stationsItems = [];
let stationsLoading = false;
let stationsError = "";
let stationsSeq = 0;
let popularItems = [];
let popularTried = false;
let historyQuery = "";
let favQuery = "";
let countryQuery = "";
let countryStations = null;
let countryLoading = false;
let countryError = "";
let countryCode = "";
let browseCursor = 0;

function toast(text) {
  toastEl.textContent = text;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1400);
}

function closeOverlay() {
  overlay = null;
  overlayEl.classList.remove("open", "modal");
  overlayEl.innerHTML = "";
}

function openOverlay(next) {
  overlay = next;
  overlayEl.classList.add("open");
  overlayEl.classList.toggle("modal", next.kind === "help" || next.kind === "memo");
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
    overlayEl.innerHTML = `<div class="modal-card" role="dialog" aria-label="Shortcuts">
      <h2>Keybind</h2>
      <div class="keys">
        <span>Space</span><span>Play / pause</span>
        <span>Enter</span><span>Play highlighted</span>
        <span>↑ ↓</span><span>Move cursor</span>
        <span>F</span><span>Fav highlighted</span>
        <span>N</span><span>Note highlighted</span>
        <span>X / D</span><span>Delete highlighted</span>
        <span>- / =</span><span>Volume down / up</span>
        <span>S / Shift+S</span><span>Stations tab</span>
        <span>P</span><span>Pomodoro (25 min)</span>
        <span>Shift+F</span><span>Fav tab</span>
        <span>Shift+H</span><span>History tab</span>
        <span>Shift+C</span><span>Countries tab</span>
        <span>Esc</span><span>Fav / close</span>
      </div>
      <div class="hint stats-line">
        <button type="button" id="btn-stats">Usage stats: …</button>
        <a href="privacy.html" target="_blank" rel="noopener noreferrer">Privacy</a>
      </div>
      <div class="hint">Esc closes</div>
    </div>`;
    const statsBtn = overlayEl.querySelector("#btn-stats");
    const paintStats = (on) => {
      statsBtn.textContent = on ? "Usage stats: on" : "Usage stats: off";
    };
    void isEnabled().then(paintStats);
    statsBtn.addEventListener("click", async () => {
      const next = !(await isEnabled());
      await setEnabled(next);
      paintStats(next);
      toast(next ? "Usage stats on" : "Usage stats off");
    });
    return;
  }
  overlayEl.innerHTML = `<div class="modal-card" role="dialog" aria-label="Station note">
    <h2>Note</h2>
    <div class="hint">${escapeHtml(overlay.track?.title || "")}</div>
    <textarea id="memo-text" rows="1" placeholder="E.G. NIGHT WORK, FEW VOCALS">${escapeHtml(body || "")}</textarea>
    <div class="overlay-actions">
      <button type="button" class="primary" data-memo="save">Save</button>
      <button type="button" data-memo="clear">Clear</button>
      <button type="button" data-memo="cancel">Close</button>
    </div>
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
    scrollChildIntoContainer(listEl, listEl.querySelector(".track.is-cursor"));
  });
} else {
  listEl.focus();
}

attachEqVis(
  document.getElementById("eq-vis"),
  (n) => {
    const eng = localCore?.engine;
    if (eng?.ctx?.state === "suspended") void eng.ctx.resume();
    if (eng?.getSpectrum) return eng.getSpectrum(n);
    return analyserBins || [];
  },
  () => {
    const s = client.state.status;
    return s === "playing" || client.state.playing || (s === "buffering" && !!client.state.air);
  }
);

client.subscribe((state, kind) => {
  if (kind === "cursor") {
    highlightPlayingKeys(state);
    return;
  }
  if (kind === "time" || kind === "sleep" || kind === "meta" || kind === "status") {
    renderChrome(state);
    highlightPlayingKeys(state);
    return;
  }
  render(state);
});

function isOnAir(state) {
  return state.status === "playing" || (state.status === "buffering" && !!state.air);
}

function renderChrome(state) {
  const track = state.air || state.playlist[state.index];
  const title = document.getElementById("track-title");
  title.textContent = track?.title || "PICK A STATION";
  title.classList.toggle("is-on", isOnAir(state));
  const song = document.getElementById("song-title");
  song.textContent = String(state.songTitle || "").trim();
  const noteEl = document.getElementById("now-note");
  const note = noteText(track);
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

function updateSleepClock(state) {
  const clock = sleepClock(state);
  const label = document.getElementById("sleep-label");
  if (!label) return;
  label.textContent = clock.text;
  label.classList.toggle("counting", clock.counting);
  label.classList.toggle("fading", clock.fading);
}

function renderSleepChips(state) {
  const el = document.getElementById("sleep-line");
  const sig = String(state.sleepMinutes ?? "off");
  if (el.dataset.sig === sig && el.childElementCount) return;
  el.dataset.sig = sig;
  el.innerHTML = SLEEP_PRESETS.map((mins) => {
    const on = state.sleepMinutes === mins ? "on" : "";
    const title = isPomodoro(mins) ? " title=\"POMODORO TECHNIQUE\"" : "";
    return `<button type="button" class="chip ${on}" data-sleep="${mins}"${title}>${sleepChipLabel(mins)}</button>`;
  }).join("");
}

function playingKey(state) {
  return trackKey(state.air || state.playlist[state.index]);
}

function highlightPlayingKeys(state) {
  const key = playingKey(state);
  const on = isOnAir(state);
  listEl.querySelectorAll(".track").forEach((el) => {
    el.classList.toggle("is-playing", on && el.dataset.key === key);
  });
  syncCursor();
}

function paintList(sig, html, after) {
  if (listEl.dataset.sig === sig && listEl.querySelector(".track, .empty, .list-heading")) {
    highlightPlayingKeys(client.state);
    return;
  }
  listEl.dataset.sig = sig;
  listEl.innerHTML = html;
  after?.();
}

function setPane(next, { focusSearch = false } = {}) {
  if (pane === next && next === "countries" && countryStations) {
    countryStations = null;
    countryCode = "";
    countryError = "";
    countryQuery = "";
    browseCursor = 0;
    renderPane(client.state);
    listEl.focus();
    return;
  }
  pane = next;
  browseCursor = 0;
  if (pane === "countries") {
    countryStations = null;
    countryCode = "";
    countryError = "";
  }
  renderPane(client.state);
  if (focusSearch && (pane === "stations" || pane === "history" || pane === "fav" || pane === "countries")) paneSearchEl.focus();
  else listEl.focus();
}

function renderPane(state) {
  document.querySelectorAll("[data-pane]").forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.pane === pane);
  });
  paneSearchEl.hidden = false;
  if (pane === "stations") {
    paneSearchEl.placeholder = "SEARCH STATIONS…";
    if (paneSearchEl.value !== stationsQuery) paneSearchEl.value = stationsQuery;
    if (!stationsQuery.trim() && !popularItems.length) void searchStationsPane("");
    else {
      if (!stationsQuery.trim() && popularItems.length) stationsItems = popularItems;
      renderStations();
    }
  } else if (pane === "history") {
    paneSearchEl.placeholder = "SEARCH HISTORY…";
    if (paneSearchEl.value !== historyQuery) paneSearchEl.value = historyQuery;
    renderHistory();
  } else if (pane === "countries") {
    paneSearchEl.placeholder = countryStations ? "SEARCH STATIONS…" : "SEARCH COUNTRIES…";
    if (paneSearchEl.value !== countryQuery) paneSearchEl.value = countryQuery;
    renderCountries();
  } else {
    paneSearchEl.placeholder = "SEARCH FAV…";
    if (paneSearchEl.value !== favQuery) paneSearchEl.value = favQuery;
    renderFav(state);
  }
}

function trackHaystack(t) {
  return haystackOf(t, noteText(t));
}

function localCatalog() {
  const seen = new Set();
  const out = [];
  const add = (t) => {
    if (!t) return;
    const k = trackKey(t);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(t);
  };
  for (const t of client.state.playlist || []) add(t);
  for (const t of client.state.favorites || []) add(t);
  for (const t of client.state.history || []) add(t);
  for (const n of Object.values(client.state.notes || {})) {
    add({
      id: n.id,
      title: n.title || n.url || "Station",
      url: n.url,
      kind: n.kind || "radio",
    });
  }
  return out;
}

function isHiddenTrack(t) {
  const key = trackKey(t);
  return Boolean(key && client.state.hidden?.includes(key));
}

function stationRow(t, i, { history = false } = {}) {
  const memo = noteText(t);
  const fav = client.isFavorite(t);
  const playing = isOnAir(client.state) && trackKey(t) === playingKey(client.state) ? "is-playing" : "";
  const cur = i === browseCursor ? "is-cursor" : "";
  const del = `<button type="button" class="mini hide" data-row-act="delete">DELETE</button>`;
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

let ignoreActivateUntil = 0;
function holdPlay() {
  ignoreActivateUntil = performance.now() + 500;
}

listEl.addEventListener(
  "pointerdown",
  (e) => {
    if (e.target.closest("[data-row-act],.track-side")) holdPlay();
  },
  true
);
listEl.addEventListener(
  "click",
  (e) => {
    if (e.target.closest("[data-row-act],.track-side")) return;
    if (performance.now() < ignoreActivateUntil) {
      e.preventDefault();
      e.stopPropagation();
    }
  },
  true
);
listEl.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") e.preventDefault();
  },
  true
);

function bindStationRows(tracks, { history = false } = {}) {
  listEl.querySelectorAll(".track").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (performance.now() < ignoreActivateUntil) return;
      if (e.target.closest("[data-row-act],[data-hide],[data-fav],[data-memo],.track-side")) return;
      const i = Number(el.dataset.i);
      const track = tracks[i];
      if (!track) return;
      browseCursor = i;
      highlightPlayingKeys(client.state);
      const qi = client.state.playlist.findIndex((t) => trackKey(t) === trackKey(track));
      if (qi >= 0) {
        client.command("unlock");
        client.command("playIndex", qi, { moveCursor: true });
      } else playPicked(track);
    });
  });
  listEl.querySelectorAll("[data-row-act]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      holdPlay();
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
          client.command("hideTrack", track);
          if (pane === "stations") {
            stationsItems = stationsItems.filter((t) => trackKey(t) !== trackKey(track));
            renderStations();
          } else if (pane === "countries" && countryStations) {
            countryStations = countryStations.filter((t) => trackKey(t) !== trackKey(track));
            renderCountries();
          }
        }
      }
    });
  });
  listEl.querySelectorAll("[data-hide]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      holdPlay();
      client.command("hideStation", Number(btn.dataset.hide));
    });
  });
}

function favTracks() {
  const q = favQuery.trim().toLowerCase();
  return (client.state.favorites || []).filter((t) => !q || trackHaystack(t).includes(q));
}

function renderFav(state) {
  const tracks = favTracks();
  const all = state.favorites || [];
  const sig = `fav\n${favQuery}\n${tracks.map((t) => `${trackKey(t)}\u0001${noteText(t)}`).join("\n")}`;
  if (!all.length) {
    paintList("fav-empty", `<div class="empty">No favorites yet.</div>`);
    return;
  }
  if (!tracks.length) {
    paintList("fav-nomatch", `<div class="empty">NO MATCH.</div>`);
    return;
  }
  paintList(sig, tracks.map((t, i) => stationRow(t, i)).join(""), () => bindStationRows(tracks));
}

function historyItems() {
  return (client.state.history || []).map((t) => t);
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
  const tracks = stationsItems;
  const sig = `stations\n${q}\n${tracks.map((t) => `${trackKey(t)}\u0001${client.isFavorite(t) ? 1 : 0}\u0001${noteText(t)}`).join("\n")}`;
  if (!tracks.length) {
    paintList("stations-empty", `<div class="empty">${q ? "NOTHING HERE." : "TYPE TO SEARCH ALL STATIONS."}</div>`);
    return;
  }
  const heading = !q ? `<div class="list-heading">${POPULAR_HEADING}</div>` : "";
  paintList(sig, heading + tracks.map((t, i) => stationRow(t, i)).join(""), () => bindStationRows(tracks));
}

async function searchStationsPane(q) {
  const seq = ++stationsSeq;
  const text = q.trim();
  stationsQuery = q;
  if (!text) {
    stationsError = "";
    if (popularItems.length) {
      stationsLoading = false;
      stationsItems = popularItems;
      if (pane === "stations") renderStations();
      return;
    }
    if (stationsLoading) return;
    popularTried = true;
    stationsLoading = true;
    stationsItems = [];
    if (pane === "stations") renderStations();
    try {
      const rows = await popularStations(POPULAR_LIMIT);
      if (seq !== stationsSeq) return;
      popularItems = (rows || []).filter((t) => !isHiddenTrack(t)).slice(0, POPULAR_LIMIT);
      stationsLoading = false;
      stationsItems = popularItems;
      stationsError = popularItems.length ? "" : "NO POPULAR STATIONS.";
      if (pane === "stations") renderStations();
    } catch (err) {
      if (seq !== stationsSeq) return;
      popularTried = false;
      stationsLoading = false;
      stationsError = err.message || "popular failed";
      if (pane === "stations") renderStations();
    }
    return;
  }
  stationsLoading = true;
  if (pane === "stations") renderStations();
  try {
    const needle = text.toLowerCase();
    const localHits = localCatalog().filter((t) => trackHaystack(t).includes(needle));
    let remote = [];
    let remoteErr = "";
    try {
      remote = await searchStations({ name: text, limit: 50 });
    } catch (err) {
      remoteErr = err.message || "search failed";
    }
    if (seq !== stationsSeq) return;
    stationsLoading = false;
    stationsItems = mergeTracks(localHits, remote).filter((t) => !isHiddenTrack(t));
    stationsError = stationsItems.length ? "" : remoteErr;
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
  const tracks = historyItems().filter((t) => !q || trackHaystack(t).includes(q));
  const sig = `history\n${q}\n${tracks.map((t) => `${trackKey(t)}\u0001${client.isFavorite(t) ? 1 : 0}\u0001${noteText(t)}`).join("\n")}`;
  if (!historyItems().length) {
    paintList("history-empty", `<div class="empty">NO HISTORY YET.</div>`);
    return;
  }
  if (!tracks.length) {
    paintList("history-nomatch", `<div class="empty">NO MATCH.</div>`);
    return;
  }
  paintList(sig, tracks.map((t, i) => stationRow(t, i, { history: true })).join(""), () => bindStationRows(tracks, { history: true }));
}

function filteredRegions() {
  const q = countryQuery.trim().toLowerCase();
  return REGIONS.filter((r) => !q || `${r.name} ${r.code}`.toLowerCase().includes(q));
}

function countryStationList() {
  const q = countryQuery.trim().toLowerCase();
  return (countryStations || []).filter((t) => !isHiddenTrack(t) && (!q || trackHaystack(t).includes(q)));
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
    const tracks = countryStationList();
    const sig = `countries\n${countryCode}\n${countryQuery}\n${tracks.map((t) => `${trackKey(t)}\u0001${client.isFavorite(t) ? 1 : 0}\u0001${noteText(t)}`).join("\n")}`;
    listEl.dataset.sig = sig;
    if (!countryStations.length) {
      listEl.innerHTML = `<div class="empty">No stations.</div>`;
      return;
    }
    if (!tracks.length) {
      listEl.innerHTML = `<div class="empty">NO MATCH.</div>`;
      return;
    }
    listEl.innerHTML = tracks.map((t, i) => stationRow(t, i)).join("");
    bindStationRows(tracks);
    return;
  }
  const regions = filteredRegions();
  listEl.dataset.sig = `countries\n${countryQuery}`;
  if (!regions.length) {
    listEl.innerHTML = `<div class="empty">NO MATCH.</div>`;
    return;
  }
  listEl.innerHTML = regions.map(
    (r, i) => `<div class="track ${i === browseCursor ? "is-cursor" : ""}" data-i="${i}" data-code="${r.code}">
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
  countryQuery = "";
  browseCursor = 0;
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
    toast(`${code} · ${tracks.length}`);
    renderCountries();
  } catch (err) {
    countryLoading = false;
    countryError = err.message || "load failed";
    renderCountries();
  }
}

function visibleTracks() {
  if (pane === "fav") return favTracks();
  if (pane === "history") {
    const q = historyQuery.trim().toLowerCase();
    return historyItems().filter((t) => !q || trackHaystack(t).includes(q));
  }
  if (pane === "stations") return stationsItems;
  if (pane === "countries" && countryStations) return countryStationList();
  return tracksForPane(pane, {});
}

function highlightedTrack() {
  return visibleTracks()[browseCursor] || null;
}

function cursorGutter() {
  return listEl.querySelector(".list-heading")?.offsetHeight || 0;
}

function syncCursor() {
  const rows = [...listEl.querySelectorAll(".track")];
  if (!rows.length) return null;
  browseCursor = stepCursor(rows.length, browseCursor, 0);
  rows.forEach((el) => el.classList.toggle("is-cursor", Number(el.dataset.i) === browseCursor));
  return rows.find((el) => Number(el.dataset.i) === browseCursor) || rows[browseCursor] || null;
}

function moveBrowse(delta) {
  const rows = [...listEl.querySelectorAll(".track")];
  if (!rows.length) return;
  browseCursor = stepCursor(rows.length, browseCursor, delta);
  scrollChildIntoContainer(listEl, syncCursor(), cursorGutter());
}

function moveCursor(delta) {
  moveBrowse(delta);
}

function activateHighlight() {
  if (pane === "countries" && !countryStations) {
    const row = filteredRegions()[browseCursor];
    if (row) loadCountry(row.code);
    return;
  }
  const track = highlightedTrack();
  if (!track) return;
  const qi = client.state.playlist.findIndex((t) => trackKey(t) === trackKey(track));
  if (qi >= 0) client.command("playIndex", qi, { moveCursor: true });
  else playPicked(track);
  listEl.focus();
}

function favHighlight() {
  const track = highlightedTrack();
  if (!track) return;
  client.command("toggleFavorite", track);
  toast("Favorite updated");
}

function noteHighlight() {
  const track = highlightedTrack();
  if (track) openMemo(track);
}

function deleteHighlight() {
  const track = highlightedTrack();
  if (!track) return;
  if (pane === "history") {
    client.command("removeHistory", track);
    browseCursor = Math.max(0, browseCursor - 1);
    renderHistory();
    return;
  }
  if (pane === "fav") {
    client.command("toggleFavorite", track);
    return;
  }
  client.command("hideTrack", track);
  if (pane === "stations") {
    stationsItems = stationsItems.filter((t) => trackKey(t) !== trackKey(track));
    renderStations();
  } else if (pane === "countries") {
    if (countryStations) {
      countryStations = countryStations.filter((t) => trackKey(t) !== trackKey(track));
      renderCountries();
    }
  }
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

document.addEventListener("pointerdown", () => client.command("unlock"), true);
document.addEventListener("keydown", () => client.command("unlock"), true);
document.getElementById("track-title").addEventListener("click", () => client.command("toggle"));
document.getElementById("now-note").addEventListener("click", () => {
  openMemo(client.state.air || client.state.playlist[client.state.index]);
});
document.getElementById("btn-play").addEventListener("click", () => client.command("toggle"));
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
  browseCursor = 0;
  if (pane === "history") {
    historyQuery = q;
    renderHistory();
    return;
  }
  if (pane === "fav") {
    favQuery = q;
    renderFav(client.state);
    return;
  }
  if (pane === "countries") {
    countryQuery = q;
    renderCountries();
    return;
  }
  if (pane !== "stations") return;
  if (!q.trim()) {
    searchStationsPane("");
    return;
  }
  searchTimer = setTimeout(() => searchStationsPane(q), 280);
});

document.getElementById("btn-help").addEventListener("click", () => openOverlay({ kind: "help" }));
overlayEl.addEventListener("click", (e) => {
  if (overlayEl.classList.contains("modal") && e.target === overlayEl) closeOverlay();
});

document.addEventListener(
  "keydown",
  (e) => {
    if (overlay || typingInField()) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") e.preventDefault();
  },
  true
);

document.addEventListener("keydown", async (e) => {
  if (overlay) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeOverlay();
      return;
    }
    if (overlay.kind === "memo") {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const text = overlayEl.querySelector("#memo-text")?.value || "";
        client.command("setStationNote", overlay.track, text);
        closeOverlay();
        toast(text.trim() ? "Note saved" : "Note cleared");
      }
      return;
    }
    return;
  }

  if (e.key === "Escape") {
    if (pane === "countries" && countryStations) {
      e.preventDefault();
      countryStations = null;
      countryCode = "";
      countryError = "";
      countryQuery = "";
      browseCursor = 0;
      renderPane(client.state);
      listEl.focus();
      return;
    }
    if (pane !== "fav") {
      e.preventDefault();
      setPane("fav");
      return;
    }
  }

  if (typingInField()) return;

  if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
    const tabs = {
      KeyF: "fav",
      KeyS: "stations",
      KeyH: "history",
      KeyC: "countries",
    };
    const next = tabs[e.code];
    if (next) {
      e.preventDefault();
      setPane(next);
      return;
    }
  }

  const key = e.key;

  if (key === "?") {
    e.preventDefault();
    openOverlay({ kind: "help" });
    return;
  }
  if (key === " ") {
    e.preventDefault();
    client.command("unlock");
    client.command("toggle");
    return;
  }
  if (key === "Enter") {
    e.preventDefault();
    activateHighlight();
    return;
  }
  if (e.code === "KeyS" && !e.shiftKey) {
    e.preventDefault();
    setPane("stations");
    return;
  }
  if (e.code === "KeyP" && !e.shiftKey) {
    e.preventDefault();
    client.command("setSleepTimer", 25);
    toast("Pomodoro");
    return;
  }
  if (key === "-" || key === "_" || e.code === "Minus" || e.code === "NumpadSubtract" || e.code === "BracketLeft") {
    e.preventDefault();
    client.command("nudgeVolume", -5);
    return;
  }
  if (key === "=" || key === "+" || e.code === "Equal" || e.code === "NumpadAdd" || e.code === "BracketRight") {
    e.preventDefault();
    client.command("nudgeVolume", 5);
    return;
  }
  if (key === "ArrowDown") {
    e.preventDefault();
    moveCursor(1);
    return;
  }
  if (key === "ArrowUp") {
    e.preventDefault();
    moveCursor(-1);
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
  if (e.code === "KeyN" || e.code === "KeyM") {
    e.preventDefault();
    noteHighlight();
    return;
  }
  if (e.code === "KeyF" && !e.shiftKey) {
    e.preventDefault();
    favHighlight();
    return;
  }
  if (e.code === "KeyX" || e.code === "KeyD" || key === "Delete" || key === "Backspace") {
    e.preventDefault();
    deleteHighlight();
    return;
  }
});

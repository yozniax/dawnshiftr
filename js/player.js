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

let overlay = null;
let toastTimer = 0;
let analyserBins = null;

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
  const { kind, title, hint, query = "", body } = overlay;
  if (kind === "help") {
    overlayEl.innerHTML = `<h2>Keys</h2>
      <div class="keys">
        <span>Space</span><span>Play / pause</span>
        <span>Enter</span><span>Play cursor</span>
        <span>↑ ↓</span><span>Move list</span>
        <span>x</span><span>Delete / hide</span>
        <span>m</span><span>Note</span>
        <span>f</span><span>Fav</span>
        <span>R</span><span>Tunes</span>
        <span>N</span><span>Countries</span>
        <span>S</span><span>Sleep</span>
        <span>?</span><span>This help</span>
      </div>
      <div class="hint" style="margin-top:10px">Esc closes</div>`;
    return;
  }
  if (kind === "memo") {
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
    return;
  }
  overlayEl.innerHTML = `<h2>${escapeHtml(title || kind.toUpperCase())}</h2>
    <div class="hint">${escapeHtml(hint || "↑↓ move · Enter select · Esc close")}</div>
    ${kind === "radio" ? `<input id="overlay-search" type="search" placeholder="SEARCH…" value="${escapeAttr(query)}" />` : ""}
    <div class="results" id="overlay-results"></div>`;
  bindOverlayInput();
  renderOverlayResults();
}

function stationActionButtons(track, { history = false } = {}) {
  const fav = client.isFavorite(track);
  return `<button type="button" class="mini ${fav ? "on" : ""}" data-row-act="fav">FAV</button>
    <button type="button" class="mini" data-row-act="note">NOTE</button>
    ${history ? `<button type="button" class="mini hide" data-row-act="delete">DELETE</button>` : ""}`;
}

function refreshTunesOverlay() {
  if (overlay?.kind !== "radio") return;
  if (!String(overlay.query || "").trim()) overlay.items = historyItems();
  renderOverlayResults();
}

function renderOverlayResults() {
  if (!overlay) return;
  const box = overlayEl.querySelector("#overlay-results");
  if (!box) return;
  const { items = [], cursor = 0, loading, error } = overlay;
  if (loading) {
    box.innerHTML = `<div class="empty">LOADING…</div>`;
    return;
  }
  if (error) {
    box.innerHTML = `<div class="empty err">ERR: ${escapeHtml(error)}</div>`;
    return;
  }
  if (!items.length) {
    const empty =
      overlay.kind === "radio" && !String(overlay.query || "").trim()
        ? "TYPE TO SEARCH ALL STATIONS."
        : "NOTHING HERE.";
    box.innerHTML = `<div class="empty">${empty}</div>`;
    return;
  }
  box.innerHTML = items
    .map((it, i) => {
      const sub = it.sub ? `<span>${escapeHtml(it.sub)}</span>` : "";
      const actions = it.track
        ? `<div class="track-side">${stationActionButtons(it.track, { history: Boolean(it.history) })}</div>`
        : "";
      return `<div class="item ${i === cursor ? "on" : ""}" data-i="${i}">
        <div class="item-main"><b>${escapeHtml(it.label)}</b>${sub}</div>
        ${actions}
      </div>`;
    })
    .join("");
  box.querySelectorAll(".item").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-row-act]")) return;
      overlay.cursor = Number(el.dataset.i);
      activateOverlay();
    });
  });
  box.querySelectorAll("[data-row-act]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const item = overlay.items?.[Number(btn.closest(".item")?.dataset.i)];
      if (!item?.track) return;
      const act = btn.dataset.rowAct;
      if (act === "fav") client.command("toggleFavorite", item.track);
      else if (act === "note") openMemo(item.track);
      else if (act === "delete" && item.history) {
        await client.command("removeHistory", item.track);
        overlay.items = historyItems();
        overlay.cursor = Math.min(overlay.cursor || 0, Math.max(0, overlay.items.length - 1));
        renderOverlayResults();
      }
    });
  });
  box.querySelector(".item.on")?.scrollIntoView({ block: "nearest" });
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
    updatePlayingHighlight(state);
    return;
  }
  render(state);
  refreshTunesOverlay();
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
  document.getElementById("source-label").textContent = "RADIO";
  document.getElementById("now-kicker").textContent = statusCopy(state);
  document.getElementById("track-title").textContent = track?.title || "PICK A STATION";
  const song = document.getElementById("song-title");
  const title = state.songTitle;
  if (title) {
    song.textContent = title;
    song.classList.remove("empty");
  } else {
    song.textContent = state.status === "playing" || state.status === "buffering" ? "WAITING FOR TITLE…" : "NO TITLE YET";
    song.classList.add("empty");
  }
  const note = noteText(track);
  const noteEl = document.getElementById("now-note");
  noteEl.textContent = note || "NO NOTE";
  noteEl.classList.toggle("empty", !note);
  document.getElementById("btn-play").textContent = state.status === "playing" ? "❚❚" : "▶";
  const vol = document.getElementById("vol-slider");
  if (document.activeElement !== vol) vol.value = String(state.volume ?? 80);
  updateSleepClock(state);
}

function render(state) {
  renderChrome(state);
  renderSleepChips(state);
  renderList(state);
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
  if (state.sleepEndsAt) {
    label.textContent = `SLEEPING IN ${formatSleepRemain(remaining)}`;
  } else {
    label.textContent = "SLEEP";
  }
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

function listSignature(state) {
  return state.playlist.map((t) => `${trackKey(t)}\u0001${client.isFavorite(t) ? 1 : 0}\u0001${noteText(t)}`).join("\n");
}

function updatePlayingHighlight(state) {
  listEl.querySelectorAll(".track").forEach((el) => {
    const i = Number(el.dataset.i);
    el.classList.toggle("is-playing", i === state.index);
    el.classList.toggle("is-cursor", i === state.cursor);
  });
}

function renderList(state) {
  const sig = listSignature(state);
  if (listEl.dataset.sig === sig && listEl.querySelector(".track")) {
    updatePlayingHighlight(state);
    return;
  }
  listEl.dataset.sig = sig;
  const rows = state.playlist.map((t, i) => ({ t, i }));
  const hiddenN = state.hidden?.length || 0;
  if (!state.playlist.length) {
    listEl.innerHTML = `<div class="empty">No stations.
      ${hiddenN ? `<div><button type="button" id="unhide-all">Show ${hiddenN} hidden</button></div>` : "Tunes or countries."}</div>`;
    document.getElementById("unhide-all")?.addEventListener("click", () => client.command("unhideAll"));
    return;
  }
  listEl.innerHTML = rows
    .map(({ t, i }) => {
      const playing = i === state.index ? "is-playing" : "";
      const cur = i === state.cursor ? "is-cursor" : "";
      const memo = noteText(t);
      const fav = client.isFavorite(t);
      return `<div class="track ${playing} ${cur}" data-i="${i}">
        <div>
          <div class="name">${escapeHtml(t.title)}</div>
          <div class="memo ${memo ? "" : "none"}">${escapeHtml(memo || "No note")}</div>
        </div>
        <div class="track-side">
          <button type="button" class="mini ${fav ? "on" : ""}" data-fav="${i}">FAV</button>
          <button type="button" class="mini" data-memo="${i}">NOTE</button>
          <button type="button" class="mini hide" data-hide="${i}">DELETE</button>
        </div>
      </div>`;
    })
    .join("");
  listEl.querySelectorAll(".track").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-fav],[data-memo],[data-hide]")) return;
      const i = Number(el.dataset.i);
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

function historyItems() {
  return (client.state.history || []).map((t) => ({
    label: t.title,
    sub: [noteText(t), t.country, t.bitrate ? `${t.bitrate}k` : "RECENT"].filter(Boolean).join(" · "),
    track: t,
    history: true,
  }));
}

function showFavorites() {
  if (!client.state.favorites?.length) {
    toast("No favorites yet");
    return;
  }
  const keep = isTuned();
  client.command("loadFavorites");
  toast(keep ? "Favorites · still playing" : "Favorites");
}

function openRadio(seed = "") {
  openOverlay({
    kind: "radio",
    title: "TUNES",
    hint: "HISTORY · TYPE TO SEARCH ALL STATIONS",
    query: seed,
    items: historyItems(),
    cursor: 0,
    loading: false,
    async onQuery(q) {
      const seq = (overlay._seq = (overlay._seq || 0) + 1);
      const text = q.trim();
      if (!text) {
        overlay.loading = false;
        overlay.error = "";
        overlay.items = historyItems();
        overlay.cursor = 0;
        overlay.hint = overlay.items.length
          ? "HISTORY · TYPE TO SEARCH ALL STATIONS"
          : "NO HISTORY YET · TYPE TO SEARCH ALL STATIONS";
        const hint = overlayEl.querySelector(".hint");
        if (hint) hint.textContent = overlay.hint;
        renderOverlayResults();
        return;
      }
      overlay.loading = true;
      renderOverlayResults();
      try {
        const tracks = await searchStations({ name: text, limit: 50 });
        if (overlay?.kind !== "radio" || seq !== overlay._seq) return;
        overlay.loading = false;
        overlay.error = "";
        overlay.items = tracks.map((t) => ({
          label: t.title,
          sub: [noteText(t), t.country, t.bitrate ? `${t.bitrate}k` : ""].filter(Boolean).join(" · "),
          track: t,
          history: false,
        }));
        overlay.cursor = 0;
        const hint = overlayEl.querySelector(".hint");
        if (hint) hint.textContent = "ALL STATIONS";
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
    title: "COUNTRIES",
    hint: "LOAD STATIONS FROM A COUNTRY.",
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
        const keep = isTuned();
        await queueTracks(tracks);
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
    hint: "Stops playback.",
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
  else openSleepPicker();
});

document.querySelector(".now-card").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-sleep]");
  if (!btn) return;
  const value = btn.dataset.sleep;
  if (value === "off") client.command("clearSleepTimer");
  else client.command("setSleepTimer", Number(value));
});

document.querySelector(".toolbar-btns").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === "radio") openRadio();
  if (act === "country") openCountries();
  if (act === "fav") showFavorites();
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
    if (e.key === "ArrowDown") {
      e.preventDefault();
      overlay.cursor = Math.min((overlay.items?.length || 1) - 1, (overlay.cursor || 0) + 1);
      renderOverlayResults();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      overlay.cursor = Math.max(0, (overlay.cursor || 0) - 1);
      renderOverlayResults();
      return;
    }
    if (e.key === "Enter" && e.shiftKey && overlay.kind === "radio" && overlay.items?.[overlay.cursor]) {
      e.preventDefault();
      const t = overlay.items[overlay.cursor].track;
      client.command("unhideKey", trackKey(t));
      await client.command("appendTracks", [t]);
      toast("Added");
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      await activateOverlay();
      return;
    }
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
  if (key === "n") {
    showFavorites();
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

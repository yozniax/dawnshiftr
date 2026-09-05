import { PlayerCore, isExtension, defaultState, SLEEP_PRESETS, FADE_MS, NOISE_PRESETS, trackKey } from "./core.js";
import { applyTheme, THEME_NAMES, THEMES } from "./themes.js";
import { Visualizer } from "./visualizer.js";
import { searchStations, topStations, stationsByCountry, featuredTracks, loadFromUrl, REGIONS } from "./radio.js";

class ExtensionBridge {
  constructor() {
    this.state = defaultState();
    this.listeners = new Set();
    this._analyser = null;
    this.port = chrome.runtime.connect({ name: "ui" });
    this.port.onMessage.addListener((msg) => {
      if (msg?.type === "state") {
        this.state = msg.state;
        for (const fn of this.listeners) fn(this.state, msg.kind);
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
    getAnalyser() {
      return core.getAnalyser();
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

function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60);
  return `${m}:${String(s).padStart(2, "0")}`;
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
  const { kind, title, hint, items = [], cursor = 0, query = "", loading, error, body } = overlay;
  if (kind === "help") {
    overlayEl.innerHTML = `<h2>ショートカット</h2>
      <div class="keys">
        <span>Space</span><span>再生 / 一時停止</span>
        <span>Enter</span><span>カーソルの局を再生</span>
        <span>↑ ↓</span><span>局リストを移動</span>
        <span>m</span><span>この局にメモ</span>
        <span>f</span><span>お気に入り</span>
        <span>R</span><span>ラジオ検索</span>
        <span>N</span><span>国から選局</span>
        <span>S</span><span>スリープ</span>
        <span>w</span><span>ホワイトノイズ</span>
        <span>u</span><span>URL を開く</span>
        <span>o</span><span>ローカルファイル</span>
        <span>?</span><span>この画面</span>
      </div>
      <div class="hint" style="margin-top:10px">Esc で閉じる</div>`;
    return;
  }
  if (kind === "memo") {
    overlayEl.innerHTML = `<h2>局メモ</h2>
      <div class="hint">${escapeHtml(overlay.track?.title || "")}</div>
      <textarea id="memo-text" rows="5" placeholder="例: 夜作業向け。ボーカル少なめ、雨音が混ざる">${escapeHtml(body || "")}</textarea>
      <div class="overlay-actions">
        <button type="button" class="primary" data-memo="save">保存</button>
        <button type="button" data-memo="clear">削除</button>
        <button type="button" data-memo="cancel">閉じる</button>
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
        toast(text.trim() ? "メモを保存しました" : "メモを消しました");
      });
    });
    return;
  }
  if (kind === "url") {
    overlayEl.innerHTML = `<h2>URL を再生</h2>
      <div class="hint">ストリーム、M3U / PLS</div>
      <input type="text" placeholder="https://…" value="${escapeAttr(query)}" />`;
    bindOverlayInput();
    return;
  }
  overlayEl.innerHTML = `<h2>${escapeHtml(title || kind.toUpperCase())}</h2>
    <div class="hint">${escapeHtml(hint || "↑↓ で移動 · Enter で決定 · Esc で閉じる")}</div>
    ${kind === "radio" || kind === "filter" || kind === "theme" ? `<input type="search" placeholder="絞り込み…" value="${escapeAttr(query)}" />` : ""}
    <div class="results" id="overlay-results"></div>`;
  const box = overlayEl.querySelector("#overlay-results");
  if (loading) box.innerHTML = `<div class="empty">読み込み中…</div>`;
  else if (error) box.innerHTML = `<div class="empty err">ERR: ${escapeHtml(error)}</div>`;
  else if (!items.length) box.innerHTML = `<div class="empty">見つかりませんでした。</div>`;
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

async function activateOverlay() {
  if (!overlay) return;
  if (overlay.kind === "url") {
    const raw = overlayEl.querySelector("input")?.value?.trim();
    closeOverlay();
    if (!raw) return;
    try {
      const tracks = await loadFromUrl(raw);
      await client.command("setPlaylist", tracks);
      toast(`${tracks.length} 件を読み込みました`);
    } catch (err) {
      toast(err.message || "読み込みに失敗しました");
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
const vis = new Visualizer(document.getElementById("viz"));
vis.start(
  () => client.getAnalyser(),
  () => client.state.status === "playing"
);

client.subscribe((state, kind) => {
  applyTheme(state.theme);
  if (kind === "time" || kind === "sleep") renderChrome(state);
  else render(state);
});

function statusCopy(state) {
  if (state.status === "error") return `エラー: ${state.error || "再生できません"}`;
  if (state.status === "buffering") return "接続中…";
  if (state.status === "playing") return state.noiseId ? "ノイズ再生中" : state.live ? "配信中" : "再生中";
  if (state.status === "paused") return "一時停止";
  return "停止中";
}

function renderChrome(state) {
  const track = state.playlist[state.index];
  const noise = NOISE_PRESETS.find((p) => p.id === state.noiseId);
  document.getElementById("source-label").textContent = noise ? "Noise" : track?.kind === "file" ? "File" : "Radio";
  document.getElementById("now-kicker").textContent = `${statusCopy(state)}  ·  ${
    state.live ? "LIVE" : `${fmtTime(state.currentTime)} / ${fmtTime(state.duration)}`
  }`;
  document.getElementById("track-title").textContent = noise?.title || track?.title || "局を選んでください";
  const note = noise ? "スリープ用の帯域ノイズ。局の音は止まります。" : noteText(track);
  const noteEl = document.getElementById("now-note");
  noteEl.textContent = note || "メモなし · クリックしてこの局のメモを書く";
  noteEl.classList.toggle("empty", !note);
  document.getElementById("btn-play").textContent = state.status === "playing" ? "❚❚" : "▶";
  const vol = document.getElementById("vol-slider");
  if (document.activeElement !== vol) vol.value = String(state.volume ?? 80);
  renderSleep(state);
}

function render(state) {
  renderChrome(state);
  renderNoise(state);
  renderTone(state);
  renderThemes(state);
  renderList(state);
}

function renderSleep(state) {
  const el = document.getElementById("sleep-line");
  const remaining = state.sleepEndsAt ? state.sleepRemainingMs || Math.max(0, state.sleepEndsAt - Date.now()) : 0;
  const fading = Boolean(state.sleepEndsAt) && remaining <= FADE_MS;
  const chips = SLEEP_PRESETS.map((mins) => {
    const on = state.sleepMinutes === mins ? "on" : "";
    return `<button type="button" class="chip ${on}" data-sleep="${mins}">${mins}</button>`;
  }).join("");
  const remain = state.sleepEndsAt
    ? `<button type="button" class="chip fade" data-sleep="off" title="タイマー解除">${fmtSleep(remaining)}${fading ? " fade" : ""} ×</button>`
    : "";
  el.innerHTML = `${remain}${chips}<span class="chip" style="pointer-events:none;border:0">分</span>`;
  const label = document.getElementById("sleep-label");
  if (label) label.textContent = fading ? "スリープ（フェード中）" : "スリープ";
}

function renderNoise(state) {
  const el = document.getElementById("noise-line");
  el.innerHTML = NOISE_PRESETS.map(
    (p) => `<button type="button" class="chip ${state.noiseId === p.id && state.status === "playing" ? "on" : ""}" data-noise="${p.id}">${p.label}</button>`
  ).join("");
}

function renderTone(state) {
  const t = state.tone || { bass: 0, mid: 0, treble: 0 };
  const box = document.getElementById("tone-line");
  if (box.contains(document.activeElement) && box.querySelector("[data-tone]")) {
    box.querySelectorAll("[data-tone]").forEach((input) => {
      if (document.activeElement !== input) input.value = String(t[input.dataset.tone] ?? 0);
    });
    return;
  }
  const rows = [
    ["bass", "低音", t.bass],
    ["mid", "中音", t.mid],
    ["treble", "高音", t.treble],
  ];
  box.innerHTML = rows
    .map(
      ([id, label, val]) =>
        `<span>${label}</span><input type="range" min="-12" max="12" value="${val}" data-tone="${id}" />`
    )
    .join("");
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
  if (!state.playlist.length) {
    listEl.innerHTML = `<div class="empty">キューは空です。選局、国、URL、ファイルから追加できます。</div>`;
    return;
  }
  if (!rows.length) {
    listEl.innerHTML = `<div class="empty">「${escapeHtml(listFilter)}」に合う局がありません。メモの文言でも検索できます。</div>`;
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
          <div class="memo ${memo ? "" : "none"}">${escapeHtml(memo || "メモなし")}</div>
        </div>
        <div class="track-side">
          <button type="button" class="mini" data-fav="${i}" title="お気に入り">${star}</button>
          <button type="button" class="mini" data-memo="${i}" title="メモ">メモ</button>
        </div>
      </div>`;
    })
    .join("");
  listEl.querySelectorAll(".track").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-fav],[data-memo]")) return;
      const i = Number(el.dataset.i);
      client.command("statePatch", { cursor: i });
      client.command("playIndex", i);
    });
  });
  listEl.querySelectorAll("[data-fav]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const t = state.playlist[Number(btn.dataset.fav)];
      client.command("toggleFavorite", t);
    });
  });
  listEl.querySelectorAll("[data-memo]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openMemo(state.playlist[Number(btn.dataset.memo)]);
    });
  });
  listEl.querySelector(".is-cursor")?.scrollIntoView({ block: "nearest" });
}

function openMemo(track) {
  if (!track) return;
  openOverlay({
    kind: "memo",
    track,
    body: noteText(track),
  });
}

function openRadio(seed = "") {
  openOverlay({
    kind: "radio",
    title: "ラジオを探す",
    hint: "Enter で再生 · a でリストに追加。メモ済みの局は下にメモが出ます。",
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
          sub: [noteText(t), t.country, t.bitrate ? `${t.bitrate}k` : ""].filter(Boolean).join(" · "),
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
      client.command("unlock");
      await client.command("setPlaylist", [item.track, ...client.state.playlist.filter((t) => t.url !== item.track.url)]);
    },
  });
  overlay.onQuery(seed);
}

function openCountries() {
  openOverlay({
    kind: "countries",
    title: "国から選局",
    hint: "国を選ぶとその国の局がリストになります。",
    items: REGIONS.map((r) => ({ label: r.name, sub: r.code, code: r.code })),
    cursor: 0,
    async onPick(item) {
      overlay.loading = true;
      overlay._bound = false;
      renderOverlay();
      try {
        const tracks = await stationsByCountry(item.code, 60);
        closeOverlay();
        if (!tracks.length) {
          toast("局が見つかりませんでした");
          return;
        }
        client.command("unlock");
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

function openSleepPicker() {
  const current = client.state.sleepMinutes;
  const names = [...SLEEP_PRESETS.map(String), "off"];
  openOverlay({
    kind: "sleep",
    title: "スリープタイマー",
    hint: "時間になると止まります。最後の約15秒で音量を下げ、英語の声で The time is up. と知らせます。",
    items: names.map((name) => ({
      label: name === "off" ? "オフ" : `${name} 分`,
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

function openNoisePicker() {
  openOverlay({
    kind: "noise",
    title: "ホワイトノイズ",
    hint: "低域・中域・高域。もう一度押すと止まります。",
    items: NOISE_PRESETS.map((p) => ({
      label: p.title,
      value: p.id,
    })),
    cursor: Math.max(0, NOISE_PRESETS.findIndex((p) => p.id === client.state.noiseId)),
    async onPick(item) {
      closeOverlay();
      client.command("unlock");
      client.command("playNoise", item.value);
    },
  });
}

function openNoted() {
  const tracks = Object.values(client.state.notes || {})
    .filter((n) => n?.url)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (!tracks.length) {
    toast("メモした局はまだありません");
    return;
  }
  openOverlay({
    kind: "notes",
    title: "メモした局",
    hint: "メモを手がかりに選局できます。",
    items: tracks.map((n) => ({
      label: n.title,
      sub: n.text,
      track: { id: n.id, title: n.title, url: n.url, kind: n.kind || "radio" },
    })),
    cursor: 0,
    async onPick(item) {
      closeOverlay();
      client.command("unlock");
      await client.command("setPlaylist", [item.track, ...client.state.playlist.filter((t) => t.url !== item.track.url)]);
    },
  });
}

document.getElementById("track-title").addEventListener("click", () => client.command("toggle"));
document.getElementById("now-note").addEventListener("click", () => {
  if (client.state.noiseId) return;
  openMemo(client.state.playlist[client.state.index]);
});
document.getElementById("btn-play").addEventListener("click", () => client.command("toggle"));
document.getElementById("btn-prev").addEventListener("click", () => client.command("prev"));
document.getElementById("btn-next").addEventListener("click", () => client.command("next"));
document.getElementById("vol-slider").addEventListener("input", (e) => {
  client.command("setVolume", Number(e.target.value));
});

document.getElementById("sleep-line").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-sleep]");
  if (!btn) return;
  const value = btn.dataset.sleep;
  if (value === "off") client.command("clearSleepTimer");
  else client.command("setSleepTimer", Number(value));
});

document.getElementById("noise-line").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-noise]");
  if (!btn) return;
  client.command("unlock");
  client.command("playNoise", btn.dataset.noise);
});

document.getElementById("tone-line").addEventListener("input", (e) => {
  const input = e.target.closest("[data-tone]");
  if (!input) return;
  client.command("setTone", { [input.dataset.tone]: Number(input.value) });
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
    if (!client.state.favorites?.length) toast("お気に入りはまだありません");
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
  toast(`${tracks.length} ファイル`);
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
        toast("メモを保存しました");
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
      overlay._bound = false;
      renderOverlay();
    }
    if (e.key === "ArrowUp") {
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
      toast("リストに追加しました");
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
    const next = Math.min(s.playlist.length - 1, s.cursor + 1);
    client.command("statePatch", { cursor: next });
    return;
  }
  if (key === "ArrowUp") {
    e.preventDefault();
    const next = Math.max(0, s.cursor - 1);
    client.command("statePatch", { cursor: next });
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
    toast("お気に入りを更新しました");
    return;
  }
  if (key === "S") {
    openSleepPicker();
    return;
  }
  if (key === "w") {
    openNoisePicker();
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
    if (!s.favorites?.length) toast("お気に入りはまだありません");
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
    client.command("removeAt", s.cursor);
    return;
  }
  if (key === "1" && !e.ctrlKey) {
    client.command("setPlaylist", featuredTracks());
    toast("おすすめ局");
  }
});

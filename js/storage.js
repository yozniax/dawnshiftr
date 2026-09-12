const KEY = "dawnshiftr-state-v1";
const LEGACY_KEY = "broamp-state-v2";
const VAULT_NS = "dawnshiftr-vault";
const VAULT_URL = "https://www.doyo.be/dawnshiftr-backup";
const VAULT_PATH = "/dawnshiftr-backup";
const VAULT_COUNT = "dnbc";
const VAULT_CHUNK = "dnb";
const CHUNK_SIZE = 3000;
const MAX_CHUNKS = 24;
const VAULT_TTL_SEC = 60 * 60 * 24 * 365 * 5;

function chromeLocal() {
  return globalThis.chrome?.storage?.local;
}

function chromeSync() {
  return globalThis.chrome?.storage?.sync;
}

export function hasUserData(state) {
  if (!state || typeof state !== "object") return false;
  if (Array.isArray(state.favorites) && state.favorites.length) return true;
  if (Array.isArray(state.hidden) && state.hidden.length) return true;
  if (Array.isArray(state.history) && state.history.length) return true;
  if (state.notes && typeof state.notes === "object" && Object.keys(state.notes).length) return true;
  return false;
}

export function pickPersisted(...records) {
  let best = null;
  for (const rec of records) {
    if (!rec || typeof rec !== "object" || Array.isArray(rec)) continue;
    if (!best) {
      best = rec;
      continue;
    }
    const recHas = hasUserData(rec);
    const bestHas = hasUserData(best);
    if (recHas && !bestHas) {
      best = rec;
      continue;
    }
    if (recHas === bestHas && (Number(rec.savedAt) || 0) > (Number(best.savedAt) || 0)) best = rec;
  }
  return best || {};
}

export function compactState(state, { dropHistory = false } = {}) {
  if (!state || typeof state !== "object") return {};
  const notes = {};
  for (const [key, note] of Object.entries(state.notes || {})) {
    if (!note || typeof note !== "object") continue;
    notes[key] = {
      text: String(note.text || "").slice(0, 280),
      title: String(note.title || "").slice(0, 96),
      url: String(note.url || "").slice(0, 512),
      id: String(note.id || "").slice(0, 96),
      kind: note.kind || "radio",
      updatedAt: note.updatedAt || 0,
    };
  }
  const slim = (t) => {
    if (!t || typeof t !== "object") return null;
    const { blob, file, _blobUrl, ...rest } = t;
    return {
      id: rest.id,
      title: rest.title,
      url: rest.url,
      kind: rest.kind || "radio",
      homepage: rest.homepage,
      country: rest.country,
      tags: rest.tags,
    };
  };
  return {
    savedAt: Number(state.savedAt) || Date.now(),
    volume: state.volume,
    favorites: (state.favorites || []).map(slim).filter(Boolean).slice(0, 80),
    notes,
    hidden: (state.hidden || []).filter(Boolean).slice(0, 200),
    history: dropHistory ? [] : (state.history || []).map(slim).filter(Boolean).slice(0, 40),
    playlist: dropHistory ? [] : (state.playlist || []).map(slim).filter(Boolean).slice(0, 40),
    index: state.index,
    sleepMinutes: state.sleepMinutes ?? null,
  };
}

export function utf8ToBase64Url(text) {
  const bytes = new TextEncoder().encode(String(text || ""));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function base64UrlToUtf8(raw) {
  const pad = "=".repeat((4 - (raw.length % 4)) % 4);
  const b64 = String(raw || "")
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .concat(pad);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function encodeVaultChunks(state, chunkSize = CHUNK_SIZE) {
  let packed = compactState(state);
  let chunks = splitChunks(utf8ToBase64Url(JSON.stringify(packed)), chunkSize);
  if (chunks.length > MAX_CHUNKS) {
    packed = compactState(state, { dropHistory: true });
    chunks = splitChunks(utf8ToBase64Url(JSON.stringify(packed)), chunkSize);
  }
  return chunks.slice(0, MAX_CHUNKS);
}

export function decodeVaultChunks(chunks) {
  if (!Array.isArray(chunks) || !chunks.length) return {};
  try {
    const parsed = JSON.parse(base64UrlToUtf8(chunks.join("")));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function splitChunks(text, chunkSize) {
  const out = [];
  for (let i = 0; i < text.length; i += chunkSize) out.push(text.slice(i, i + chunkSize));
  return out;
}

async function readStore(api, keys) {
  if (!api) return {};
  try {
    const bag = await api.get(keys);
    for (const key of keys) {
      const value = bag[key];
      if (value && typeof value === "object") return value;
    }
  } catch {
    /* quota / missing */
  }
  return {};
}

async function readLocal() {
  const api = chromeLocal();
  if (api) return readStore(api, [KEY, LEGACY_KEY]);
  try {
    return JSON.parse(localStorage.getItem(KEY) || localStorage.getItem(LEGACY_KEY) || "{}");
  } catch {
    return {};
  }
}

async function writeLocal(next) {
  const api = chromeLocal();
  if (api) {
    await api.set({ [KEY]: next });
    return;
  }
  localStorage.setItem(KEY, JSON.stringify(next));
}

async function readSync() {
  return readStore(chromeSync(), [KEY]);
}

async function writeSync(next) {
  const api = chromeSync();
  if (!api) return;
  const packed = compactState(next);
  try {
    await api.set({ [KEY]: packed });
  } catch {
    try {
      await api.set({ [KEY]: compactState(next, { dropHistory: true }) });
    } catch {
      /* quota */
    }
  }
}

function cookieApi() {
  return globalThis.chrome?.cookies;
}

export async function writeVaultCookies(state) {
  const api = cookieApi();
  if (!api?.set || !api.remove) return false;
  const chunks = encodeVaultChunks(state);
  const expires = Math.floor(Date.now() / 1000) + VAULT_TTL_SEC;
  const base = {
    url: VAULT_URL,
    path: VAULT_PATH,
    secure: true,
    httpOnly: false,
    sameSite: "strict",
    expirationDate: expires,
  };
  await api.set({ ...base, name: VAULT_COUNT, value: String(chunks.length) });
  for (let i = 0; i < chunks.length; i++) {
    await api.set({ ...base, name: `${VAULT_CHUNK}${i}`, value: chunks[i] });
  }
  const extras = await api.getAll({ url: VAULT_URL });
  await Promise.all(
    (extras || [])
      .filter((c) => {
        const name = c?.name || "";
        if (name === VAULT_COUNT) return false;
        if (!name.startsWith(VAULT_CHUNK)) return false;
        const n = Number(name.slice(VAULT_CHUNK.length));
        return Number.isInteger(n) && n >= chunks.length;
      })
      .map((c) => api.remove({ url: VAULT_URL, name: c.name }))
  );
  return true;
}

export async function readVaultCookies() {
  const api = cookieApi();
  if (!api?.getAll) return {};
  try {
    const all = await api.getAll({ url: VAULT_URL });
    const countCookie = (all || []).find((c) => c.name === VAULT_COUNT);
    const n = Number(countCookie?.value);
    if (!Number.isInteger(n) || n <= 0) return {};
    const chunks = [];
    for (let i = 0; i < n; i++) {
      const hit = (all || []).find((c) => c.name === `${VAULT_CHUNK}${i}`);
      if (!hit?.value) return {};
      chunks.push(hit.value);
    }
    return decodeVaultChunks(chunks);
  } catch {
    return {};
  }
}

function sendVault(msg) {
  return new Promise((resolve) => {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
      resolve(null);
      return;
    }
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        void chrome.runtime.lastError;
        resolve(res || null);
      });
    } catch {
      resolve(null);
    }
  });
}

async function readVault() {
  if (cookieApi()?.getAll) {
    try {
      const data = await readVaultCookies();
      if (data && (hasUserData(data) || data.savedAt)) return data;
    } catch {
      /* offscreen may not allow cookies */
    }
  }
  const res = await sendVault({ ns: VAULT_NS, op: "load" });
  return res?.data && typeof res.data === "object" ? res.data : {};
}

let vaultTimer = 0;
let vaultQueued = null;

function scheduleVault(next, immediate) {
  vaultQueued = next;
  if (immediate) {
    clearTimeout(vaultTimer);
    vaultTimer = 0;
    void replicaVault(next);
    return;
  }
  if (vaultTimer) return;
  vaultTimer = setTimeout(() => {
    vaultTimer = 0;
    const payload = vaultQueued;
    vaultQueued = null;
    if (payload) void replicaVault(payload);
  }, 500);
}

async function replicaVault(next) {
  try {
    if (cookieApi()?.set) {
      await writeVaultCookies(next);
      return;
    }
  } catch {
    /* fall through to the service worker */
  }
  await sendVault({ ns: VAULT_NS, op: "save", data: next });
}

export function handleVaultMessage(msg) {
  if (!msg || msg.ns !== VAULT_NS) return null;
  if (msg.op === "save") return writeVaultCookies(msg.data).then(() => ({ ok: true }));
  if (msg.op === "load") return readVaultCookies().then((data) => ({ data }));
  return null;
}

export async function loadPersisted() {
  const local = await readLocal();
  const synced = await readSync();
  const vault = await readVault();
  const next = pickPersisted(local, synced, vault);
  if (hasUserData(next) && !hasUserData(local)) {
    try {
      await writeLocal(next);
      void writeSync(next);
    } catch {
      /* keep the in-memory restore */
    }
  }
  if (hasUserData(next)) scheduleVault(next, true);
  return next;
}

export async function savePersisted(partial) {
  const prev = await readLocal();
  const next = { ...prev, ...partial, savedAt: Date.now() };
  await writeLocal(next);
  void writeSync(next);
  const urgent = ["favorites", "notes", "hidden", "history", "playlist"].some((key) => key in (partial || {}));
  scheduleVault(next, urgent);
  return next;
}

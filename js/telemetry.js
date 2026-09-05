// REMINDER: ingest + admin dashboard for these events is not built yet.
// Wire TELEMETRY_REMOTE when that receiver exists. Preview uses POST /v1/ingest.

const KEY = "dawnshiftr-telemetry-v1";
const MAX_QUEUE = 80;
const FLUSH_MS = 45_000;
export const TELEMETRY_REMOTE = "https://stats.doyo.be/v1/ingest";

function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `n-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

function chromeStore() {
  return globalThis.chrome?.storage?.local;
}

async function readBag() {
  const api = chromeStore();
  if (api) {
    const bag = await api.get(KEY);
    return bag[KEY] && typeof bag[KEY] === "object" ? bag[KEY] : {};
  }
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

async function writeBag(next) {
  const api = chromeStore();
  if (api) await api.set({ [KEY]: next });
  else localStorage.setItem(KEY, JSON.stringify(next));
}

function hostOf(url) {
  try {
    return new URL(url).host.slice(0, 80);
  } catch {
    return "";
  }
}

export function stationRef(track) {
  if (!track) return null;
  const id = String(track.id || "").slice(0, 96);
  const title = String(track.title || "").slice(0, 96);
  if (!id && !title && !track.url) return null;
  return {
    id: id || title,
    title: title || id,
    kind: track.kind || "radio",
    host: hostOf(track.url),
  };
}

function ingestUrl() {
  if (typeof location !== "undefined" && location.protocol.startsWith("http")) {
    return new URL("/v1/ingest", location.origin).href;
  }
  return TELEMETRY_REMOTE;
}

let bag = {
  enabled: true,
  installId: "",
  queue: [],
  sessions: 0,
  listenMs: 0,
  lastSessionDay: "",
};
let ready = null;
let flushTimer = 0;
let flushing = false;

async function load() {
  if (!ready) {
    ready = (async () => {
      const saved = await readBag();
      bag = {
        enabled: saved.enabled !== false,
        installId: saved.installId || uuid(),
        queue: Array.isArray(saved.queue) ? saved.queue.slice(-MAX_QUEUE) : [],
        sessions: Number(saved.sessions) || 0,
        listenMs: Number(saved.listenMs) || 0,
        lastSessionDay: saved.lastSessionDay || "",
      };
      if (!saved.installId) await writeBag(bag);
    })();
  }
  await ready;
  return bag;
}

async function save() {
  await writeBag({
    enabled: bag.enabled !== false,
    installId: bag.installId,
    queue: bag.queue.slice(-MAX_QUEUE),
    sessions: bag.sessions,
    listenMs: bag.listenMs,
    lastSessionDay: bag.lastSessionDay,
  });
}

function context() {
  let tz = "";
  let locale = "";
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    /* empty */
  }
  try {
    locale = typeof navigator !== "undefined" ? navigator.language || "" : "";
  } catch {
    /* empty */
  }
  return { tz, locale };
}

export async function isEnabled() {
  await load();
  return bag.enabled !== false;
}

export async function setEnabled(on) {
  await load();
  bag.enabled = Boolean(on);
  if (!bag.enabled) bag.queue = [];
  await save();
}

export async function record(type, payload = {}) {
  await load();
  if (bag.enabled === false) return;
  bag.queue.push({ t: Date.now(), type, ...payload });
  if (bag.queue.length > MAX_QUEUE) bag.queue = bag.queue.slice(-MAX_QUEUE);
  await save();
  if (bag.queue.length >= 12) void flush();
}

export async function recordSession() {
  await load();
  if (bag.enabled === false) return;
  const day = new Date().toISOString().slice(0, 10);
  bag.sessions += 1;
  bag.lastSessionDay = day;
  await save();
  await record("session", { n: bag.sessions });
}

export async function recordListen(track, ms) {
  const dur = Math.max(0, Math.round(Number(ms) || 0));
  if (dur < 1000) return;
  const ref = stationRef(track);
  if (!ref) return;
  await load();
  bag.listenMs += dur;
  await save();
  await record("listen", { ...ref, ms: dur });
}

export async function recordFav(track, on) {
  const ref = stationRef(track);
  if (!ref) return;
  await record("fav", { ...ref, on: Boolean(on) });
}

export async function recordFavs(tracks) {
  const items = (tracks || []).map(stationRef).filter(Boolean).slice(0, 40);
  await record("favs", { items });
}

export async function flush() {
  await load();
  if (bag.enabled === false || flushing || !bag.queue.length) return;
  flushing = true;
  const events = bag.queue.slice();
  const body = JSON.stringify({
    v: 1,
    app: "dawnshiftr",
    installId: bag.installId,
    ...context(),
    totals: { sessions: bag.sessions, listenMs: bag.listenMs },
    events,
  });
  try {
    const res = await fetch(ingestUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    });
    if (!res.ok) throw new Error(String(res.status));
    bag.queue = bag.queue.slice(events.length);
    await save();
  } catch {
    /* receiver not live yet — keep the queue */
  } finally {
    flushing = false;
  }
}

export function startTelemetry() {
  void load().then(() => {
    if (flushTimer) return;
    flushTimer = setInterval(() => void flush(), FLUSH_MS);
    const bump = () => void flush();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") bump();
      });
    }
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", bump);
    }
  });
}

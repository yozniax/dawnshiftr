const YT_HOSTS = new Set([
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "youtu.be",
]);

export function parseYouTubeUrl(raw) {
  if (!raw) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  if (!YT_HOSTS.has(host)) return null;
  const listId = u.searchParams.get("list") || "";
  if (host === "youtu.be") {
    const videoId = u.pathname.split("/").filter(Boolean)[0]?.split("?")[0] || "";
    if (!videoId && !listId) return null;
    return { videoId, listId, url: raw };
  }
  if (u.pathname === "/watch") {
    const videoId = u.searchParams.get("v") || "";
    if (!videoId && !listId) return null;
    return { videoId, listId, url: raw };
  }
  if (u.pathname === "/playlist") {
    if (!listId) return null;
    return { videoId: "", listId, url: raw };
  }
  const m = u.pathname.match(/^\/(?:shorts|embed|live|v|tv)\/([^/?]+)/);
  if (m) return { videoId: m[1], listId, url: raw };
  return null;
}

export function youtubeTitle(raw) {
  return String(raw || "")
    .replace(/\s*-\s*YouTube Music\s*$/i, "")
    .replace(/\s*-\s*YouTube\s*$/i, "")
    .trim();
}

export function youtubeTrack(info, title) {
  const videoId = info.videoId || "";
  const listId = info.listId || "";
  const id = videoId ? `yt:${videoId}` : `ytlist:${listId}`;
  return {
    id,
    title: youtubeTitle(title) || "YouTube",
    url: info.url || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : `https://www.youtube.com/playlist?list=${listId}`),
    kind: "youtube",
    videoId,
    listId,
  };
}

function inExtension() {
  return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
}

class Emitter {
  constructor() {
    this.listeners = new Map();
  }

  on(event, fn) {
    const list = this.listeners.get(event) || [];
    list.push(fn);
    this.listeners.set(event, list);
  }

  emit(event, payload) {
    for (const fn of this.listeners.get(event) || []) fn(payload);
  }
}

/** Preview / non-extension: iframe embed. Chrome extension pages cannot play this. */
export class YouTubeIframeEngine extends Emitter {
  constructor() {
    super();
    this.iframe = null;
    this._volume = 80;
    this._wantPlay = false;
    this._origin = typeof location !== "undefined" ? location.origin : "*";
    this._handshakeIv = 0;
    this._onMessage = (e) => this.handleMessage(e);
    if (typeof window !== "undefined") window.addEventListener("message", this._onMessage);
  }

  mount() {
    if (this.iframe) return;
    const iframe = document.createElement("iframe");
    iframe.id = "yt-player";
    iframe.allow = "autoplay; encrypted-media; fullscreen";
    iframe.setAttribute("allowfullscreen", "true");
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    iframe.style.cssText = "position:fixed;left:0;top:0;width:320px;height:180px;opacity:0;pointer-events:none;border:0;z-index:-1";
    iframe.addEventListener("load", () => this.handshake());
    document.body.appendChild(iframe);
    this.iframe = iframe;
  }

  embedSrc(videoId, listId) {
    const params = new URLSearchParams({
      autoplay: "1",
      enablejsapi: "1",
      playsinline: "1",
      rel: "0",
      modestbranding: "1",
      controls: "0",
      fs: "0",
      widget_referrer: "https://www.youtube.com/",
    });
    if (this._origin && this._origin !== "null" && !this._origin.startsWith("chrome-extension:")) {
      params.set("origin", this._origin);
    }
    if (listId) params.set("list", listId);
    const path = videoId || "videoseries";
    return `https://www.youtube.com/embed/${encodeURIComponent(path)}?${params}`;
  }

  handshake() {
    if (!this.iframe?.contentWindow) return;
    this.iframe.contentWindow.postMessage(JSON.stringify({ event: "listening", id: 1 }), "*");
    this.send("addEventListener", ["onReady"]);
    this.send("addEventListener", ["onStateChange"]);
    this.send("addEventListener", ["onError"]);
  }

  startHandshakeLoop() {
    this.stopHandshakeLoop();
    let n = 0;
    this.handshake();
    this._handshakeIv = setInterval(() => {
      n += 1;
      this.handshake();
      if (n > 20) this.stopHandshakeLoop();
    }, 400);
  }

  stopHandshakeLoop() {
    if (this._handshakeIv) {
      clearInterval(this._handshakeIv);
      this._handshakeIv = 0;
    }
  }

  send(func, args = []) {
    this.iframe?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), "*");
  }

  load({ videoId, listId }) {
    this.mount();
    this._wantPlay = true;
    this.emit("status", "buffering");
    this.iframe.src = this.embedSrc(videoId, listId);
    this.startHandshakeLoop();
  }

  play() {
    this._wantPlay = true;
    this.send("playVideo");
  }

  pause() {
    this._wantPlay = false;
    this.send("pauseVideo");
  }

  stop({ silent = false } = {}) {
    this._wantPlay = false;
    this.stopHandshakeLoop();
    try {
      this.send("stopVideo");
    } catch {
      /* empty */
    }
    if (this.iframe) this.iframe.src = "about:blank";
    if (!silent) this.emit("status", "stopped");
  }

  setVolume(n) {
    this._volume = Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
    this.send("setVolume", [this._volume]);
  }

  handleMessage(e) {
    if (!this.iframe || e.source !== this.iframe.contentWindow) return;
    let data = e.data;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        return;
      }
    }
    if (!data || typeof data !== "object") return;
    const event = data.event;
    const info = data.info;
    if (event === "onReady" || event === "initialDelivery") {
      this.stopHandshakeLoop();
      this.send("setVolume", [this._volume]);
      if (this._wantPlay) this.send("playVideo");
      return;
    }
    if (event === "infoDelivery" && info && typeof info === "object") {
      if (typeof info.playerState === "number") this.applyState(info.playerState);
      const title = info.videoData?.title || info.title;
      if (title) this.emit("title", title);
      return;
    }
    if (event === "onStateChange") {
      const state = typeof info === "number" ? info : info?.playerState;
      if (typeof state === "number") this.applyState(state);
    }
    if (event === "onError") this.emit("error", "youtube error");
  }

  applyState(state) {
    if (state === 1) this.emit("status", "playing");
    else if (state === 2) this.emit("status", "paused");
    else if (state === 3) this.emit("status", "buffering");
    else if (state === 0) this.emit("ended");
  }
}

/**
 * Chrome extension: drive the open YouTube tab.
 * Extension pages cannot autoplay a hidden youtube.com iframe (Error 153 / autoplay).
 */
export class YouTubeTabEngine extends Emitter {
  constructor() {
    super();
    this._volume = 80;
    this._wantPlay = false;
    this.tabId = null;
    this._onMessage = (msg, sender) => this.handleRuntimeMessage(msg, sender);
    if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(this._onMessage);
    }
  }

  handleRuntimeMessage(msg, sender) {
    if (msg?.ns !== "dawnshiftr-yt" || !msg.event) return;
    if (this.tabId != null && sender.tab?.id != null && sender.tab.id !== this.tabId) return;
    if (msg.event === "status" && msg.status) this.emit("status", msg.status);
    if (msg.event === "ended") this.emit("ended");
    if (msg.event === "title" && msg.title) this.emit("title", youtubeTitle(msg.title));
  }

  rpc(op, extra = {}) {
    return new Promise((resolve) => {
      if (this.tabId == null || typeof chrome === "undefined" || !chrome.tabs?.sendMessage) {
        resolve(null);
        return;
      }
      chrome.tabs.sendMessage(this.tabId, { ns: "dawnshiftr-yt", op, ...extra }, (res) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(res || null);
      });
    });
  }

  async ensureScript() {
    if (this.tabId == null || typeof chrome === "undefined" || !chrome.scripting?.executeScript) return;
    try {
      await chrome.scripting.executeScript({ target: { tabId: this.tabId }, files: ["js/yt-tab.js"] });
    } catch {
      /* restricted page */
    }
  }

  async resolveTab(info) {
    if (info?.tabId != null) return info.tabId;
    if (typeof chrome === "undefined" || !chrome.tabs?.query) return null;
    const tabs = await chrome.tabs.query({
      url: ["*://*.youtube.com/*", "*://music.youtube.com/*", "*://youtu.be/*"],
    });
    for (const tab of tabs) {
      const parsed = parseYouTubeUrl(tab.url || "");
      if (info?.videoId && parsed?.videoId === info.videoId) return tab.id;
      if (!info?.videoId && info?.listId && parsed?.listId === info.listId) return tab.id;
    }
    if (info?.url) {
      try {
        const created = await chrome.tabs.create({ url: info.url, active: true });
        return created?.id ?? null;
      } catch {
        return null;
      }
    }
    return null;
  }

  async load(info) {
    this._wantPlay = true;
    this.emit("status", info?.alreadyPlaying ? "playing" : "buffering");
    this.tabId = await this.resolveTab(info);
    if (this.tabId == null) {
      this.emit("error", "open the YouTube tab");
      return;
    }
    try {
      await chrome.tabs.update(this.tabId, { muted: false });
    } catch {
      /* ignore */
    }
    await this.ensureScript();
    await this.rpc("volume", { value: this._volume });
    if (!info?.alreadyPlaying) await this.rpc("play", { volume: this._volume });
    let snap = await this.rpc("ping");
    if (!snap?.playing) snap = (await this.rpc("play", { volume: this._volume })) || snap;
    if (snap?.title) this.emit("title", youtubeTitle(snap.title));
    if (snap?.playing || info?.alreadyPlaying) this.emit("status", "playing");
    else if (snap && !snap.hasMedia) this.emit("error", "no video on this tab");
  }

  play() {
    this._wantPlay = true;
    void this.rpc("play", { volume: this._volume }).then((snap) => {
      if (snap?.playing) this.emit("status", "playing");
    });
  }

  pause() {
    this._wantPlay = false;
    void this.rpc("pause");
  }

  stop({ silent = false } = {}) {
    this._wantPlay = false;
    void this.rpc("pause");
    this.tabId = null;
    if (!silent) this.emit("status", "stopped");
  }

  setVolume(n) {
    this._volume = Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
    void this.rpc("volume", { value: this._volume });
  }
}

export class YouTubeEngine {
  constructor() {
    this.impl = inExtension() ? new YouTubeTabEngine() : new YouTubeIframeEngine();
  }

  on(event, fn) {
    return this.impl.on(event, fn);
  }

  load(info) {
    return this.impl.load(info);
  }

  play() {
    return this.impl.play();
  }

  pause() {
    return this.impl.pause();
  }

  stop(opts) {
    return this.impl.stop(opts);
  }

  setVolume(n) {
    return this.impl.setVolume(n);
  }
}

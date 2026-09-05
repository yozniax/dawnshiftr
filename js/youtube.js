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

export class YouTubeEngine {
  constructor() {
    this.iframe = null;
    this._volume = 80;
    this._wantPlay = false;
    this.listeners = new Map();
    this._origin = typeof location !== "undefined" ? location.origin : "*";
    this._onMessage = (e) => this.handleMessage(e);
    if (typeof window !== "undefined") window.addEventListener("message", this._onMessage);
  }

  on(event, fn) {
    const list = this.listeners.get(event) || [];
    list.push(fn);
    this.listeners.set(event, list);
  }

  emit(event, payload) {
    for (const fn of this.listeners.get(event) || []) fn(payload);
  }

  mount() {
    if (this.iframe) return;
    const iframe = document.createElement("iframe");
    iframe.id = "yt-player";
    iframe.allow = "autoplay; encrypted-media; fullscreen";
    iframe.setAttribute("allowfullscreen", "true");
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

  send(func, args = []) {
    this.iframe?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), "*");
  }

  load({ videoId, listId }) {
    this.mount();
    this._wantPlay = true;
    this.emit("status", "buffering");
    this.iframe.src = this.embedSrc(videoId, listId);
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

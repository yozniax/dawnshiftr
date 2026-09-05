(() => {
  if (window.__dawnshiftrYtTab) return;
  window.__dawnshiftrYtTab = true;

  let bound = null;

  function media() {
    return (
      document.querySelector("video.html5-main-video") ||
      document.querySelector("ytmusic-player video") ||
      document.querySelector("video") ||
      document.querySelector("audio")
    );
  }

  function emit(event, extra = {}) {
    try {
      chrome.runtime.sendMessage({ ns: "dawnshiftr-yt", event, ...extra });
    } catch {
      /* extension reloaded */
    }
  }

  function bind(el) {
    if (!el || bound === el) return;
    bound = el;
    el.addEventListener("playing", () => emit("status", { status: "playing" }));
    el.addEventListener("play", () => emit("status", { status: "playing" }));
    el.addEventListener("pause", () => emit("status", { status: "paused" }));
    el.addEventListener("ended", () => emit("ended"));
    el.addEventListener("waiting", () => emit("status", { status: "buffering" }));
  }

  function snapshot() {
    const el = media();
    bind(el);
    return {
      ok: Boolean(el),
      hasMedia: Boolean(el),
      playing: Boolean(el && !el.paused && !el.ended),
      paused: Boolean(el?.paused),
      ended: Boolean(el?.ended),
      volume: el ? Math.round((el.muted ? 0 : el.volume) * 100) : null,
      title: document.title || "",
    };
  }

  function applyVolume(n) {
    const el = media();
    if (!el) return snapshot();
    const v = Math.max(0, Math.min(1, Number(n) / 100));
    el.volume = v;
    el.muted = v <= 0.001;
    return snapshot();
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.ns !== "dawnshiftr-yt" || msg.event) return;
    const el = media();
    bind(el);
    if (msg.op === "ping") {
      sendResponse(snapshot());
      return;
    }
    if (!el) {
      sendResponse({ ok: false, error: "no video" });
      return;
    }
    if (msg.op === "play") {
      if (msg.volume != null) applyVolume(msg.volume);
      el.muted = false;
      const p = el.play();
      if (p && typeof p.then === "function") {
        p.then(() => sendResponse({ ok: true, ...snapshot() })).catch((err) =>
          sendResponse({ ok: false, error: String(err), ...snapshot() }),
        );
        return true;
      }
      sendResponse({ ok: true, ...snapshot() });
      return;
    }
    if (msg.op === "pause" || msg.op === "stop") {
      el.pause();
      sendResponse({ ok: true, ...snapshot() });
      return;
    }
    if (msg.op === "volume") {
      sendResponse({ ok: true, ...applyVolume(msg.value) });
    }
  });

  bind(media());
  const mo = new MutationObserver(() => bind(media()));
  mo.observe(document.documentElement, { childList: true, subtree: true });

  const titleEl = document.querySelector("title");
  if (titleEl) {
    new MutationObserver(() => {
      const title = document.title;
      if (title) emit("title", { title });
    }).observe(titleEl, { childList: true });
  }
})();

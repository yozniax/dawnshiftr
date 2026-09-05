function decodeIcyText(raw) {
  const s = String(raw || "").replace(/\0+$/g, "").trim();
  if (!s) return "";
  try {
    return decodeURIComponent(escape(s));
  } catch {
    return s;
  }
}

function titleFromIcyMeta(text) {
  const m = String(text).match(/StreamTitle='([^']*)'/i);
  return decodeIcyText(m?.[1] || "");
}

export class IcyWatcher {
  constructor() {
    this._ac = null;
    this._timer = 0;
  }

  stop() {
    if (this._ac) this._ac.abort();
    this._ac = null;
    if (this._timer) clearTimeout(this._timer);
    this._timer = 0;
  }

  watch(url, onTitle) {
    this.stop();
    if (!url || url.startsWith("blob:") || url.startsWith("data:")) return;
    this._ac = new AbortController();
    const signal = this._ac.signal;
    if (typeof location !== "undefined" && /^https?:$/.test(location.protocol)) {
      this._poll(url, onTitle, signal);
      return;
    }
    this._stream(url, onTitle, signal);
  }

  async _poll(url, onTitle, signal) {
    const tick = async () => {
      if (signal.aborted) return;
      try {
        const res = await fetch(`/nowplaying?url=${encodeURIComponent(url)}`, { signal });
        if (res.ok) {
          const data = await res.json();
          if (data?.title) onTitle(data.title);
        }
      } catch {
        /* aborted or offline */
      }
      if (!signal.aborted) this._timer = setTimeout(tick, 3500);
    };
    tick();
  }

  async _stream(url, onTitle, signal) {
    try {
      const res = await fetch(url, {
        signal,
        headers: { "Icy-MetaData": "1", Accept: "*/*" },
        redirect: "follow",
      });
      const metaInt = Number(res.headers.get("icy-metaint"));
      if (!res.body || !Number.isFinite(metaInt) || metaInt <= 0) return;
      const reader = res.body.getReader();
      let leftover = new Uint8Array(0);
      let mode = "audio";
      let need = metaInt;
      const concat = (a, b) => {
        const out = new Uint8Array(a.length + b.length);
        out.set(a, 0);
        out.set(b, a.length);
        return out;
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done || signal.aborted) break;
        leftover = concat(leftover, value);
        while (leftover.length) {
          if (mode === "audio") {
            const n = Math.min(need, leftover.length);
            leftover = leftover.subarray(n);
            need -= n;
            if (need === 0) {
              mode = "len";
              need = 1;
            }
          } else if (mode === "len") {
            if (!leftover.length) break;
            const len = leftover[0] * 16;
            leftover = leftover.subarray(1);
            if (len === 0) {
              mode = "audio";
              need = metaInt;
            } else {
              mode = "meta";
              need = len;
            }
          } else {
            if (leftover.length < need) break;
            const meta = leftover.subarray(0, need);
            leftover = leftover.subarray(need);
            const text = new TextDecoder("latin1").decode(meta);
            const title = titleFromIcyMeta(text);
            if (title) onTitle(title);
            mode = "audio";
            need = metaInt;
          }
        }
      }
    } catch {
      /* aborted */
    }
  }
}

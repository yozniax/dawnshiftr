const RAW_BARS = 9;
const BARS = 7;

export function attachEqVis(canvas, getLevels, isPlaying) {
  const ctx = canvas.getContext("2d");
  const smoothed = new Float32Array(BARS);
  let raf = 0;

  function size() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth || canvas.parentElement?.clientWidth || 280;
    const h = canvas.clientHeight || 40;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function contrast(raw) {
    const slice = (raw || []).slice(0, BARS);
    const out = new Array(BARS);
    for (let i = 0; i < BARS; i++) {
      const v = Math.max(0, (slice[i] || 0) - 0.03);
      out[i] = Math.min(1, Math.pow(v, 0.62) * 1.7);
    }
    return out;
  }

  function draw() {
    raf = requestAnimationFrame(draw);
    const w = canvas.clientWidth || 280;
    const h = canvas.clientHeight || 40;
    const playing = isPlaying();
    const levels = contrast(getLevels(RAW_BARS));
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue("--accent").trim() || "#e85a2a";
    const line = css.getPropertyValue("--line").trim() || "#2a2a2a";
    ctx.clearRect(0, 0, w, h);
    const gap = 3;
    const barW = (w - gap * (BARS - 1)) / BARS;
    for (let i = 0; i < BARS; i++) {
      let v = levels[i] || 0;
      if (!playing) v *= 0.12;
      smoothed[i] += (v - smoothed[i]) * (playing ? 0.82 : 0.18);
      const bh = Math.max(2, smoothed[i] * (h - 2));
      const x = i * (barW + gap);
      ctx.fillStyle = playing ? accent : line;
      ctx.globalAlpha = 0.45 + smoothed[i] * 0.55;
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") ctx.roundRect(x, h - bh, barW, bh, Math.min(2, barW / 2));
      else ctx.rect(x, h - bh, barW, bh);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  size();
  const ro = new ResizeObserver(size);
  ro.observe(canvas);
  draw();
  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
  };
}

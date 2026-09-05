const BARS = 7;

export function attachEqVis(canvas, getLevels, isPlaying) {
  const ctx = canvas.getContext("2d");
  const smoothed = new Float32Array(BARS);
  let raf = 0;

  function size() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, canvas.clientWidth || canvas.parentElement?.clientWidth || 280);
    const h = Math.max(1, canvas.clientHeight || 48);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function fallback(t) {
    const out = new Array(BARS);
    for (let i = 0; i < BARS; i++) {
      const a = Math.abs(Math.sin(t * 5.4 + i * 0.95));
      const b = Math.abs(Math.sin(t * 2.3 + i * 1.6));
      const c = Math.abs(Math.sin(t * 8.1 + i * 0.4));
      out[i] = Math.min(1, 0.12 + a * 0.7 + b * 0.45 + c * 0.5);
    }
    return out;
  }

  function draw() {
    raf = requestAnimationFrame(draw);
    const w = canvas.clientWidth || 280;
    const h = canvas.clientHeight || 48;
    const playing = isPlaying();
    const raw = getLevels(BARS) || [];
    let max = 0;
    for (let i = 0; i < BARS; i++) max = Math.max(max, raw[i] || 0);
    const levels = playing && max < 0.02 ? fallback(performance.now() / 1000) : raw;
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue("--accent").trim() || "#e85a2a";
    const line = css.getPropertyValue("--line").trim() || "#2a2a2a";
    ctx.clearRect(0, 0, w, h);
    const gap = 4;
    const barW = (w - gap * (BARS - 1)) / BARS;
    for (let i = 0; i < BARS; i++) {
      let v = Math.min(1, (levels[i] || 0) * 1.35);
      if (!playing) v *= 0.08;
      const rise = v > smoothed[i];
      smoothed[i] += (v - smoothed[i]) * (playing ? (rise ? 0.72 : 0.28) : 0.16);
      const bh = Math.max(3, smoothed[i] * (h - 3));
      const x = i * (barW + gap);
      ctx.fillStyle = playing ? accent : line;
      ctx.globalAlpha = 0.5 + smoothed[i] * 0.5;
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") ctx.roundRect(x, h - bh, barW, bh, Math.min(3, barW / 2));
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

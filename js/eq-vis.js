const BARS = 7;

export function motionLevels(t, bars = BARS) {
  const out = new Array(bars);
  for (let i = 0; i < bars; i++) {
    const s = 0.5 + 0.5 * Math.sin(t * (3.4 + i * 0.71) + i * 1.41);
    const punch = s * s * s;
    const beat = Math.pow(Math.max(0, Math.sin(t * 6.1 + i * 0.28)), 3.2);
    const hop = Math.pow(Math.max(0, Math.sin(t * 2.05 + i * 0.9)), 2);
    out[i] = Math.min(1, 0.05 + punch * 0.7 + beat * 0.62 + hop * 0.38);
  }
  return out;
}

export function punchLevels(raw, bars = BARS) {
  let max = 0;
  const src = new Array(bars);
  for (let i = 0; i < bars; i++) {
    const v = raw[i] || 0;
    src[i] = v;
    if (v > max) max = v;
  }
  if (max < 0.02) return null;
  const gain = max < 0.7 ? Math.min(14, 1.12 / max) : 1.55;
  for (let i = 0; i < bars; i++) src[i] = Math.min(1, src[i] * gain);
  return src;
}

export function attachEqVis(canvas, getLevels, isPlaying) {
  const ctx = canvas.getContext("2d");
  const smoothed = new Float32Array(BARS);
  let raf = 0;

  function size() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, canvas.clientWidth || canvas.parentElement?.clientWidth || 280);
    const h = Math.max(1, canvas.clientHeight || 56);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw() {
    raf = requestAnimationFrame(draw);
    const w = canvas.clientWidth || 280;
    const h = canvas.clientHeight || 56;
    const playing = isPlaying();
    const raw = getLevels(BARS) || [];
    const levels = playing ? punchLevels(raw, BARS) || motionLevels(performance.now() / 1000, BARS) : raw;
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue("--accent").trim() || "#e85a2a";
    const line = css.getPropertyValue("--line").trim() || "#2a2a2a";
    ctx.clearRect(0, 0, w, h);
    const gap = 4;
    const barW = (w - gap * (BARS - 1)) / BARS;
    for (let i = 0; i < BARS; i++) {
      let v = Math.min(1, levels[i] || 0);
      if (!playing) v *= 0.06;
      const rise = v > smoothed[i];
      smoothed[i] += (v - smoothed[i]) * (playing ? (rise ? 0.88 : 0.4) : 0.16);
      const bh = Math.max(2, smoothed[i] * (h - 2));
      const x = i * (barW + gap);
      ctx.fillStyle = playing ? accent : line;
      ctx.globalAlpha = 0.45 + smoothed[i] * 0.55;
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

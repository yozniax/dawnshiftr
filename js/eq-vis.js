const BARS = 18;

export function attachEqVis(canvas, getLevels, isPlaying) {
  const ctx = canvas.getContext("2d");
  const smoothed = new Float32Array(BARS);
  let idle = 0;
  let raf = 0;

  function size() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth || canvas.parentElement?.clientWidth || 280;
    const h = canvas.clientHeight || 40;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw() {
    raf = requestAnimationFrame(draw);
    const w = canvas.clientWidth || 280;
    const h = canvas.clientHeight || 40;
    const playing = isPlaying();
    let levels = getLevels(BARS);
    if (!levels || levels.length !== BARS) levels = smoothed;
    let energy = 0;
    for (let i = 0; i < BARS; i++) energy += levels[i] || 0;
    idle += 0.07;
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue("--accent").trim() || "#e4a15a";
    const line = css.getPropertyValue("--line").trim() || "#3d3228";
    ctx.clearRect(0, 0, w, h);
    const gap = 3;
    const barW = (w - gap * (BARS - 1)) / BARS;
    for (let i = 0; i < BARS; i++) {
      let v = levels[i] || 0;
      if (playing && energy < 0.04) {
        v = 0.12 + 0.55 * Math.abs(Math.sin(idle + i * 0.38));
      } else if (!playing) {
        v *= 0.35;
      }
      smoothed[i] += (v - smoothed[i]) * (playing ? 0.28 : 0.12);
      const bh = Math.max(2, smoothed[i] * (h - 2));
      const x = i * (barW + gap);
      ctx.fillStyle = playing ? accent : line;
      ctx.globalAlpha = 0.35 + smoothed[i] * 0.65;
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

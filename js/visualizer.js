export class Visualizer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.raf = 0;
    this.playing = () => false;
    this.t = 0;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth || 320;
    const h = this.canvas.clientHeight || 48;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w;
    this.h = h;
  }

  start(isPlaying) {
    this.playing = isPlaying;
    cancelAnimationFrame(this.raf);
    const loop = () => {
      this.t += 0.016;
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  draw() {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue("--accent").trim() || "#e4a15a";
    const muted = css.getPropertyValue("--muted").trim() || "#a8927c";
    const on = this.playing();
    const amp = on ? 0.38 : 0.12;
    const speed = on ? 2.4 : 0.7;
    const mid = h / 2;

    ctx.strokeStyle = muted;
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 1;
    const cx = 18;
    for (let i = 0; i < 4; i++) {
      const r = 6 + i * 9 + (on ? Math.sin(this.t * 2 + i) * 1.5 : 0);
      ctx.beginPath();
      ctx.arc(cx, mid, r, -Math.PI * 0.55, Math.PI * 0.55);
      ctx.stroke();
    }

    ctx.globalAlpha = on ? 0.95 : 0.45;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let x = 0; x <= w; x++) {
      const u = x / w;
      const y =
        mid +
        Math.sin(u * Math.PI * 10 + this.t * speed) * h * amp * (0.45 + 0.55 * Math.sin(u * Math.PI)) +
        Math.sin(u * Math.PI * 22 + this.t * speed * 1.7) * h * amp * 0.18;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.globalAlpha = on ? 0.35 : 0.12;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= w; x++) {
      const u = x / w;
      const y = mid + Math.sin(u * Math.PI * 7 - this.t * speed * 0.8) * h * amp * 0.55;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

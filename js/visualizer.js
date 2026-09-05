export class Visualizer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.raf = 0;
    this.getFrame = () => null;
    this.playing = () => false;
    this.t = 0;
    this.smooth = [];
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth || 320;
    const h = this.canvas.clientHeight || 72;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w;
    this.h = h;
  }

  start(getFrame, isPlaying) {
    this.getFrame = getFrame;
    this.playing = isPlaying;
    cancelAnimationFrame(this.raf);
    const loop = () => {
      this.t += 0.016;
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  bins(n = 36) {
    const frame = this.getFrame();
    const out = new Array(n).fill(0);
    if (frame?.freq) {
      const data = frame.freq;
      const usable = Math.floor(data.length * 0.62);
      for (let i = 0; i < n; i++) {
        const a = Math.floor((i / n) * usable);
        const b = Math.max(a + 1, Math.floor(((i + 1) / n) * usable));
        let sum = 0;
        for (let j = a; j < b; j++) sum += data[j];
        out[i] = sum / (b - a) / 255;
      }
    } else if (this.playing()) {
      for (let i = 0; i < n; i++) {
        out[i] = 0.16 + 0.22 * Math.abs(Math.sin(this.t * 1.7 + i * 0.28));
      }
    }
    if (!this.smooth.length) this.smooth = out.slice();
    this.smooth = out.map((v, i) => this.smooth[i] * 0.72 + v * 0.28);
    return this.smooth;
  }

  draw() {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue("--accent").trim() || "#e4a15a";
    const bins = this.bins();
    const mid = h * 0.62;
    ctx.beginPath();
    ctx.moveTo(0, h);
    bins.forEach((v, i) => {
      const x = (i / (bins.length - 1)) * w;
      const y = mid - v * (h * 0.5);
      if (i === 0) ctx.lineTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(w, h);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, accent);
    g.addColorStop(1, "transparent");
    ctx.globalAlpha = this.playing() ? 0.55 : 0.22;
    ctx.fillStyle = g;
    ctx.fill();
    ctx.globalAlpha = this.playing() ? 0.95 : 0.4;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    bins.forEach((v, i) => {
      const x = (i / (bins.length - 1)) * w;
      const y = mid - v * (h * 0.5);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

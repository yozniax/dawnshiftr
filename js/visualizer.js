const VIS_MODES = ["spectrum", "mirror", "waveform", "scope", "particles", "heartbeat"];

export { VIS_MODES };

export class Visualizer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.mode = "spectrum";
    this.particles = [];
    this.raf = 0;
    this.getFrame = () => null;
    this.playing = false;
    this.t = 0;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  setMode(mode) {
    this.mode = VIS_MODES.includes(mode) ? mode : "spectrum";
    if (this.mode === "particles") this.seedParticles();
  }

  nextMode() {
    const i = VIS_MODES.indexOf(this.mode);
    this.setMode(VIS_MODES[(i + 1) % VIS_MODES.length]);
    return this.mode;
  }

  seedParticles() {
    this.particles = Array.from({ length: 48 }, () => ({
      x: Math.random(),
      y: Math.random(),
      v: 0.15 + Math.random() * 0.6,
      s: 1 + Math.random() * 2,
    }));
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

  colors() {
    const css = getComputedStyle(document.documentElement);
    return {
      accent: css.getPropertyValue("--accent").trim() || "#82FB9C",
      green: css.getPropertyValue("--green").trim() || "#2ec27e",
      yellow: css.getPropertyValue("--yellow").trim() || "#f7df50",
      red: css.getPropertyValue("--red").trim() || "#ff5f78",
      fg: css.getPropertyValue("--fg").trim() || "#8e95b8",
      bg: css.getPropertyValue("--bg").trim() || "#0b0c16",
    };
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

  stop() {
    cancelAnimationFrame(this.raf);
  }

  binsFrom(frame) {
    const n = 48;
    const out = new Array(n).fill(0);
    if (frame?.freq) {
      const data = frame.freq;
      const usable = Math.floor(data.length * 0.7);
      for (let i = 0; i < n; i++) {
        const a = Math.floor((i / n) * usable);
        const b = Math.floor(((i + 1) / n) * usable);
        let sum = 0;
        for (let j = a; j < b; j++) sum += data[j];
        out[i] = sum / Math.max(1, b - a) / 255;
      }
      if (out.every((v) => v < 0.02) && this.playing()) {
        return this.fallbackBins(n);
      }
      return out;
    }
    return this.playing() ? this.fallbackBins(n) : out;
  }

  fallbackBins(n) {
    const t = this.t;
    return Array.from({ length: n }, (_, i) => {
      const base = 0.18 + 0.18 * Math.sin(t * 2.2 + i * 0.33);
      const pulse = 0.35 * Math.abs(Math.sin(t * 4 + i * 0.5));
      return Math.min(1, base + pulse);
    });
  }

  draw() {
    const { ctx, w, h } = this;
    const c = this.colors();
    ctx.clearRect(0, 0, w, h);
    const frame = this.getFrame();
    const bins = this.binsFrom(frame);
    switch (this.mode) {
      case "mirror":
        this.drawMirror(bins, c);
        break;
      case "waveform":
        this.drawWave(frame, bins, c);
        break;
      case "scope":
        this.drawScope(frame, c);
        break;
      case "particles":
        this.drawParticles(bins, c);
        break;
      case "heartbeat":
        this.drawHeartbeat(bins, c);
        break;
      default:
        this.drawSpectrum(bins, c);
    }
  }

  drawSpectrum(bins, c) {
    const { ctx, w, h } = this;
    const gap = 2;
    const bw = (w - gap * (bins.length - 1)) / bins.length;
    bins.forEach((v, i) => {
      const bh = Math.max(2, v * h);
      const x = i * (bw + gap);
      const y = h - bh;
      const g = ctx.createLinearGradient(0, h, 0, 0);
      g.addColorStop(0, c.green);
      g.addColorStop(0.55, c.yellow);
      g.addColorStop(1, c.red);
      ctx.fillStyle = g;
      ctx.globalAlpha = 0.35 + v * 0.65;
      ctx.fillRect(x, y, Math.max(1, bw), bh);
    });
    ctx.globalAlpha = 1;
  }

  drawMirror(bins, c) {
    const { ctx, w, h } = this;
    const mid = h / 2;
    const gap = 2;
    const bw = (w - gap * (bins.length - 1)) / bins.length;
    bins.forEach((v, i) => {
      const bh = Math.max(1, v * (mid - 2));
      const x = i * (bw + gap);
      ctx.fillStyle = c.accent;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x, mid - bh, Math.max(1, bw), bh);
      ctx.globalAlpha = 0.35;
      ctx.fillRect(x, mid, Math.max(1, bw), bh);
    });
    ctx.globalAlpha = 1;
  }

  drawWave(frame, bins, c) {
    const { ctx, w, h } = this;
    ctx.beginPath();
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 1.5;
    const data = frame?.time;
    if (data) {
      for (let i = 0; i < data.length; i++) {
        const x = (i / (data.length - 1)) * w;
        const y = ((data[i] - 128) / 128) * (h * 0.42) + h / 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    } else {
      for (let i = 0; i < bins.length; i++) {
        const x = (i / (bins.length - 1)) * w;
        const y = h / 2 - (bins[i] - 0.4) * h * 0.7;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }

  drawScope(frame, c) {
    const { ctx, w, h } = this;
    ctx.strokeStyle = c.fg;
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    this.drawWave(frame, this.binsFrom(frame), c);
  }

  drawParticles(bins, c) {
    const { ctx, w, h } = this;
    const energy = bins.reduce((a, b) => a + b, 0) / bins.length;
    if (!this.particles.length) this.seedParticles();
    ctx.fillStyle = c.accent;
    for (const p of this.particles) {
      p.y -= p.v * (0.004 + energy * 0.02);
      if (p.y < 0) {
        p.y = 1;
        p.x = Math.random();
      }
      ctx.globalAlpha = 0.25 + energy * 0.7;
      ctx.fillRect(p.x * w, p.y * h, p.s, p.s);
    }
    ctx.globalAlpha = 1;
  }

  drawHeartbeat(bins, c) {
    const { ctx, w, h } = this;
    const energy = bins.reduce((a, b) => a + b, 0) / bins.length;
    ctx.strokeStyle = c.red;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const mid = h / 2;
    for (let x = 0; x <= w; x++) {
      const u = x / w;
      const beat = Math.exp(-Math.pow((u - ((this.t * 0.35) % 1)) * 14, 2));
      const y = mid - beat * (8 + energy * 28) * Math.sin(u * 40);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

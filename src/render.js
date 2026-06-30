// Drawing primitives + screen shake. Everything is vector strokes with optional glow.
import { COLORS, CFG } from './config.js';
import { settings } from './settings.js';

export function glow(ctx, color, amount = CFG.glow) {
  if (!settings.glow) { ctx.shadowBlur = 0; return; }
  ctx.shadowColor = color;
  ctx.shadowBlur = amount;
}

export function noGlow(ctx) {
  ctx.shadowBlur = 0;
}

// Stroke a polyline/polygon from a flat or point array.
export function strokePoly(ctx, pts, { color = COLORS.fg, width = 2, close = true } = {}) {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  if (close) ctx.closePath();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

export function strokeCircle(ctx, x, y, r, { color = COLORS.fg, width = 2 } = {}) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

export function fillDot(ctx, x, y, r, color = COLORS.fg) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

export class Shake {
  constructor() { this.t = 0; this.mag = 0; this.x = 0; this.y = 0; }
  add(mag) { mag *= settings.shake; if (mag <= 0) return; this.mag = Math.max(this.mag, mag); this.t = 1; }
  update(dt) {
    if (this.t > 0) {
      this.t = Math.max(0, this.t - dt * CFG.shakeDecay);
      const m = this.mag * this.t;
      this.x = (Math.random() * 2 - 1) * m;
      this.y = (Math.random() * 2 - 1) * m;
    } else {
      this.x = this.y = 0;
      this.mag = 0;
    }
  }
}

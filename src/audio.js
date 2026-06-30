// Synthesized SFX via WebAudio — no asset files, so nothing breaks the offline guarantee.
import { isMuted, setMuted } from './storage.js';
import { settings } from './settings.js';

let ctx = null;
let master = null;
let muted = isMuted();
let noiseBuf = null;
let silentBuf = null;
let primed = false;

function ensure() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  // iOS 16.4+: mark this as "playback" so audio is NOT silenced by the
  // hardware Ring/Silent switch — the usual reason a game is mute on iPhone.
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* ignore */ }
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.5;
  master.connect(ctx.destination);

  // pre-render a short white-noise buffer for explosions/thrust
  const len = Math.floor(ctx.sampleRate * 0.5);
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

  silentBuf = ctx.createBuffer(1, 1, 22050); // for the iOS unlock trick
}

// Must be called from a user gesture. Safe to call on every pointerdown:
// resume() is a no-op once running, and the priming buffer plays only once.
export function unlock() {
  ensure();
  if (!ctx) return;
  if (ctx.state !== 'running') ctx.resume();
  if (!primed) {
    try {
      const s = ctx.createBufferSource();
      s.buffer = silentBuf;
      s.connect(master);
      s.start(0);
      primed = true;
    } catch { /* ignore */ }
  }
}

export function toggleMute() {
  muted = !muted;
  setMuted(muted);
  if (master) master.gain.value = muted ? 0 : 0.5;
  return muted;
}

export function getMuted() {
  return muted;
}

function tone({ type = 'sine', f0, f1, dur, gain = 0.3, delay = 0 }) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  if (f1 != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise({ dur, gain = 0.4, lp0 = 1800, lp1 = 200 }) {
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.setValueAtTime(lp0, t);
  filt.frequency.exponentialRampToValueAtTime(Math.max(40, lp1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filt).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

export const sfx = {
  fire() {
    if (!settings.sndFire) return;
    tone({ type: 'square', f0: 720, f1: 240, dur: 0.12, gain: 0.18 });
  },
  thrust() {
    if (!settings.sndThrust) return;
    noise({ dur: 0.12, gain: 0.06, lp0: 600, lp1: 300 });
  },
  explode(size = 1) {
    if (!settings.sndExplode) return;
    noise({ dur: 0.25 + size * 0.18, gain: 0.45, lp0: 1200 + size * 600, lp1: 120 });
    tone({ type: 'sawtooth', f0: 140 - size * 20, f1: 40, dur: 0.3, gain: 0.12 });
  },
  ufo() {
    if (!settings.sndUfo) return;
    tone({ type: 'sawtooth', f0: 180, f1: 220, dur: 0.18, gain: 0.08 });
  },
  ufoFire() {
    if (!settings.sndUfo) return;
    tone({ type: 'triangle', f0: 420, f1: 180, dur: 0.14, gain: 0.12 });
  },
  powerup() {
    if (!settings.sndPowerup) return;
    tone({ type: 'triangle', f0: 440, f1: 880, dur: 0.12, gain: 0.2 });
    tone({ type: 'triangle', f0: 660, f1: 1320, dur: 0.14, gain: 0.16, delay: 0.08 });
  },
  death() {
    if (!settings.sndDeath) return;
    noise({ dur: 0.6, gain: 0.5, lp0: 1600, lp1: 80 });
    tone({ type: 'sawtooth', f0: 220, f1: 40, dur: 0.7, gain: 0.18 });
  },
  wave() {
    tone({ type: 'sine', f0: 330, f1: 660, dur: 0.18, gain: 0.16 });
    tone({ type: 'sine', f0: 495, f1: 990, dur: 0.2, gain: 0.14, delay: 0.1 });
  },
};

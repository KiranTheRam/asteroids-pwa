// Bootstrap: canvas/DPR sizing, control-deck layout, FOV zoom, game loop,
// input wiring, FPS meter, SW registration.
import { CFG, COLORS, clamp, TAU } from './config.js';
import { Game, STATE } from './game.js';
import { Input } from './input.js';
import { glow, noGlow, strokeCircle, strokePoly } from './render.js';
import { unlock, toggleMute, getMuted } from './audio.js';
import { settings } from './settings.js';
import { initSettingsUI, isSettingsOpen } from './settings-ui.js';
import { initUpgradesUI, isUpgradesOpen, openUpgrades } from './upgrades-ui.js';
import { GamepadInput } from './gamepad.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const world = { w: window.innerWidth, h: window.innerHeight }; // virtual gameplay field
const screen = { w: window.innerWidth, h: window.innerHeight }; // canvas in CSS px
const view = { top: 0, right: 0, bottom: 0, left: 0 };

// Control layout (screen px), recomputed on resize.
const layout = {
  deckTop: 0,
  landscape: false,
  controlsVisible: true,
  controlsOverlay: false,
  play: { x: 0, y: 0, w: 0, h: 0 },
  steer: { cx: 0, cy: 0, r: 0, zone: { x: 0, y: 0, w: 0, h: 0 } },
  fire: { cx: 0, cy: 0, r: 0, zone: { x: 0, y: 0, w: 0, h: 0 } },
  center: { cx: 0, pauseY: 0, muteY: 0 },
};

let controllerConnected = false;

// Hidden probe to read safe-area insets (notches, home indicator).
const probe = document.createElement('div');
probe.style.cssText =
  'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
  'padding:env(safe-area-inset-top) env(safe-area-inset-right) ' +
  'env(safe-area-inset-bottom) env(safe-area-inset-left);';
document.body.appendChild(probe);

function resize() {
  // Cap DPR at 2: on a 3x ProMotion screen the extra pixels cost frame time
  // without visible benefit for vector art, and headroom is what keeps us at 120Hz.
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  // Measure the canvas element (CSS 100dvh) rather than window.innerHeight,
  // which disagrees on mobile and left a gap at the bottom.
  const rect = canvas.getBoundingClientRect();
  const w = Math.round(rect.width) || window.innerWidth;
  const h = Math.round(rect.height) || window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  screen.w = w; screen.h = h;

  const cs = getComputedStyle(probe);
  view.top = parseFloat(cs.paddingTop) || 0;
  view.right = parseFloat(cs.paddingRight) || 0;
  view.bottom = parseFloat(cs.paddingBottom) || 0;
  view.left = parseFloat(cs.paddingLeft) || 0;

  const isLandscape = w > h;
  layout.landscape = isLandscape;
  layout.controlsVisible = !controllerConnected;
  layout.controlsOverlay = isLandscape && layout.controlsVisible;

  if (isLandscape) {
    // Landscape uses the whole canvas. Safe-area insets still position UI, but
    // not the playable world.
    layout.play.x = 0;
    layout.play.y = 0;
    layout.play.w = w;
    layout.play.h = h;
  } else {
    // Keep portrait gameplay out of safe-area insets. That strip stays plain
    // black instead of hidden play area.
    layout.play.x = view.left;
    layout.play.y = view.top;
    layout.play.w = w - view.left - view.right;
    layout.play.h = h - view.top - view.bottom;
  }

  const emptyZone = { x: -1, y: -1, w: 0, h: 0 };
  if (!layout.controlsVisible) {
    layout.deckTop = h - view.bottom;
    layout.steer.zone = emptyZone;
    layout.fire.zone = emptyZone;
    layout.center.cx = w / 2;
    layout.center.pauseY = -100;
    layout.center.muteY = -100;
    return;
  }

  // ---- deck / overlay zones ----
  const steerLeft = !settings.swapSides;

  if (isLandscape) {
    // Landscape keeps the playfield full-size and overlays the touch pads in
    // the bottom corners. Zones stay local so normal playfield taps still work.
    layout.deckTop = h - view.bottom;
    const margin = clamp(Math.min(w, h) * 0.08, 28, 52);
    const usableH = h - view.top - view.bottom;
    const r = clamp(Math.min(usableH * 0.24, w * 0.10), 48, 86);
    const cy = h - view.bottom - margin - r;
    const leftCx = view.left + margin + r;
    const rightCx = w - view.right - margin - r;
    const zoneW = r * 2.6;
    const zoneH = r * 2.6;
    const leftZone = { x: leftCx - zoneW / 2, y: cy - zoneH / 2, w: zoneW, h: zoneH };
    const rightZone = { x: rightCx - zoneW / 2, y: cy - zoneH / 2, w: zoneW, h: zoneH };

    layout.steer.zone = steerLeft ? leftZone : rightZone;
    layout.steer.cx = steerLeft ? leftCx : rightCx; layout.steer.cy = cy;
    layout.steer.r = r;

    layout.fire.zone = steerLeft ? rightZone : leftZone;
    layout.fire.cx = steerLeft ? rightCx : leftCx; layout.fire.cy = cy;
    layout.fire.r = clamp(r * 0.9, 44, 78);

    layout.center.cx = w / 2;
    layout.center.pauseY = h - view.bottom - margin - 58;
    layout.center.muteY = h - view.bottom - margin - 18;
    return;
  }

  const deckUsable = clamp(h * 0.24, 140, 220); // touch area, excludes home indicator
  const deckH = deckUsable + view.bottom;
  layout.deckTop = h - deckH;
  layout.play.h = layout.deckTop - view.top;

  const centerW = 84;
  const sideW = (w - centerW) / 2;
  const cy = layout.deckTop + deckUsable / 2;
  const fitR = Math.min(sideW, deckUsable) / 2;

  const leftCx = sideW / 2, rightCx = w - sideW / 2;
  const leftZone = { x: 0, y: layout.deckTop, w: sideW, h: deckH };
  const rightZone = { x: w - sideW, y: layout.deckTop, w: sideW, h: deckH };

  layout.steer.zone = steerLeft ? leftZone : rightZone;
  layout.steer.cx = steerLeft ? leftCx : rightCx; layout.steer.cy = cy;
  layout.steer.r = clamp(fitR - 12, 50, 110);

  layout.fire.zone = steerLeft ? rightZone : leftZone;
  layout.fire.cx = steerLeft ? rightCx : leftCx; layout.fire.cy = cy;
  layout.fire.r = clamp(fitR - 16, 44, 92);

  layout.center.cx = w / 2;
  layout.center.pauseY = layout.deckTop + deckUsable * 0.34;
  layout.center.muteY = layout.deckTop + deckUsable * 0.66;
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
resize();

let appliedSwap = settings.swapSides; // relayout trigger when this changes

const game = new Game(world);
const input = new Input(canvas, layout);
const gamepad = new GamepadInput();

// Unlock audio on every press until the context is actually running (iOS can
// ignore the first attempt); unlock() is cheap and self-guards after priming.
canvas.addEventListener('pointerdown', () => unlock());

// UI buttons: pause + mute live in the deck's centre column.
const BTN = 44;
const offscreenRect = () => ({ x: -100, y: -100, w: 0, h: 0 });
const pauseRect = () => layout.controlsVisible
  ? ({ x: layout.center.cx - BTN / 2, y: layout.center.pauseY - BTN / 2, w: BTN, h: BTN })
  : offscreenRect();
const muteRect = () => layout.controlsVisible
  ? ({ x: layout.center.cx - BTN / 2, y: layout.center.muteY - BTN / 2, w: BTN, h: BTN })
  : offscreenRect();

let muted = getMuted();
initSettingsUI({ onSoundChange: (m) => { muted = m; } });
initUpgradesUI();
input.addButton(pauseRect, () => {
  if (game.state === STATE.PLAYING || game.state === STATE.PAUSED) game.togglePause();
});
input.addButton(muteRect, () => { unlock(); muted = toggleMute(); });

// Auto-pause when tab/app is hidden.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === STATE.PLAYING) game.togglePause();
});

// ---------------- loop ----------------
let last = performance.now();
let acc = 0;
let fps = 60;     // 1 / interval-between-frames (== display refresh when capped)
let workMs = 0;   // time actually spent rendering one frame (the meaningful number)

function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > CFG.maxFrame) dt = CFG.maxFrame;
  if (dt > 0) fps += (1 / dt - fps) * 0.1; // smoothed frame rate

  // relayout if the user swapped control sides in settings
  if (settings.swapSides !== appliedSwap) { appliedSwap = settings.swapSides; resize(); }

  input.update(dt);
  const gp = gamepad.poll();
  const hasController = !!gp || gamepad.hasKnownController();
  if (hasController !== controllerConnected) {
    controllerConnected = hasController;
    input.reset();
    resize();
  }
  const wt0 = performance.now();

  // FOV: world is the play area scaled up by `fov`, so more space is visible.
  const fov = settings.fov;
  const zoom = 1 / fov;
  world.w = layout.play.w * fov;
  world.h = layout.play.h * fov;

  const playing = game.state === STATE.PLAYING;
  document.body.classList.toggle('playing', playing);

  if (playing) {
    game.steer = input.steer;
    if (settings.twinStick) {
      // right stick: fire while touched, in its aimed direction
      input.consumeFireToggles();
      game.firing = input.aim.active;
      game.aimHasDir = input.aim.hasDir;
      if (input.aim.hasDir) game.fireAngle = input.aim.angle;
      else if (game.ship) game.fireAngle = game.ship.angle;
      game.autofireOn = false;
    } else {
      // right pad: each tap flips autofire; shots go where the ship points
      if (input.consumeFireToggles() % 2 === 1) game.autofireOn = !game.autofireOn;
      game.firing = game.autofireOn;
      game.aimHasDir = false;
      if (game.ship) game.fireAngle = game.ship.angle;
    }
    input.consumeMenuTap();
    // controller overrides touch when a stick/button is active
    if (gp) {
      if (gp.lmag > 0) game.steer = { active: true, angle: Math.atan2(gp.ly, gp.lx), thrust: Math.min(1, gp.lmag) };
      if (gp.rmag > 0) { game.firing = true; game.aimHasDir = true; game.fireAngle = Math.atan2(gp.ry, gp.rx); }
      else if (gp.fire) { game.firing = true; game.aimHasDir = false; if (game.ship) game.fireAngle = game.ship.angle; }
      if (gp.startEdge) game.togglePause();
    }
  } else if (isSettingsOpen() || isUpgradesOpen()) {
    input.consumeFireToggles(); input.consumeMenuTap();
    game.firing = false;
  } else {
    if (input.consumeMenuTap() > 0) game.tap();
    if (gp && (gp.startEdge || gp.aEdge)) game.tap(); // start / restart / resume
    input.consumeFireToggles();
    game.firing = false;
  }

  acc += dt;
  let steps = 0;
  while (acc >= CFG.step && steps < 240) { game.update(CFG.step); acc -= CFG.step; steps++; }

  // ---- draw ----
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, screen.w, screen.h);

  game.renderWorld(ctx, zoom, layout.play);
  // HUD only while playing/paused — on title & game-over it's zeros/redundant
  // and clutters the clean start screen (the overlay shows score there).
  if (playing || game.state === STATE.PAUSED) game.renderHud(ctx, screen, layout.play, view);
  if (playing && !settings.planet) drawShipIndicator(zoom);

  const inGame = playing || game.state === STATE.PAUSED;
  if (inGame && layout.controlsVisible) drawDeck(playing);

  game.renderOverlay(ctx, screen);
  if (!playing && controllerConnected && !isSettingsOpen() && !isUpgradesOpen()) drawControllerHint();
  if (settings.showFps) drawFps();

  // actual render cost this frame (excludes the wait between frames)
  workMs += (performance.now() - wt0 - workMs) * 0.1;

  requestAnimationFrame(frame);
}

// Edge arrow that follows the ship when it's at/near a play-area border
// (where the wrap seam can hide it).
function drawShipIndicator(zoom) {
  if (!game.ship) return;
  const play = layout.play;
  const sx = play.x + game.shake.x + game.ship.x * zoom;
  const sy = play.y + game.shake.y + game.ship.y * zoom;
  const inset = 22;
  const left = play.x + inset, right = play.x + play.w - inset;
  const top = play.y + inset, bottom = play.y + play.h - inset;
  if (sx >= left && sx <= right && sy >= top && sy <= bottom) return; // clearly visible

  const cx = clamp(sx, left, right), cy = clamp(sy, top, bottom);
  const ang = Math.atan2(sy - cy, sx - cx); // points outward toward the ship
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  glow(ctx, COLORS.thrust, 8);
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = COLORS.thrust;
  ctx.beginPath();
  ctx.moveTo(11, 0); ctx.lineTo(-6, -7); ctx.lineTo(-1, 0); ctx.lineTo(-6, 7);
  ctx.closePath();
  ctx.fill();
  noGlow(ctx);
  ctx.restore();
  ctx.globalAlpha = 1;
}

// ---------------- deck chrome ----------------
function drawDeck(playing) {
  if (!layout.controlsVisible) return;

  if (!layout.controlsOverlay) {
    ctx.globalAlpha = 1;
    strokePoly(ctx, [{ x: 0, y: layout.deckTop }, { x: screen.w, y: layout.deckTop }],
      { color: '#1c1c20', width: 2, close: false });
  }

  // steer pad — static base ring + centre dot
  const s = layout.steer;
  ctx.globalAlpha = 0.5;
  strokeCircle(ctx, s.cx, s.cy, s.r, { color: COLORS.dim, width: 2 });
  ctx.fillStyle = COLORS.dim;
  ctx.beginPath(); ctx.arc(s.cx, s.cy, 3, 0, TAU); ctx.fill();
  deckLabel('STEER', s.cx, s.cy + s.r + 14);
  ctx.globalAlpha = 1;

  // active thumbstick (when steering)
  if (playing && settings.indicator && input.steer.active) {
    const st = input.steer;
    let dx = st.x - st.ox, dy = st.y - st.oy;
    const d = Math.hypot(dx, dy) || 1;
    const cd = Math.min(d, s.r);
    const kx = st.ox + (dx / d) * cd, ky = st.oy + (dy / d) * cd;
    glow(ctx, COLORS.thrust, 8);
    ctx.globalAlpha = 0.5 + 0.5 * st.thrust;
    strokePoly(ctx, [{ x: st.ox, y: st.oy }, { x: kx, y: ky }],
      { color: COLORS.thrust, width: 3, close: false });
    ctx.beginPath(); ctx.arc(kx, ky, 10, 0, TAU);
    ctx.fillStyle = COLORS.thrust; ctx.fill();
    noGlow(ctx);
    ctx.globalAlpha = 1;
  }

  const f = layout.fire;
  if (settings.twinStick) {
    // right pad is an aim stick (mirrors the steer pad)
    ctx.globalAlpha = 0.5;
    strokeCircle(ctx, f.cx, f.cy, f.r, { color: COLORS.dim, width: 2 });
    ctx.fillStyle = COLORS.dim;
    ctx.beginPath(); ctx.arc(f.cx, f.cy, 3, 0, TAU); ctx.fill();
    deckLabel('AIM', f.cx, f.cy + f.r + 14);
    ctx.globalAlpha = 1;
    if (playing && input.aim.active) {
      const am = input.aim;
      let dx = am.x - am.ox, dy = am.y - am.oy;
      const d = Math.hypot(dx, dy) || 1;
      const cd = Math.min(d, f.r);
      const kx = am.ox + (dx / d) * cd, ky = am.oy + (dy / d) * cd;
      glow(ctx, COLORS.thrust, 8);
      strokePoly(ctx, [{ x: am.ox, y: am.oy }, { x: kx, y: ky }],
        { color: COLORS.thrust, width: 3, close: false });
      ctx.beginPath(); ctx.arc(kx, ky, 10, 0, TAU);
      ctx.fillStyle = COLORS.thrust; ctx.fill();
      noGlow(ctx);
    }
  } else {
    // fire pad — toggles autofire; lit when ON
    const on = playing && game.autofireOn;
    const col = on ? COLORS.thrust : COLORS.fg;
    ctx.globalAlpha = on ? 1 : (input.fireActive ? 0.85 : 0.55);
    if (on) glow(ctx, COLORS.thrust, 14);
    strokeCircle(ctx, f.cx, f.cy, f.r, { color: col, width: on ? 3 : 2 });
    ctx.fillStyle = on ? 'rgba(34,211,238,0.15)' : (input.fireActive ? 'rgba(244,244,245,0.08)' : 'transparent');
    ctx.beginPath(); ctx.arc(f.cx, f.cy, f.r, 0, TAU); ctx.fill();
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(f.cx, f.cy, 5, 0, TAU); ctx.fill();
    noGlow(ctx);
    deckLabel(on ? 'AUTO ON' : 'FIRE', f.cx, f.cy + f.r + 14);
    ctx.globalAlpha = 1;
  }

  drawPause(pauseRect());
  drawMute(muteRect());
}

function deckLabel(text, x, y) {
  ctx.fillStyle = COLORS.dim;
  ctx.font = '700 11px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

function drawControllerHint() {
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = COLORS.life;
  ctx.font = '700 12px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('CONTROLLER CONNECTED', screen.w / 2, screen.h - 24 - view.bottom);
  ctx.globalAlpha = 1;
}

function drawFps() {
  // "work" is what our code costs per frame; if it's well under the refresh
  // budget (8.3ms for 120Hz) yet FPS stays 60, the cap is iOS/WebKit, not us.
  const txt = Math.round(fps) + ' FPS · work ' + workMs.toFixed(1) + 'ms';
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = fps >= 90 ? COLORS.thrust : COLORS.dim;
  ctx.font = '700 13px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(txt, screen.w / 2, view.top + 10);
  ctx.globalAlpha = 1;
}

function drawPause(r) {
  ctx.globalAlpha = 0.8;
  glow(ctx, COLORS.fg, 4);
  ctx.fillStyle = COLORS.fg;
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  if (game.state === STATE.PAUSED) {
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy - 9); ctx.lineTo(cx + 10, cy); ctx.lineTo(cx - 6, cy + 9);
    ctx.closePath(); ctx.fill();
  } else {
    ctx.fillRect(cx - 8, cy - 9, 5, 18);
    ctx.fillRect(cx + 3, cy - 9, 5, 18);
  }
  noGlow(ctx);
  ctx.globalAlpha = 1;
}

function drawMute(r) {
  ctx.globalAlpha = 0.8;
  glow(ctx, COLORS.fg, 4);
  ctx.strokeStyle = COLORS.fg;
  ctx.fillStyle = COLORS.fg;
  ctx.lineWidth = 2;
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  ctx.beginPath();
  ctx.moveTo(cx - 9, cy - 4); ctx.lineTo(cx - 4, cy - 4); ctx.lineTo(cx + 1, cy - 9);
  ctx.lineTo(cx + 1, cy + 9); ctx.lineTo(cx - 4, cy + 4); ctx.lineTo(cx - 9, cy + 4);
  ctx.closePath(); ctx.fill();
  if (muted) {
    ctx.beginPath();
    ctx.moveTo(cx + 5, cy - 6); ctx.lineTo(cx + 13, cy + 6);
    ctx.moveTo(cx + 13, cy - 6); ctx.lineTo(cx + 5, cy + 6);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(cx + 4, cy, 5, -0.7, 0.7);
    ctx.moveTo(cx + 7, cy);
    ctx.arc(cx + 4, cy, 9, -0.7, 0.7);
    ctx.stroke();
  }
  noGlow(ctx);
  ctx.globalAlpha = 1;
}

requestAnimationFrame(frame);

// ---------------- PWA service worker ----------------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline-first; ignore */ });
  });
}

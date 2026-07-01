// Player-configurable settings: a live singleton, persisted to localStorage.
// Read directly by the game/render code each frame; mutated by the settings UI.
import { getSettings, setSettings } from './storage.js';

export const DEFAULTS = {
  thruster: 1.0,   // accel multiplier (0.5 = gentle, 2.0 = twitchy)
  turn: 1.0,       // rotation responsiveness multiplier
  fov: 1.2,        // field of view: higher = more zoomed out
  shake: 1.0,      // screen-shake intensity (0 = off)
  glow: true,      // neon glow (off = flatter look, better on weak GPUs)
  haptics: true,   // vibration on hits/death (no-op where unsupported, e.g. iOS)
  indicator: true, // show the moving thumbstick indicator while steering
  swapSides: false,// put the steer pad on the right, fire on the left (left-handed)
  twinStick: false,// right pad becomes an aim stick that fires in its direction
  showFps: false,  // on-screen frame-rate readout (verify 120Hz)
  // per-effect sound switches (master on/off is the audio mute flag)
  sndFire: true,
  sndExplode: true,
  sndThrust: true,
  sndUfo: true,
  sndPowerup: true,
  sndDeath: true,
  // ---- Modes ----
  planet: false,   // spherical Super Stardust-style playfield (enables arcade content)
  // ---- Arcade mode (off = Classic) + per-feature toggles ----
  arcade: false,
  arcHunter: true,
  arcMine: true,
  arcSniper: true,
  arcPierce: true,
  arcHoming: true,
  arcSlow: true,
  arcBomb: true,
  arcCombo: true,
  arcExplosive: true,
  arcGravity: true,
  arcAstCrystal: true,
  arcAstIron: true,
  arcAstIce: true,
  arcAstParasite: true,
};

// numeric ranges enforced on load so a corrupt store can't break the game
const RANGES = {
  thruster: [0.5, 2.0],
  turn: [0.5, 2.0],
  fov: [0.8, 2.0],
  shake: [0.0, 1.5],
};

function sanitize(raw) {
  const out = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) {
    if (!(k in raw)) continue;
    if (typeof DEFAULTS[k] === 'boolean') out[k] = !!raw[k];
    else {
      const [lo, hi] = RANGES[k];
      const v = Number(raw[k]);
      if (Number.isFinite(v)) out[k] = Math.min(hi, Math.max(lo, v));
    }
  }
  return out;
}

export const settings = sanitize(getSettings());

export function saveSettings() {
  setSettings({ ...settings });
}

export function resetSettings() {
  Object.assign(settings, DEFAULTS);
  saveSettings();
}

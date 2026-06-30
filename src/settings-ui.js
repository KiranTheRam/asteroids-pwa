// Binds the DOM settings panel to the live `settings` singleton + audio mute.
import { settings, saveSettings, resetSettings, DEFAULTS } from './settings.js';
import { getMuted, toggleMute, unlock } from './audio.js';

const $ = (id) => document.getElementById(id);
const fmtX = (v) => Number(v).toFixed(2).replace(/0$/, '') + '×';

// [settingKey, sliderId, outputId, formatter]
const SLIDERS = [
  ['thruster', 'set-thruster', 'out-thruster', fmtX],
  ['turn', 'set-turn', 'out-turn', fmtX],
  ['fov', 'set-fov', 'out-fov', fmtX],
  ['shake', 'set-shake', 'out-shake', (v) => (Number(v) === 0 ? 'Off' : Math.round(v * 100) + '%')],
];
// [settingKey, checkboxId]  (sound is special-cased via audio mute)
const TOGGLES = [
  ['indicator', 'set-indicator'],
  ['swapSides', 'set-swapsides'],
  ['twinStick', 'set-twinstick'],
  ['glow', 'set-glow'],
  ['haptics', 'set-haptics'],
  ['showFps', 'set-showfps'],
  // per-effect sound switches
  ['sndFire', 'set-snd-fire'],
  ['sndExplode', 'set-snd-explode'],
  ['sndThrust', 'set-snd-thrust'],
  ['sndUfo', 'set-snd-ufo'],
  ['sndPowerup', 'set-snd-powerup'],
  ['sndDeath', 'set-snd-death'],
  // arcade mode + per-feature toggles
  ['arcade', 'set-arcade'],
  ['arcHunter', 'set-arc-hunter'],
  ['arcMine', 'set-arc-mine'],
  ['arcSniper', 'set-arc-sniper'],
  ['arcPierce', 'set-arc-pierce'],
  ['arcHoming', 'set-arc-homing'],
  ['arcSlow', 'set-arc-slow'],
  ['arcBomb', 'set-arc-bomb'],
  ['arcCombo', 'set-arc-combo'],
  ['arcExplosive', 'set-arc-explosive'],
  ['arcGravity', 'set-arc-gravity'],
  ['arcAstCrystal',  'set-arc-ast-crystal'],
  ['arcAstIron',     'set-arc-ast-iron'],
  ['arcAstIce',      'set-arc-ast-ice'],
  ['arcAstParasite', 'set-arc-ast-parasite'],
];

// Grey out individual effect rows when master Sound is off.
function refreshSoundRows() {
  const off = getMuted();
  document.querySelectorAll('#settings .row.snd').forEach((row) => {
    row.style.opacity = off ? '0.4' : '1';
    const cb = row.querySelector('input');
    if (cb) cb.disabled = off;
  });
}

// Grey out arcade feature rows when Arcade mode is off (Classic).
function refreshArcadeRows() {
  const off = !settings.arcade;
  document.querySelectorAll('#settings .arc').forEach((el) => {
    el.style.opacity = off ? '0.4' : '1';
    const cb = el.querySelector && el.querySelector('input');
    if (cb) cb.disabled = off;
  });
}

let onSoundChange = null;

function syncToUI() {
  for (const [key, sid, oid, fmt] of SLIDERS) {
    $(sid).value = settings[key];
    $(oid).textContent = fmt(settings[key]);
  }
  for (const [key, cid] of TOGGLES) $(cid).checked = settings[key];
  $('set-sound').checked = !getMuted();
  refreshSoundRows();
  refreshArcadeRows();
}

export function initSettingsUI(opts = {}) {
  onSoundChange = opts.onSoundChange || null;

  for (const [key, sid, oid, fmt] of SLIDERS) {
    $(sid).addEventListener('input', (e) => {
      settings[key] = Number(e.target.value);
      $(oid).textContent = fmt(settings[key]);
      saveSettings();
    });
  }

  for (const [key, cid] of TOGGLES) {
    $(cid).addEventListener('change', (e) => {
      settings[key] = e.target.checked;
      saveSettings();
      if (key === 'arcade') refreshArcadeRows();
    });
  }

  $('set-sound').addEventListener('change', (e) => {
    unlock();
    // toggleMute flips current state; align it with the checkbox.
    if (getMuted() === e.target.checked) toggleMute();
    if (onSoundChange) onSoundChange(getMuted());
    refreshSoundRows();
  });

  $('set-reset').addEventListener('click', () => {
    resetSettings();
    syncToUI();
  });

  // The Vibration API doesn't exist on iOS Safari — flag haptics as unsupported.
  if (!('vibrate' in navigator)) {
    const cb = $('set-haptics');
    cb.disabled = true;
    const lbl = cb.closest('.row')?.querySelector('.lbl');
    if (lbl) lbl.textContent = 'Haptics (unsupported here)';
  }

  $('gear').addEventListener('click', openSettings);
  $('set-close').addEventListener('click', closeSettings);
  // tap the dimmed backdrop (outside the panel) to dismiss
  $('settings').addEventListener('pointerdown', (e) => {
    if (e.target === $('settings')) closeSettings();
  });
}

export function openSettings() {
  syncToUI();
  $('settings').classList.remove('hidden');
}

export function closeSettings() {
  $('settings').classList.add('hidden');
}

export function isSettingsOpen() {
  return !$('settings').classList.contains('hidden');
}

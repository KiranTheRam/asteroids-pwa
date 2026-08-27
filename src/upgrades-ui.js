// Roguelite upgrades panel: spend minerals on permanent bonuses.
import { UPGRADES, COLORS } from './config.js';
import { getRoguelite, setRoguelite } from './storage.js';

const $ = (id) => document.getElementById(id);
let returnFocus = null;

function render() {
  const rl = getRoguelite();
  const upg = rl.upgrades || {};

  $('upg-minerals').textContent = rl.minerals;

  const list = $('upgrade-list');
  list.innerHTML = '';

  for (const def of UPGRADES) {
    const level = upg[def.key] || 0;
    const maxLevel = def.costs.length;
    const nextCost = level < maxLevel ? def.costs[level] : null;
    const maxed = level >= maxLevel;
    const canAfford = !maxed && rl.minerals >= nextCost;

    const row = document.createElement('div');
    row.className = 'upg-row';

    const info = document.createElement('div');
    info.className = 'upg-info';
    const name = document.createElement('span');
    name.className = 'upg-name';
    name.textContent = def.label;
    const hint = document.createElement('span');
    hint.className = 'upg-hint';
    hint.textContent = def.hint;
    info.appendChild(name);
    info.appendChild(hint);

    const right = document.createElement('div');
    right.className = 'upg-right';

    const lvlEl = document.createElement('span');
    lvlEl.className = 'upg-level';
    lvlEl.textContent = maxed ? 'MAX' : `${level}/${maxLevel}`;

    const btn = document.createElement('button');
    btn.className = 'upg-buy' + (canAfford ? ' can-afford' : '');
    btn.disabled = !canAfford;
    btn.textContent = maxed ? '—' : `${nextCost} ⬡`;
    btn.addEventListener('click', () => {
      const current = getRoguelite();
      const cost = def.costs[(current.upgrades[def.key] || 0)];
      if (current.minerals < cost) return;
      current.minerals -= cost;
      current.upgrades[def.key] = (current.upgrades[def.key] || 0) + 1;
      setRoguelite(current);
      render();
    });

    right.appendChild(lvlEl);
    right.appendChild(btn);
    row.appendChild(info);
    row.appendChild(right);
    list.appendChild(row);
  }
}

export function initUpgradesUI() {
  $('upg-close').addEventListener('click', closeUpgrades);
  $('upg-close-top').addEventListener('click', closeUpgrades);
  $('upg-open').addEventListener('click', openUpgrades);
  $('upgrades').addEventListener('pointerdown', (e) => {
    if (e.target === $('upgrades')) closeUpgrades();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isUpgradesOpen()) closeUpgrades();
  });
}

export function openUpgrades() {
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  render();
  $('upgrades').classList.remove('hidden');
  $('upgrades').querySelector('.panel').scrollTop = 0;
  requestAnimationFrame(() => $('upg-close-top').focus({ preventScroll: true }));
}

export function closeUpgrades() {
  $('upgrades').classList.add('hidden');
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  returnFocus = null;
}

export function isUpgradesOpen() {
  return !$('upgrades').classList.contains('hidden');
}

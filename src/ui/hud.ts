/**
 * The in-match HUD: live scoreboard with hearts, match clock, map caption and
 * the pause / result overlays.
 *
 * Deliberately DOM rather than canvas text — it gets crisp type, real text
 * wrapping and screen-reader access for free, and it keeps the WebGL frame
 * budget entirely for the arena.
 */

import { MATCH_TIME_SECONDS, SUDDEN_DEATH_START } from '../core/constants';
import type { GameState, MapDef } from '../core/types';
import { PLAYER_COLORS } from '../render/atlas';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatClock(seconds: number): string {
  const clamped = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export class Hud {
  readonly root = el('div', 'hud');

  private scoreboard = el('div', 'scoreboard');
  private clock = el('div', 'hud-clock');
  private caption = el('div', 'hud-map');
  private hint = el('div', 'hud-hint');
  private cards = new Map<number, {
    row: HTMLElement;
    name: HTMLElement;
    points: HTMLElement;
    hearts: HTMLElement;
  }>();

  constructor(def: MapDef) {
    const top = el('div', 'hud-top');
    top.append(this.scoreboard, this.clock);

    const bottom = el('div', 'hud-bottom');
    this.caption.innerHTML = `<strong>${def.name}</strong> — ${def.district}`;
    this.hint.textContent = 'Arrows / WASD to move · Space to drop · P to pause · Esc to leave';
    bottom.append(this.caption, this.hint);

    this.root.append(top, bottom);
  }

  update(state: GameState, localSlot: number): void {
    const remaining = MATCH_TIME_SECONDS - state.time;
    this.clock.textContent = formatClock(remaining);
    this.clock.classList.toggle('is-urgent', state.time >= SUDDEN_DEATH_START);

    for (const player of state.players) {
      let card = this.cards.get(player.id);
      if (!card) {
        const row = el('div', 'score-card');
        const chip = el('span', 'score-chip');
        chip.style.background = PLAYER_COLORS[player.id % PLAYER_COLORS.length];
        const name = el('span', 'score-name');
        const points = el('span', 'score-points');
        const hearts = el('span', 'score-hearts');
        row.append(chip, name, points, hearts);
        this.scoreboard.append(row);
        card = { row, name, points, hearts };
        this.cards.set(player.id, card);
      }

      const label = player.id === localSlot ? `${player.name} (you)` : player.name;
      if (card.name.textContent !== label) card.name.textContent = label;

      const points = String(player.score);
      if (card.points.textContent !== points) card.points.textContent = points;

      card.row.classList.toggle('is-out', !player.alive && player.lives <= 0);

      // Hearts only matter where a player has spare lives (solo and campaign).
      if (player.maxLives > 1 && card.hearts.childElementCount !== player.maxLives) {
        card.hearts.replaceChildren(
          ...Array.from({ length: player.maxLives }, () => el('span', 'heart'))
        );
      }
      if (player.maxLives > 1) {
        Array.from(card.hearts.children).forEach((heart, index) => {
          heart.classList.toggle('is-spent', index >= player.lives);
        });
      }
    }

    const local = state.players[localSlot];
    if (state.status === 'running' && local && !local.alive) {
      this.hint.textContent =
        local.lives <= 0 ? 'You are out — Space to skip ahead' : 'Respawning…';
    }
  }
}

export interface OverlayAction {
  label: string;
  primary?: boolean;
  onSelect: () => void;
}

/** A dismissible modal card. Returns a handle that removes it. */
export function showOverlay(
  parent: HTMLElement,
  title: string,
  body: string,
  actions: OverlayAction[],
  scores?: string[]
): () => void {
  const overlay = el('div', 'overlay');
  const card = el('div', 'overlay-card');
  card.append(el('h2', undefined, title));
  if (body) card.append(el('p', undefined, body));
  if (scores && scores.length > 0) {
    card.append(el('div', 'result-scores', scores.join('\n')));
  }

  const row = el('div', 'overlay-actions');
  actions.forEach((action, index) => {
    const button = el('button', action.primary ? 'primary' : undefined, action.label);
    button.addEventListener('click', action.onSelect);
    if (index === 0) requestAnimationFrame(() => button.focus());
    row.append(button);
  });
  card.append(row);
  overlay.append(card);
  parent.append(overlay);

  return () => overlay.remove();
}

/**
 * Attract mode: a real bot match running behind the menu.
 *
 * This is what an arcade cabinet does when nobody has inserted a coin, and it
 * is why the menu has motion without a single frame of bespoke animation — it
 * is the actual game, on the actual renderer, with the actual bots. Arenas
 * rotate, matches restart, and the whole thing is silent so the title track
 * keeps the room.
 */

import { BotController } from '../ai/bot';
import { TICK_DT } from '../core/constants';
import { createGame, step } from '../core/game';
import type { GameState, PlayerInput, RosterEntry } from '../core/types';
import { BoardRenderer } from '../render/board';
import { EffectsDriver } from '../render/effects';
import { PlayerAnimator } from '../render/visuals';
import { MAPS } from '../maps';

/** Seconds the podium is held before the next arena loads. */
const RESULT_HOLD = 2.4;

/** Demo bots only — the roster is never a human. */
const ROSTER: RosterEntry[] = [
  { kind: 'bot', name: 'Nils' },
  { kind: 'bot', name: 'Astrid' },
  { kind: 'bot', name: 'Erik' },
  { kind: 'bot', name: 'Greta' },
];

export class AttractMode {
  private canvas: HTMLCanvasElement;
  private board!: BoardRenderer;
  private state!: GameState;
  private bots: BotController[] = [];
  private animator = new PlayerAnimator();
  private effects!: EffectsDriver;

  private mapIndex: number;
  private accumulator = 0;
  private lastTime = 0;
  private shake = 0;
  private shakePhase = 0;
  private holding = 0;
  private running = true;

  constructor(canvas: HTMLCanvasElement, startIndex = Math.floor(Math.random() * MAPS.length)) {
    this.canvas = canvas;
    this.mapIndex = startIndex % MAPS.length;
    this.load();
    window.addEventListener('resize', this.onResize);
    this.lastTime = performance.now();
    requestAnimationFrame(this.loop);
  }

  /** The arena currently on show, for the menu caption. */
  get arenaName(): string {
    return MAPS[this.mapIndex].def.name;
  }

  private load(): void {
    this.board?.dispose();
    const entry = MAPS[this.mapIndex];
    // A fresh seed per cycle so the crate layout differs every time.
    const seed = (Date.now() ^ (Math.random() * 0x7fffffff)) | 0;
    this.state = createGame(entry.def, ROSTER, seed);
    this.bots = ROSTER.map((_, slot) => new BotController(slot));
    this.animator.reset();
    this.board = new BoardRenderer(this.canvas, entry.theme, entry.def.id, seed);
    this.effects = new EffectsDriver(this.board, null);
    this.effects.seed(this.state);
    this.accumulator = 0;
    this.holding = 0;
    this.shake = 0;
  }

  private next(): void {
    this.mapIndex = (this.mapIndex + 1) % MAPS.length;
    this.load();
  }

  private onResize = (): void => {
    this.board.resize();
  };

  private loop = (now: number): void => {
    if (!this.running) return;
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;

    if (this.state.status === 'running') {
      this.accumulator += dt;
      while (this.accumulator >= TICK_DT) {
        this.accumulator -= TICK_DT;
        const inputs: PlayerInput[] = this.state.players.map((p) =>
          this.bots[p.id].update(this.state, TICK_DT)
        );
        step(this.state, inputs, TICK_DT);
        this.shake = Math.min(1, this.shake + this.effects.react(this.state));
      }
    } else {
      this.holding += dt;
      if (this.holding >= RESULT_HOLD) {
        this.next();
        requestAnimationFrame(this.loop);
        return;
      }
    }

    this.animator.advance(this.state, dt);

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 3.2);
      this.shakePhase += dt;
      // Half the amplitude of a real match: the menu must stay readable.
      const amp = this.shake * this.shake * 11;
      this.board.setShake(
        Math.sin(this.shakePhase * 74) * amp,
        Math.cos(this.shakePhase * 91) * amp
      );
    } else {
      this.board.setShake(0, 0);
    }

    // -1 marks nobody as local, so no "this is you" ring appears.
    this.board.sync(this.state, this.animator.visuals(this.state, -1));
    this.board.render(dt);
    requestAnimationFrame(this.loop);
  };

  dispose(): void {
    this.running = false;
    window.removeEventListener('resize', this.onResize);
    this.board?.dispose();
  }
}

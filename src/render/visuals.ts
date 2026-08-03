/**
 * Turns simulation state into per-character presentation: facing, walk cycle,
 * plant crouch, panic, death fade and respawn blink.
 *
 * Shared by the live match and the menu's attract mode, so demo play looks
 * exactly like real play. Nothing here writes to GameState.
 */

import type { GameState } from '../core/types';
import type { PlayerVisual } from './board';

/** Seconds a defeated character lingers while fading out. */
const DEATH_FADE = 0.7;

/** Seconds the plant animation plays after dropping a bomb. */
const PLANT_TIME = 0.24;

/** Fuse seconds below which a threatened tile makes a character panic. */
const PANIC_FUSE = 0.8;

type Facing = 'down' | 'up' | 'left' | 'right';

interface Anim {
  x: number;
  y: number;
  facing: Facing;
  moving: boolean;
  /** Animation clock in 60 Hz frames, matching ANIM_TICKS units. */
  ticks: number;
  /** Seconds since the death fade began; -1 while alive. */
  deathTime: number;
  plantTime: number;
}

export class PlayerAnimator {
  private anims = new Map<number, Anim>();
  private frame = 0;

  /** Advances every character's animation clock by `dt` seconds. */
  advance(state: GameState, dt: number): void {
    this.frame += dt * 60;
    const frames = dt * 60;

    for (const player of state.players) {
      let anim = this.anims.get(player.id);
      if (!anim) {
        anim = {
          x: player.pos.x,
          y: player.pos.y,
          facing: 'down',
          moving: false,
          ticks: 0,
          deathTime: -1,
          plantTime: 0,
        };
        this.anims.set(player.id, anim);
      }

      anim.plantTime = Math.max(0, anim.plantTime - dt);

      if (!player.alive) {
        anim.deathTime = anim.deathTime < 0 ? 0 : anim.deathTime + dt;
        anim.moving = false;
        anim.ticks += frames;
        continue;
      }
      if (anim.deathTime >= 0) {
        // Respawned: clear the death clock so the fade does not linger.
        anim.deathTime = -1;
        anim.ticks = 0;
      }

      const dx = player.pos.x - anim.x;
      const dy = player.pos.y - anim.y;
      anim.moving = Math.abs(dx) + Math.abs(dy) > 1e-4;
      if (anim.moving) {
        anim.facing =
          Math.abs(dx) >= Math.abs(dy)
            ? dx > 0
              ? 'right'
              : 'left'
            : dy > 0
              ? 'down'
              : 'up';
      }
      anim.x = player.pos.x;
      anim.y = player.pos.y;
      anim.ticks += frames;

      // A bomb this player just dropped under themselves plays the plant pose.
      const justPlanted = state.bombs.some(
        (b) =>
          b.owner === player.id &&
          b.x === Math.floor(player.pos.x) &&
          b.y === Math.floor(player.pos.y) &&
          b.fuse > 1.9
      );
      if (justPlanted) anim.plantTime = PLANT_TIME;
    }
  }

  /** True when a live bomb threatens this tile soon: drives the panic pose. */
  private inDanger(state: GameState, x: number, y: number): boolean {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    return state.bombs.some((bomb) => {
      if (bomb.fuse > PANIC_FUSE) return false;
      if (bomb.x === cx && bomb.y === cy) return true;
      if (bomb.x === cx) return Math.abs(bomb.y - cy) <= bomb.range;
      if (bomb.y === cy) return Math.abs(bomb.x - cx) <= bomb.range;
      return false;
    });
  }

  /** Builds this frame's draw list. `localSlot` of -1 marks nobody as local. */
  visuals(state: GameState, localSlot: number): PlayerVisual[] {
    const out: PlayerVisual[] = [];
    const finished = state.status === 'finished';

    for (const player of state.players) {
      const anim = this.anims.get(player.id);
      if (!anim) continue;

      if (!player.alive) {
        const fade = anim.deathTime < 0 ? 0 : Math.min(1, anim.deathTime / DEATH_FADE);
        if (fade >= 1) continue;
        out.push({
          slot: player.id,
          x: player.pos.x,
          y: player.pos.y,
          anim: 'die',
          tick: anim.ticks,
          flip: false,
          alpha: 1 - fade,
          lift: fade * 26,
          local: player.id === localSlot,
        });
        continue;
      }

      let name: string;
      if (finished && state.winner === player.id) name = 'win';
      else if (anim.plantTime > 0) name = 'plant';
      else if (anim.moving) {
        name =
          anim.facing === 'up'
            ? 'walk-up'
            : anim.facing === 'down'
              ? 'walk-down'
              : 'walk-side';
      } else if (this.inDanger(state, player.pos.x, player.pos.y)) name = 'panic';
      else {
        name =
          anim.facing === 'up'
            ? 'idle-up'
            : anim.facing === 'down'
              ? 'idle-down'
              : 'idle-side';
      }

      // Respawn grace reads as a fast blink.
      const blink =
        player.invulnFor > 0 && Math.floor(this.frame / 3) % 2 === 1 ? 0.35 : 1;

      out.push({
        slot: player.id,
        x: player.pos.x,
        y: player.pos.y,
        anim: name,
        tick: anim.ticks,
        flip: anim.facing === 'left',
        alpha: blink,
        lift: 0,
        local: player.id === localSlot,
      });
    }
    return out;
  }

  reset(): void {
    this.anims.clear();
    this.frame = 0;
  }
}

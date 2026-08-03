/**
 * The single sprite atlas the board renderer draws from, painted on a canvas
 * at match start from the map's MapTheme and the procedural materials.
 *
 * Everything the arena needs lives in one texture on one uniform grid, which
 * is what lets blocks, bombs, flames and players share a single InstancedMesh
 * — and therefore render in one draw call with a correct painter's y-sort
 * (instances are filled row by row, and instance order is draw order).
 *
 * Layout rule for every cell: the entity's tile footprint is the centred
 * 64x64 region at the bottom of the 96x96 cell, so a sprite quad is always
 * 1.5x TILE, horizontally centred and bottom-aligned to its tile.
 */

import { ANIM_TICKS, ANIMS, CELL, drawBomber } from './sprites';
import { type ArenaMaterials, canvas2d, mix, Rng, shade } from './textures';
import type { MapTheme } from './theme';

/** Cells per atlas row. */
const GRID = 16;

/** Tile footprint inside a cell. */
const FOOT = 64;
const FOOT_X = (CELL - FOOT) / 2;
const FOOT_Y = CELL - FOOT;

/** How far a block's top face is lifted above its footprint, in cell px. */
const LIFT = 22;

export const PLAYER_COLORS = [
  '#4f9dde',
  '#e2574c',
  '#57b26a',
  '#e0b34c',
  '#9a6dd7',
  '#5bc8c4',
] as const;

export const CHAR_VARIANTS = PLAYER_COLORS.length;

/** Named single-cell sprites. Values are filled in by buildAtlas. */
export interface AtlasTable {
  wall: number;
  suddenWall: number;
  /** Crate at damage stage 0, 1, 2. */
  crate: [number, number, number];
  shadow: number;
  ring: number;
  panel: number;
  decor: number;
  /** Six-frame bomb fuse cycle. */
  bomb: number[];
  flameCenter: number;
  flameH: number;
  flameV: number;
  flameTipL: number;
  flameTipR: number;
  flameTipU: number;
  flameTipD: number;
  powerBomb: number;
  powerFlame: number;
  powerSpeed: number;
  /** anim name -> [firstCell, frameCount, ticksPerFrame] per colour variant. */
  chars: Array<Record<string, [number, number, number]>>;
}

export interface Atlas {
  canvas: HTMLCanvasElement;
  table: AtlasTable;
  /** Cells per row, needed by the sprite shader. */
  grid: number;
}

/** Draws a tiling material patch into a rect, cropping to the current path. */
function fillWithMaterial(
  g: CanvasRenderingContext2D,
  material: HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  const pattern = g.createPattern(material, 'repeat')!;
  g.save();
  g.translate(x, y);
  g.fillStyle = pattern;
  g.fillRect(0, 0, w, h);
  g.restore();
}

/**
 * A 2.5D block: lifted top face, shaded front face, lit and shadowed edges.
 * `damage` (0..1) cracks the surface open to reveal the interior material.
 */
function drawBlock(
  g: CanvasRenderingContext2D,
  theme: MapTheme,
  face: HTMLCanvasElement,
  interior: HTMLCanvasElement,
  top: string,
  edge: string,
  damage: number,
  rng: Rng
): void {
  const x = FOOT_X;
  const w = FOOT;
  const topY = FOOT_Y - LIFT;
  const frontY = topY + FOOT - LIFT;
  const frontH = CELL - frontY;

  // --- front face
  g.save();
  g.beginPath();
  g.rect(x, frontY, w, frontH);
  g.clip();
  fillWithMaterial(g, face, x, frontY - 20, w, frontH + 20);
  // Directional shading across the front.
  const lightFromLeft = theme.lightDir.x < 0;
  const grad = g.createLinearGradient(x, 0, x + w, 0);
  grad.addColorStop(0, `rgba(0,0,0,${lightFromLeft ? 0.02 : 0.3})`);
  grad.addColorStop(1, `rgba(0,0,0,${lightFromLeft ? 0.3 : 0.02})`);
  g.fillStyle = grad;
  g.fillRect(x, frontY, w, frontH);
  const drop = g.createLinearGradient(0, frontY, 0, CELL);
  drop.addColorStop(0, 'rgba(0,0,0,0)');
  drop.addColorStop(1, 'rgba(0,0,0,0.34)');
  g.fillStyle = drop;
  g.fillRect(x, frontY, w, frontH);
  g.restore();

  // --- top face
  g.save();
  g.beginPath();
  g.rect(x, topY, w, FOOT - LIFT + 1);
  g.clip();
  fillWithMaterial(g, face, x, topY, w, FOOT);
  g.fillStyle = mix(top, '#ffffff', 0.0);
  g.globalAlpha = 0.55;
  g.fillRect(x, topY, w, FOOT - LIFT + 1);
  g.globalAlpha = 1;
  // Sun rake across the top.
  const sun = g.createLinearGradient(x, topY, x + w, topY + FOOT - LIFT);
  sun.addColorStop(0, `rgba(255,255,255,${lightFromLeft ? 0.2 : 0.05})`);
  sun.addColorStop(1, `rgba(255,255,255,${lightFromLeft ? 0.05 : 0.2})`);
  g.fillStyle = sun;
  g.fillRect(x, topY, w, FOOT - LIFT + 1);
  g.restore();

  // --- damage: cracks widening into holes that expose the interior
  if (damage > 0) {
    g.save();
    g.beginPath();
    g.rect(x, topY, w, CELL - topY);
    g.clip();
    const holes = Math.round(1 + damage * 3);
    for (let i = 0; i < holes; i++) {
      const hx = x + rng.range(w * 0.15, w * 0.85);
      const hy = topY + rng.range(FOOT * 0.2, CELL - topY - 6);
      const hr = rng.range(4, 6 + damage * 9);
      g.save();
      g.beginPath();
      g.moveTo(hx + hr, hy);
      for (let a = 1; a <= 7; a++) {
        const ang = (a / 7) * Math.PI * 2;
        const rr = hr * rng.range(0.6, 1.25);
        g.lineTo(hx + Math.cos(ang) * rr, hy + Math.sin(ang) * rr * 0.8);
      }
      g.closePath();
      g.clip();
      fillWithMaterial(g, interior, hx - hr * 1.5, hy - hr * 1.5, hr * 3, hr * 3);
      g.restore();
      // Lip of the hole catches light on the top edge.
      g.strokeStyle = 'rgba(0,0,0,0.45)';
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(hx, hy, hr * 0.95, 0, Math.PI, true);
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.16)';
      g.beginPath();
      g.arc(hx, hy, hr * 0.95, 0, Math.PI);
      g.stroke();
    }
    // Hairline cracks radiating out.
    g.strokeStyle = mix(theme.crate.crack, '#000000', 0.3);
    for (let i = 0; i < 3 + damage * 4; i++) {
      g.lineWidth = rng.range(0.8, 1.9);
      let cx2 = x + rng.range(6, w - 6);
      let cy2 = topY + rng.range(8, CELL - topY - 8);
      g.beginPath();
      g.moveTo(cx2, cy2);
      for (let s = 0; s < 4; s++) {
        cx2 += rng.range(-9, 9);
        cy2 += rng.range(2, 10);
        g.lineTo(cx2, cy2);
      }
      g.stroke();
    }
    g.restore();
  }

  // --- outline and the lit ridge along the top edge
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.lineWidth = 2;
  g.strokeRect(x + 1, topY + 1, w - 2, CELL - topY - 2);
  g.strokeStyle = shade(edge, 0.35);
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(x + 1.5, topY + 1.5);
  g.lineTo(x + w - 1.5, topY + 1.5);
  g.stroke();
  // Seam where the top meets the front.
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(x + 1, frontY);
  g.lineTo(x + w - 1, frontY);
  g.stroke();
}

/** One bomb frame: dark sphere, taut fuse, spark growing with the fuse. */
function drawBomb(g: CanvasRenderingContext2D, frame: number, theme: MapTheme): void {
  const cx = CELL / 2;
  const cy = FOOT_Y + FOOT * 0.55;
  const t = frame / 5;
  const r = FOOT * 0.34 * (1 + 0.05 * Math.sin(frame * 1.6));

  g.fillStyle = 'rgba(0,0,0,0.26)';
  g.beginPath();
  g.ellipse(cx, cy + r * 0.86, r * 1.05, r * 0.32, 0, 0, 7);
  g.fill();

  const body = g.createRadialGradient(cx - r * 0.3, cy - r * 0.4, r * 0.1, cx, cy, r);
  body.addColorStop(0, '#4a4f5e');
  body.addColorStop(0.55, '#252932');
  body.addColorStop(1, '#12141a');
  g.fillStyle = body;
  g.beginPath();
  g.arc(cx, cy, r, 0, 7);
  g.fill();
  g.strokeStyle = '#0b0d11';
  g.lineWidth = 2.4;
  g.stroke();

  // Rim light from the map's key light.
  g.strokeStyle = `rgba(255,255,255,${0.18 + t * 0.25})`;
  g.lineWidth = 2;
  g.beginPath();
  g.arc(cx, cy, r - 1.4, Math.PI * 1.05, Math.PI * 1.6);
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.4)';
  g.beginPath();
  g.ellipse(cx - r * 0.34, cy - r * 0.42, r * 0.2, r * 0.14, -0.5, 0, 7);
  g.fill();

  // Collar and fuse.
  g.fillStyle = '#5c4326';
  g.beginPath();
  g.roundRect(cx - 5, cy - r - 5, 10, 8, 2);
  g.fill();
  g.strokeStyle = '#0b0d11';
  g.lineWidth = 2;
  g.stroke();
  const wobble = Math.sin(frame * 2.1) * 4;
  g.strokeStyle = '#c8ab74';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(cx, cy - r - 4);
  g.quadraticCurveTo(cx + 6 + wobble, cy - r - 14, cx + 10 + wobble, cy - r - 20);
  g.stroke();

  // Spark, brighter and bigger as the fuse burns down.
  const sx = cx + 10 + wobble;
  const sy = cy - r - 20;
  const sparkR = 3.5 + t * 4;
  const halo = g.createRadialGradient(sx, sy, 0, sx, sy, sparkR * 3);
  halo.addColorStop(0, theme.flame.core);
  halo.addColorStop(0.35, `${theme.flame.edge}88`);
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = halo;
  g.beginPath();
  g.arc(sx, sy, sparkR * 3, 0, 7);
  g.fill();
  g.fillStyle = '#fffdf0';
  g.beginPath();
  g.arc(sx, sy, sparkR * 0.7, 0, 7);
  g.fill();
  // Sparks flying off.
  for (let i = 0; i < 4; i++) {
    const a = frame * 1.3 + i * 1.7;
    const d = sparkR * (1.6 + (i % 2));
    g.fillStyle = i % 2 === 0 ? theme.flame.core : theme.flame.edge;
    g.beginPath();
    g.arc(sx + Math.cos(a) * d, sy + Math.sin(a) * d * 0.8, 1.3, 0, 7);
    g.fill();
  }
}

type FlameShape = 'center' | 'h' | 'v' | 'tipL' | 'tipR' | 'tipU' | 'tipD';

/** A billowing blast piece. Shapes connect seamlessly across tiles. */
function drawFlame(
  g: CanvasRenderingContext2D,
  shape: FlameShape,
  theme: MapTheme,
  rng: Rng
): void {
  const cx = CELL / 2;
  const cy = FOOT_Y + FOOT / 2;
  const half = FOOT / 2;

  // Reach: how far the piece extends past the tile toward each neighbour.
  const reach = { l: 0, r: 0, u: 0, d: 0 };
  if (shape === 'center') {
    reach.l = reach.r = reach.u = reach.d = half;
  } else if (shape === 'h') {
    reach.l = reach.r = half;
    reach.u = reach.d = half * 0.62;
  } else if (shape === 'v') {
    reach.u = reach.d = half;
    reach.l = reach.r = half * 0.62;
  } else {
    const soft = half * 0.55;
    reach.l = shape === 'tipR' ? half : soft;
    reach.r = shape === 'tipL' ? half : soft;
    reach.u = shape === 'tipD' ? half : soft;
    reach.d = shape === 'tipU' ? half : soft;
    if (shape === 'tipL') reach.l = half * 0.9;
    if (shape === 'tipR') reach.r = half * 0.9;
    if (shape === 'tipU') reach.u = half * 0.9;
    if (shape === 'tipD') reach.d = half * 0.9;
  }

  // Outer glow.
  const glowR = Math.max(reach.l, reach.r, reach.u, reach.d) * 1.5;
  const glow = g.createRadialGradient(cx, cy, 0, cx, cy, glowR);
  glow.addColorStop(0, `${theme.flame.core}cc`);
  glow.addColorStop(0.45, `${theme.flame.edge}66`);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = glow;
  g.beginPath();
  g.arc(cx, cy, glowR, 0, 7);
  g.fill();

  // Layered billows: edge tint outside, hot core inside.
  const layers: Array<[number, string]> = [
    [1.0, theme.flame.edge],
    [0.72, theme.flame.core],
    [0.42, '#fff6dc'],
  ];
  for (const [scale, color] of layers) {
    g.fillStyle = color;
    g.beginPath();
    const lobes = 14;
    for (let i = 0; i <= lobes; i++) {
      const a = (i / lobes) * Math.PI * 2;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      // Blend the horizontal and vertical reach by how much this angle points
      // along each axis, so beams stay square-ended and centres stay round.
      const horiz = (cos > 0 ? reach.r : reach.l) * Math.abs(cos);
      const vert = (sin > 0 ? reach.d : reach.u) * Math.abs(sin);
      const rr = (horiz + vert) * scale * rng.range(0.86, 1.12);
      const px = cx + Math.cos(a) * rr;
      const py = cy + Math.sin(a) * rr;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.fill();
  }

  // Licks of fire escaping upward.
  for (let i = 0; i < 5; i++) {
    const a = rng.range(-2.6, -0.5);
    const d = rng.range(half * 0.4, half * 0.95);
    g.fillStyle = i % 2 === 0 ? '#fff6dc' : theme.flame.core;
    g.beginPath();
    g.ellipse(
      cx + Math.cos(a) * d,
      cy + Math.sin(a) * d,
      rng.range(2, 5),
      rng.range(4, 9),
      a + Math.PI / 2,
      0,
      7
    );
    g.fill();
  }
}

/** Power-up icons, drawn to read at a glance on a small tile. */
function drawPowerIcon(
  g: CanvasRenderingContext2D,
  kind: 'bomb' | 'flame' | 'speed',
  theme: MapTheme
): void {
  const cx = CELL / 2;
  const cy = FOOT_Y + FOOT / 2;
  const r = FOOT * 0.3;

  if (kind === 'bomb') {
    g.fillStyle = '#22262f';
    g.beginPath();
    g.arc(cx, cy + 2, r, 0, 7);
    g.fill();
    g.strokeStyle = '#0b0d11';
    g.lineWidth = 2.4;
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.42)';
    g.beginPath();
    g.ellipse(cx - r * 0.34, cy - r * 0.38, r * 0.22, r * 0.15, -0.5, 0, 7);
    g.fill();
    g.strokeStyle = '#c8ab74';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx, cy - r + 1);
    g.quadraticCurveTo(cx + 7, cy - r - 8, cx + 11, cy - r - 12);
    g.stroke();
    g.fillStyle = theme.flame.core;
    g.beginPath();
    g.arc(cx + 11, cy - r - 12, 3.4, 0, 7);
    g.fill();
    // A small "+1" plate so the pickup reads as an upgrade.
    g.fillStyle = '#fffdf0';
    g.font = '700 17px "Familjen Grotesk", system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.strokeStyle = '#0b0d11';
    g.lineWidth = 3.5;
    g.strokeText('+', cx - r * 0.85, cy + r * 0.75);
    g.fillText('+', cx - r * 0.85, cy + r * 0.75);
    return;
  }

  if (kind === 'flame') {
    const grad = g.createRadialGradient(cx, cy + r * 0.4, 1, cx, cy, r * 1.4);
    grad.addColorStop(0, '#fff6dc');
    grad.addColorStop(0.45, theme.flame.core);
    grad.addColorStop(1, theme.flame.edge);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(cx, cy - r * 1.25);
    g.bezierCurveTo(cx + r * 1.1, cy - r * 0.2, cx + r * 0.7, cy + r, cx, cy + r);
    g.bezierCurveTo(cx - r * 0.7, cy + r, cx - r * 1.1, cy - r * 0.2, cx, cy - r * 1.25);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = '#fffdf0';
    g.beginPath();
    g.moveTo(cx, cy - r * 0.35);
    g.bezierCurveTo(cx + r * 0.4, cy + r * 0.1, cx + r * 0.25, cy + r * 0.65, cx, cy + r * 0.7);
    g.bezierCurveTo(cx - r * 0.25, cy + r * 0.65, cx - r * 0.4, cy + r * 0.1, cx, cy - r * 0.35);
    g.closePath();
    g.fill();
    return;
  }

  // Speed: a chevron bolt with motion streaks.
  g.strokeStyle = 'rgba(255,255,255,0.5)';
  g.lineWidth = 2.4;
  for (let i = 0; i < 3; i++) {
    g.beginPath();
    g.moveTo(cx - r * 1.35, cy - r * 0.5 + i * r * 0.5);
    g.lineTo(cx - r * 0.7, cy - r * 0.5 + i * r * 0.5);
    g.stroke();
  }
  g.fillStyle = '#ffe066';
  g.beginPath();
  g.moveTo(cx + r * 0.15, cy - r * 1.2);
  g.lineTo(cx - r * 0.7, cy + r * 0.15);
  g.lineTo(cx - r * 0.05, cy + r * 0.15);
  g.lineTo(cx - r * 0.35, cy + r * 1.2);
  g.lineTo(cx + r * 0.8, cy - r * 0.3);
  g.lineTo(cx + r * 0.1, cy - r * 0.3);
  g.closePath();
  g.fill();
  g.strokeStyle = '#7a5a08';
  g.lineWidth = 2.2;
  g.stroke();
}

/** Sparse floor decor: a clump of vegetation or a bollard, per tileset. */
function drawDecor(g: CanvasRenderingContext2D, theme: MapTheme, rng: Rng): void {
  const cx = CELL / 2;
  const base = CELL - 8;
  const hard = theme.tileset === 'concrete' || theme.tileset === 'metro' || theme.tileset === 'plaza';

  g.fillStyle = 'rgba(0,0,0,0.2)';
  g.beginPath();
  g.ellipse(cx, base, 13, 4.5, 0, 0, 7);
  g.fill();

  if (hard) {
    // Bollard.
    g.fillStyle = shade(theme.accent, -0.1);
    g.beginPath();
    g.roundRect(cx - 5, base - 26, 10, 26, [5, 5, 2, 2]);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.28)';
    g.fillRect(cx - 3.5, base - 24, 2.4, 22);
    g.fillStyle = '#fffdf0';
    g.fillRect(cx - 5, base - 19, 10, 3);
    return;
  }

  // Vegetation: a few overlapping leafy lobes.
  for (let i = 0; i < 7; i++) {
    const a = rng.range(-Math.PI, 0);
    const d = rng.range(0, 11);
    g.fillStyle = mix(theme.accent, i % 2 === 0 ? '#ffffff' : '#000000', rng.range(0.02, 0.24));
    g.beginPath();
    g.ellipse(
      cx + Math.cos(a) * d,
      base - 8 + Math.sin(a) * 6,
      rng.range(6, 11),
      rng.range(5, 9),
      rng.range(0, 3),
      0,
      7
    );
    g.fill();
  }
  g.strokeStyle = 'rgba(0,0,0,0.28)';
  g.lineWidth = 1.6;
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.moveTo(cx + rng.range(-7, 7), base);
    g.lineTo(cx + rng.range(-9, 9), base - rng.range(9, 17));
    g.stroke();
  }
}

/** Contact shadow blob, tinted per instance. */
function drawShadow(g: CanvasRenderingContext2D): void {
  const cx = CELL / 2;
  const cy = CELL - 14;
  const grad = g.createRadialGradient(cx, cy, 1, cx, cy, 26);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.4)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.save();
  g.translate(cx, cy);
  g.scale(1, 0.36);
  g.translate(-cx, -cy);
  g.fillStyle = grad;
  g.beginPath();
  g.arc(cx, cy, 26, 0, 7);
  g.fill();
  g.restore();
}

/** Slot marker ring under a player, tinted per instance. */
function drawRing(g: CanvasRenderingContext2D): void {
  const cx = CELL / 2;
  const cy = CELL - 14;
  g.save();
  g.translate(cx, cy);
  g.scale(1, 0.4);
  g.translate(-cx, -cy);
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 4;
  g.beginPath();
  g.arc(cx, cy, 21, 0, 7);
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.4)';
  g.lineWidth = 8;
  g.beginPath();
  g.arc(cx, cy, 21, 0, 7);
  g.stroke();
  g.restore();
}

/** Pedestal under a floating power-up. */
function drawPanel(g: CanvasRenderingContext2D, theme: MapTheme): void {
  const cx = CELL / 2;
  const cy = FOOT_Y + FOOT / 2;
  const r = FOOT * 0.42;
  const grad = g.createRadialGradient(cx, cy, 2, cx, cy, r);
  grad.addColorStop(0, `${theme.flame.core}55`);
  grad.addColorStop(0.7, `${theme.flame.edge}22`);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(cx, cy, r, 0, 7);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = 2;
  g.beginPath();
  g.roundRect(cx - r * 0.72, cy - r * 0.72, r * 1.44, r * 1.44, 8);
  g.stroke();
}

/**
 * Paints the whole atlas. Called once per match: ~200 small canvas draws,
 * well under the 300 ms load budget, and nothing runs per frame.
 */
export function buildAtlas(theme: MapTheme, materials: ArenaMaterials, seed: number): Atlas {
  // Count cells first so the canvas is exactly tall enough.
  const propCells = 26;
  const charCellsPerVariant = Object.values(ANIMS).reduce((n, frames) => n + frames.length, 0);
  const total = propCells + charCellsPerVariant * CHAR_VARIANTS;
  const rows = Math.ceil(total / GRID);

  const [canvas, g] = canvas2d(GRID * CELL, rows * CELL);
  g.imageSmoothingEnabled = true;

  let cell = 0;
  const at = (index: number): void => {
    g.setTransform(1, 0, 0, 1, (index % GRID) * CELL, Math.floor(index / GRID) * CELL);
  };
  const rng = new Rng(seed ^ 0x27d4eb2f);

  // --- blocks
  const wall = cell++;
  at(wall);
  drawBlock(g, theme, materials.wall, materials.interior, theme.wall.top, theme.wall.edge, 0, rng);

  const suddenWall = cell++;
  at(suddenWall);
  drawBlock(g, theme, materials.wall, materials.interior, theme.wall.top, theme.wall.edge, 0, rng);
  // Sudden-death blocks read hot so the closing ring is unmistakable.
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = `${theme.flame.edge}44`;
  g.fillRect(0, 0, CELL, CELL);
  g.globalCompositeOperation = 'source-over';

  const crate: [number, number, number] = [0, 0, 0];
  for (let stage = 0; stage < 3; stage++) {
    crate[stage] = cell++;
    at(crate[stage]);
    drawBlock(
      g,
      theme,
      materials.crate,
      materials.interior,
      theme.crate.top,
      theme.crate.crack,
      stage * 0.5,
      new Rng((seed ^ 0x165667b1) + stage * 7919)
    );
  }

  // --- markers
  const shadow = cell++;
  at(shadow);
  drawShadow(g);

  const ring = cell++;
  at(ring);
  drawRing(g);

  const panel = cell++;
  at(panel);
  drawPanel(g, theme);

  const decor = cell++;
  at(decor);
  drawDecor(g, theme, new Rng(seed ^ 0x5bf03635));

  // --- bombs
  const bomb: number[] = [];
  for (let f = 0; f < 6; f++) {
    bomb.push(cell++);
    at(bomb[f]);
    drawBomb(g, f, theme);
  }

  // --- flames
  const shapes: FlameShape[] = ['center', 'h', 'v', 'tipL', 'tipR', 'tipU', 'tipD'];
  const flameCells: number[] = [];
  for (const shape of shapes) {
    const index = cell++;
    flameCells.push(index);
    at(index);
    drawFlame(g, shape, theme, new Rng(seed ^ 0x9e3779b1));
  }

  // --- power-ups
  const powerBomb = cell++;
  at(powerBomb);
  drawPowerIcon(g, 'bomb', theme);
  const powerFlame = cell++;
  at(powerFlame);
  drawPowerIcon(g, 'flame', theme);
  const powerSpeed = cell++;
  at(powerSpeed);
  drawPowerIcon(g, 'speed', theme);

  // Pad to the reserved prop block so the character table starts predictably.
  cell = propCells;

  // --- characters, one full animation set per slot colour
  const chars: Array<Record<string, [number, number, number]>> = [];
  for (let variant = 0; variant < CHAR_VARIANTS; variant++) {
    const table: Record<string, [number, number, number]> = {};
    for (const [name, frames] of Object.entries(ANIMS)) {
      table[name] = [cell, frames.length, ANIM_TICKS[name] ?? 5];
      for (const pose of frames) {
        at(cell);
        drawBomber(g, pose, PLAYER_COLORS[variant]);
        cell++;
      }
    }
    chars.push(table);
  }

  g.setTransform(1, 0, 0, 1, 0, 0);

  return {
    canvas,
    grid: GRID,
    table: {
      wall,
      suddenWall,
      crate,
      shadow,
      ring,
      panel,
      decor,
      bomb,
      flameCenter: flameCells[0],
      flameH: flameCells[1],
      flameV: flameCells[2],
      flameTipL: flameCells[3],
      flameTipR: flameCells[4],
      flameTipU: flameCells[5],
      flameTipD: flameCells[6],
      powerBomb,
      powerFlame,
      powerSpeed,
      chars,
    },
  };
}

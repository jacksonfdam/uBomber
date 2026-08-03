/**
 * Procedural material synthesis. Every surface in the arena — floors, block
 * top and front faces, crate interiors — is drawn on a canvas at match start
 * from the map's MapTheme. The repo ships zero image assets.
 *
 * All patterns tile seamlessly at TEX px so the floor can repeat across the
 * board with a single texture.
 */

import type { FaceKind, MapTheme, TilesetKind } from './theme';

/** Edge length of every generated material patch, in texture pixels. */
export const TEX = 128;

/** Deterministic LCG: same theme + seed always paints the same surface. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0;
    return this.s / 0xffffffff;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length) % items.length];
  }
}

export function canvas2d(w = TEX, h = TEX): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Linear blend between two hex colours, returned as a css rgb() string. */
export function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const m = ca.map((v, i) => Math.round(v + (cb[i] - v) * t));
  return `rgb(${m[0]},${m[1]},${m[2]})`;
}

export function shade(hex: string, amount: number): string {
  return amount >= 0 ? mix(hex, '#ffffff', amount) : mix(hex, '#000000', -amount);
}

/** Tiling value-noise overlay for grime and tonal variation. */
function noiseOverlay(
  g: CanvasRenderingContext2D,
  rng: Rng,
  dark: string,
  light: string,
  cells: number,
  alpha: number
): void {
  const step = TEX / cells;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const v = rng.next();
      g.globalAlpha = alpha * Math.abs(v - 0.5) * 2;
      g.fillStyle = v > 0.5 ? light : dark;
      g.fillRect(x * step, y * step, step + 1, step + 1);
    }
  }
  g.globalAlpha = 1;
}

function grain(g: CanvasRenderingContext2D, rng: Rng, n: number, alpha: number): void {
  for (let i = 0; i < n; i++) {
    g.globalAlpha = alpha * rng.next();
    g.fillStyle = rng.next() > 0.5 ? '#ffffff' : '#000000';
    g.fillRect(rng.range(0, TEX), rng.range(0, TEX), rng.range(1, 2.2), rng.range(1, 2.2));
  }
  g.globalAlpha = 1;
}

/**
 * Draws `fn` at (x, y) and again wrapped around every edge it crosses, so
 * features that overhang the patch reappear on the opposite side.
 */
function tiled(x: number, y: number, fn: (ox: number, oy: number) => void): void {
  for (const dx of [0, -TEX, TEX]) {
    for (const dy of [0, -TEX, TEX]) {
      if (dx !== 0 && x > TEX * 0.25 && x < TEX * 0.75) continue;
      if (dy !== 0 && y > TEX * 0.25 && y < TEX * 0.75) continue;
      fn(x + dx, y + dy);
    }
  }
}

/** A rounded stone with a top highlight and a bottom shadow. */
function stone(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  radius: number
): void {
  tiled(x, y, (px, py) => {
    g.fillStyle = fill;
    g.beginPath();
    g.roundRect(px, py, w, h, radius);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.16)';
    g.lineWidth = 1.4;
    g.beginPath();
    g.roundRect(px + 0.7, py + 0.7, w - 1.4, h - 1.4, radius);
    g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.32)';
    g.beginPath();
    g.moveTo(px + radius, py + h - 0.5);
    g.lineTo(px + w - radius, py + h - 0.5);
    g.stroke();
  });
}

type Gen = (g: CanvasRenderingContext2D, t: MapTheme, rng: Rng) => void;

// ------------------------------------------------------------------ floors

/** Gamla Stan: irregular medieval cobbles in a running bond. */
const cobble: Gen = (g, t, rng) => {
  g.fillStyle = t.floor.grout;
  g.fillRect(0, 0, TEX, TEX);
  const rows = 6;
  const cols = 6;
  const ch = TEX / rows;
  const cw = TEX / cols;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const off = (r % 2) * (cw / 2);
      const px = (c * cw + off) % TEX;
      const w = cw - rng.range(3, 6);
      const h = ch - rng.range(3, 5);
      const tone = rng.next();
      const fill =
        tone < 0.3
          ? mix(t.floor.base, t.floor.alt, 0.8)
          : tone < 0.6
            ? mix(t.floor.base, t.floor.grout, 0.2)
            : t.floor.base;
      stone(g, px + 1.5, r * ch + 1.5, w, h, fill, Math.min(w, h) / 2.4);
    }
  }
  noiseOverlay(g, rng, '#1d150c', '#efe2c8', 16, 0.11);
  grain(g, rng, 420, 0.09);
};

/** T-Centralen: blasted bedrock with a painted cobalt wash. */
const metro: Gen = (g, t, rng) => {
  g.fillStyle = t.floor.base;
  g.fillRect(0, 0, TEX, TEX);
  for (let i = 0; i < 22; i++) {
    const x = rng.range(0, TEX);
    const y = rng.range(0, TEX);
    const r = rng.range(9, 26);
    tiled(x, y, (px, py) => {
      g.fillStyle = mix(
        t.floor.base,
        rng.next() > 0.55 ? t.floor.alt : t.floor.grout,
        rng.range(0.2, 0.6)
      );
      g.beginPath();
      g.arc(px, py, r, 0, 7);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.beginPath();
      g.arc(px - r * 0.25, py - r * 0.3, r * 0.55, 0, 7);
      g.fill();
    });
  }
  // Drill scars from blasting.
  g.strokeStyle = 'rgba(0,0,0,0.32)';
  for (let i = 0; i < 4; i++) {
    const x = rng.range(0, TEX);
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, TEX);
    g.stroke();
  }
  noiseOverlay(g, rng, '#0d1424', '#8a9ac8', 20, 0.14);
  grain(g, rng, 520, 0.1);
};

/** Södermalm: the Sergels-Torg-style triangle plattan, wet-sheened. */
const plaza: Gen = (g, t, rng) => {
  g.fillStyle = t.floor.grout;
  g.fillRect(0, 0, TEX, TEX);
  const s = TEX / 4;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const even = (x + y) % 2 === 0;
      g.fillStyle = even ? t.floor.base : t.floor.alt;
      g.beginPath();
      if (even) {
        g.moveTo(x * s, y * s + s);
        g.lineTo(x * s + s / 2, y * s);
        g.lineTo(x * s + s, y * s + s);
      } else {
        g.moveTo(x * s, y * s);
        g.lineTo(x * s + s, y * s);
        g.lineTo(x * s + s / 2, y * s + s);
      }
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.18)';
      g.lineWidth = 1;
      g.stroke();
    }
  }
  const sheen = g.createLinearGradient(0, 0, TEX, TEX);
  sheen.addColorStop(0, 'rgba(190,210,255,0.09)');
  sheen.addColorStop(0.5, 'rgba(190,210,255,0)');
  sheen.addColorStop(1, 'rgba(130,170,255,0.11)');
  g.fillStyle = sheen;
  g.fillRect(0, 0, TEX, TEX);
  grain(g, rng, 260, 0.06);
};

/** Östermalm: regular granite setts, the textbook boulevard grid. */
const setts: Gen = (g, t, rng) => {
  g.fillStyle = t.floor.grout;
  g.fillRect(0, 0, TEX, TEX);
  const n = 8;
  const s = TEX / n;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      g.fillStyle = mix(t.floor.base, t.floor.alt, rng.range(0, 0.7));
      g.fillRect(c * s + 1, r * s + 1, s - 2, s - 2);
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(c * s + 1, r * s + 1, s - 2, 1.2);
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.fillRect(c * s + 1, r * s + s - 2.2, s - 2, 1.2);
    }
  }
  noiseOverlay(g, rng, '#2a2724', '#dcd6cc', 24, 0.09);
  grain(g, rng, 360, 0.07);
};

/** Djurgården: mown grass over gravel paths. */
const park: Gen = (g, t, rng) => {
  g.fillStyle = t.floor.base;
  g.fillRect(0, 0, TEX, TEX);
  // Tonal patches of grass.
  for (let i = 0; i < 26; i++) {
    const x = rng.range(0, TEX);
    const y = rng.range(0, TEX);
    tiled(x, y, (px, py) => {
      g.fillStyle = mix(t.floor.base, t.floor.alt, rng.range(0.1, 0.7));
      g.beginPath();
      g.ellipse(px, py, rng.range(10, 28), rng.range(7, 18), rng.range(0, 3), 0, 7);
      g.fill();
    });
  }
  // Blades.
  for (let i = 0; i < 260; i++) {
    const x = rng.range(0, TEX);
    const y = rng.range(0, TEX);
    g.strokeStyle = rng.next() > 0.5 ? shade(t.floor.base, 0.18) : shade(t.floor.base, -0.2);
    g.lineWidth = rng.range(0.6, 1.3);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + rng.range(-2, 2), y - rng.range(3, 7));
    g.stroke();
  }
  grain(g, rng, 300, 0.07);
};

/** Vasastan: brick-paved courtyards between the housing blocks. */
const brick: Gen = (g, t, rng) => {
  g.fillStyle = t.floor.grout;
  g.fillRect(0, 0, TEX, TEX);
  const rows = 8;
  const h = TEX / rows;
  const bw = TEX / 4;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * (bw / 2);
    for (let c = -1; c < 4; c++) {
      const px = c * bw + off;
      g.fillStyle = mix(t.floor.base, t.floor.alt, rng.range(0, 0.65));
      g.fillRect(px + 1, r * h + 1, bw - 2, h - 2);
      g.fillStyle = 'rgba(255,255,255,0.10)';
      g.fillRect(px + 1, r * h + 1, bw - 2, 1);
      g.fillStyle = 'rgba(0,0,0,0.2)';
      g.fillRect(px + 1, r * h + h - 2, bw - 2, 1);
    }
  }
  noiseOverlay(g, rng, '#301a12', '#e2c2a4', 20, 0.1);
  grain(g, rng, 340, 0.08);
};

/** Kungsholmen: the Norr Mälarstrand quay — stone slabs beside the water. */
const quay: Gen = (g, t, rng) => {
  g.fillStyle = t.floor.grout;
  g.fillRect(0, 0, TEX, TEX);
  const rows = 4;
  const cols = 2;
  const ch = TEX / rows;
  const cw = TEX / cols;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const off = (r % 2) * (cw / 2);
      const px = (c * cw + off) % TEX;
      stone(
        g,
        px + 2,
        r * ch + 2,
        cw - 4,
        ch - 4,
        mix(t.floor.base, t.floor.alt, rng.range(0, 0.5)),
        3
      );
    }
  }
  // Damp streaks running toward the water.
  for (let i = 0; i < 6; i++) {
    const x = rng.range(0, TEX);
    const grad = g.createLinearGradient(0, 0, 0, TEX);
    grad.addColorStop(0, 'rgba(40,60,70,0.20)');
    grad.addColorStop(1, 'rgba(40,60,70,0)');
    g.fillStyle = grad;
    g.fillRect(x, 0, rng.range(5, 16), TEX);
  }
  noiseOverlay(g, rng, '#22292c', '#cfd8dc', 24, 0.1);
};

/** Skansen: falu-red boardwalk planking over the terraces. */
const timber: Gen = (g, t, rng) => {
  g.fillStyle = t.floor.grout;
  g.fillRect(0, 0, TEX, TEX);
  const rows = 4;
  const h = TEX / rows;
  for (let r = 0; r < rows; r++) {
    g.fillStyle = mix(t.floor.base, t.floor.alt, rng.range(0.05, 0.5));
    g.fillRect(0, r * h + 1, TEX, h - 2);
    // Wood grain.
    for (let i = 0; i < 9; i++) {
      g.strokeStyle = `rgba(40,14,8,${rng.range(0.07, 0.2)})`;
      g.lineWidth = rng.range(0.5, 1.3);
      const gy = r * h + rng.range(3, h - 3);
      g.beginPath();
      g.moveTo(0, gy);
      g.bezierCurveTo(TEX * 0.3, gy + rng.range(-2, 2), TEX * 0.7, gy + rng.range(-2, 2), TEX, gy);
      g.stroke();
    }
    g.fillStyle = 'rgba(255,250,235,0.16)';
    g.fillRect(0, r * h + 1, TEX, 1.2);
    g.fillStyle = 'rgba(0,0,0,0.26)';
    g.fillRect(0, r * h + h - 2, TEX, 1.4);
    // Nail heads.
    for (const nx of [TEX * 0.18, TEX * 0.52, TEX * 0.85]) {
      g.fillStyle = 'rgba(22,10,6,0.55)';
      g.beginPath();
      g.arc(nx + rng.range(-4, 4), r * h + h / 2, 1.6, 0, 7);
      g.fill();
    }
  }
  grain(g, rng, 260, 0.07);
};

/** Slussen: the interchange as a live construction site. */
const concrete: Gen = (g, t, rng) => {
  g.fillStyle = t.floor.base;
  g.fillRect(0, 0, TEX, TEX);
  // Shuttering panels with tie holes.
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 2; x++) {
      const px = x * (TEX / 2);
      const py = y * (TEX / 2);
      const s = TEX / 2;
      g.fillStyle = mix(t.floor.base, y === x ? t.floor.alt : t.floor.grout, rng.range(0.1, 0.28));
      g.fillRect(px + 1, py + 1, s - 2, s - 2);
      g.strokeStyle = 'rgba(0,0,0,0.26)';
      g.lineWidth = 1.6;
      g.strokeRect(px + 1, py + 1, s - 2, s - 2);
      for (const [hx, hy] of [
        [px + 11, py + 11],
        [px + s - 11, py + 11],
        [px + 11, py + s - 11],
        [px + s - 11, py + s - 11],
      ]) {
        g.fillStyle = 'rgba(0,0,0,0.38)';
        g.beginPath();
        g.arc(hx, hy, 2.4, 0, 7);
        g.fill();
        g.fillStyle = 'rgba(255,255,255,0.14)';
        g.beginPath();
        g.arc(hx, hy - 0.9, 1.7, 0, 7);
        g.fill();
      }
    }
  }
  // Rust bleeding down from the rebar.
  for (let i = 0; i < 5; i++) {
    const x = rng.range(0, TEX);
    const grad = g.createLinearGradient(0, 0, 0, TEX);
    grad.addColorStop(0, 'rgba(120,60,30,0.16)');
    grad.addColorStop(1, 'rgba(120,60,30,0)');
    g.fillStyle = grad;
    g.fillRect(x, 0, rng.range(3, 11), TEX);
  }
  noiseOverlay(g, rng, '#3a3a3c', '#d6d6d2', 32, 0.09);
  grain(g, rng, 460, 0.07);
};

/** Skärgården: bare archipelago granite, glacier-scoured. */
const granite: Gen = (g, t, rng) => {
  g.fillStyle = t.floor.base;
  g.fillRect(0, 0, TEX, TEX);
  for (let i = 0; i < 18; i++) {
    const x = rng.range(0, TEX);
    const y = rng.range(0, TEX);
    const w = rng.range(24, 62);
    const h = rng.range(18, 44);
    tiled(x, y, (px, py) => {
      g.fillStyle = mix(
        t.floor.base,
        rng.next() > 0.5 ? t.floor.alt : t.floor.grout,
        rng.range(0.12, 0.45)
      );
      g.beginPath();
      g.moveTo(px, py + h * 0.3);
      g.lineTo(px + w * 0.4, py);
      g.lineTo(px + w, py + h * 0.4);
      g.lineTo(px + w * 0.7, py + h);
      g.lineTo(px + w * 0.15, py + h * 0.85);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.09)';
      g.lineWidth = 1.3;
      g.stroke();
    });
  }
  // Glacial striations.
  g.strokeStyle = 'rgba(12,14,18,0.4)';
  for (let i = 0; i < 8; i++) {
    g.lineWidth = rng.range(0.6, 1.6);
    const y = rng.range(0, TEX);
    g.beginPath();
    g.moveTo(0, y);
    g.bezierCurveTo(TEX * 0.3, y + rng.range(-6, 6), TEX * 0.7, y + rng.range(-6, 6), TEX, y);
    g.stroke();
  }
  noiseOverlay(g, rng, '#26262e', '#cfd2d8', 24, 0.12);
  grain(g, rng, 520, 0.1);
};

const FLOORS: Record<TilesetKind, Gen> = {
  cobble,
  metro,
  plaza,
  setts,
  park,
  brick,
  quay,
  timber,
  concrete,
  granite,
};

// ------------------------------------------------------------ block faces

/**
 * Vertical faces of indestructible blocks. Five families cover the ten
 * tilesets; the theme colours keep them distinct even where the pattern is
 * shared, and `light` decides which way the bevels catch the sun.
 */
const FACES: Record<FaceKind, (g: CanvasRenderingContext2D, t: MapTheme, rng: Rng) => void> = {
  stone(g, t, rng) {
    g.fillStyle = t.wall.front;
    g.fillRect(0, 0, TEX, TEX);
    const rows = 4;
    const h = TEX / rows;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * (TEX / 6);
      for (let c = -1; c < 3; c++) {
        const w = TEX / 2.6;
        const px = c * w + off;
        stone(
          g,
          px + 2,
          r * h + 2,
          w - 4,
          h - 4,
          mix(t.wall.front, t.wall.edge, rng.range(0, 0.5)),
          2.5
        );
      }
    }
    noiseOverlay(g, rng, '#1a1712', '#e6ddca', 20, 0.1);
  },

  tiled(g, t, rng) {
    g.fillStyle = t.wall.edge;
    g.fillRect(0, 0, TEX, TEX);
    const n = 6;
    const s = TEX / n;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        g.fillStyle = mix(t.wall.front, t.wall.top, rng.range(0, 0.35));
        g.fillRect(c * s + 1.2, r * s + 1.2, s - 2.4, s - 2.4);
        g.fillStyle = 'rgba(255,255,255,0.17)';
        g.fillRect(c * s + 1.2, r * s + 1.2, s - 2.4, 1.4);
        g.fillStyle = 'rgba(0,0,0,0.2)';
        g.fillRect(c * s + 1.2, r * s + s - 2.6, s - 2.4, 1.4);
      }
    }
    // Specular streak: glazed tile catches the light.
    const sheen = g.createLinearGradient(0, 0, TEX, TEX);
    sheen.addColorStop(0, 'rgba(255,255,255,0.10)');
    sheen.addColorStop(0.6, 'rgba(255,255,255,0)');
    g.fillStyle = sheen;
    g.fillRect(0, 0, TEX, TEX);
  },

  brick(g, t, rng) {
    g.fillStyle = t.wall.edge;
    g.fillRect(0, 0, TEX, TEX);
    const rows = 7;
    const h = TEX / rows;
    const bw = TEX / 3;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * (bw / 2);
      for (let c = -1; c < 3; c++) {
        const px = c * bw + off;
        g.fillStyle = mix(t.wall.front, t.wall.top, rng.range(0, 0.4));
        g.fillRect(px + 1.5, r * h + 1.5, bw - 3, h - 3);
        g.fillStyle = 'rgba(255,255,255,0.12)';
        g.fillRect(px + 1.5, r * h + 1.5, bw - 3, 1.1);
        g.fillStyle = 'rgba(0,0,0,0.22)';
        g.fillRect(px + 1.5, r * h + h - 2.6, bw - 3, 1.1);
      }
    }
    noiseOverlay(g, rng, '#2c1410', '#e8c8a8', 18, 0.09);
  },

  timber(g, t, rng) {
    g.fillStyle = t.wall.front;
    g.fillRect(0, 0, TEX, TEX);
    const rows = 5;
    const h = TEX / rows;
    for (let r = 0; r < rows; r++) {
      g.fillStyle = mix(t.wall.front, t.wall.top, rng.range(0, 0.4));
      g.fillRect(0, r * h + 1, TEX, h - 2);
      for (let i = 0; i < 7; i++) {
        g.strokeStyle = `rgba(36,12,6,${rng.range(0.08, 0.22)})`;
        g.lineWidth = rng.range(0.5, 1.4);
        const gy = r * h + rng.range(3, h - 3);
        g.beginPath();
        g.moveTo(0, gy);
        g.bezierCurveTo(
          TEX * 0.3,
          gy + rng.range(-2, 2),
          TEX * 0.7,
          gy + rng.range(-2, 2),
          TEX,
          gy
        );
        g.stroke();
      }
      g.fillStyle = 'rgba(255,248,232,0.15)';
      g.fillRect(0, r * h + 1, TEX, 1.2);
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(0, r * h + h - 2, TEX, 1.4);
    }
  },

  concrete(g, t, rng) {
    g.fillStyle = t.wall.front;
    g.fillRect(0, 0, TEX, TEX);
    for (let i = 0; i < 6; i++) {
      g.fillStyle = mix(t.wall.front, t.wall.edge, rng.range(0.05, 0.3));
      g.fillRect(0, rng.range(0, TEX), TEX, rng.range(6, 22));
    }
    // Form-tie holes on a regular grid.
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        const hx = 32 + x * 64;
        const hy = 32 + y * 64;
        g.fillStyle = 'rgba(0,0,0,0.36)';
        g.beginPath();
        g.arc(hx, hy, 3, 0, 7);
        g.fill();
        g.fillStyle = 'rgba(255,255,255,0.13)';
        g.beginPath();
        g.arc(hx, hy - 1, 2, 0, 7);
        g.fill();
      }
    }
    noiseOverlay(g, rng, '#33353a', '#d2d4d6', 28, 0.1);
    grain(g, rng, 380, 0.07);
  },
};

// ----------------------------------------------------------------- crates

/** The destructible crate face: boarded timber, tinted by the map. */
function crateFace(t: MapTheme, rng: Rng): HTMLCanvasElement {
  const [c, g] = canvas2d();
  g.fillStyle = t.crate.front;
  g.fillRect(0, 0, TEX, TEX);
  // Boards.
  const rows = 4;
  const h = TEX / rows;
  for (let r = 0; r < rows; r++) {
    g.fillStyle = mix(t.crate.front, t.crate.top, rng.range(0, 0.4));
    g.fillRect(2, r * h + 2, TEX - 4, h - 4);
    for (let i = 0; i < 6; i++) {
      g.strokeStyle = `rgba(30,16,6,${rng.range(0.08, 0.2)})`;
      g.lineWidth = rng.range(0.5, 1.2);
      const gy = r * h + rng.range(4, h - 4);
      g.beginPath();
      g.moveTo(2, gy);
      g.lineTo(TEX - 2, gy + rng.range(-2, 2));
      g.stroke();
    }
    g.fillStyle = 'rgba(255,250,236,0.14)';
    g.fillRect(2, r * h + 2, TEX - 4, 1.4);
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.fillRect(2, r * h + h - 3, TEX - 4, 1.6);
  }
  // Corner brackets.
  g.strokeStyle = mix(t.crate.crack, '#000000', 0.25);
  g.lineWidth = 3.5;
  g.strokeRect(3, 3, TEX - 6, TEX - 6);
  g.strokeStyle = 'rgba(255,255,255,0.12)';
  g.lineWidth = 1.2;
  g.strokeRect(4.5, 4.5, TEX - 9, TEX - 9);
  grain(g, rng, 220, 0.07);
  return c;
}

/** Exposed interior once a crate cracks — deliberately unlike the surface. */
function interiorFace(t: MapTheme, rng: Rng): HTMLCanvasElement {
  const [c, g] = canvas2d();
  const grad = g.createLinearGradient(0, 0, 0, TEX);
  grad.addColorStop(0, t.crate.interior);
  grad.addColorStop(1, mix(t.crate.interior, '#000000', 0.45));
  g.fillStyle = grad;
  g.fillRect(0, 0, TEX, TEX);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = mix(t.crate.interior, '#000000', rng.range(0, 0.55));
    g.beginPath();
    g.ellipse(
      rng.range(0, TEX),
      rng.range(0, TEX),
      rng.range(1.5, 5),
      rng.range(1, 3.5),
      rng.range(0, 3),
      0,
      7
    );
    g.fill();
  }
  noiseOverlay(g, rng, '#000000', t.crate.interior, 18, 0.16);
  grain(g, rng, 320, 0.11);
  return c;
}

export interface ArenaMaterials {
  /** Tiling floor patch; repeats across the whole board. */
  floor: HTMLCanvasElement;
  /** Vertical face of indestructible blocks. */
  wall: HTMLCanvasElement;
  /** Vertical face of destructible crates. */
  crate: HTMLCanvasElement;
  /** Material revealed behind a cracked crate. */
  interior: HTMLCanvasElement;
}

/** Paints every material the arena needs. Called once per match. */
export function generateMaterials(theme: MapTheme, seed: number): ArenaMaterials {
  const [floor, fg] = canvas2d();
  FLOORS[theme.tileset](fg, theme, new Rng(seed));

  const [wall, wg] = canvas2d();
  FACES[theme.face](wg, theme, new Rng(seed ^ 0x9e3779b9));

  return {
    floor,
    wall,
    crate: crateFace(theme, new Rng(seed ^ 0x85ebca6b)),
    interior: interiorFace(theme, new Rng(seed ^ 0xc2b2ae35)),
  };
}

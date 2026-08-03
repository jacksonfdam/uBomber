/**
 * The layered backdrop behind the arena: a sky gradient plus two silhouette
 * bands, generated per theme. This is what makes each map read as a place
 * rather than a recoloured grid — and it costs no art assets.
 *
 * The bands sit on separate planes at different depths so they can drift very
 * slightly with the screen shake, giving the board a sense of standing in a
 * world instead of floating on a colour.
 */

import * as THREE from 'three';
import { canvas2d, mix, Rng } from './textures';
import type { MapTheme, SkylineLayer, SkylineStyle } from './theme';

const W = 2048;
const H = 1024;

function skyCanvas(theme: MapTheme, rng: Rng): HTMLCanvasElement {
  const [c, g] = canvas2d(W, H);
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, theme.sky.top);
  grad.addColorStop(0.55, theme.sky.mid);
  grad.addColorStop(1, theme.sky.bottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  if (theme.sky.stars) {
    for (let i = 0; i < 260; i++) {
      const y = rng.range(0, H * 0.72);
      g.globalAlpha = rng.range(0.15, 0.9) * (1 - y / H);
      g.fillStyle = '#ffffff';
      const s = rng.range(0.7, 2.1);
      g.fillRect(rng.range(0, W), y, s, s);
    }
    g.globalAlpha = 1;
  }

  const sun = theme.sky.sun;
  if (sun) {
    const x = sun.x * W;
    const y = sun.y * H;
    const halo = g.createRadialGradient(x, y, sun.size * 0.2, x, y, sun.size * 5);
    halo.addColorStop(0, sun.color);
    halo.addColorStop(0.22, `${sun.color}a0`);
    halo.addColorStop(1, `${sun.color}00`);
    g.fillStyle = halo;
    g.fillRect(x - sun.size * 5, y - sun.size * 5, sun.size * 10, sun.size * 10);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(x, y, sun.size, 0, 7);
    g.fill();
  }

  // Soft cloud bands.
  for (let i = 0; i < 6; i++) {
    const y = rng.range(H * 0.08, H * 0.55);
    const w = rng.range(340, 980);
    const cloud = g.createRadialGradient(0, 0, 0, 0, 0, w / 2);
    cloud.addColorStop(0, 'rgba(255,255,255,0.11)');
    cloud.addColorStop(1, 'rgba(255,255,255,0)');
    g.save();
    g.translate(rng.range(0, W), y);
    g.scale(1, 0.22);
    g.fillStyle = cloud;
    g.fillRect(-w / 2, -w / 2, w, w);
    g.restore();
  }
  return c;
}

type SilGen = (
  g: CanvasRenderingContext2D,
  layer: SkylineLayer,
  rng: Rng,
  base: number
) => void;

const SILHOUETTES: Record<SkylineStyle, SilGen> = {
  /** Gamla Stan: gabled medieval townhouses, tight and irregular. */
  townhouses(g, l, rng, base) {
    let x = -40;
    while (x < W + 40) {
      const bw = rng.range(90, 190);
      const bh = rng.range(0.45, 1) * l.height * H;
      g.fillStyle = l.color;
      g.beginPath();
      g.moveTo(x, base);
      g.lineTo(x, base - bh);
      if (rng.next() > 0.4) {
        g.lineTo(x + bw / 2, base - bh - rng.range(26, 62));
        g.lineTo(x + bw, base - bh);
      } else {
        g.lineTo(x + bw, base - bh - rng.range(-10, 14));
      }
      g.lineTo(x + bw, base);
      g.closePath();
      g.fill();
      if (rng.next() > 0.5) g.fillRect(x + rng.range(10, bw - 22), base - bh - 62, 12, 44);
      if (l.detail) {
        g.fillStyle = l.detail;
        const rows = Math.floor(bh / 48);
        for (let r = 0; r < rows; r++) {
          for (let wx = x + 16; wx < x + bw - 18; wx += 32) {
            if (rng.next() > 0.55) g.fillRect(wx, base - bh + 20 + r * 48, 9, 13);
          }
        }
      }
      x += bw + rng.range(2, 12);
    }
  },

  /** T-Centralen: a blasted rock cavern ceiling with hanging ribs. */
  cavern(g, l, rng, base) {
    g.fillStyle = l.color;
    g.beginPath();
    g.moveTo(0, base);
    let x = 0;
    while (x < W) {
      const step = rng.range(80, 180);
      g.quadraticCurveTo(
        x + step * 0.5,
        base - l.height * H * rng.range(0.55, 1),
        x + step,
        base - l.height * H * rng.range(0.4, 0.8)
      );
      x += step;
    }
    g.lineTo(W, base);
    g.closePath();
    g.fill();
    if (l.detail) {
      // Cobalt vine murals picked out on the rock.
      g.strokeStyle = l.detail;
      g.lineWidth = 3;
      for (let i = 0; i < 18; i++) {
        const sx = rng.range(0, W);
        const sy = base - rng.range(20, l.height * H * 0.7);
        g.beginPath();
        g.moveTo(sx, sy);
        g.quadraticCurveTo(sx + rng.range(-40, 40), sy - 40, sx + rng.range(-70, 70), sy - 80);
        g.stroke();
      }
    }
  },

  /** Södermalm: modernist slabs stepping across the ridge. */
  blocks(g, l, rng, base) {
    let x = -30;
    while (x < W + 30) {
      const bw = rng.range(150, 300);
      const bh = rng.range(0.4, 1) * l.height * H;
      g.fillStyle = l.color;
      g.fillRect(x, base - bh, bw, bh);
      if (l.detail) {
        g.fillStyle = l.detail;
        for (let wy = base - bh + 22; wy < base - 24; wy += 34) {
          for (let wx = x + 18; wx < x + bw - 20; wx += 26) {
            if (rng.next() > 0.42) g.fillRect(wx, wy, 12, 16);
          }
        }
      }
      x += bw + rng.range(6, 26);
    }
  },

  /** Östermalm: stately boulevard frontage with mansard roofs. */
  boulevard(g, l, rng, base) {
    let x = -30;
    while (x < W + 30) {
      const bw = rng.range(180, 260);
      const bh = rng.range(0.62, 0.95) * l.height * H;
      g.fillStyle = l.color;
      g.fillRect(x, base - bh, bw, bh);
      // Mansard cap.
      g.beginPath();
      g.moveTo(x, base - bh);
      g.lineTo(x + 22, base - bh - 34);
      g.lineTo(x + bw - 22, base - bh - 34);
      g.lineTo(x + bw, base - bh);
      g.closePath();
      g.fill();
      if (l.detail) {
        g.fillStyle = l.detail;
        for (let wy = base - bh + 26; wy < base - 30; wy += 40) {
          for (let wx = x + 20; wx < x + bw - 24; wx += 34) {
            if (rng.next() > 0.3) g.fillRect(wx, wy, 14, 22);
          }
        }
      }
      x += bw + rng.range(2, 8);
    }
  },

  /** Djurgården: oak and birch canopy. */
  trees(g, l, rng, base) {
    let x = -40;
    while (x < W + 40) {
      const th = rng.range(0.5, 1) * l.height * H;
      const tw = rng.range(70, 160);
      g.fillStyle = l.color;
      // Trunk.
      g.fillRect(x + tw / 2 - 7, base - th * 0.45, 14, th * 0.45);
      // Canopy of overlapping lobes.
      for (let i = 0; i < 7; i++) {
        g.beginPath();
        g.ellipse(
          x + tw / 2 + rng.range(-tw * 0.35, tw * 0.35),
          base - th + rng.range(-10, th * 0.35),
          rng.range(tw * 0.24, tw * 0.44),
          rng.range(th * 0.16, th * 0.3),
          0,
          0,
          7
        );
        g.fill();
      }
      if (l.detail) {
        g.fillStyle = l.detail;
        for (let i = 0; i < 5; i++) {
          g.beginPath();
          g.ellipse(
            x + tw / 2 + rng.range(-tw * 0.3, tw * 0.3),
            base - th + rng.range(-6, th * 0.2),
            rng.range(8, 18),
            rng.range(6, 12),
            0,
            0,
            7
          );
          g.fill();
        }
      }
      x += tw * rng.range(0.5, 0.8);
    }
  },

  /** Vasastan: dense turn-of-the-century tenement wall. */
  tenements(g, l, rng, base) {
    let x = -20;
    while (x < W + 20) {
      const bw = rng.range(110, 170);
      const bh = rng.range(0.7, 1) * l.height * H;
      g.fillStyle = mix(l.color, '#000000', rng.range(0, 0.22));
      g.fillRect(x, base - bh, bw, bh);
      if (l.detail) {
        g.fillStyle = l.detail;
        for (let wy = base - bh + 18; wy < base - 20; wy += 30) {
          for (let wx = x + 12; wx < x + bw - 14; wx += 24) {
            if (rng.next() > 0.5) g.fillRect(wx, wy, 11, 15);
          }
        }
      }
      x += bw + rng.range(1, 5);
    }
  },

  /** Kungsholmen: the Riddarfjärden waterfront with masts and reflections. */
  waterfront(g, l, rng, base) {
    // Water band.
    const water = g.createLinearGradient(0, base - l.height * H, 0, base);
    water.addColorStop(0, l.color);
    water.addColorStop(1, mix(l.color, '#000000', 0.35));
    g.fillStyle = water;
    g.fillRect(0, base - l.height * H, W, l.height * H);
    // Glints.
    g.strokeStyle = l.detail ?? 'rgba(255,255,255,0.3)';
    for (let i = 0; i < 90; i++) {
      const y = base - rng.range(0, l.height * H);
      const len = rng.range(14, 70) * (1 - (base - y) / (l.height * H) + 0.3);
      g.globalAlpha = rng.range(0.1, 0.45);
      g.lineWidth = rng.range(1, 2.4);
      g.beginPath();
      g.moveTo(rng.range(0, W), y);
      g.lineTo(rng.range(0, W) + len, y);
      g.stroke();
    }
    g.globalAlpha = 1;
    // Distant masts.
    g.strokeStyle = mix(l.color, '#000000', 0.5);
    g.lineWidth = 2.4;
    for (let i = 0; i < 22; i++) {
      const x = rng.range(0, W);
      const h = rng.range(30, 90);
      g.beginPath();
      g.moveTo(x, base - l.height * H);
      g.lineTo(x, base - l.height * H - h);
      g.stroke();
    }
  },

  /** Skansen: falu-red farmsteads and animal pens on the terraces. */
  farmstead(g, l, rng, base) {
    let x = -40;
    while (x < W + 40) {
      const bw = rng.range(120, 210);
      const bh = rng.range(0.35, 0.7) * l.height * H;
      g.fillStyle = l.color;
      g.fillRect(x, base - bh, bw, bh);
      // Steep pitched roof.
      g.beginPath();
      g.moveTo(x - 10, base - bh);
      g.lineTo(x + bw / 2, base - bh - rng.range(40, 70));
      g.lineTo(x + bw + 10, base - bh);
      g.closePath();
      g.fill();
      if (l.detail) {
        g.fillStyle = l.detail;
        for (let wx = x + 22; wx < x + bw - 24; wx += 44) {
          g.fillRect(wx, base - bh + 22, 18, 22);
        }
      }
      // Fence between farmsteads.
      const gap = rng.range(40, 110);
      g.strokeStyle = mix(l.color, '#000000', 0.3);
      g.lineWidth = 3;
      for (let fx = x + bw + 8; fx < x + bw + gap; fx += 18) {
        g.beginPath();
        g.moveTo(fx, base);
        g.lineTo(fx, base - 26);
        g.stroke();
      }
      g.beginPath();
      g.moveTo(x + bw + 8, base - 18);
      g.lineTo(x + bw + gap, base - 18);
      g.stroke();
      x += bw + gap;
    }
  },

  /** Slussen: tower cranes and gantries over the interchange. */
  cranes(g, l, rng, base) {
    // Site hoarding.
    g.fillStyle = mix(l.color, '#000000', 0.25);
    g.fillRect(0, base - l.height * H * 0.22, W, l.height * H * 0.22);
    g.strokeStyle = l.color;
    g.lineWidth = 5;
    for (let i = 0; i < 7; i++) {
      const x = rng.range(0, W);
      const h = rng.range(0.55, 1) * l.height * H;
      const jib = rng.range(150, 300);
      const dir = rng.next() > 0.5 ? 1 : -1;
      // Mast.
      g.beginPath();
      g.moveTo(x, base);
      g.lineTo(x, base - h);
      g.stroke();
      // Jib and counter-jib.
      g.beginPath();
      g.moveTo(x - dir * jib * 0.3, base - h);
      g.lineTo(x + dir * jib, base - h);
      g.stroke();
      // Hoist line.
      g.lineWidth = 2;
      const hx = x + dir * jib * rng.range(0.4, 0.9);
      g.beginPath();
      g.moveTo(hx, base - h);
      g.lineTo(hx, base - h + rng.range(60, 200));
      g.stroke();
      g.lineWidth = 5;
      // Lattice rungs.
      g.lineWidth = 2;
      for (let y = base - h + 14; y < base; y += 26) {
        g.beginPath();
        g.moveTo(x - 9, y);
        g.lineTo(x + 9, y - 12);
        g.stroke();
      }
      g.lineWidth = 5;
      if (l.detail) {
        g.fillStyle = l.detail;
        g.beginPath();
        g.arc(x, base - h, 6, 0, 7);
        g.fill();
      }
    }
  },

  /** Skärgården: low granite islets receding into the haze. */
  islets(g, l, rng, base) {
    const water = g.createLinearGradient(0, base - l.height * H, 0, base);
    water.addColorStop(0, mix(l.color, '#ffffff', 0.12));
    water.addColorStop(1, mix(l.color, '#000000', 0.3));
    g.fillStyle = water;
    g.fillRect(0, base - l.height * H, W, l.height * H);
    for (let i = 0; i < 14; i++) {
      const x = rng.range(-100, W + 100);
      const w = rng.range(160, 460);
      const h = rng.range(18, 62);
      const y = base - rng.range(l.height * H * 0.3, l.height * H);
      g.fillStyle = mix(l.color, '#000000', rng.range(0.1, 0.45));
      g.beginPath();
      g.moveTo(x, y);
      g.bezierCurveTo(x + w * 0.25, y - h, x + w * 0.75, y - h * rng.range(0.6, 1.2), x + w, y);
      g.closePath();
      g.fill();
      if (l.detail && rng.next() > 0.55) {
        // A lone pine on the skyline.
        g.fillStyle = l.detail;
        const px = x + w * rng.range(0.25, 0.75);
        g.beginPath();
        g.moveTo(px - 7, y - h * 0.5);
        g.lineTo(px, y - h * 0.5 - rng.range(20, 40));
        g.lineTo(px + 7, y - h * 0.5);
        g.closePath();
        g.fill();
      }
    }
  },
};

function silhouetteCanvas(theme: MapTheme, layer: SkylineLayer, rng: Rng): HTMLCanvasElement {
  const [c, g] = canvas2d(W, H);
  SILHOUETTES[layer.style](g, layer, rng, H);
  // Haze toward the horizon so the far band recedes.
  const haze = g.createLinearGradient(0, H * (1 - layer.height), 0, H);
  haze.addColorStop(0, `${theme.sky.mid}66`);
  haze.addColorStop(1, `${theme.sky.mid}00`);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = haze;
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-over';
  return c;
}

function planeFrom(canvas: HTMLCanvasElement, w: number, h: number, z: number): THREE.Mesh {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false })
  );
  mesh.position.z = z;
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * Sky plus two silhouette bands, sized to cover `viewW` x `viewH` world units
 * with margin for the shake offset.
 */
export class Backdrop {
  readonly group = new THREE.Group();
  private layers: THREE.Mesh[] = [];
  private baseW: number;
  private baseH: number;

  constructor(theme: MapTheme, viewW: number, viewH: number, seed: number) {
    this.baseW = viewW;
    this.baseH = viewH;

    const sky = planeFrom(skyCanvas(theme, new Rng(seed ^ 0x1b873593)), viewW, viewH, -40);
    this.group.add(sky);
    this.layers.push(sky);

    theme.skyline.forEach((layer, i) => {
      const canvas = silhouetteCanvas(theme, layer, new Rng(seed ^ (0x2545f491 + i * 7919)));
      const plane = planeFrom(canvas, viewW, viewH, -30 + i * 8);
      // Bands sit low: the arena covers the middle of the screen.
      plane.position.y = -viewH * 0.06 * (1 - i * 0.5);
      this.group.add(plane);
      this.layers.push(plane);
    });
  }

  /**
   * Stretches every layer to cover the camera's current extents.
   *
   * The camera grows past the stage on wide viewports, so a fixed-size backdrop
   * leaves the clear colour showing down the outer edges — and the post stack's
   * aberration then draws a coloured seam along that hard boundary.
   */
  cover(halfW: number, halfH: number): void {
    const scaleX = (halfW * 2 * 1.2) / this.baseW;
    const scaleY = (halfH * 2 * 1.2) / this.baseH;
    for (const layer of this.layers) {
      layer.scale.set(Math.max(1, scaleX), Math.max(1, scaleY), 1);
    }
  }

  /** Parallax against the camera shake: far layers move least. */
  offset(dx: number, dy: number): void {
    this.layers.forEach((layer, i) => {
      const factor = i === 0 ? 0.12 : 0.24 + i * 0.16;
      layer.position.x = dx * factor;
      const baseY = layer.userData.baseY as number | undefined;
      if (baseY === undefined) layer.userData.baseY = layer.position.y;
      layer.position.y = (layer.userData.baseY as number) + dy * factor;
    });
  }

  dispose(): void {
    for (const layer of this.layers) {
      const material = layer.material as THREE.MeshBasicMaterial;
      material.map?.dispose();
      material.dispose();
      layer.geometry.dispose();
    }
    this.layers = [];
  }
}

/**
 * Render-side particles: blast fireballs, crate splinters, dust, pickup
 * sparkles, death poofs and per-map ambient weather.
 *
 * Nothing in here is ever part of GameState. That is not a style choice: the
 * match is host-authoritative and guests reconcile against 10 Hz snapshots, so
 * any render-side randomness that leaked into the simulation would desync
 * every peer. Particles are driven purely by observed state changes.
 *
 * One fixed-size pool feeds a single THREE.Points draw call.
 */

import * as THREE from 'three';
import type { MapTheme } from './theme';

/** Hard cap. A 15x13 arena never needs more, and the pool never reallocates. */
const MAX = 2048;

interface Particle {
  life: number;
  maxLife: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  size: number;
  r: number;
  g: number;
  b: number;
  /** Keeps full brightness instead of fading with age. */
  solid: boolean;
  /** Drifts sideways on a slow sine (snow, leaves). */
  drift: boolean;
}

function rgbOf(hex: string): [number, number, number] {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

export class Vfx {
  readonly points: THREE.Points;
  private pool: Particle[] = [];
  private positions = new Float32Array(MAX * 3);
  private colors = new Float32Array(MAX * 3);
  private sizes = new Float32Array(MAX);
  private geo = new THREE.BufferGeometry();
  private theme: MapTheme;
  private weatherAcc = 0;
  private clock = 0;

  constructor(theme: MapTheme) {
    this.theme = theme;
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      uniforms: {},
      vertexShader: /* glsl */ `
        attribute float size;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec3 vColor;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.12, length(d));
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor, a);
        }
      `,
    });

    this.points = new THREE.Points(this.geo, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  private emit(p: Partial<Particle> & { x: number; y: number }): void {
    if (this.pool.length >= MAX) return;
    this.pool.push({
      life: 0,
      maxLife: 40,
      vx: 0,
      vy: 0,
      gravity: -0.12,
      size: 4,
      r: 1,
      g: 1,
      b: 1,
      solid: false,
      drift: false,
      ...p,
    });
  }

  /** A bomb detonating on a tile: hot core, tinted billow, debris and dust. */
  blast(x: number, y: number): void {
    const core = rgbOf(this.theme.flame.core);
    const edge = rgbOf(this.theme.flame.edge);
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = Math.random() * 3.4;
      const hot = Math.random();
      const [r, g, b] = hot > 0.5 ? core : edge;
      this.emit({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp + 0.9,
        gravity: -0.02,
        size: 7 + Math.random() * 11,
        maxLife: 16 + Math.random() * 12,
        r: r + 0.25,
        g: g + 0.18,
        b: b + 0.1,
      });
    }
    this.dust(x, y, 10);
  }

  /** Crate breaking apart: splinters in the crate's own materials. */
  crateBreak(x: number, y: number): void {
    const palette = [
      this.theme.crate.front,
      this.theme.crate.top,
      this.theme.crate.interior,
      this.theme.crate.crack,
    ].map(rgbOf);
    for (let i = 0; i < 20; i++) {
      const [r, g, b] = palette[i % palette.length];
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 2.6;
      this.emit({
        x: x + (Math.random() - 0.5) * 26,
        y: y + (Math.random() - 0.5) * 18,
        vx: Math.cos(a) * sp,
        vy: Math.abs(Math.sin(a)) * sp * 1.7 + 0.6,
        gravity: -0.17,
        size: 3 + Math.random() * 5,
        maxLife: 30 + Math.random() * 26,
        r,
        g,
        b,
        solid: true,
      });
    }
    this.dust(x, y, 8);
  }

  dust(x: number, y: number, n: number): void {
    for (let i = 0; i < n; i++) {
      this.emit({
        x: x + (Math.random() - 0.5) * 30,
        y: y + (Math.random() - 0.5) * 12,
        vx: (Math.random() - 0.5) * 0.8,
        vy: Math.random() * 0.6,
        gravity: 0.006,
        size: 8 + Math.random() * 12,
        maxLife: 26 + Math.random() * 24,
        r: 0.42,
        g: 0.4,
        b: 0.37,
      });
    }
  }

  /** Bomb placed: a small puff at the feet. */
  place(x: number, y: number): void {
    for (let i = 0; i < 6; i++) {
      this.emit({
        x: x + (Math.random() - 0.5) * 16,
        y: y - 6,
        vx: (Math.random() - 0.5) * 0.7,
        vy: Math.random() * 0.4,
        gravity: 0.004,
        size: 5 + Math.random() * 6,
        maxLife: 18 + Math.random() * 10,
        r: 0.5,
        g: 0.48,
        b: 0.44,
      });
    }
  }

  /** Power-up collected: a ring of sparks in the map's hot colour. */
  pickup(x: number, y: number): void {
    const [r, g, b] = rgbOf(this.theme.flame.core);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      this.emit({
        x,
        y,
        vx: Math.cos(a) * 1.9,
        vy: Math.sin(a) * 1.9 + 0.5,
        gravity: -0.012,
        size: 4 + Math.random() * 4,
        maxLife: 24,
        r: r + 0.3,
        g: g + 0.3,
        b: b + 0.2,
      });
    }
  }

  /** A player going down. */
  death(x: number, y: number, color: string): void {
    const [r, g, b] = rgbOf(color);
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.6 + Math.random() * 2;
      this.emit({
        x: x + (Math.random() - 0.5) * 18,
        y: y + Math.random() * 20,
        vx: Math.cos(a) * sp,
        vy: Math.abs(Math.sin(a)) * sp + 1,
        gravity: -0.05,
        size: 5 + Math.random() * 7,
        maxLife: 30 + Math.random() * 20,
        r,
        g,
        b,
      });
    }
    this.dust(x, y, 6);
  }

  /** Sudden-death wall slamming down. */
  slam(x: number, y: number): void {
    this.dust(x, y, 12);
    const [r, g, b] = rgbOf(this.theme.wall.top);
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI;
      this.emit({
        x,
        y: y - 20,
        vx: Math.cos(a) * (1 + Math.random() * 2),
        vy: Math.random() * 0.8,
        gravity: -0.14,
        size: 4 + Math.random() * 4,
        maxLife: 24,
        r,
        g,
        b,
        solid: true,
      });
    }
  }

  /**
   * Advances one render frame and spawns ambient weather across the stage.
   * `dt` is in seconds; particle velocities are per-60Hz-frame for stability,
   * so dt is normalised against that.
   */
  update(dt: number, stageW: number, stageH: number): void {
    const steps = Math.min(3, Math.max(0.2, dt * 60));
    this.clock += dt;

    if (this.theme.weather) {
      const rate =
        this.theme.weather === 'rain'
          ? 2.6
          : this.theme.weather === 'snow'
            ? 1.1
            : this.theme.weather === 'embers'
              ? 0.5
              : 0.4;
      this.weatherAcc += rate * steps;
      while (this.weatherAcc >= 1) {
        this.weatherAcc -= 1;
        this.spawnWeather(stageW, stageH);
      }
    }

    let n = 0;
    const sway = Math.sin(this.clock * 1.1) * 0.5;
    for (let i = this.pool.length - 1; i >= 0; i--) {
      const p = this.pool[i];
      p.life += steps;
      if (p.life >= p.maxLife || p.y < -stageH) {
        this.pool.splice(i, 1);
        continue;
      }
      p.vy += p.gravity * steps;
      p.x += (p.vx + (p.drift ? sway : 0)) * steps;
      p.y += p.vy * steps;

      const t = 1 - p.life / p.maxLife;
      const a = p.solid ? Math.min(1, t * 2.2) : t;
      this.positions[n * 3] = p.x;
      this.positions[n * 3 + 1] = p.y;
      this.positions[n * 3 + 2] = 6;
      this.colors[n * 3] = p.r * a;
      this.colors[n * 3 + 1] = p.g * a;
      this.colors[n * 3 + 2] = p.b * a;
      this.sizes[n] = p.size * (0.55 + t * 0.45);
      n++;
    }

    this.geo.setDrawRange(0, n);
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.size as THREE.BufferAttribute).needsUpdate = true;
  }

  private spawnWeather(stageW: number, stageH: number): void {
    const x = (Math.random() - 0.5) * stageW * 1.2;
    const y = stageH * 0.62;
    switch (this.theme.weather) {
      case 'rain':
        this.emit({
          x,
          y,
          vx: -1.4,
          vy: -13,
          gravity: 0,
          size: 3,
          maxLife: 120,
          r: 0.5,
          g: 0.6,
          b: 0.78,
          solid: true,
        });
        break;
      case 'snow':
        this.emit({
          x,
          y,
          vx: (Math.random() - 0.5) * 0.6,
          vy: -0.8 - Math.random() * 0.7,
          gravity: 0,
          size: 3.5 + Math.random() * 3.5,
          maxLife: 400,
          r: 0.95,
          g: 0.97,
          b: 1,
          solid: true,
          drift: true,
        });
        break;
      case 'leaves': {
        const [r, g, b] = rgbOf(this.theme.accent);
        this.emit({
          x,
          y,
          vx: (Math.random() - 0.5) * 0.8,
          vy: -0.9 - Math.random() * 0.8,
          gravity: 0,
          size: 4 + Math.random() * 4,
          maxLife: 380,
          r,
          g,
          b,
          solid: true,
          drift: true,
        });
        break;
      }
      case 'embers': {
        const [r, g, b] = rgbOf(this.theme.flame.core);
        this.emit({
          x,
          y: -stageH * 0.5,
          vx: (Math.random() - 0.5) * 0.5,
          vy: 0.7 + Math.random() * 0.8,
          gravity: 0,
          size: 2.5 + Math.random() * 2.5,
          maxLife: 220,
          r,
          g,
          b,
          drift: true,
        });
        break;
      }
      default:
        break;
    }
  }

  dispose(): void {
    this.geo.dispose();
    (this.points.material as THREE.Material).dispose();
    this.pool = [];
  }
}

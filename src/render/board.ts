/**
 * The arena renderer.
 *
 * Draw-call budget, which is the whole point of the single-atlas design:
 *   1  backdrop sky           1  floor plane (shader-tiled)
 *   2  skyline silhouettes    1  sprite batch (blocks + entities + players)
 *   1  particle points        + the post-processing passes
 *
 * The sprite batch is one InstancedMesh. Instances are filled row by row, and
 * because instance order is draw order, that alone gives a correct painter's
 * y-sort across blocks, bombs and characters — no per-frame sorting, no depth
 * tricks, no extra passes.
 *
 * Every sprite quad follows the same convention: 1.5x TILE, horizontally
 * centred on its tile and bottom-aligned to the tile's bottom edge.
 */

import * as THREE from 'three';
import { SUDDEN_DEATH_ORDER } from '../core/game';
import { BOMB_FUSE, FLAME_TTL, TILE_COLS, TILE_ROWS } from '../core/constants';
import type { GameState } from '../core/types';
import { type Atlas, buildAtlas, PLAYER_COLORS } from './atlas';
import { Backdrop } from './backdrop';
import { DEFAULT_POST, PostStack, type PostSettings } from './post';
import { generateMaterials } from './textures';
import type { MapTheme } from './theme';
import { Vfx } from './vfx';

/** World units per tile. */
export const TILE = 64;

/** Blank space kept around the board so the backdrop reads. */
const MARGIN = 76;

const BOARD_W = TILE_COLS * TILE;
const BOARD_H = TILE_ROWS * TILE;
const STAGE_W = BOARD_W + MARGIN * 2;
const STAGE_H = BOARD_H + MARGIN * 2;

/** Sprite quad edge, in world units. */
const QUAD = TILE * 1.5;

/** Upper bound on simultaneous sprites; the buffer never reallocates. */
const CAPACITY = 1400;

/** What the match runtime tells the renderer about one player this frame. */
export interface PlayerVisual {
  slot: number;
  /** Continuous tile-space position. */
  x: number;
  y: number;
  /** Key into ANIMS. */
  anim: string;
  /** Frame counter; wrapped against the animation length. */
  tick: number;
  flip: boolean;
  /** 0..1 overall opacity (death fade, respawn blink). */
  alpha: number;
  /** Extra world-space lift, used while a defeated player floats away. */
  lift: number;
  /** Draws the wider "this is you" ring. */
  local: boolean;
}

const FLOOR_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FLOOR_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uFloor;
  uniform vec2 uCells;
  uniform vec2 uRepeat;
  uniform vec3 uLight;
  uniform float uCheck;

  void main() {
    vec3 col = texture2D(uFloor, vUv * uRepeat).rgb;

    // Per-cell checker so the grid stays legible without a drawn outline.
    vec2 cell = floor(vUv * uCells);
    float check = mod(cell.x + cell.y, 2.0);
    col *= mix(1.0, uCheck, check);

    // Seam shading at the cell borders: a hair of contact darkness.
    vec2 f = fract(vUv * uCells);
    float seam = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
    col *= 0.9 + 0.1 * smoothstep(0.0, 0.06, seam);

    // Key light rake across the board, plus falloff into the far corners.
    float rake = dot(vUv - 0.5, normalize(uLight)) * 0.5 + 0.5;
    col *= 0.88 + 0.16 * rake;
    float r2 = dot(vUv - 0.5, vUv - 0.5);
    col *= 1.0 - 0.28 * smoothstep(0.1, 0.55, r2);

    gl_FragColor = vec4(col, 1.0);
  }
`;

const SPRITE_VERT = /* glsl */ `
  attribute vec3 aCell;   // cell index, flip, unused
  attribute vec4 aTint;   // rgb multiplier, alpha
  varying vec2 vUv;
  varying vec4 vTint;
  uniform vec2 uAtlasGrid; // columns, rows

  void main() {
    vec2 local = vec2(uv.x, 1.0 - uv.y);
    if (aCell.y > 0.5) local.x = 1.0 - local.x;
    vec2 cellCoord = vec2(mod(aCell.x, uAtlasGrid.x), floor(aCell.x / uAtlasGrid.x));
    vUv = (cellCoord + local) / uAtlasGrid;
    vTint = aTint;
    gl_Position =
      projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

const SPRITE_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uAtlas;
  varying vec2 vUv;
  varying vec4 vTint;
  void main() {
    vec4 c = texture2D(uAtlas, vUv);
    float a = c.a * vTint.a;
    if (a < 0.004) discard;
    gl_FragColor = vec4(c.rgb * vTint.rgb, a);
  }
`;

/** Deterministic per-cell hash, stable for a given map. */
function cellHash(c: number, r: number, salt: number): number {
  return ((c * 73856093) ^ (r * 19349663) ^ salt) >>> 0;
}

function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h = (h ^ text.charCodeAt(i)) >>> 0;
    h = (h * 16777619) >>> 0;
  }
  return h;
}

export class BoardRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  readonly vfx: Vfx;

  private atlas: Atlas;
  private backdrop: Backdrop;
  private post: PostStack;
  private batch: THREE.InstancedMesh;
  private cellAttr: THREE.InstancedBufferAttribute;
  private tintAttr: THREE.InstancedBufferAttribute;
  private floor: THREE.Mesh;
  private dummy = new THREE.Object3D();
  private colors: THREE.Color[];
  private theme: MapTheme;
  private mapSalt: number;
  private flash = 0;
  private clock = 0;
  private settings: PostSettings = { ...DEFAULT_POST };

  constructor(
    canvas: HTMLCanvasElement,
    theme: MapTheme,
    mapId: string,
    seed: number
  ) {
    this.theme = theme;
    this.mapSalt = hashString(mapId);
    this.colors = PLAYER_COLORS.map((hex) => new THREE.Color(hex));

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(new THREE.Color(theme.sky.bottom), 1);

    this.camera = new THREE.OrthographicCamera(
      -STAGE_W / 2,
      STAGE_W / 2,
      STAGE_H / 2,
      -STAGE_H / 2,
      -100,
      100
    );
    this.camera.position.z = 10;

    const materials = generateMaterials(theme, seed);
    this.atlas = buildAtlas(theme, materials, seed);

    this.backdrop = new Backdrop(theme, STAGE_W, STAGE_H, seed);
    this.backdrop.group.renderOrder = 0;
    this.scene.add(this.backdrop.group);

    this.floor = this.buildFloor(materials.floor);
    this.scene.add(this.floor);

    const atlasTexture = new THREE.CanvasTexture(this.atlas.canvas);
    atlasTexture.flipY = false;
    atlasTexture.colorSpace = THREE.SRGBColorSpace;
    atlasTexture.minFilter = THREE.LinearFilter;
    atlasTexture.magFilter = THREE.LinearFilter;
    atlasTexture.generateMipmaps = false;

    const geometry = new THREE.PlaneGeometry(QUAD, QUAD);
    this.cellAttr = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
    this.tintAttr = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4);
    geometry.setAttribute('aCell', this.cellAttr);
    geometry.setAttribute('aTint', this.tintAttr);

    const rows = this.atlas.canvas.height / (this.atlas.canvas.width / this.atlas.grid);
    const spriteMaterial = new THREE.ShaderMaterial({
      vertexShader: SPRITE_VERT,
      fragmentShader: SPRITE_FRAG,
      uniforms: {
        uAtlas: { value: atlasTexture },
        uAtlasGrid: { value: new THREE.Vector2(this.atlas.grid, rows) },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });

    this.batch = new THREE.InstancedMesh(geometry, spriteMaterial, CAPACITY);
    this.batch.frustumCulled = false;
    this.batch.renderOrder = 2;
    this.batch.count = 0;
    this.scene.add(this.batch);

    this.vfx = new Vfx(theme);
    this.scene.add(this.vfx.points);

    this.post = new PostStack(
      this.renderer,
      this.scene,
      this.camera,
      theme,
      canvas.clientWidth || STAGE_W,
      canvas.clientHeight || STAGE_H
    );

    this.resize();
  }

  private buildFloor(floorMaterial: HTMLCanvasElement): THREE.Mesh {
    const texture = new THREE.CanvasTexture(floorMaterial);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;

    const material = new THREE.ShaderMaterial({
      vertexShader: FLOOR_VERT,
      fragmentShader: FLOOR_FRAG,
      uniforms: {
        uFloor: { value: texture },
        uCells: { value: new THREE.Vector2(TILE_COLS, TILE_ROWS) },
        // The patch covers two tiles, so it repeats half as often as cells.
        uRepeat: { value: new THREE.Vector2(TILE_COLS / 2, TILE_ROWS / 2) },
        uLight: {
          value: new THREE.Vector2(this.theme.lightDir.x, this.theme.lightDir.y),
        },
        uCheck: { value: 0.94 },
      },
    });

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(BOARD_W, BOARD_H), material);
    // Flip v so row 0 of the grid is the top row on screen.
    const uv = mesh.geometry.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    mesh.position.z = -1;
    mesh.renderOrder = 1;
    mesh.frustumCulled = false;
    return mesh;
  }

  // ------------------------------------------------------------- geometry

  /** World x of a tile-space x (in tile units, 0..cols). */
  private worldX(tileX: number): number {
    return tileX * TILE - BOARD_W / 2;
  }

  /** World y of a tile-space y (in tile units, 0..rows), y axis up. */
  private worldY(tileY: number): number {
    return BOARD_H / 2 - tileY * TILE;
  }

  // -------------------------------------------------------------- filling

  private count = 0;

  private push(
    cell: number,
    centreX: number,
    centreY: number,
    tint: THREE.Color | null,
    alpha: number,
    flip = false,
    scale = 1
  ): void {
    if (this.count >= CAPACITY) return;
    const i = this.count++;
    this.dummy.position.set(centreX, centreY, 0);
    this.dummy.scale.set(scale, scale, 1);
    this.dummy.rotation.z = 0;
    this.dummy.updateMatrix();
    this.batch.setMatrixAt(i, this.dummy.matrix);
    this.cellAttr.setXYZ(i, cell, flip ? 1 : 0, 0);
    if (tint) this.tintAttr.setXYZW(i, tint.r, tint.g, tint.b, alpha);
    else this.tintAttr.setXYZW(i, 1, 1, 1, alpha);
  }

  /**
   * A sprite occupying tile (c, r): centred on the column, bottom-aligned to
   * the row's bottom edge. `dy` nudges it in world units (bob, lift).
   */
  private pushTile(
    cell: number,
    tileX: number,
    tileBottomY: number,
    tint: THREE.Color | null,
    alpha: number,
    dy = 0,
    flip = false,
    scale = 1
  ): void {
    const cx = this.worldX(tileX);
    const cy = this.worldY(tileBottomY) + (QUAD / 2) * scale + dy;
    this.push(cell, cx, cy, tint, alpha, flip, scale);
  }

  /**
   * Rebuilds the instance buffer for one frame.
   *
   * Fill order is the render order: flat things first, then a row-by-row pass
   * over blocks, bombs and characters so lower rows overlap higher ones.
   */
  sync(state: GameState, visuals: PlayerVisual[]): void {
    const t = this.atlas.table;
    this.count = 0;

    // Which tiles were walled by sudden death, so they can read as hot.
    const sudden = new Set<string>();
    for (let i = 0; i < state.suddenDeathClosed && i < SUDDEN_DEATH_ORDER.length; i++) {
      const tile = SUDDEN_DEATH_ORDER[i];
      sudden.add(`${tile.x},${tile.y}`);
    }

    // --- floor decor, behind everything else
    for (let r = 0; r < TILE_ROWS; r++) {
      for (let c = 0; c < TILE_COLS; c++) {
        if (state.grid[r][c] !== 'floor') continue;
        if (cellHash(c, r, this.mapSalt) % 17 !== 3) continue;
        this.pushTile(t.decor, c + 0.5, r + 1, null, 0.95);
      }
    }

    // --- flames lie flat on the floor
    const lit = new Set(state.flames.map((f) => `${f.x},${f.y}`));
    for (const f of state.flames) {
      const left = lit.has(`${f.x - 1},${f.y}`);
      const right = lit.has(`${f.x + 1},${f.y}`);
      const up = lit.has(`${f.x},${f.y - 1}`);
      const down = lit.has(`${f.x},${f.y + 1}`);
      const horiz = left || right;
      const vert = up || down;

      let cell: number;
      if ((horiz && vert) || (!horiz && !vert)) cell = t.flameCenter;
      else if (horiz) {
        cell = left && right ? t.flameH : right ? t.flameTipL : t.flameTipR;
      } else {
        cell = up && down ? t.flameV : down ? t.flameTipU : t.flameTipD;
      }

      // Flames bloom in fast and fade out over their tail.
      const age = 1 - f.ttl / FLAME_TTL;
      const grow = Math.min(1, age * 6);
      const alpha = Math.min(1, f.ttl / (FLAME_TTL * 0.7));
      const flicker = 1 + Math.sin(this.clock * 40 + f.x * 3 + f.y * 5) * 0.05;
      this.pushTile(cell, f.x + 0.5, f.y + 1, null, alpha, 0, false, grow * flicker);
    }

    // --- power-ups float above the floor with a shadow beneath
    for (const u of state.powerups) {
      const bob = Math.sin(this.clock * 3 + u.x * 5 + u.y * 3) * 4;
      const icon =
        u.type === 'bomb' ? t.powerBomb : u.type === 'flame' ? t.powerFlame : t.powerSpeed;
      this.pushTile(t.shadow, u.x + 0.5, u.y + 1, null, 0.3 - bob * 0.01, 0, false, 0.7);
      this.pushTile(t.panel, u.x + 0.5, u.y + 1, null, 0.9, bob);
      this.pushTile(icon, u.x + 0.5, u.y + 1, null, 1, bob);
    }

    // --- row-by-row: blocks, bombs, characters
    const playersByRow: PlayerVisual[][] = Array.from({ length: TILE_ROWS }, () => []);
    for (const v of visuals) {
      const row = Math.min(TILE_ROWS - 1, Math.max(0, Math.floor(v.y)));
      playersByRow[row].push(v);
    }

    const bombsByRow: Array<Array<{ x: number; y: number; fuse: number }>> = Array.from(
      { length: TILE_ROWS },
      () => []
    );
    for (const b of state.bombs) {
      if (b.y >= 0 && b.y < TILE_ROWS) bombsByRow[b.y].push(b);
    }

    for (let r = 0; r < TILE_ROWS; r++) {
      for (let c = 0; c < TILE_COLS; c++) {
        const tile = state.grid[r][c];
        if (tile === 'floor') continue;
        if (tile === 'wall') {
          const cell = sudden.has(`${c},${r}`) ? t.suddenWall : t.wall;
          this.pushTile(cell, c + 0.5, r + 1, null, 1);
        } else {
          // Crates vary between three weathering stages, stable per cell.
          const stage = [0, 0, 1, 1, 2][cellHash(c, r, this.mapSalt ^ 0x51ed) % 5];
          this.pushTile(t.crate[stage], c + 0.5, r + 1, null, 1);
        }
      }

      for (const b of bombsByRow[r]) {
        // Six-frame fuse that accelerates as the bomb gets closer to going off.
        const burned = BOMB_FUSE - b.fuse;
        const frame = Math.floor(burned * (5 + burned * 5)) % 6;
        const urgency = 1 - b.fuse / BOMB_FUSE;
        const pulse = 1 + 0.06 * Math.sin(this.clock * (9 + urgency * 16));
        this.pushTile(t.shadow, b.x + 0.5, b.y + 1, null, 0.34, 0, false, 0.68);
        this.pushTile(t.bomb[frame], b.x + 0.5, b.y + 1, null, 1, 0, false, pulse);
      }

      for (const v of playersByRow[r]) {
        const chars = this.atlas.table.chars[v.slot % this.atlas.table.chars.length];
        const entry = chars[v.anim] ?? chars['idle-down'];
        const [first, frames, ticks] = entry;
        const frame = Math.floor(v.tick / ticks) % frames;
        const bottom = v.y + 0.5;

        if (v.alpha > 0.05 && v.lift === 0) {
          this.pushTile(t.shadow, v.x, bottom, null, 0.34 * v.alpha, 0, false, 0.72);
          if (v.local) {
            this.pushTile(t.ring, v.x, bottom, null, 0.5 * v.alpha, 0, false, 1.18);
          }
          this.pushTile(t.ring, v.x, bottom, this.colors[v.slot % 6], 0.85 * v.alpha);
        }
        this.pushTile(first + frame, v.x, bottom, null, v.alpha, v.lift, v.flip);
      }
    }

    this.batch.count = this.count;
    this.batch.instanceMatrix.needsUpdate = true;
    this.cellAttr.needsUpdate = true;
    this.tintAttr.needsUpdate = true;
  }

  // --------------------------------------------------------------- frame

  /** Camera shake in world units, decayed by the caller. */
  setShake(x: number, y: number): void {
    this.camera.position.x = x;
    this.camera.position.y = y;
    this.backdrop.offset(-x * 0.5, -y * 0.5);
  }

  /** Adds to the detonation white-out; decays on its own each frame. */
  addFlash(amount: number): void {
    this.flash = Math.min(0.5, this.flash + amount);
  }

  applyPost(settings: PostSettings): void {
    this.settings = settings;
    this.post.apply(settings);
  }

  resize(): void {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);

    // Fit the stage inside the canvas without ever cropping the board.
    const stageAspect = STAGE_W / STAGE_H;
    const viewAspect = w / h;
    let halfW = STAGE_W / 2;
    let halfH = STAGE_H / 2;
    if (viewAspect > stageAspect) halfW = halfH * viewAspect;
    else halfH = halfW / viewAspect;

    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
    this.post.setSize(w, h);
  }

  render(dt: number): void {
    this.clock += dt;
    this.flash = Math.max(0, this.flash - dt * 2.6);
    this.post.setFlash(this.flash);
    this.vfx.update(dt, STAGE_W, STAGE_H);

    if (this.settings.enabled) this.post.render(this.clock);
    else this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.backdrop.dispose();
    this.vfx.dispose();
    this.post.dispose();
    this.batch.geometry.dispose();
    (this.batch.material as THREE.Material).dispose();
    this.floor.geometry.dispose();
    (this.floor.material as THREE.Material).dispose();
    this.renderer.dispose();
  }
}

/**
 * The bombers themselves: a parametric character drawn into the sprite atlas
 * at match start. No sprite sheet, no third-party art.
 *
 * The design is deliberately our own — a stocky Stockholm courier in a knitted
 * beanie, round welding goggles and a satchel of bombs, with the team colour
 * on the hood and scarf. Every animation frame is posed from curves with
 * anticipation and follow-through instead of snapping between drawings.
 */

/** Edge length of one atlas cell, in atlas pixels. */
export const CELL = 96;

/** Where the character's feet sit inside the cell. */
const GROUND_Y = CELL - 16;

export type Facing = 'down' | 'up' | 'side';

export interface Pose {
  facing: Facing;
  /** Body lean in radians (+ leans forward / in the travel direction). */
  lean: number;
  /** Vertical squash, 0.85..1.15 (anticipation and impact). */
  squash: number;
  /** Leg stride, -1..1. */
  legs: number;
  /** Arm swing, -1..1. */
  arms: number;
  /** Vertical bob in pixels. */
  bob: number;
  /** 0 normal, 1 wide, 2 shut, 3 happy crescents. */
  eyes: number;
  /** Beanie tilt in radians. */
  hat: number;
  /** Squashed flat on the ground (death). */
  flat?: boolean;
  /** Holding a bomb out in front. */
  carry?: boolean;
}

const P = (p: Partial<Pose> & { facing: Facing }): Pose => ({
  lean: 0,
  squash: 1,
  legs: 0,
  arms: 0,
  bob: 0,
  eyes: 0,
  hat: 0,
  ...p,
});

/**
 * Animation table. Walk cycles carry the weight: a six-frame stride with a
 * squash on each footfall and the arms counter-swinging the legs.
 */
export const ANIMS: Record<string, Pose[]> = {
  'idle-down': [P({ facing: 'down' })],
  'idle-up': [P({ facing: 'up' })],
  'idle-side': [P({ facing: 'side', lean: 0.03 })],

  'walk-down': [
    P({ facing: 'down', legs: 1, arms: -1, bob: 0 }),
    P({ facing: 'down', legs: 0.5, arms: -0.5, bob: -1.6, squash: 1.04 }),
    P({ facing: 'down', legs: -0.4, arms: 0.4, bob: 0 }),
    P({ facing: 'down', legs: -1, arms: 1, bob: 0.8, squash: 0.97 }),
    P({ facing: 'down', legs: -0.5, arms: 0.5, bob: -1.6, squash: 1.04 }),
    P({ facing: 'down', legs: 0.4, arms: -0.4, bob: 0 }),
  ],
  'walk-up': [
    P({ facing: 'up', legs: 1, arms: -1, bob: 0 }),
    P({ facing: 'up', legs: 0.5, arms: -0.5, bob: -1.6, squash: 1.04 }),
    P({ facing: 'up', legs: -0.4, arms: 0.4, bob: 0 }),
    P({ facing: 'up', legs: -1, arms: 1, bob: 0.8, squash: 0.97 }),
    P({ facing: 'up', legs: -0.5, arms: 0.5, bob: -1.6, squash: 1.04 }),
    P({ facing: 'up', legs: 0.4, arms: -0.4, bob: 0 }),
  ],
  'walk-side': [
    P({ facing: 'side', legs: 1, arms: -1, lean: 0.09 }),
    P({ facing: 'side', legs: 0.5, arms: -0.5, lean: 0.07, bob: -1.8, squash: 1.05 }),
    P({ facing: 'side', legs: -0.4, arms: 0.4, lean: 0.06 }),
    P({ facing: 'side', legs: -1, arms: 1, lean: 0.09, bob: 0.9, squash: 0.96 }),
    P({ facing: 'side', legs: -0.5, arms: 0.5, lean: 0.07, bob: -1.8, squash: 1.05 }),
    P({ facing: 'side', legs: 0.4, arms: -0.4, lean: 0.06 }),
  ],

  /** Dropping a bomb: crouch, plant, recover. */
  plant: [
    P({ facing: 'down', carry: true, squash: 1.06, arms: 0.4, eyes: 1 }),
    P({ facing: 'down', carry: true, squash: 0.9, lean: 0.16, arms: 1, bob: 2, eyes: 2 }),
    P({ facing: 'down', squash: 0.94, lean: 0.1, arms: 0.5, bob: 1 }),
    P({ facing: 'down', squash: 1.04, arms: 0 }),
  ],

  /** Bomb ticking nearby: eyes wide, arms up, hat jostling. */
  panic: [
    P({ facing: 'down', arms: -1, eyes: 1, hat: -0.13, squash: 1.05, bob: -1 }),
    P({ facing: 'down', arms: 1, eyes: 1, hat: 0.13, squash: 0.96, bob: 1 }),
  ],

  /** Caught in the blast: flattened, flung, going still. */
  die: [
    P({ facing: 'down', squash: 1.14, eyes: 1, arms: -1, bob: -4, hat: -0.3 }),
    P({ facing: 'down', squash: 0.8, eyes: 2, arms: 1, bob: -1, hat: 0.35 }),
    P({ facing: 'down', squash: 0.5, eyes: 2, arms: 0.6, flat: true }),
    P({ facing: 'down', squash: 0.34, eyes: 2, arms: 0.3, flat: true }),
  ],

  /** Last one standing. */
  win: [
    P({ facing: 'down', eyes: 3, squash: 0.92, arms: -1 }),
    P({ facing: 'down', eyes: 3, squash: 1.12, arms: 1, bob: -6, hat: 0.16 }),
  ],
};

/** Ticks each frame is held; lower is faster. */
export const ANIM_TICKS: Record<string, number> = {
  'idle-down': 8,
  'idle-up': 8,
  'idle-side': 8,
  'walk-down': 4,
  'walk-up': 4,
  'walk-side': 4,
  plant: 3,
  panic: 4,
  die: 7,
  win: 8,
};

const COAT = '#4a4038';
const COAT_DARK = '#2e2822';
const SKIN = '#c98f63';
const SKIN_DARK = '#a06f49';
const OUTLINE = '#161213';
const BOOT = '#241d1a';
const GOGGLE_GLASS = '#8fd4e8';
const SATCHEL = '#6b4a2c';

function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function darken(hex: string, amount: number): string {
  const h = hex.replace('#', '');
  const rgb = [0, 2, 4].map((i) =>
    Math.max(0, Math.round(parseInt(h.slice(i, i + 2), 16) * (1 - amount)))
  );
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

function lighten(hex: string, amount: number): string {
  const h = hex.replace('#', '');
  const rgb = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16);
    return Math.min(255, Math.round(v + (255 - v) * amount));
  });
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

/**
 * Draws one posed bomber into the current canvas cell, feet at GROUND_Y.
 * `team` tints the hood, scarf and beanie band so slots read apart instantly.
 */
export function drawBomber(
  g: CanvasRenderingContext2D,
  pose: Pose,
  team: string
): void {
  const cx = CELL / 2;
  g.save();
  g.translate(cx, GROUND_Y + pose.bob);
  g.rotate(pose.facing === 'side' ? pose.lean : pose.lean * 0.4);

  const sq = pose.squash;
  const bodyW = 30 / Math.sqrt(sq);
  const bodyH = 34 * sq;
  const by = -bodyH * 0.5;
  const side = pose.facing === 'side';
  const back = pose.facing === 'up';

  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.strokeStyle = OUTLINE;
  g.lineWidth = 3;

  // --- ground contact shadow (drawn into the sprite so it moves with them)
  g.fillStyle = 'rgba(0,0,0,0.22)';
  g.beginPath();
  g.ellipse(0, 2, bodyW * 0.52, 5.5, 0, 0, 7);
  g.fill();

  if (pose.flat) {
    // Flattened silhouette: a puddle of coat with the beanie beside it.
    g.fillStyle = COAT_DARK;
    g.beginPath();
    g.ellipse(0, -5 * sq, bodyW * 0.72, 9 * sq, 0, 0, 7);
    g.fill();
    g.stroke();
    g.fillStyle = team;
    g.beginPath();
    g.ellipse(bodyW * 0.42, -7 * sq, 9, 6 * sq, -0.3, 0, 7);
    g.fill();
    g.stroke();
    g.restore();
    return;
  }

  // --- legs and boots
  const stride = pose.legs * (side ? 8 : 6);
  for (const s of side ? [1, -1] : [-1, 1]) {
    const lx = side ? stride * s * 0.9 : s * 7 + stride * s * 0.5;
    const lift = pose.legs * s > 0 ? -2.5 : 0;
    g.fillStyle = s > 0 ? BOOT : darken(BOOT, 0.25);
    g.beginPath();
    g.roundRect(lx - 5, -11 + lift, 10, 12, 3.5);
    g.fill();
    g.stroke();
  }

  // --- satchel hangs behind on the side view
  if (side) {
    g.fillStyle = SATCHEL;
    g.beginPath();
    g.ellipse(-bodyW * 0.42, by + bodyH * 0.22, 9, 8, -0.2, 0, 7);
    g.fill();
    g.stroke();
  }

  // --- body: heavy coat with a radial light from the upper left
  const coatGrad = g.createRadialGradient(
    -bodyW * 0.22,
    by - bodyH * 0.3,
    3,
    0,
    by,
    bodyH * 0.95
  );
  coatGrad.addColorStop(0, lighten(COAT, 0.22));
  coatGrad.addColorStop(0.55, COAT);
  coatGrad.addColorStop(1, COAT_DARK);
  g.fillStyle = coatGrad;
  g.beginPath();
  g.roundRect(-bodyW * 0.5, by - bodyH * 0.1, bodyW, bodyH * 0.72, [10, 10, 6, 6]);
  g.fill();
  g.stroke();

  // --- team-coloured hood over the shoulders
  g.fillStyle = team;
  g.beginPath();
  g.moveTo(-bodyW * 0.5, by + bodyH * 0.04);
  g.quadraticCurveTo(0, by - bodyH * 0.24, bodyW * 0.5, by + bodyH * 0.04);
  g.quadraticCurveTo(0, by + bodyH * 0.2, -bodyW * 0.5, by + bodyH * 0.04);
  g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = withAlpha('#ffffff', 0.16);
  g.beginPath();
  g.ellipse(-bodyW * 0.16, by - bodyH * 0.04, bodyW * 0.2, 3.5, -0.2, 0, 7);
  g.fill();

  // --- arms
  const armY = by + bodyH * 0.16;
  const swing = pose.arms;
  const drawArm = (sx: number, angle: number, len: number): void => {
    g.strokeStyle = OUTLINE;
    g.lineWidth = 8;
    g.beginPath();
    g.moveTo(sx, armY);
    g.lineTo(sx + Math.cos(angle) * len, armY + Math.sin(angle) * len);
    g.stroke();
    g.strokeStyle = COAT;
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(sx, armY);
    g.lineTo(sx + Math.cos(angle) * len, armY + Math.sin(angle) * len);
    g.stroke();
    // Mitten.
    g.fillStyle = SKIN;
    g.strokeStyle = OUTLINE;
    g.lineWidth = 2.2;
    g.beginPath();
    g.arc(sx + Math.cos(angle) * len, armY + Math.sin(angle) * len, 3.6, 0, 7);
    g.fill();
    g.stroke();
  };

  if (pose.carry) {
    drawArm(-6, 0.9 + swing * 0.2, 13);
    drawArm(6, 0.55 + swing * 0.2, 13);
  } else if (side) {
    drawArm(2, 1.1 + swing * 0.7, 12);
  } else {
    drawArm(-bodyW * 0.44, 1.5 - swing * 0.6, 12);
    drawArm(bodyW * 0.44, 1.5 + swing * 0.6, 12);
  }

  // --- carried bomb, held low in front
  if (pose.carry) {
    g.fillStyle = '#22242c';
    g.strokeStyle = OUTLINE;
    g.lineWidth = 2.4;
    g.beginPath();
    g.arc(0, armY + 13, 7.5, 0, 7);
    g.fill();
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.28)';
    g.beginPath();
    g.arc(-2.4, armY + 10.6, 2.4, 0, 7);
    g.fill();
  }

  // --- head
  const headR = 13.5;
  const headY = by - bodyH * 0.26 - headR * 0.4;
  g.fillStyle = back ? SKIN_DARK : SKIN;
  g.strokeStyle = OUTLINE;
  g.lineWidth = 3;
  g.beginPath();
  g.arc(0, headY, headR, 0, 7);
  g.fill();
  g.stroke();

  // --- scarf at the neck, team colour
  g.fillStyle = team;
  g.beginPath();
  g.roundRect(-headR * 0.82, headY + headR * 0.62, headR * 1.64, 7, 3);
  g.fill();
  g.stroke();
  if (side) {
    // Tail flicks behind when moving.
    g.fillStyle = darken(team, 0.15);
    g.beginPath();
    g.moveTo(-headR * 0.7, headY + headR * 0.7);
    g.quadraticCurveTo(
      -headR * 1.7 - Math.abs(pose.legs) * 4,
      headY + headR * 0.5,
      -headR * 1.5,
      headY + headR * 1.3
    );
    g.quadraticCurveTo(-headR * 1.0, headY + headR * 1.1, -headR * 0.7, headY + headR * 0.7);
    g.fill();
    g.stroke();
  }

  // --- goggles / eyes
  if (!back) {
    const eyeY = headY - 1;
    const eyeDx = side ? 4.5 : 5.4;
    const eyeCentre = side ? 3.5 : 0;
    if (pose.eyes === 2) {
      g.strokeStyle = OUTLINE;
      g.lineWidth = 2.2;
      for (const s of side ? [1] : [-1, 1]) {
        g.beginPath();
        g.arc(eyeCentre + s * eyeDx, eyeY, 3.2, 0.2 * Math.PI, 0.8 * Math.PI);
        g.stroke();
      }
    } else if (pose.eyes === 3) {
      g.strokeStyle = OUTLINE;
      g.lineWidth = 2.2;
      for (const s of side ? [1] : [-1, 1]) {
        g.beginPath();
        g.arc(eyeCentre + s * eyeDx, eyeY + 1.6, 3.4, 1.2 * Math.PI, 1.8 * Math.PI);
        g.stroke();
      }
    } else {
      const r = pose.eyes === 1 ? 4.6 : 4;
      for (const s of side ? [1] : [-1, 1]) {
        const ex = eyeCentre + s * eyeDx;
        // Goggle rim.
        g.fillStyle = COAT_DARK;
        g.beginPath();
        g.arc(ex, eyeY, r + 1.4, 0, 7);
        g.fill();
        g.fillStyle = GOGGLE_GLASS;
        g.beginPath();
        g.arc(ex, eyeY, r, 0, 7);
        g.fill();
        g.fillStyle = '#12151a';
        g.beginPath();
        g.arc(ex + (side ? 0.8 : s * 0.5), eyeY + 0.4, r * 0.44, 0, 7);
        g.fill();
        g.fillStyle = 'rgba(255,255,255,0.85)';
        g.beginPath();
        g.arc(ex - r * 0.34, eyeY - r * 0.4, r * 0.26, 0, 7);
        g.fill();
      }
    }
    // Goggle strap.
    g.strokeStyle = darken(team, 0.3);
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(-headR, headY - 1);
    g.lineTo(headR, headY - 1);
    g.stroke();
  } else {
    // Back of the head: strap buckle only.
    g.strokeStyle = darken(team, 0.3);
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(-headR, headY - 1);
    g.lineTo(headR, headY - 1);
    g.stroke();
    g.fillStyle = COAT_DARK;
    g.beginPath();
    g.roundRect(-3, headY - 3.5, 6, 5, 1.5);
    g.fill();
  }

  // --- knitted beanie with a team band and a pompom
  g.save();
  g.translate(0, headY - headR * 0.62);
  g.rotate(pose.hat);
  g.fillStyle = COAT_DARK;
  g.beginPath();
  g.moveTo(-headR * 0.98, 2);
  g.quadraticCurveTo(-headR * 0.8, -headR * 1.15, 0, -headR * 1.3);
  g.quadraticCurveTo(headR * 0.8, -headR * 1.15, headR * 0.98, 2);
  g.closePath();
  g.fill();
  g.strokeStyle = OUTLINE;
  g.lineWidth = 3;
  g.stroke();
  // Rib knit.
  g.strokeStyle = 'rgba(255,255,255,0.13)';
  g.lineWidth = 1.2;
  for (let i = -1; i <= 1; i++) {
    g.beginPath();
    g.moveTo(i * 4.6, 1);
    g.quadraticCurveTo(i * 3.6, -headR * 0.6, i * 2, -headR * 1.15);
    g.stroke();
  }
  // Team band.
  g.fillStyle = team;
  g.beginPath();
  g.roundRect(-headR * 1.02, -1.5, headR * 2.04, 5.5, 2.5);
  g.fill();
  g.strokeStyle = OUTLINE;
  g.lineWidth = 2.4;
  g.stroke();
  // Pompom.
  g.fillStyle = lighten(team, 0.45);
  g.beginPath();
  g.arc(0, -headR * 1.44, 4.2, 0, 7);
  g.fill();
  g.stroke();
  g.restore();

  g.restore();
}

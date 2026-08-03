/**
 * The uBOMBER wordmark: hand-authored 5x7 pixel glyphs drawn on a canvas, with
 * the O of BOMBER replaced by a bomb whose fuse actually burns.
 *
 * Pixel art rather than a webfont because the mark needs a bevel, a hard drop
 * shadow and a live spark — and because at this scale type *is* the art. Every
 * coordinate is on the logical pixel grid, so it stays crisp at any zoom.
 */

/** Logical pixels per art pixel in the backing canvas. */
const PX = 10;

/** Rows in a glyph. */
const H = 7;

/** Logical rows reserved above the letters for the fuse and spark. */
const HEAD = 8;

type Glyph = { rows: string[]; advance: number };

const GLYPHS: Record<string, Glyph> = {
  u: {
    rows: ['.....', '.....', 'X...X', 'X...X', 'X...X', 'X...X', '.XXX.'],
    advance: 6,
  },
  B: {
    rows: ['XXXX.', 'X...X', 'X...X', 'XXXX.', 'X...X', 'X...X', 'XXXX.'],
    advance: 6,
  },
  M: {
    rows: ['X...X', 'XX.XX', 'X.X.X', 'X...X', 'X...X', 'X...X', 'X...X'],
    advance: 6,
  },
  E: {
    rows: ['XXXXX', 'X....', 'X....', 'XXXX.', 'X....', 'X....', 'XXXXX'],
    advance: 6,
  },
  R: {
    // The leg drops straight rather than stepping one pixel per row: a 1px
    // diagonal at this size reads as noise and the glyph turns into an F.
    rows: ['XXXX.', 'X...X', 'X...X', 'XXXX.', 'X..X.', 'X...X', 'X...X'],
    advance: 5,
  },
};

/** The bomb that stands in for the O. Needs more air than a letter does. */
const BOMB: Glyph = {
  rows: ['..XXX..', '.XXXXX.', 'XXXXXXX', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..'],
  advance: 9,
};

/** Wordmark layout: `null` marks the bomb. */
const WORD: Array<string | null> = ['u', 'B', null, 'M', 'B', 'E', 'R'];

const GOLD = '#ffc63f';
const GOLD_LIT = '#fff0a8';
const GOLD_DEEP = '#c07a12';
const SHADOW = '#16101c';
const BOMB_BODY = '#2b2f3c';
const BOMB_LIT = '#5b6478';
const SPARK = '#fff6d8';
const FLAME = '#ff8a3c';

/**
 * Total canvas width in art pixels.
 *
 * The `+ 1` is the drop shadow's overhang. Trimming instead of padding clips
 * the final glyph's right-hand column, which is exactly how the R stopped
 * reading as an R.
 */
function wordWidth(): number {
  const advances = WORD.reduce(
    (w, key) => w + (key === null ? BOMB.advance : GLYPHS[key].advance),
    0
  );
  return advances + 1;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

/**
 * Mounts the animated wordmark into `parent` and returns a disposer.
 * Runs its own rAF; cheap enough to leave on behind a menu.
 */
export function mountLogo(parent: HTMLElement): () => void {
  const W = wordWidth();
  const totalH = HEAD + H;

  const canvas = document.createElement('canvas');
  canvas.className = 'logo';
  canvas.width = W * PX;
  canvas.height = totalH * PX;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'uBomber');
  parent.appendChild(canvas);

  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = false;

  let running = true;
  let clock = 0;
  const sparks: Spark[] = [];

  /** Fills one art pixel. */
  const dot = (x: number, y: number, color: string, size = 1): void => {
    g.fillStyle = color;
    g.fillRect(x * PX, y * PX, PX * size, PX * size);
  };

  const drawGlyphRows = (
    rows: string[],
    ox: number,
    oy: number,
    fill: string,
    lit: string,
    deep: string
  ): void => {
    // Hard drop shadow first, one pixel down-right.
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        if (rows[r][c] !== 'X') continue;
        dot(ox + c + 1, oy + r + 1, SHADOW);
      }
    }
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        if (rows[r][c] !== 'X') continue;
        const above = rows[r - 1]?.[c] === 'X';
        const below = rows[r + 1]?.[c] === 'X';
        // Bevel only the ends of a vertical run: top lit, bottom deep, middle
        // flat. Isolated pixels — every step of the R's diagonal leg — stay
        // flat too, because shading them individually scatters the stroke and
        // the letter stops reading.
        const color = !above && below ? lit : above && !below ? deep : fill;
        dot(ox + c, oy + r, color);
      }
    }
  };

  const frame = (): void => {
    if (!running) return;
    clock += 1 / 60;
    g.clearRect(0, 0, canvas.width, canvas.height);

    // The mark itself is fixed. Only the fuse burns: a bobbing wordmark reads
    // as the page loading, not as a cabinet idling.
    const baseY = HEAD;

    let x = 0;
    let bombX = 0;
    for (const key of WORD) {
      if (key === null) {
        bombX = x;
        drawGlyphRows(BOMB.rows, x, baseY, BOMB_BODY, BOMB_LIT, '#151821');
        // Catch light on the bomb's upper left.
        dot(x + 2, baseY + 1, '#8b93a6');
        dot(x + 1, baseY + 2, '#6d7688');
        x += BOMB.advance;
      } else {
        drawGlyphRows(GLYPHS[key].rows, x, baseY, GOLD, GOLD_LIT, GOLD_DEEP);
        x += GLYPHS[key].advance;
      }
    }

    // --- fuse, rising from the bomb's crown and curling right
    const fuseBase = { x: bombX + 4, y: baseY };
    const wobble = Math.sin(clock * 3.1);
    const path: Array<[number, number]> = [
      [fuseBase.x, fuseBase.y - 1],
      [fuseBase.x + 1, fuseBase.y - 2],
      [fuseBase.x + 1, fuseBase.y - 3],
      [fuseBase.x + 2, fuseBase.y - 4],
      [fuseBase.x + 3, fuseBase.y - 5],
      [fuseBase.x + 3 + (wobble > 0 ? 1 : 0), fuseBase.y - 6],
    ];
    for (const [fx, fy] of path) {
      dot(fx + 1, fy + 1, SHADOW);
      dot(fx, fy, '#c8a35e');
    }

    // --- spark at the fuse tip
    const tip = path[path.length - 1];
    const pulse = 0.6 + 0.4 * Math.sin(clock * 12);
    g.globalAlpha = 0.35 * pulse;
    dot(tip[0] - 1, tip[1] - 1, FLAME, 3);
    g.globalAlpha = 1;
    dot(tip[0], tip[1], SPARK);
    if (pulse > 0.85) {
      dot(tip[0] - 1, tip[1], FLAME);
      dot(tip[0] + 1, tip[1], FLAME);
    }

    // Sparks fly off the tip and fall.
    if (Math.random() < 0.35) {
      sparks.push({
        x: tip[0],
        y: tip[1],
        vx: (Math.random() - 0.5) * 0.28,
        vy: -Math.random() * 0.2 - 0.05,
        life: 1,
      });
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.life -= 0.028;
      if (s.life <= 0) {
        sparks.splice(i, 1);
        continue;
      }
      s.vy += 0.012;
      s.x += s.vx;
      s.y += s.vy;
      g.globalAlpha = Math.max(0, s.life);
      dot(Math.round(s.x), Math.round(s.y), s.life > 0.5 ? SPARK : FLAME);
      g.globalAlpha = 1;
    }

    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);

  return () => {
    running = false;
    canvas.remove();
  };
}

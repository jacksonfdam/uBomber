#!/usr/bin/env python3
"""Builds res://assets/sprites.png from the Bomb Party source sheet.

Source: assets/third_party/bomb_party_v4.png (CC-BY 3.0, see ATTRIBUTION.md).
Tiles that get tinted by map themes at runtime (floor, wall, crate, bush) are
neutralized to grayscale here so a plain modulate reproduces the theme color.

Atlas layout (16px cells, 16 cols x 9 rows):
  row 0: floorA floorB wall crate shadow ring panel bolt bush
  row 1: flCenter flH flTipL flTipR flV flTipU flTipD flBall flBurst
  row 2: bomb0..bomb5
  row 3-8: character variants 0-5; cols 0-3 down, 4-7 right, 8-9 up,
           10-13 left (right frames flipped)

Characters are all the same chibi hooded goblin (matching the splash art):
the source's purple-robed goblin recolored per player slot, so variant N
wears PLAYER_COLORS[N] from match_view.ts.

Usage: python3 tools/build_atlas.py   (from the game/ directory)
"""

from pathlib import Path

from PIL import Image, ImageDraw

CELL = 16
GAME_DIR = Path(__file__).resolve().parent.parent
SOURCE = GAME_DIR / 'assets' / 'third_party' / 'bomb_party_v4.png'
OUT = GAME_DIR / 'assets' / 'sprites.png'


def cell(sheet: Image.Image, c: int, r: int) -> Image.Image:
    return sheet.crop((c * CELL, r * CELL, (c + 1) * CELL, (r + 1) * CELL))


def neutralize(img: Image.Image) -> Image.Image:
    """Grayscale normalized around a bright mean; theme modulate then lands
    close to the theme color instead of a much darker shade."""
    rgba = img.convert('RGBA')
    gray = rgba.convert('L')

    def lift(v: int) -> float:
        # Gamma lift compresses the sprite's contrast so dark front faces
        # stay readable once the (often dark) theme color multiplies in.
        return ((v / 255) ** 0.6) * 255

    values = [
        lift(gray.getpixel((x, y))) for y in range(16) for x in range(16)
        if rgba.getpixel((x, y))[3] > 0
    ]
    mean = sum(values) / len(values) if values else 255
    scale = 205 / max(1, mean)
    out = Image.new('RGBA', rgba.size, (0, 0, 0, 0))
    for y in range(16):
        for x in range(16):
            r, g, b, a = rgba.getpixel((x, y))
            if a == 0:
                continue
            v = min(255, round(lift(gray.getpixel((x, y))) * scale))
            out.putpixel((x, y), (v, v, v, a))
    return out


def shadow_blob() -> Image.Image:
    """Radial soft shadow; squashed into an ellipse by the draw rect."""
    img = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    for y in range(16):
        for x in range(16):
            dx = (x - 7.5) / 7.5
            dy = (y - 7.5) / 7.5
            d2 = dx * dx + dy * dy
            if d2 < 1:
                img.putpixel((x, y), (0, 0, 0, round(130 * (1 - d2))))
    return img


def ring() -> Image.Image:
    """White circle outline; modulated with the player color at runtime."""
    img = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    for y in range(16):
        for x in range(16):
            d = ((x - 7.5) ** 2 + (y - 7.5) ** 2) ** 0.5
            a = max(0.0, 1 - abs(d - 6.0) / 1.6)
            if a > 0:
                img.putpixel((x, y), (255, 255, 255, round(230 * a)))
    return img


def panel() -> Image.Image:
    """Cream pickup panel with a dark pixel border."""
    img = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rectangle([2, 2, 13, 13], fill=(250, 236, 188, 255), outline=(82, 54, 24, 255))
    # knock out corners for a rounded pixel look
    for x, y in [(2, 2), (13, 2), (2, 13), (13, 13)]:
        img.putpixel((x, y), (0, 0, 0, 0))
    for x, y in [(3, 3), (12, 3), (3, 12), (12, 12)]:
        img.putpixel((x, y), (82, 54, 24, 255))
    d.line([4, 3, 11, 3], fill=(255, 249, 224, 255))
    return img


def bolt() -> Image.Image:
    """Lightning icon for the speed power-up."""
    art = [
        '................',
        '................',
        '.......XXXX.....',
        '......XXXX......',
        '.....XXXX.......',
        '....XXXX........',
        '....XXXXXXX.....',
        '.....XXXXXX.....',
        '.......XXX......',
        '......XXX.......',
        '.....XXX........',
        '....XXX.........',
        '....XX..........',
        '....X...........',
        '................',
        '................',
    ]
    img = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    for y, row in enumerate(art):
        for x, ch in enumerate(row):
            if ch == 'X':
                img.putpixel((x, y), (255, 214, 51, 255))
    # single-pixel dark outline
    out = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    for y in range(16):
        for x in range(16):
            if img.getpixel((x, y))[3]:
                out.putpixel((x, y), img.getpixel((x, y)))
                continue
            near = any(
                0 <= x + dx < 16 and 0 <= y + dy < 16 and img.getpixel((x + dx, y + dy))[3]
                for dx in (-1, 0, 1) for dy in (-1, 0, 1)
            )
            if near:
                out.putpixel((x, y), (120, 78, 10, 255))
    return out


# One robe color per player slot; must match PLAYER_COLORS in match_view.ts.
ROBE_TARGETS = ['#4f9dde', '#e2574c', '#57b26a', '#e0b34c', '#9a6dd7', '#5bc8c4']

# Brightest robe tone in the source goblin (blue channel of #6740b3).
ROBE_PEAK = 179


def recolor_goblin(img: Image.Image, target_hex: str) -> Image.Image:
    """Repaints the purple robe with the target color, keeping the shading
    ramp; green skin, face band and outlines are left untouched."""
    target = tuple(int(target_hex.lstrip('#')[i:i + 2], 16) for i in (0, 2, 4))
    out = img.copy()
    for y in range(16):
        for x in range(16):
            r, g, b, a = out.getpixel((x, y))
            if a == 0 or not (b > g + 12 and r > g - 8):
                continue
            # 1.25 puts the source's base tone at exactly the target color,
            # leaving the highlight a step brighter.
            shade = min(1.6, (b / ROBE_PEAK) * 1.25)
            out.putpixel((x, y), (
                min(255, round(target[0] * shade)),
                min(255, round(target[1] * shade)),
                min(255, round(target[2] * shade)),
                a,
            ))
    return out


def main() -> None:
    src = Image.open(SOURCE).convert('RGBA')
    atlas = Image.new('RGBA', (16 * CELL, 9 * CELL), (0, 0, 0, 0))

    def put(img: Image.Image, c: int, r: int) -> None:
        atlas.alpha_composite(img, (c * CELL, r * CELL))

    # row 0: themed tiles (neutralized) + procedural helpers
    put(neutralize(cell(src, 1, 13)), 0, 0)   # floorA (grass)
    put(neutralize(cell(src, 2, 13)), 1, 0)   # floorB (grass variant)
    put(neutralize(cell(src, 2, 2)), 2, 0)    # wall (beveled block)
    put(neutralize(cell(src, 9, 13)), 3, 0)   # crate
    put(shadow_blob(), 4, 0)
    put(ring(), 5, 0)
    put(panel(), 6, 0)
    put(bolt(), 7, 0)
    put(neutralize(cell(src, 3, 13)), 8, 0)   # bush decor

    # row 1: explosion flames (original colors)
    put(cell(src, 2, 18), 0, 1)   # center burst
    put(cell(src, 1, 18), 1, 1)   # horizontal beam
    put(cell(src, 0, 18), 2, 1)   # left tip
    put(cell(src, 3, 18), 3, 1)   # right tip
    put(cell(src, 14, 14), 4, 1)  # vertical beam
    put(cell(src, 14, 13), 5, 1)  # top tip
    put(cell(src, 14, 15), 6, 1)  # bottom tip
    put(cell(src, 14, 17), 7, 1)  # flame ball (power-up icon)
    put(cell(src, 14, 18), 8, 1)  # round burst

    # row 2: bomb fuse animation
    for i in range(6):
        put(cell(src, 4 + i, 18), i, 2)

    # rows 3-8: the hooded goblin (source row 16) recolored per player slot
    for variant, robe in enumerate(ROBE_TARGETS):
        for frame in range(10):
            put(recolor_goblin(cell(src, frame, 16), robe), frame, 3 + variant)
        for i in range(4):  # left-facing = flipped right-facing
            put(
                recolor_goblin(cell(src, 4 + i, 16), robe).transpose(Image.FLIP_LEFT_RIGHT),
                10 + i,
                3 + variant,
            )

    atlas.save(OUT)
    print(f'wrote {OUT} ({atlas.width}x{atlas.height})')


if __name__ == '__main__':
    main()

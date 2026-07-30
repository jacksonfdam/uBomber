"""Builds the promo art (splash + menu background) from the game's sprite atlas.

Everything is composed at low resolution and upscaled 4x nearest-neighbor so
the output stays true 8-bit: limited palette, ordered-dither glows, hand-drawn
5x7 pixel type. Outputs to web/public/img/.

Usage: python3 tools/build_promo.py   (from the game/ directory)
"""
import math
from PIL import Image, ImageDraw

from pathlib import Path

GAME_DIR = Path(__file__).resolve().parent.parent
OUT_DIR = GAME_DIR.parent / 'web' / 'public' / 'img'
atlas = Image.open(GAME_DIR / 'assets' / 'sprites.png').convert('RGBA')

BG      = (20, 22, 28)      # #14161c night slate
BG_DEEP = (13, 14, 19)
AMBER   = (255, 179, 0)     # #ffb300
FLAME   = (255, 143, 0)     # #ff8f00
GLOW_HI = (255, 214, 96)
SKY_SIL = (10, 11, 16)      # skyline silhouette
SKY_MID = (30, 26, 30)      # lit horizon band
STONE   = (44, 48, 60)
STONE_D = (34, 37, 47)
WATER   = (16, 24, 34)

def cell(c, r): return atlas.crop((c*16, r*16, (c+1)*16, (r+1)*16))

def tint(img, t):
    img = img.copy(); px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            r,g,b,a = px[x,y]
            px[x,y] = (min(255,r*t[0]//255), min(255,g*t[1]//255), min(255,b*t[2]//255), a)
    return img

# ---- 5x7 pixel font for "uBomber" -----------------------------------------
GLYPHS = {
 'u': ["  ","  ","X  X","X  X","X  X","X  X"," XXX"],
 'B': ["XXXX ","X   X","X   X","XXXX ","X   X","X   X","XXXX "],
 'o': ["", "", " XXX ", "X   X", "X   X", "X   X", " XXX "],
 'm': ["","","XX X ","X X X","X X X","X X X","X X X"],
 'b': ["X    ","X    ","XXXX ","X   X","X   X","X   X","XXXX "],
 'e': ["",""," XXX ","X   X","XXXXX","X    "," XXXX"],
 'r': ["","","X XX ","XX  X","X    ","X    ","X    "],
}
def draw_text(d, text, ox, oy, s, fill, outline=None, shadow=None):
    x = ox
    for ch in text:
        rows = GLYPHS[ch]
        pad = 7 - len(rows)
        w = max((len(r) for r in rows if r), default=5)
        for ry, row in enumerate(rows):
            for rx, c in enumerate(row):
                if c == 'X':
                    px, py = x + rx*s, oy + (ry+pad)*s
                    if shadow: d.rectangle([px+s, py+s, px+2*s-1, py+2*s-1], fill=shadow)
        for ry, row in enumerate(rows):
            for rx, c in enumerate(row):
                if c == 'X':
                    px, py = x + rx*s, oy + (ry+pad)*s
                    if outline:
                        d.rectangle([px-1, py-1, px+s, py+s], fill=outline)
        for ry, row in enumerate(rows):
            for rx, c in enumerate(row):
                if c == 'X':
                    px, py = x + rx*s, oy + (ry+pad)*s
                    d.rectangle([px, py, px+s-1, py+s-1], fill=fill)
        x += (w + 1) * s
    return x

def text_width(text, s):
    w = 0
    for ch in text:
        rows = GLYPHS[ch]
        gw = max((len(r) for r in rows if r), default=5)
        w += (gw + 1) * s
    return w - s

# ---- scenery helpers --------------------------------------------------------
def skyline(d, W, base, seed=7):
    """Gabled Gamla Stan houses + Stadshuset tower, silhouetted."""
    x = -4; n = seed
    while x < W:
        n = (n*1103515245 + 12345) & 0x7fffffff
        hw = 14 + n % 16          # house width
        hh = 16 + (n >> 8) % 22   # house height
        d.rectangle([x, base-hh, x+hw, base], fill=SKY_SIL)
        d.polygon([(x-1, base-hh), (x+hw+1, base-hh), (x+hw//2, base-hh-6-(n>>16)%6)], fill=SKY_SIL)
        if (n >> 4) % 3 == 0:  # chimney
            d.rectangle([x+2, base-hh-8, x+4, base-hh], fill=SKY_SIL)
        # lit windows
        for wy in range(base-hh+4, base-3, 6):
            for wx in range(x+3, x+hw-2, 5):
                if ((wx*7+wy*13) % 11) == 0:
                    d.point((wx, wy), fill=(120, 84, 20))
        x += hw + 2 + (n >> 12) % 5
def stadshuset(d, x, base):
    d.rectangle([x, base-52, x+10, base], fill=SKY_SIL)          # tower
    d.rectangle([x+1, base-56, x+9, base-52], fill=SKY_SIL)      # lantern
    d.polygon([(x, base-56), (x+10, base-56), (x+5, base-63)], fill=SKY_SIL)
    for i, cx in enumerate((x+2, x+5, x+8)):                     # tre kronor
        d.point((cx, base-58-i%2), fill=AMBER)
def stars(d, W, H, seed=3):
    n = seed
    for _ in range(90):
        n = (n*48271) % 0x7fffffff
        x, y = n % W, (n >> 8) % H
        if y < H - 8:
            d.point((x, y), fill=(90, 95, 110) if n % 3 else (200, 200, 210))
def glow(img, cx, cy, radius, color):
    """Ordered-dither radial glow, keeps it 8-bit."""
    bayer = [[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]]
    px = img.load()
    for y in range(max(0,cy-radius), min(img.height, cy+radius)):
        for x in range(max(0,cx-radius), min(img.width, cx+radius)):
            dist = math.hypot(x-cx, y-cy) / radius
            if dist >= 1: continue
            k = (1 - dist) ** 2 * 18
            if k > bayer[y % 4][x % 4]:
                r, g, b, a = px[x, y]
                t = min(1.0, k / 24)
                px[x, y] = (int(r+(color[0]-r)*t*0.8), int(g+(color[1]-g)*t*0.8), int(b+(color[2]-b)*t*0.8), a)
def cobbles(d, W, y0, y1):
    for y in range(y0, y1, 5):
        for x in range(-3, W, 8):
            off = 4 if (y // 5) % 2 else 0
            d.rectangle([x+off, y, x+off+6, y+3], fill=STONE if ((x+y)//5) % 3 else STONE_D, outline=BG_DEEP)

# ============================ SPLASH (480x270 -> 1920x1080) ==================
W, H = 480, 270
img = Image.new('RGBA', (W, H), BG)
d = ImageDraw.Draw(img)
stars(d, W, 140)
d.rectangle([0, 128, W, 152], fill=SKY_MID)                     # horizon band
skyline(d, W, 152)
stadshuset(d, 388, 152)
d.rectangle([0, 152, W, 168], fill=WATER)                       # riddarfjärden strip
for x in range(0, W, 3):                                        # reflections
    if (x*7) % 5 == 0: d.point((x, 154 + (x*11) % 12), fill=(60, 62, 40))
cobbles(d, W, 168, H)
glow(img, 402, 196, 96, FLAME)                                  # explosion glow
d = ImageDraw.Draw(img)
# explosion flames from atlas at the glow origin
def paste(sp, x, y, s=2): img.alpha_composite(sp.resize((16*s, 16*s), Image.NEAREST), (x, y))
paste(cell(0,1), 386, 180, 3)                                    # center burst
paste(cell(4,1), 394, 150, 2); paste(cell(5,1), 394, 134, 2)     # beam up + tip
paste(cell(1,1), 354, 188, 2); paste(cell(2,1), 338, 188, 2)     # beam left + tip
# crates flying near blast
paste(tint(cell(3,0), (181,133,78)), 350, 148, 2)
paste(tint(cell(3,0), (181,133,78)), 430, 170, 2)
# four bombers running from the blast (side-left frames, staggered)
runners = [(3, 60, 196, 10), (0, 130, 206, 11), (1, 205, 199, 12), (2, 285, 208, 13)]
for var, x, y, fr in runners:
    sh = tint(cell(4,0), (0,0,0))
    img.alpha_composite(sh.resize((40, 12), Image.NEAREST), (x-2, y+38))
    paste(cell(fr, 3+var), x, y, 3)
# bombs they dropped behind
paste(cell(2,2), 176, 216, 2); paste(cell(4,2), 330, 212, 2)
# title with shadow + outline
s = 6
tw = text_width('uBomber', s)
d = ImageDraw.Draw(img)
draw_text(d, 'uBomber', (W-tw)//2, 26, s, AMBER, outline=(60,30,0), shadow=(0,0,0))
sub = 'bombs over stockholm'
# subtitle as simple dotted rule + small text via 1px font? keep a clean amber rule instead
d.rectangle([(W-tw)//2, 88, (W+tw)//2, 89], fill=(120, 84, 20))
img = img.resize((1920, 1080), Image.NEAREST)
img.convert('RGB').save(OUT_DIR / 'splash.png', optimize=True)

# ============================ MENU (320x208 -> 1280x832) =====================
W, H = 320, 208
img = Image.new('RGBA', (W, H), BG)
d = ImageDraw.Draw(img)
stars(d, W, 84)
d.rectangle([0, 74, W, 90], fill=SKY_MID)
skyline(d, W, 90, seed=23)
stadshuset(d, 262, 90)
# arena floor from atlas tiles, dim slate tint
floor_t = (64, 70, 86); floor_t2 = (56, 61, 75)
for ty in range(90, H, 16):
    for tx in range(0, W, 16):
        f = cell(1 if ((tx//16 + ty//16) * 7) % 5 == 0 else 0, 0)
        img.alpha_composite(tint(f, floor_t if (tx//16 + ty//16) % 2 == 0 else floor_t2), (tx, ty))
d = ImageDraw.Draw(img)
# crate + wall rim at the bottom edge
for tx in range(0, W, 16):
    sp = cell(3, 0) if (tx//16) % 3 else cell(2, 0)
    img.alpha_composite(tint(sp, (96, 78, 58) if (tx//16) % 3 else (70, 74, 88)), (tx, H-16))
# soft dark vignette (dithered)
bayer = [[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]]
px = img.load()
cx, cy = W/2, H/2 + 10
for y in range(H):
    for x in range(W):
        dist = math.hypot((x-cx)/(W*0.62), (y-cy)/(H*0.72))
        k = max(0.0, dist - 0.55) * 26
        if k > bayer[y % 4][x % 4]:
            r, g, b, a = px[x, y]
            px[x, y] = (int(r*0.55), int(g*0.55), int(b*0.55), a)
d = ImageDraw.Draw(img)
# bomb mascot, center-bottom, with amber fuse glow
glow(img, W//2 + 1, H - 44, 26, (120, 84, 20))
img.alpha_composite(cell(0, 2).resize((32, 32), Image.NEAREST), (W//2 - 16, H - 62))
# two tiny bombers peeking from the bottom corners
img.alpha_composite(cell(0, 3).resize((32, 32), Image.NEAREST), (12, H - 58))
img.alpha_composite(cell(0, 5).resize((32, 32), Image.NEAREST), (W - 44, H - 58))
# title small at top
s = 3
tw = text_width('uBomber', s)
draw_text(ImageDraw.Draw(img), 'uBomber', (W-tw)//2, 18, s, AMBER, outline=(60,30,0), shadow=(0,0,0))
img = img.resize((1280, 832), Image.NEAREST)
img.convert('RGB').save(OUT_DIR / 'menu.png', optimize=True)
print(f'wrote {OUT_DIR}/splash.png and menu.png')

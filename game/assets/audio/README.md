# Audio assets (bring your own)

uBomber's audio system is fully wired (`game/src/godot/audio.ts`) but the
repository intentionally ships **no sound files**: the game falls back to
silence for any missing clip.

Why: the popular sound packs from the Bomberman modding scene (e.g.
GameBanana's *Bomberman PSX Sound Pack – PB*) are rips of commercial games —
their own READMEs say "all rights reserved to Hudson Soft / Konami". They are
fine for personal builds, but they cannot be redistributed in an MIT
repository. This whole directory (except this file) is therefore gitignored.

## Installing a pack locally

```bash
ops/install-sound-pack.sh "/path/to/Bomberman PSX Sound Pack - PB v0.7.8b"
godot --headless --path game --import   # let the engine import the clips
```

## Expected files

| File | Played when |
|------|-------------|
| `sfx/menu_accept.wav` | any menu button is pressed |
| `sfx/menu_move.wav` | reserved for focus movement |
| `sfx/bomb_place.wav` | a bomb is placed |
| `sfx/explosion.wav` | a blast goes off |
| `sfx/item.wav` | a power-up is collected |
| `sfx/death.wav` | a player dies |
| `sfx/start.wav` | a match starts |
| `sfx/winner.wav` | someone wins |
| `music/title.ogg` | main menu (loops) |
| `music/lobby.ogg` | online lobby (loops) |
| `music/battle.ogg` | during a match (loops) |
| `music/victory.ogg` | win jingle (once) |
| `music/draw.ogg` | draw jingle (once) |

Any WAV (sfx) / OGG (music) with these names works — royalty-free packs are
a great option for builds you plan to publish.

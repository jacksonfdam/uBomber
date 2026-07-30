#!/usr/bin/env bash
# Installs a "Power Bomberman"-layout sound pack into game/assets/audio/.
#
# uBomber ships without audio: sound packs for the Power Bomberman mod scene
# (e.g. "Bomberman PSX Sound Pack - PB" by MonochromeKirby on GameBanana)
# drop straight in with this script. Mind the licensing: most such packs are
# rips of commercial games and must NOT be committed to a public repository
# — game/assets/audio/ is gitignored for exactly that reason.
#
# Usage: ops/install-sound-pack.sh "/path/to/sound pack folder"

set -euo pipefail

PACK="${1:?usage: ops/install-sound-pack.sh <pack-directory>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/game/assets/audio"

copy() { # copy <source-relative-to-pack> <dest-relative-to-audio>
  if [ -f "$PACK/$1" ]; then
    mkdir -p "$DEST/$(dirname "$2")"
    cp "$PACK/$1" "$DEST/$2"
    echo "  + $2"
  else
    echo "  - skipped $2 (missing $1)"
  fi
}

echo "Installing sound pack from: $PACK"

# Sound effects (see game/src/godot/audio.ts for the event names)
copy "sound/accept.wav"             "sfx/menu_accept.wav"
copy "sound/choose.wav"             "sfx/menu_move.wav"
copy "sound/sfx_power/bomb.wav"     "sfx/bomb_place.wav"
copy "sound/sfx_power/explosion.wav" "sfx/explosion.wav"
copy "sound/sfx_power/item.wav"     "sfx/item.wav"
copy "sound/voice/death1.wav"       "sfx/death.wav"
copy "sound/voice/start.wav"        "sfx/start.wav"
copy "sound/voice/winner.wav"       "sfx/winner.wav"

# Music (loop points encoded in some filenames are ignored; full-file loop)
copy "music/title.ogg" "music/title.ogg"
for f in "$PACK"/music/online_lobby*.ogg; do
  [ -f "$f" ] && cp "$f" "$DEST/music/lobby.ogg" && echo "  + music/lobby.ogg"
done
for f in "$PACK"/music/redial*.ogg; do
  [ -f "$f" ] && cp "$f" "$DEST/music/battle.ogg" && echo "  + music/battle.ogg"
done
for f in "$PACK"/music/battle_victory*.ogg; do
  [ -f "$f" ] && cp "$f" "$DEST/music/victory.ogg" && echo "  + music/victory.ogg"
done
copy "music/battle_draw.ogg" "music/draw.ogg"

echo "Done. Re-run the editor import (or: godot --headless --path game --import)"
echo "and re-export for the sounds to reach web builds."

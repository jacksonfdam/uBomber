# AI audio generation prompts

Prompts for generating an **original, redistributable** sound set for
uBomber — one entry per file the audio bank expects (see
[game/assets/audio/README.md](../game/assets/audio/README.md)). Generate,
rename to the exact filenames below, drop them into `game/assets/audio/`,
re-import and re-export.

Suggested tools: **ElevenLabs Sound Effects**, **Stability Stable Audio**,
or **Meta AudioCraft/AudioGen** for SFX; **Suno**, **Udio** or **Stable
Audio** for music. Check each service's terms grant you commercial/
redistribution rights before committing the output to the repository.

## Sound identity

One consistent brief to prepend to every prompt:

> Retro arcade game audio for a playful Bomberman-style game set in
> Stockholm. Bright, punchy, slightly chiptune-flavored but with modern
> clarity. Cheerful, cartoonish, never harsh or scary. No voice, no lyrics.

## Technical specs

- **SFX**: WAV, 44.1 kHz, 16-bit, mono is fine. Trim silence; peak around
  -3 dBFS. Keep them SHORT — they fire dozens of times per match.
- **Music**: OGG Vorbis, 44.1 kHz, stereo, ~-14 LUFS. Loop tracks must end
  exactly where they can rejoin their own start (ask the tool for a
  "seamless loop" or trim on a bar boundary at the stated BPM).

## Sound effects (`game/assets/audio/sfx/`)

| File | Length | Prompt |
|------|--------|--------|
| `menu_accept.wav` | 0.2–0.4 s | "Cheerful arcade menu confirm blip: a quick two-note rising chime, bright square-wave with a soft marimba body, instant attack, clean tail. One-shot UI sound." |
| `menu_move.wav` | 0.1–0.2 s | "Tiny arcade menu tick for moving between options: single short soft click-blip, neutral pitch, very quiet tail. One-shot UI sound." |
| `bomb_place.wav` | 0.2–0.4 s | "Cartoon bomb being set down on stone: a plump, hollow 'plunk' with a faint metallic pin-click at the end. Playful, round, bassy but small. One-shot." |
| `explosion.wav` | 0.6–1.0 s | "Cartoon arcade explosion: punchy deep 'boom' with a crunchy mid-range burst and a fast crackling decay, slight 8-bit noise character, no long rumble tail. Fun, not frightening. One-shot." |
| `item.wav` | 0.4–0.6 s | "Sparkling power-up pickup: ascending three-note glissando with glassy bell timbre and a tiny shimmer, joyful and rewarding. One-shot arcade collect sound." |
| `death.wav` | 0.5–0.8 s | "Comical arcade defeat sound: a descending 'wah-wah' slide whistle with a soft 'poof' at the end, cartoonish and light-hearted, no screams. One-shot." |
| `start.wav` | 0.6–1.0 s | "Match-start fanfare stinger: quick snappy drum fill into a single bright brass-and-square-wave hit, energetic 'go!' feeling without any voice. One-shot." |
| `winner.wav` | 0.8–1.2 s | "Victory stinger: short triumphant ascending fanfare, chiptune brass with a sparkle on the last note, celebratory and cute. One-shot." |

## Music (`game/assets/audio/music/`)

| File | Length | Loop | Prompt |
|------|--------|------|--------|
| `title.ogg` | 60–90 s | yes | "Upbeat retro arcade title theme with a Swedish folk twist: bouncy chiptune lead playing a cheerful melody inspired by Scandinavian folk dance (polska rhythm hints), warm synth bass, light percussion, accordion-like pad accents. 112 BPM, seamless loop, instrumental." |
| `lobby.ogg` | 45–60 s | yes | "Relaxed waiting-room groove: mellow lo-fi chiptune with soft vibraphone melody, gentle bossa-ish beat, friendly and patient mood, low intensity. 96 BPM, seamless loop, instrumental." |
| `battle.ogg` | 60–90 s | yes | "Driving arcade battle theme: fast energetic chiptune with punchy drums, pumping synth bass, catchy urgent melody with playful tension, occasional folk-fiddle-style synth runs. 150 BPM, seamless loop, instrumental, never stressful or dark." |
| `victory.ogg` | 6–10 s | no | "Short victory jingle: triumphant chiptune fanfare resolving to a bright major chord with celebratory sparkle, confident and happy ending. One-shot, instrumental." |
| `draw.ogg` | 5–8 s | no | "Short 'draw / time up' jingle: mildly comic descending chiptune phrase ending on an unresolved chord, a friendly shrug in music form. One-shot, instrumental." |

## Per-tool tips

- **ElevenLabs SFX**: paste the SFX prompts as-is; set duration explicitly;
  generate 3–4 variants and keep the punchiest.
- **Stable Audio**: works for both; for loops add "seamless loop" and set
  the exact duration to a whole number of bars at the stated BPM
  (e.g. 150 BPM · 4/4 · 32 bars = 51.2 s).
- **Suno/Udio**: prefix music prompts with "instrumental, no vocals, video
  game soundtrack"; download the highest-quality export and convert to OGG
  (`ffmpeg -i in.wav -c:a libvorbis -q:a 6 out.ogg`).
- Loudness pass for consistency: `ffmpeg-normalize` or a -14 LUFS master in
  any editor keeps mixes even across generators.

Once every file is original and its license allows redistribution, the
`game/assets/audio/*` gitignore rule can be dropped so the sounds ship with
the repository.

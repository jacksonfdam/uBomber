/**
 * Text helpers for the arcade display face.
 *
 * Press Start 2P has no uppercase Å, Ä or Ö, so naively upper-casing a
 * Stockholm arena name renders tofu or drops to a mismatched fallback glyph
 * mid-word. Transliterating is both legible and period-correct — cabinets of
 * the era were ASCII — while the proper spelling stays in the map data for
 * menus prose, documentation and the page title.
 */

const FOLD: Record<string, string> = {
  Å: 'A',
  Ä: 'A',
  Ö: 'O',
  å: 'a',
  ä: 'a',
  ö: 'o',
  É: 'E',
  é: 'e',
  Ü: 'U',
  ü: 'u',
};

/** Upper-cases for the pixel font, folding Swedish diacritics to ASCII. */
export function arcadeCase(text: string): string {
  let out = '';
  for (const ch of text) out += FOLD[ch] ?? ch;
  return out.toUpperCase();
}

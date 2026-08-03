/**
 * Everything visual and aural that distinguishes one arena from another.
 *
 * This is the whole reason a new map costs no art: each map module exports one
 * MapTheme next to its MapDef, and the renderer derives its tileset, block
 * faces, backdrop, particle colours, colour grade and music from it. Nothing
 * here is loaded from disk — it is all synthesized at match start.
 */

/** Selects the floor pattern generator in render/textures.ts. */
export type TilesetKind =
  | 'cobble'
  | 'metro'
  | 'plaza'
  | 'setts'
  | 'park'
  | 'brick'
  | 'quay'
  | 'timber'
  | 'concrete'
  | 'granite';

/** Selects the vertical-face treatment shared by walls of a family. */
export type FaceKind = 'stone' | 'tiled' | 'brick' | 'timber' | 'concrete';

/** Selects the silhouette generator in render/backdrop.ts. */
export type SkylineStyle =
  | 'townhouses'
  | 'cavern'
  | 'blocks'
  | 'boulevard'
  | 'trees'
  | 'tenements'
  | 'waterfront'
  | 'farmstead'
  | 'cranes'
  | 'islets';

/** Selects the layered noise bed in audio/audio.ts. */
export type AmbientBed =
  | 'city'
  | 'metro'
  | 'plaza'
  | 'boulevard'
  | 'park'
  | 'courtyard'
  | 'water'
  | 'market'
  | 'site'
  | 'archipelago';

export type Weather = 'rain' | 'snow' | 'leaves' | 'embers' | null;

export interface SkylineLayer {
  style: SkylineStyle;
  color: string;
  /** Fraction of the backdrop height the silhouette occupies, 0..1. */
  height: number;
  /** Optional second tone for windows, lights and details. */
  detail?: string;
}

export interface MapTheme {
  tileset: TilesetKind;
  face: FaceKind;

  floor: {
    base: string;
    /** Second tone for the checker variation across cells. */
    alt: string;
    /** Joint / grout / seam colour. */
    grout: string;
  };

  wall: {
    /** Lit top face of the block. */
    top: string;
    /** Front face in shadow. */
    front: string;
    /** Side bevel and trim. */
    edge: string;
  };

  crate: {
    top: string;
    front: string;
    /** Exposed material once the crate cracks — must differ from the front. */
    interior: string;
    /** Crack line colour as damage accumulates. */
    crack: string;
  };

  /** Blast colours: the core burns hot, the edge carries the map's tint. */
  flame: { core: string; edge: string };

  /** Decor props scattered on floor cells (bushes, crates, bollards). */
  accent: string;

  sky: {
    top: string;
    mid: string;
    bottom: string;
    sun?: { x: number; y: number; color: string; size: number };
    stars?: boolean;
  };

  /** Far and near silhouette bands behind the arena. */
  skyline: [SkylineLayer, SkylineLayer];

  /** Directional light used for block bevels and edge shading. */
  lightDir: { x: number; y: number };
  lightColor: string;

  weather?: Weather;
  ambient: AmbientBed;

  grading: {
    /** Multiplied tint, e.g. [1.05, 1.0, 0.92]. */
    gain: [number, number, number];
    /** Added lift in the shadows. */
    lift: [number, number, number];
    saturation: number;
    vignette: number;
  };
  bloom: number;

  music: {
    /** Semitone offsets of the scale the generative track draws from. */
    scale: number[];
    /** Root MIDI note. */
    root: number;
    tempo: number;
    /** 0..1 — how bright and percussive the instruments are. */
    brightness: number;
  };
}

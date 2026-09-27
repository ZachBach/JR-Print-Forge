/**
 * What a customer's image can become, and the rules that keep it printable.
 *
 * Each product takes the uploaded image — already resampled by the page to
 * exactly `artSize()` cells — and returns a height field for the mesher plus
 * plain-language warnings. Sizes are millimetres; `cell` is the grid pitch.
 *
 *   relief      keychain, plaque, coaster, badge: the drawing raised (or cut)
 *               into a plate, optionally cut to the drawing's own outline,
 *               with a keyring tab and a raised rim
 *   lithophane  a panel whose thickness follows the photo, so it shows the
 *               picture when lit from behind
 *   cutter      a cookie / clay cutter that follows the outline of a sketch
 *
 * Printability defaults assume a 0.4 mm nozzle: the smallest reliable feature
 * is two extrusion widths, 0.8 mm.
 */
import {
  adaptiveThreshold,
  boxMean,
  bounds,
  count,
  dilate,
  distanceTo,
  erode,
  fillHoles,
  otsu,
  removeSmall,
  stretch,
  type Box,
  type Grey,
  type Mask,
} from './raster.ts';
import type { HeightField } from './mesh.ts';

export type ImageMode = 'sketch' | 'artwork' | 'photo';

export interface ImageSettings {
  /** sketch: photo of pen on paper · artwork: clean digital line art · photo: shades of grey */
  mode: ImageMode;
  /** 0–1. Drawing modes: how faint a mark still counts as ink. */
  sensitivity: number;
  /** Light marks on a dark ground — chalkboard, white-on-black logo. */
  invert: boolean;
  /** Drawing modes: width added to every stroke, mm. */
  bolden: number;
  /** Drawing modes: specks and pinholes smaller than this are dropped, mm². */
  despeckle: number;
  /** Photo mode: blur radius before shaping, mm. */
  smoothing: number;
}

export interface ReliefSpec {
  kind: 'relief';
  shape: 'rect' | 'rounded' | 'circle' | 'outline';
  /** Plate width (diameter for a circle), mm. */
  width: number;
  /** Plate thickness under the design, mm. */
  base: number;
  /** Height of the design above the plate, mm. */
  relief: number;
  style: 'raised' | 'engraved';
  /** Raised rim around the edge, mm; 0 for none. */
  border: number;
  /** Space between the design and the edge, mm. */
  margin: number;
  /** Add a keyring tab with a hole. */
  hole: boolean;
}

export interface LithophaneSpec {
  kind: 'lithophane';
  width: number;
  /** Thickness at the brightest pixel, mm. */
  minThickness: number;
  /** Thickness at the darkest pixel, mm. */
  maxThickness: number;
  /** Solid frame around the picture, mm; 0 for none. */
  frame: number;
  hole: boolean;
}

export interface CutterSpec {
  kind: 'cutter';
  /** Width of the cutting outline, mm. */
  width: number;
  /** Cutting wall thickness, mm. */
  wall: number;
  /** Cutting wall height, mm. */
  height: number;
  /** Grip lip around the outside, mm. */
  flangeWidth: number;
  flangeHeight: number;
  /** Pen gaps up to this wide are closed before tracing, mm. */
  gapClose: number;
}

export type ProductSpec = ReliefSpec | LithophaneSpec | CutterSpec;
export type ProductKind = ProductSpec['kind'];

export const LIMITS = {
  /** Two 0.4 mm extrusion widths. */
  minFeature: 0.8,
  /** Most desktop printers (Bambu X1/P1/A1, Prusa MK4) top out near 250 mm. */
  bed: 250,
  /** Matches the quote form's "Large — up to 400 mm". */
  maxSize: 400,
  minSize: 10,
  /** Keeps a build under a few hundred ms and the file under a few tens of MB. */
  maxCells: 1_000_000,
} as const;

const HOLE_R = 2.5; // 5 mm keyring hole
const RING = 2.5; // material around it
const HOLE_GAP = 0.5; // hole edge to design edge

export const DEFAULT_IMAGE: ImageSettings = {
  mode: 'sketch',
  sensitivity: 0.5,
  invert: false,
  bolden: 0.4,
  despeckle: 1,
  smoothing: 0,
};

export const DEFAULTS: { relief: ReliefSpec; lithophane: LithophaneSpec; cutter: CutterSpec } = {
  relief: {
    kind: 'relief',
    shape: 'rounded',
    width: 60,
    base: 2,
    relief: 1.2,
    style: 'raised',
    border: 1.2,
    margin: 3,
    hole: true,
  },
  lithophane: {
    kind: 'lithophane',
    width: 120,
    minThickness: 0.8,
    maxThickness: 3,
    frame: 3,
    hole: false,
  },
  cutter: {
    kind: 'cutter',
    width: 80,
    wall: 1.2,
    height: 14,
    flangeWidth: 4,
    flangeHeight: 1.6,
    gapClose: 1.5,
  },
};

/** The image mode a product can actually use. */
export function effectiveMode(kind: ProductKind, mode: ImageMode): ImageMode {
  if (kind === 'lithophane') return 'photo';
  if (kind === 'cutter' && mode === 'photo') return 'sketch';
  return mode;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function artMM(spec: ProductSpec, aspect: number): { w: number; h: number } {
  const a = clamp(aspect, 0.1, 10);
  const width = clamp(spec.width, LIMITS.minSize, LIMITS.maxSize);
  let w: number;
  if (spec.kind === 'relief') {
    if (spec.shape === 'circle') {
      // The largest box of this aspect that fits inside the circle.
      const R = Math.max(2, width / 2 - spec.margin);
      const k = Math.sqrt(1 + a * a);
      return { w: (2 * R * a) / k, h: (2 * R) / k };
    }
    w = width - 2 * spec.margin;
  } else if (spec.kind === 'lithophane') {
    w = width - 2 * spec.frame;
  } else {
    w = width;
  }
  w = Math.max(4, w);
  return { w, h: w / a };
}

/**
 * The grid pitch to use: the requested detail, coarsened only if the part is
 * so large that the grid would exceed LIMITS.maxCells.
 */
export function planCell(spec: ProductSpec, aspect: number, desired: number): number {
  const { w, h } = artMM(spec, aspect);
  const slack = 24; // margins, frames, flanges and tabs, generously
  const area = (w + slack) * (h + slack);
  return Math.max(desired, Math.sqrt(area / LIMITS.maxCells));
}

/** How many cells the page must resample the artwork to. */
export function artSize(spec: ProductSpec, aspect: number, cell: number): { cols: number; rows: number } {
  const { w, h } = artMM(spec, aspect);
  return { cols: Math.max(2, Math.round(w / cell)), rows: Math.max(2, Math.round(h / cell)) };
}

/**
 * Ink detection shared by the crop pass and the build. `sketch` compares each
 * pixel with its neighbourhood (shadow-proof); `artwork` uses one global
 * Otsu level (keeps solid fills solid).
 */
export function inkMask(g: Grey, cols: number, rows: number, img: ImageSettings): Mask {
  const src = img.invert ? g.map((v) => 1 - v) : g;
  if (img.mode === 'artwork') {
    const t = otsu(src) + (img.sensitivity - 0.5) * 0.3;
    const out = new Uint8Array(src.length);
    for (let i = 0; i < src.length; i++) out[i] = src[i] < t ? 1 : 0;
    return out;
  }
  const radius = Math.max(3, Math.round(Math.max(cols, rows) / 16));
  const c = 0.16 - 0.13 * clamp(img.sensitivity, 0, 1);
  return adaptiveThreshold(src, cols, rows, radius, c);
}

/**
 * Where the drawing is, for auto-cropping a napkin photo down to the drawing.
 * Runs on a small preview of the image; returns a box in that preview's cells,
 * padded, or null when no ink was found (use the whole image).
 */
export function findArt(g: Grey, cols: number, rows: number, img: ImageSettings): Box | null {
  if (img.mode === 'photo') return null;
  let ink = inkMask(g, cols, rows, img);
  ink = removeSmall(ink, cols, rows, 1, Math.max(4, Math.round(cols * rows * 0.0002)));
  const b = bounds(ink, cols, rows);
  if (!b) return null;
  const pad = Math.round(Math.max(cols, rows) * 0.02);
  const x = Math.max(0, b.x - pad);
  const y = Math.max(0, b.y - pad);
  return { x, y, w: Math.min(cols, b.x + b.w + pad) - x, h: Math.min(rows, b.y + b.h + pad) - y };
}

interface Drawing {
  ink: Mask;
  inkFraction: number;
  /** Share of the ink too thin to print. */
  thin: number;
}

function drawing(art: Grey, cols: number, rows: number, cell: number, img: ImageSettings): Drawing {
  let ink = inkMask(art, cols, rows, img);
  const minArea = Math.max(1, Math.round(img.despeckle / (cell * cell)));
  ink = removeSmall(ink, cols, rows, 1, minArea);
  ink = removeSmall(ink, cols, rows, 0, minArea);
  if (img.bolden > 0) ink = dilate(ink, cols, rows, img.bolden / 2 / cell);
  const n = count(ink);

  // Thin = ink that an opening by half the minimum feature removes.
  const r = LIMITS.minFeature / 2 / cell;
  const opened = dilate(erode(ink, cols, rows, r), cols, rows, r);
  let lost = 0;
  for (let i = 0; i < ink.length; i++) if (ink[i] && !opened[i]) lost++;

  return { ink, inkFraction: n / ink.length, thin: n ? lost / n : 0 };
}

/** Darkness in [0, 1] for photo mode: 1 = black. Auto-levelled. */
function tone(art: Grey, cols: number, rows: number, cell: number, img: ImageSettings): Grey {
  let g: Grey = img.invert ? art.map((v) => 1 - v) : art;
  const r = Math.round(img.smoothing / cell);
  if (r >= 1) g = boxMean(g, cols, rows, r);
  g = stretch(g);
  const out = new Float32Array(g.length);
  for (let i = 0; i < g.length; i++) out[i] = 1 - g[i];
  return out;
}

export interface Build {
  field: HeightField;
  warnings: string[];
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

/**
 * Add a keyring tab above the topmost point of `shape`, with a hole through
 * it. Needs `pad` free rows at the top of the grid (see tabRows).
 */
function addTab(shape: Mask, C: number, R: number, cell: number) {
  let top = -1;
  for (let j = 0; j < R && top < 0; j++) {
    for (let i = 0; i < C; i++) {
      if (shape[j * C + i]) {
        top = j;
        break;
      }
    }
  }
  if (top < 0) return;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < C; i++) {
    if (shape[top * C + i]) {
      sum += i + 0.5;
      n++;
    }
  }
  const cx = sum / n;
  const cy = top - (HOLE_R + HOLE_GAP) / cell;
  const outer = (HOLE_R + RING) / cell;
  const inner = HOLE_R / cell;
  const j0 = Math.max(0, Math.floor(cy - outer));
  const j1 = Math.min(R - 1, Math.ceil(cy + outer));
  const i0 = Math.max(0, Math.floor(cx - outer));
  const i1 = Math.min(C - 1, Math.ceil(cx + outer));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(i + 0.5 - cx, j + 0.5 - cy);
      if (d <= outer) shape[j * C + i] = 1;
    }
  }
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      if (Math.hypot(i + 0.5 - cx, j + 0.5 - cy) <= inner) shape[j * C + i] = 0;
    }
  }
}

const tabRows = (cell: number) => Math.ceil((2 * HOLE_R + HOLE_GAP + RING) / cell) + 2;

function inkWarnings(d: Drawing, warnings: string[]) {
  if (d.inkFraction === 0) {
    warnings.push('No lines found. Raise Sensitivity — or pick Photo if this is a photograph.');
  } else if (d.inkFraction > 0.55) {
    warnings.push('Most of the image reads as ink. Try Invert, or pick Photo for a photograph.');
  }
}

export function build(
  spec: ProductSpec,
  img: ImageSettings,
  art: Grey,
  cols: number,
  rows: number,
  cell: number,
): Build {
  const mode = effectiveMode(spec.kind, img.mode);
  const settings = { ...img, mode };
  if (spec.kind === 'relief') return relief(spec, settings, art, cols, rows, cell);
  if (spec.kind === 'lithophane') return lithophane(spec, settings, art, cols, rows, cell);
  return cutter(spec, settings, art, cols, rows, cell);
}

function relief(s: ReliefSpec, img: ImageSettings, art: Grey, cols: number, rows: number, cell: number): Build {
  const warnings: string[] = [];
  let value: Grey;
  let ink: Mask | null = null;
  if (img.mode === 'photo') {
    value = tone(art, cols, rows, cell, img);
  } else {
    const d = drawing(art, cols, rows, cell, img);
    inkWarnings(d, warnings);
    if (s.style === 'raised' && d.thin > 0.1) {
      warnings.push(
        `About ${Math.round(d.thin * 100)}% of the lines are thinner than ${LIMITS.minFeature} mm and may not print. Raise Line boost.`,
      );
    }
    ink = d.ink;
    value = new Float32Array(ink.length);
    for (let i = 0; i < ink.length; i++) value[i] = ink[i];
  }

  const tab = s.hole ? tabRows(cell) : 0;
  const mc = Math.round(s.margin / cell);
  let shapeKind = s.shape;
  if (shapeKind === 'outline' && (!ink || count(ink) === 0)) {
    if (img.mode === 'photo') warnings.push('Cut to outline needs a drawing, not a photo — using a rounded plate.');
    shapeKind = 'rounded';
  }

  let C: number, R: number, ox: number, oy: number;
  if (shapeKind === 'circle') {
    const D = Math.max(cols, rows, Math.round(s.width / cell));
    C = D;
    R = D + tab;
    ox = Math.floor((D - cols) / 2);
    oy = tab + Math.floor((D - rows) / 2);
  } else if (shapeKind === 'outline') {
    const p = mc + 2;
    C = cols + 2 * p;
    R = rows + 2 * p + tab;
    ox = p;
    oy = p + tab;
  } else {
    C = cols + 2 * mc;
    R = rows + 2 * mc + tab;
    ox = mc;
    oy = mc + tab;
  }

  const val = new Float32Array(C * R);
  const inkC = new Uint8Array(C * R);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = (j + oy) * C + i + ox;
      val[k] = value[j * cols + i];
      if (ink) inkC[k] = ink[j * cols + i];
    }
  }

  let shape: Mask = new Uint8Array(C * R);
  if (shapeKind === 'outline') {
    shape = fillHoles(dilate(inkC, C, R, s.margin / cell), C, R);
  } else if (shapeKind === 'circle') {
    const rad = C / 2;
    const cx = C / 2;
    const cy = tab + C / 2;
    for (let j = tab; j < R; j++) {
      for (let i = 0; i < C; i++) if (Math.hypot(i + 0.5 - cx, j + 0.5 - cy) <= rad) shape[j * C + i] = 1;
    }
  } else {
    const w = C;
    const h = R - tab;
    const rr = shapeKind === 'rounded' ? Math.min(8 / cell, 0.15 * Math.min(w, h)) : 0;
    for (let j = tab; j < R; j++) {
      for (let i = 0; i < C; i++) {
        const x = i + 0.5;
        const y = j - tab + 0.5;
        const dx = Math.max(rr - x, 0, x - (w - rr));
        const dy = Math.max(rr - y, 0, y - (h - rr));
        if (dx * dx + dy * dy <= rr * rr) shape[j * C + i] = 1;
      }
    }
  }
  if (s.hole) addTab(shape, C, R, cell);

  const top = s.base + s.relief;
  const height = new Float32Array(C * R);
  const rim = s.border > 0 ? distanceTo(shape, C, R, 0, true) : null;
  const rimCells = s.border / cell;
  for (let k = 0; k < height.length; k++) {
    if (!shape[k]) continue;
    const v = s.style === 'raised' ? val[k] : 1 - val[k];
    height[k] = rim && rim[k] <= rimCells ? top : s.base + s.relief * v;
  }

  if (s.base < 1.2) warnings.push(`A ${fmt(s.base)} mm plate flexes and can snap — 1.5 mm or more is safer.`);
  if (s.relief < 0.4) warnings.push('Relief under 0.4 mm is two layers or fewer and will barely read.');
  if (s.border > 0 && s.border < LIMITS.minFeature) {
    warnings.push(`A ${fmt(s.border)} mm rim is below the ${LIMITS.minFeature} mm minimum and may drop out.`);
  }

  return { field: { cols: C, rows: R, cell, height, mask: shape }, warnings };
}

function lithophane(
  s: LithophaneSpec,
  img: ImageSettings,
  art: Grey,
  cols: number,
  rows: number,
  cell: number,
): Build {
  const warnings: string[] = [];
  const dark = tone(art, cols, rows, cell, img);
  const fc = Math.round(s.frame / cell);
  const tab = s.hole ? tabRows(cell) : 0;
  const C = cols + 2 * fc;
  const R = rows + 2 * fc + tab;
  const shape = new Uint8Array(C * R);
  for (let j = tab; j < R; j++) for (let i = 0; i < C; i++) shape[j * C + i] = 1;
  if (s.hole) addTab(shape, C, R, cell);

  const lo = Math.min(s.minThickness, s.maxThickness);
  const hi = Math.max(s.minThickness, s.maxThickness);
  const height = new Float32Array(C * R);
  for (let j = 0; j < R; j++) {
    for (let i = 0; i < C; i++) {
      const k = j * C + i;
      if (!shape[k]) continue;
      const ai = i - fc;
      const aj = j - fc - tab;
      const inside = ai >= 0 && aj >= 0 && ai < cols && aj < rows;
      height[k] = inside ? lo + (hi - lo) * dark[aj * cols + ai] : hi;
    }
  }

  if (lo < 0.6) warnings.push(`Under 0.6 mm the brightest areas can break through or print with gaps.`);
  if (hi - lo < 1) warnings.push('Under 1 mm between thinnest and thickest gives a flat, low-contrast picture.');
  if (hi > 5) warnings.push('Past 5 mm the dark areas block nearly all light — 3 to 4 mm is typical.');
  if (s.frame === 0 && s.width > 100) warnings.push('Panels over 100 mm without a frame tend to warp and crack.');

  return { field: { cols: C, rows: R, cell, height, mask: shape }, warnings };
}

function cutter(s: CutterSpec, img: ImageSettings, art: Grey, cols: number, rows: number, cell: number): Build {
  const warnings: string[] = [];
  const d = drawing(art, cols, rows, cell, img);
  inkWarnings(d, warnings);

  const g = s.gapClose / 2 / cell;
  const pad = Math.ceil(g + (s.wall + s.flangeWidth) / cell) + 2;
  const C = cols + 2 * pad;
  const R = rows + 2 * pad;
  const ink = new Uint8Array(C * R);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) ink[(j + pad) * C + i + pad] = d.ink[j * cols + i];

  // Morphological closing with the holes filled: bridges small pen gaps,
  // then shrinks back, leaving the silhouette of the outline.
  const closed = dilate(ink, C, R, g);
  const filled = fillHoles(closed, C, R);
  const shape = erode(filled, C, R, g);

  const areaFilled = count(filled);
  const interior = areaFilled - count(closed);
  if (areaFilled > 0 && interior / areaFilled < 0.15) {
    warnings.push(
      "The outline doesn't close, so the cutter follows the outside of the lines. Close the gap in the drawing, or raise Gap closing.",
    );
  }

  const dist = distanceTo(shape, C, R, 1);
  const wallC = s.wall / cell + 0.5;
  const flangeC = (s.wall + s.flangeWidth) / cell + 0.5;
  const height = new Float32Array(C * R);
  const mask = new Uint8Array(C * R);
  for (let k = 0; k < mask.length; k++) {
    if (shape[k]) continue;
    if (dist[k] <= wallC) {
      mask[k] = 1;
      height[k] = s.height;
    } else if (dist[k] <= flangeC) {
      mask[k] = 1;
      height[k] = s.flangeHeight;
    }
  }

  if (s.wall < LIMITS.minFeature) warnings.push(`A ${fmt(s.wall)} mm wall is below the ${LIMITS.minFeature} mm minimum and will be fragile.`);
  if (s.height > 25) warnings.push('Walls over 25 mm get wobbly — 12 to 16 mm cuts most doughs.');
  if (s.flangeWidth > 0 && s.flangeWidth < 2) warnings.push('A lip under 2 mm is hard to press on.');

  return { field: { cols: C, rows: R, cell, height, mask }, warnings };
}

/** Size problems are judged on the finished mesh, not the plan. */
export function sizeWarnings(size: [number, number, number]): string[] {
  const longest = Math.max(size[0], size[1]);
  if (longest > LIMITS.bed) {
    return [`At ${Math.round(longest)} mm this is larger than most print beds — we'll confirm the machine when we quote.`];
  }
  return [];
}

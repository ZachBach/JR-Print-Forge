/**
 * Mask → outlines. This is the step that turns a picture into geometry.
 *
 * The height-field mesher walks cell boundaries, so its walls are stairs at the
 * grid pitch: a diagonal pen stroke prints as a flight of 0.15 mm steps, and a
 * CAD tool importing it sees thousands of facets instead of an edge. Here the
 * mask is first turned into a signed distance field — positive inside, negative
 * outside, zero exactly halfway across the cell boundary — and the outline is
 * the zero contour of that field, placed by linear interpolation. The result is
 * a closed polygon whose vertices sit *between* cells, so a 45° stroke edge
 * comes out as one straight line rather than a staircase.
 *
 * Blurring the field first (`smooth`) rounds the remaining pixel corners; on a
 * signed distance field a small box blur moves the contour by well under a cell
 * away from corners, because the field is locally linear, so the outline stays
 * on the drawing while losing its jaggedness.
 */
import { boxMean, distanceTo, type Grey } from '../relief/raster.ts';
import { nest, type Profile, type Ring } from './polygon.ts';

export interface ContourOptions {
  /** Box-blur radius applied to the signed field before tracing, mm. */
  smooth?: number;
}

/**
 * The marching-squares case table, indexed by which of the four samples are
 * positive: bit 1 = top-left, 2 = top-right, 4 = bottom-right, 8 = bottom-left.
 * Values name the cell edges a contour segment joins: 0 top, 1 right, 2 bottom,
 * 3 left. Pairs are unordered — the tracer links them by shared endpoint.
 *
 * The two ambiguous cases (5 and 10, positives on a diagonal) are resolved so
 * the *positive* region stays connected. That matches `healDiagonals` in the
 * mesher, which fills one cell of such a checkerboard rather than pinching the
 * solid at a point, so the outline and the mesh agree on the topology.
 */
const CASES: number[][] = [
  [], // 0 ····
  [0, 3], // 1 TL
  [0, 1], // 2 TR
  [3, 1], // 3 TL TR
  [1, 2], // 4 BR
  [0, 1, 3, 2], // 5 TL BR — join the positives
  [0, 2], // 6 TR BR
  [3, 2], // 7 TL TR BR
  [3, 2], // 8 BL
  [0, 2], // 9 TL BL
  [0, 3, 1, 2], // 10 TR BL — join the positives
  [1, 2], // 11 TL TR BL
  [3, 1], // 12 BR BL
  [0, 1], // 13 TL BR BL
  [0, 3], // 14 TR BR BL
  [], // 15 ▓▓▓▓
];

/**
 * Trace the outline of `mask` as closed rings in millimetres, in the same frame
 * the mesher uses: XY centred on the grid, +Y up the image (row 0 at the top).
 */
export function contourRings(
  mask: Uint8Array,
  cols: number,
  rows: number,
  cell: number,
  opts: ContourOptions = {},
): Ring[] {
  const blur = Math.max(0, Math.round((opts.smooth ?? 0) / cell));
  // A collar of background around the grid guarantees every contour closes
  // inside the domain, so no ring is ever cut off by the edge. It has to be
  // wide enough that the blur cannot lift the outermost samples positive.
  const pad = blur + 2;
  const W = cols + 2 * pad;
  const H = rows + 2 * pad;
  const pm = new Uint8Array(W * H);
  let any = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const v = mask[j * cols + i];
      pm[(j + pad) * W + i + pad] = v;
      any |= v;
    }
  }
  if (!any) return [];

  // Signed distance in cells, sampled at cell centres. A solid cell touching
  // background reads +0.5 and that background cell reads −0.5, so the zero
  // crossing lands exactly on the boundary the mask describes.
  const dOut = distanceTo(pm, W, H, 0);
  const dIn = distanceTo(pm, W, H, 1);
  let sdf: Grey = new Float32Array(W * H);
  for (let k = 0; k < sdf.length; k++) sdf[k] = pm[k] ? dOut[k] - 0.5 : 0.5 - dIn[k];
  if (blur >= 1) sdf = boxMean(sdf, W, H, blur);

  // Sample (x, y) is the centre of padded cell (x, y); undo the pad and put the
  // grid's centre at the origin, matching meshHeightField.
  const ox = (-cols * cell) / 2 - pad * cell + cell / 2;
  const oy = (rows * cell) / 2 + pad * cell - cell / 2;

  const px: number[] = [];
  const py: number[] = [];
  const seen = new Map<number, number>();
  // Each grid edge carries at most one crossing, so keying by edge makes the
  // point shared between the two cells that meet there the *same* vertex —
  // linking rings becomes exact integer work with no tolerance to tune.
  const hId = (x: number, y: number) => (y * W + x) * 2;
  const vId = (x: number, y: number) => (y * W + x) * 2 + 1;

  const crossing = (id: number, x0: number, y0: number, x1: number, y1: number) => {
    const hit = seen.get(id);
    if (hit !== undefined) return hit;
    const a = sdf[y0 * W + x0];
    const b = sdf[y1 * W + x1];
    const t = a / (a - b);
    const idx = px.length;
    px.push(ox + (x0 + (x1 - x0) * t) * cell);
    py.push(oy - (y0 + (y1 - y0) * t) * cell);
    seen.set(id, idx);
    return idx;
  };

  const segA: number[] = [];
  const segB: number[] = [];
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const s00 = sdf[y * W + x];
      const s10 = sdf[y * W + x + 1];
      const s11 = sdf[(y + 1) * W + x + 1];
      const s01 = sdf[(y + 1) * W + x];
      const code = (s00 > 0 ? 1 : 0) | (s10 > 0 ? 2 : 0) | (s11 > 0 ? 4 : 0) | (s01 > 0 ? 8 : 0);
      const pairs = CASES[code];
      for (let e = 0; e < pairs.length; e += 2) {
        const ends = [pairs[e], pairs[e + 1]].map((side) => {
          if (side === 0) return crossing(hId(x, y), x, y, x + 1, y);
          if (side === 1) return crossing(vId(x + 1, y), x + 1, y, x + 1, y + 1);
          if (side === 2) return crossing(hId(x, y + 1), x, y + 1, x + 1, y + 1);
          return crossing(vId(x, y), x, y, x, y + 1);
        });
        segA.push(ends[0]);
        segB.push(ends[1]);
      }
    }
  }

  // Every crossing is interior to exactly two cells and each contributes one
  // segment end there, so the segment graph is a union of simple cycles and
  // tracing needs no special cases.
  const n = px.length;
  const link0 = new Int32Array(n).fill(-1);
  const link1 = new Int32Array(n).fill(-1);
  const join = (a: number, b: number) => {
    if (link0[a] < 0) link0[a] = b;
    else if (link1[a] < 0) link1[a] = b;
  };
  for (let s = 0; s < segA.length; s++) {
    join(segA[s], segB[s]);
    join(segB[s], segA[s]);
  }

  const used = new Uint8Array(n);
  const rings: Ring[] = [];
  for (let start = 0; start < n; start++) {
    if (used[start] || link0[start] < 0) continue;
    const ring: Ring = [];
    let cur = start;
    let prev = -1;
    while (cur >= 0 && !used[cur]) {
      used[cur] = 1;
      ring.push(px[cur], py[cur]);
      const a = link0[cur];
      const b = link1[cur];
      const next = a !== prev && a >= 0 && !used[a] ? a : b >= 0 && !used[b] ? b : -1;
      prev = cur;
      cur = next;
    }
    if (ring.length >= 6) rings.push(ring);
  }
  return rings;
}

/** The outline of a mask as extrudable profiles: outer rings with their holes. */
export function contourProfiles(
  mask: Uint8Array,
  cols: number,
  rows: number,
  cell: number,
  opts: ContourOptions = {},
): Profile[] {
  return nest(contourRings(mask, cols, rows, cell, opts));
}

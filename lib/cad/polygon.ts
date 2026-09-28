/**
 * 2D polygon primitives — the sketch half of the CAD pipeline.
 *
 * A ring is a closed loop stored as interleaved xy in millimetres, with the
 * closing edge implied (the last point joins the first; never repeat it). A
 * profile is one outer ring plus its holes, which is what a CAD sketch profile
 * is: the region you extrude.
 *
 * Orientation is a contract the rest of the pipeline relies on, not a detail:
 * outer rings run counter-clockwise, holes run clockwise. Every consumer —
 * extrusion walls, STEP face loops, DXF — derives its outward direction from
 * the edge direction alone, so with that one convention held, both cases fall
 * out of the same formula.
 */

/** Interleaved xy, mm. Implicitly closed. */
export type Ring = number[];

export interface Profile {
  outer: Ring;
  holes: Ring[];
}

export const pointCount = (r: Ring) => r.length / 2;

/** Shoelace, mm². Positive is counter-clockwise. */
export function signedArea(r: Ring): number {
  const n = r.length;
  if (n < 6) return 0;
  let s = 0;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    s += (r[j] - r[i]) * (r[j + 1] + r[i + 1]);
  }
  return s / 2;
}

export function perimeter(r: Ring): number {
  const n = r.length;
  let p = 0;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) p += Math.hypot(r[i] - r[j], r[i + 1] - r[j + 1]);
  return p;
}

/** Enclosed area of a profile, mm² — outer less its holes. */
export function profileArea(p: Profile): number {
  let a = Math.abs(signedArea(p.outer));
  for (const h of p.holes) a -= Math.abs(signedArea(h));
  return a;
}

export type Bbox = [minX: number, minY: number, maxX: number, maxY: number];

export function bbox(r: Ring): Bbox {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    if (r[i] < x0) x0 = r[i];
    if (r[i] > x1) x1 = r[i];
    if (r[i + 1] < y0) y0 = r[i + 1];
    if (r[i + 1] > y1) y1 = r[i + 1];
  }
  return [x0, y0, x1, y1];
}

export function reverse(r: Ring): Ring {
  const out: Ring = new Array(r.length);
  const n = r.length / 2;
  for (let i = 0; i < n; i++) {
    const j = n - 1 - i;
    out[i * 2] = r[j * 2];
    out[i * 2 + 1] = r[j * 2 + 1];
  }
  return out;
}

/** The same ring wound the way asked for; may return the input unchanged. */
export function orient(r: Ring, ccw: boolean): Ring {
  return signedArea(r) >= 0 === ccw ? r : reverse(r);
}

/** Crossing number. Points exactly on the boundary are undefined either way. */
export function pointInRing(r: Ring, x: number, y: number): boolean {
  let inside = false;
  const n = r.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = r[i];
    const yi = r[i + 1];
    const xj = r[j];
    const yj = r[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const inBox = (b: Bbox, x: number, y: number) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];

/**
 * Sort a flat set of contour rings into profiles by containment: a ring nested
 * an even number of deep is solid, an odd number deep is a hole in the
 * smallest ring that contains it. Marching squares hands back exactly such a
 * set — the plate's outline, the keyring hole inside it, and the island inside
 * the hole if the drawing has one.
 *
 * Both windings are fixed here, so callers never have to think about it.
 */
export function nest(rings: Ring[]): Profile[] {
  const usable = rings.filter((r) => pointCount(r) >= 3 && Math.abs(signedArea(r)) > 0);
  // Largest first: the container of a ring is always the smallest ring after
  // it in this order that still contains it.
  const order = usable
    .map((r, i) => ({ r, i, a: Math.abs(signedArea(r)), b: bbox(r) }))
    .sort((p, q) => q.a - p.a);

  const parent = new Int32Array(order.length).fill(-1);
  const depth = new Int32Array(order.length);
  for (let k = 0; k < order.length; k++) {
    const x = order[k].r[0];
    const y = order[k].r[1];
    // Walking back from k-1 visits candidates smallest-first, so the first
    // ring that contains this one is its immediate container.
    for (let j = k - 1; j >= 0; j--) {
      const c = order[j];
      if (!inBox(c.b, x, y) || !pointInRing(c.r, x, y)) continue;
      parent[k] = j;
      depth[k] = depth[j] + 1;
      break;
    }
  }

  const profiles: Profile[] = [];
  const slot = new Int32Array(order.length).fill(-1);
  for (let k = 0; k < order.length; k++) {
    if (depth[k] % 2 === 0) {
      slot[k] = profiles.length;
      profiles.push({ outer: orient(order[k].r, true), holes: [] });
    }
  }
  for (let k = 0; k < order.length; k++) {
    if (depth[k] % 2 === 1 && parent[k] >= 0) {
      const owner = slot[parent[k]];
      if (owner >= 0) profiles[owner].holes.push(orient(order[k].r, false));
    }
  }
  return profiles;
}

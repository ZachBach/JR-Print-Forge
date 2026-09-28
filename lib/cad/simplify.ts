/**
 * Ramer–Douglas–Peucker on closed rings.
 *
 * A traced contour has a vertex on every cell boundary it crosses — tens of
 * thousands of points for a keychain, almost all of them on straight runs.
 * Simplifying to a stated tolerance is what makes the output CAD-shaped: a
 * straight edge becomes one line, and the file a CAD tool opens has hundreds of
 * segments instead of tens of thousands.
 *
 * The tolerance is a real guarantee — no point of the original outline ends up
 * further than `tol` from the simplified one — so it can be quoted to the
 * customer and traded against the printer's own resolution rather than guessed.
 */
import { orient, pointCount, signedArea, type Profile, type Ring } from './polygon.ts';

/** Keep points whose distance from the chord exceeds tol, between i and j. */
function rdp(r: Ring, i: number, j: number, tol: number, keep: Uint8Array) {
  const stack: number[] = [i, j];
  const t2 = tol * tol;
  while (stack.length) {
    const b = stack.pop()!;
    const a = stack.pop()!;
    if (b - a < 2) continue;
    const ax = r[a * 2];
    const ay = r[a * 2 + 1];
    const bx = r[b * 2];
    const by = r[b * 2 + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let worstD = 0;
    for (let k = a + 1; k < b; k++) {
      const px = r[k * 2] - ax;
      const py = r[k * 2 + 1] - ay;
      // Perpendicular distance to the segment, or to the endpoint when the
      // chord has collapsed to a point.
      let d: number;
      if (len2 === 0) {
        d = px * px + py * py;
      } else {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        const ex = px - t * dx;
        const ey = py - t * dy;
        d = ex * ex + ey * ey;
      }
      if (d > worstD) {
        worstD = d;
        worst = k;
      }
    }
    if (worstD > t2 && worst > 0) {
      keep[worst] = 1;
      stack.push(a, worst, worst, b);
    }
  }
}

/**
 * Simplify a closed ring. Returns null when nothing meaningful survives — a
 * speck smaller than the tolerance is noise, not a feature, and dropping it
 * here is what keeps a dusty napkin photo from exporting 400 stray islands.
 */
export function simplifyRing(r: Ring, tol: number): Ring | null {
  const n = pointCount(r);
  if (n < 3) return null;
  if (tol <= 0) return r;

  // A closed ring has no natural endpoints, so split it at two far-apart
  // points first: the seed, and whichever point lies furthest from it.
  let far = 0;
  let farD = -1;
  for (let k = 1; k < n; k++) {
    const d = (r[k * 2] - r[0]) ** 2 + (r[k * 2 + 1] - r[1]) ** 2;
    if (d > farD) {
      farD = d;
      far = k;
    }
  }
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[far] = 1;
  rdp(r, 0, far, tol, keep);
  // The second arc runs far → n → 0; walk it on a rotated copy so the same
  // index arithmetic applies.
  const tail: Ring = [];
  for (let k = far; k <= n; k++) {
    const m = k % n;
    tail.push(r[m * 2], r[m * 2 + 1]);
  }
  const tailKeep = new Uint8Array(tail.length / 2);
  tailKeep[0] = 1;
  tailKeep[tail.length / 2 - 1] = 1;
  rdp(tail, 0, tail.length / 2 - 1, tol, tailKeep);
  for (let k = 1; k < tailKeep.length - 1; k++) if (tailKeep[k]) keep[(far + k) % n] = 1;

  const out: Ring = [];
  for (let k = 0; k < n; k++) {
    if (!keep[k]) continue;
    const x = r[k * 2];
    const y = r[k * 2 + 1];
    // Drop a point that lands on the previous one; a zero-length edge has no
    // direction, and everything downstream takes its normal from the edge.
    const m = out.length;
    if (m >= 2 && Math.abs(out[m - 2] - x) < 1e-9 && Math.abs(out[m - 1] - y) < 1e-9) continue;
    out.push(x, y);
  }
  if (out.length >= 4) {
    const m = out.length;
    if (Math.abs(out[0] - out[m - 2]) < 1e-9 && Math.abs(out[1] - out[m - 1]) < 1e-9) out.length = m - 2;
  }
  if (out.length < 6) return null;
  // A ring thinner than the tolerance carries no area worth extruding.
  if (Math.abs(signedArea(out)) < tol * tol) return null;
  return out;
}

/**
 * Drop points that sit exactly on the line between their neighbours.
 *
 * A traced straight edge has a vertex at every cell boundary it crosses, all of
 * them precisely collinear, and a run of them carries no information. Removing
 * them first is what makes corner recovery reliable: afterwards a grid chamfer is
 * a single short segment between two long ones whatever the tolerance, where if
 * RDP runs first it can keep one end of a chamfer and drop the other — leaving a
 * plate with three square corners and one clipped one, depending on where the
 * simplification happened to start.
 *
 * `eps` is float slack, not a tolerance: these points are collinear by
 * construction, not approximately.
 */
export function dropCollinear(r: Ring, eps = 1e-6): Ring {
  const n = pointCount(r);
  if (n < 4) return r;
  const out: Ring = [];
  for (let i = 0; i < n; i++) {
    const p = ((i - 1 + n) % n) * 2;
    const c = i * 2;
    const q = ((i + 1) % n) * 2;
    const ax = r[c] - r[p];
    const ay = r[c + 1] - r[p + 1];
    const bx = r[q] - r[c];
    const by = r[q + 1] - r[c + 1];
    const cross = ax * by - ay * bx;
    const scale = Math.hypot(ax, ay) * Math.hypot(bx, by);
    // Keep a corner, and keep a spike where the edge doubles back on itself.
    if (Math.abs(cross) > eps * Math.max(scale, 1) || ax * bx + ay * by < 0) out.push(r[c], r[c + 1]);
  }
  return out.length >= 6 ? out : r;
}

/**
 * Put back the corners the cell grid cut off.
 *
 * Tracing the zero level of a distance field places the outline halfway between
 * cells, which is exact along an edge but chamfers every convex corner by half a
 * cell: a rectangular plate comes back as an octagon. After simplification that
 * chamfer is one short segment between two long ones, so it can be identified
 * and replaced with the point where the two long edges would have met. A 90°
 * corner comes out at 90°, which is what the drawing said and what a CAD tool
 * expects to see.
 *
 * This is the one step that moves the outline *outward* — by up to half a cell at
 * a corner, recovering material the rasteriser lost, rather than inventing any.
 * `maxCut` bounds it: a chamfer longer than that is taken to be deliberate.
 */
export function sharpenRing(r: Ring, maxCut: number): Ring {
  const n = pointCount(r);
  if (maxCut <= 0 || n < 5) return r;
  const at = (k: number) => {
    const m = ((k % n) + n) % n;
    return [r[m * 2], r[m * 2 + 1]] as const;
  };
  const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(b[0] - a[0], b[1] - a[1]);

  const replaced = new Map<number, [number, number]>();
  const dropped = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (dropped[i] || dropped[j] || replaced.has(i) || replaced.has(j)) continue;
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(j);
    const p3 = at(j + 1);
    const mid = dist(p1, p2);
    if (mid > maxCut || mid === 0) continue;
    const la = dist(p0, p1);
    const lb = dist(p2, p3);
    if (la < mid * 1.5 || lb < mid * 1.5) continue;

    const ax = p1[0] - p0[0];
    const ay = p1[1] - p0[1];
    const bx = p3[0] - p2[0];
    const by = p3[1] - p2[1];
    const den = ax * by - ay * bx;
    // Near-parallel edges have no corner to recover, and dividing by the
    // cross product would throw the point to infinity.
    if (Math.abs(den) < 1e-9 * la * lb) continue;
    const t = ((p2[0] - p0[0]) * by - (p2[1] - p0[1]) * bx) / den;
    const u = ((p2[0] - p0[0]) * ay - (p2[1] - p0[1]) * ax) / den;
    // The crossing has to lie beyond p1 along the first edge and before p2
    // along the second — that is what makes it a corner being restored rather
    // than the two edges being pulled back into each other.
    if (t <= 1 || u >= 0) continue;
    const x = p0[0] + ax * t;
    const y = p0[1] + ay * t;
    const moved = Math.max(Math.hypot(x - p1[0], y - p1[1]), Math.hypot(x - p2[0], y - p2[1]));
    if (moved > maxCut) continue;
    replaced.set(i, [x, y]);
    dropped[j] = 1;
  }
  if (!replaced.size) return r;

  const out: Ring = [];
  for (let k = 0; k < n; k++) {
    if (dropped[k]) continue;
    const hit = replaced.get(k);
    if (hit) out.push(hit[0], hit[1]);
    else out.push(r[k * 2], r[k * 2 + 1]);
  }
  return out.length >= 6 ? out : r;
}

/**
 * Simplify a profile, dropping holes that fall below the tolerance. Windings
 * are re-asserted rather than assumed: simplification can in principle flip a
 * near-degenerate ring, and every consumer downstream reads the outward
 * direction off the edge order.
 */
export function simplifyProfile(p: Profile, tol: number, sharpen = 0): Profile | null {
  // Order matters: collapse the straight runs, square up the grid's chamfers on
  // the result, and only then simplify. Sharpening after RDP would depend on
  // which chamfer points RDP happened to keep.
  const fix = (r: Ring, ccw: boolean): Ring | null => {
    const bare = dropCollinear(r);
    const sharp = sharpen > 0 ? sharpenRing(bare, sharpen) : bare;
    const done = simplifyRing(sharp, tol);
    return done && orient(done, ccw);
  };
  const outer = fix(p.outer, true);
  if (!outer) return null;
  const holes: Ring[] = [];
  for (const h of p.holes) {
    const s = fix(h, false);
    if (s) holes.push(s);
  }
  return { outer, holes };
}

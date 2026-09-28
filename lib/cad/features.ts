/**
 * Feature recognition: reading nominal dimensions back off the traced outline.
 *
 * A rasterised keyring hole comes out of the tracer as a thirty-sided polygon
 * 2.49 mm from its centre. That is geometrically fine and dimensionally useless —
 * a shop asked to match it has nothing to measure, and a CAD tool cannot pattern
 * it or resize it. Fitting a circle to the ring recovers what the hole *was*: Ø5 mm,
 * a number that can go on a drawing.
 *
 * The fit is only accepted when the ring really is round — the worst deviation has
 * to be inside the tolerance the outline was simplified to, plus the half-cell the
 * rasteriser itself is worth. A square is off by 29% of its side and is rejected,
 * so nothing is ever rounded off into a circle that was not one.
 */
import { bbox, perimeter, pointCount, signedArea, type Profile, type Ring } from './polygon.ts';

export interface CircleFit {
  cx: number;
  cy: number;
  r: number;
  /**
   * Worst distance from the ring to the fitted circle, mm — measured at the
   * vertices *and* at the middle of every edge.
   *
   * The midpoints are the point of it. Simplification keeps vertices on the curve
   * it simplified, so a circle cut down to eight points has all eight sitting
   * exactly on the circle while its edges bow up to r(1−cos(π/n)) inside it — 0.76 mm
   * on a Ø20 hole. Judging the fit on vertices alone would call that a circle and
   * writing one back would hand the shop a hole most of a millimetre bigger than
   * the part actually has.
   */
  residual: number;
}

/**
 * Algebraic least-squares circle through the ring's vertices (Kåsa): fitting
 * x² + y² + Dx + Ey + F = 0 is linear in D, E and F, so it is one 3×3 solve with
 * no starting guess to get wrong.
 */
export function fitCircle(r: Ring): CircleFit | null {
  const n = pointCount(r);
  if (n < 5) return null;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += r[i * 2];
    sy += r[i * 2 + 1];
  }
  // Work relative to the centroid: the normal equations are badly conditioned for
  // a small circle a long way from the origin.
  const mx = sx / n;
  const my = sy / n;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let sxz = 0;
  let syz = 0;
  let sz = 0;
  for (let i = 0; i < n; i++) {
    const x = r[i * 2] - mx;
    const y = r[i * 2 + 1] - my;
    const z = x * x + y * y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
    sxz += x * z;
    syz += y * z;
    sz += z;
  }
  const den = 2 * (sxx * syy - sxy * sxy);
  if (Math.abs(den) < 1e-12) return null;
  const cx = (sxz * syy - syz * sxy) / den;
  const cy = (syz * sxx - sxz * sxy) / den;
  const r2 = cx * cx + cy * cy + sz / n;
  if (!(r2 > 0)) return null;
  const rad = Math.sqrt(r2);

  let residual = 0;
  const off = (x: number, y: number) => Math.abs(Math.hypot(x - mx - cx, y - my - cy) - rad);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const d = off(r[i * 2], r[i * 2 + 1]);
    if (d > residual) residual = d;
    const mid = off((r[i * 2] + r[j * 2]) / 2, (r[i * 2 + 1] + r[j * 2 + 1]) / 2);
    if (mid > residual) residual = mid;
  }
  return { cx: cx + mx, cy: cy + my, r: rad, residual };
}

/** A ring is circular when a fitted circle holds to `tol` everywhere. */
export function asCircle(r: Ring, tol: number): CircleFit | null {
  const fit = fitCircle(r);
  if (!fit || fit.residual > tol) return null;
  // A ring can sit on a circle and still not enclose it — a ring that doubles
  // back, say. The perimeter settles it: a closed circle's is 2πr, and an
  // inscribed polygon's is shorter by an amount its own coarseness accounts for.
  const closed = perimeter(r);
  if (Math.abs(closed - 2 * Math.PI * fit.r) > Math.max(2 * Math.PI * fit.residual, 0.02 * closed)) return null;
  return fit;
}

export interface RingFeature {
  circle: CircleFit | null;
  /** Width and height of the ring's extent, mm. */
  extent: [number, number];
  /** Enclosed area, mm². Negative for a hole. */
  area: number;
  points: number;
}

export function ringFeature(r: Ring, tol: number): RingFeature {
  const [x0, y0, x1, y1] = bbox(r);
  return {
    circle: asCircle(r, tol),
    extent: [x1 - x0, y1 - y0],
    area: signedArea(r),
    points: pointCount(r),
  };
}

export interface BodyFeatures {
  outer: RingFeature[];
  holes: RingFeature[];
}

export function bodyFeatures(profiles: Profile[], tol: number): BodyFeatures {
  return {
    outer: profiles.map((p) => ringFeature(p.outer, tol)),
    holes: profiles.flatMap((p) => p.holes.map((h) => ringFeature(h, tol))),
  };
}

const fmt = (v: number) => (Math.round(v * 100) / 100).toFixed(2).replace(/\.?0+$/, '');

/**
 * Plain-language dimensions for the order: the size of the part and the diameter
 * of anything round, which between them is most of what a shop writes down.
 *
 * Diameters are reported as the geometry measures, not as the number the design
 * probably meant. A Ø5 mm hole punched into a 0.3 mm grid traces out at Ø5.22,
 * because the outline follows the edge of the filled cells; that is the hole that
 * will be printed, so that is the hole that gets written down.
 *
 * `limit` caps how many outlines are listed. A doodle can have thirty islands and
 * a list of thirty extents is not a description of anything.
 */
export function describeFeatures(f: BodyFeatures, limit = 3): string[] {
  const out: string[] = [];
  const ranked = [...f.outer].sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
  for (const o of ranked.slice(0, limit)) {
    if (o.circle) out.push(`round, Ø${fmt(o.circle.r * 2)} mm`);
    else out.push(`${fmt(o.extent[0])} × ${fmt(o.extent[1])} mm`);
  }
  const rest = ranked.length - Math.min(limit, ranked.length);
  if (rest > 0) out.push(`+${rest} smaller outline${rest > 1 ? 's' : ''}`);
  // Equal diameters are one line: "2 holes Ø5 mm", not the same line twice.
  const round = f.holes.filter((h) => h.circle);
  const groups = new Map<string, number>();
  for (const h of round) {
    const key = fmt(h.circle!.r * 2);
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  for (const [d, n] of groups) out.push(`${n} round hole${n > 1 ? 's' : ''} Ø${d} mm`);
  const other = f.holes.length - round.length;
  if (other > 0) out.push(`${other} shaped opening${other > 1 ? 's' : ''}`);
  return out;
}

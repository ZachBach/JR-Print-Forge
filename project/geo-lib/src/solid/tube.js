import { loft } from '../core/loft.js';

/**
 * tube — a swept round section along a path.
 *
 * The common case of `loft`, given its own name because it is asked for
 * constantly: a cable, a branch, a rib, a spar, a limb. three has TubeGeometry,
 * which takes a Curve and a constant radius; this takes plain points and lets
 * the radius vary, which is the part that matters — a limb of constant radius
 * reads as a pipe.
 *
 * points: [[x, y, z], ...] or Vector3[]
 * radius: a number, or (t) => number with t running 0..1 along the path
 */
export function tube(THREE, points, radius, opt = {}) {
  const n = points.length;
  const r = typeof radius === 'function' ? radius : () => radius;
  const spine = points.map((p, i) => ({ p, rx: r(n === 1 ? 0 : i / (n - 1)) }));
  return loft(THREE, spine, { radial: 10, ...opt });
}

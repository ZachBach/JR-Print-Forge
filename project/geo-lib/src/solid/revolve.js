import { loft } from '../core/loft.js';

/**
 * revolve — a profile turned about the Y axis, with the option not to be
 * circular about it.
 *
 * three's LatheGeometry already turns a profile. What it cannot do is vary the
 * radius WITH THE ANGLE, and that one ability is the difference between a
 * traffic cone and a robed figure: drapery folds, a fluted column, a keel, a
 * scalloped rim. This is a thin wrapper over `loft` that supplies the vertical
 * spine, so `shape` and `arc` come along with it.
 *
 * profile: [[r, y], ...] bottom to top, or [[r, y, ry], ...] to make the
 * section elliptical — wide across and shallow front to back, which is what a
 * torso is and what a lathe can never say.
 *
 * Options are loft's, plus nothing. `seed` defaults to [1, 0, 0], so angle
 * zero points along +X and the quarter turns land on +X, -Z, -X, +Z.
 */
export function revolve(THREE, profile, opt = {}) {
  if (!profile || profile.length < 2) {
    throw new Error('geo-lib revolve: need at least 2 profile points');
  }
  const spine = profile.map(([r, y, ry]) => ({
    p: [0, y, 0],
    rx: r,
    ry: ry === undefined ? r : ry,
    shape: opt.shape,
  }));
  return loft(THREE, spine, { radial: 24, seed: [1, 0, 0], ...opt });
}

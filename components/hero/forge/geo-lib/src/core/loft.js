/**
 * loft — a surface swept along a spine, its cross-section changing as it goes.
 *
 * This is the workhorse of the library and the reason it exists. A lathe can
 * only produce a body of revolution: a candle, a column, a bell, and a traffic
 * cone wherever you wanted a figure. Everything organic is a cross-section
 * carried along a curve — an arm, a neck, a wolf's back, a serpent, a single
 * feather — and one function covers all of them.
 *
 * FRAMES COME FROM PARALLEL TRANSPORT. Each section's frame is the previous
 * one rotated by whatever rotation carries the previous tangent onto this one.
 * The obvious alternative — deriving the frame from a fixed world up-vector —
 * flips wherever the spine passes through vertical, and the flip shows up as a
 * 180-degree twist in the middle of a neck.
 *
 * `seed` names the direction rx points at the FIRST section, so a caller can
 * say "rx is the width across the shoulders" and mean it. Get this wrong and
 * the section is correct but rotated ninety degrees, which is a bug that looks
 * exactly like bad modelling.
 *
 * Spine sections:
 *   p      [x, y, z] or Vector3     required
 *   rx     half-extent along the frame's first axis   required
 *   ry     half-extent along the second              defaults to rx
 *   roll   radians about the tangent                 optional
 *   shape  (angle, t) => multiplier                  optional
 *
 * `shape` is what makes a section something other than an ellipse: drapery
 * folds, a keel, a crease, a scalloped edge. `t` is the section's position
 * along the spine in 0..1, so the amplitude can vary down the form.
 *
 * Options:
 *   radial  points around a section (default 14)
 *   seed    [x, y, z] direction rx points at section 0 (default [1, 0, 0])
 *   arc     [a0, a1] radians — sweep part of a turn instead of all of it
 *   capA    cap the first end (default true, ignored when arc is set)
 *   capB    cap the last end  (default true, ignored when arc is set)
 *
 * Returns an indexed BufferGeometry with position, normal and uv.
 */
export function loft(THREE, spine, opt = {}) {
  const radial = Math.max(3, opt.radial || 14);

  if (!spine || spine.length < 2) {
    throw new Error('geo-lib loft: need at least 2 spine sections');
  }
  const n = spine.length;
  const P = spine.map((s) => (
    s.p.isVector3 ? s.p.clone() : new THREE.Vector3(s.p[0], s.p[1], s.p[2])
  ));

  /* Central difference, widening the window until it spans two DISTINCT
   * points.
   *
   * Two sections at the same place are legitimate and common — a flange, a
   * hard shoulder, a belt, anywhere the profile steps sideways without rising
   * — and an earlier version dropped them as duplicates, which quietly
   * deleted the feature the caller had just asked for. What must not happen
   * is a zero-length tangent: it poisons the transported frame with NaN and
   * the whole geometry then vanishes without an error anywhere. */
  const T = P.map((_, i) => {
    for (let w = 1; w < n; w++) {
      const d = new THREE.Vector3()
        .subVectors(P[Math.min(n - 1, i + w)], P[Math.max(0, i - w)]);
      if (d.lengthSq() > 1e-16) return d.normalize();
    }
    return null;
  });
  if (T.some((t) => t === null)) {
    throw new Error('geo-lib loft: every spine section is at the same point');
  }

  // A seed parallel to the first tangent defines no plane. Step to another
  // axis rather than producing NaN; no unit vector is within 0.98 of all three.
  const ref = new THREE.Vector3(...(opt.seed || [1, 0, 0])).normalize();
  if (Math.abs(ref.dot(T[0])) > 0.98) {
    ref.set(0, 1, 0);
    if (Math.abs(ref.dot(T[0])) > 0.98) ref.set(0, 0, 1);
  }

  const carried = ref.clone().addScaledVector(T[0], -ref.dot(T[0])).normalize();
  const q = new THREE.Quaternion();
  const roll = new THREE.Quaternion();
  const N = [], B = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) carried.applyQuaternion(q.setFromUnitVectors(T[i - 1], T[i]));
    // Re-orthogonalise every step. The transport rotation is exact but float
    // error accumulates, and a frame that has drifted off the normal plane
    // shears the section instead of rotating it.
    carried.addScaledVector(T[i], -carried.dot(T[i])).normalize();

    // Roll is applied to the OUTPUT frame only, never to the carried one:
    // rolling the transported vector would compound down the rest of the spine.
    const nrm = carried.clone();
    if (spine[i].roll) nrm.applyQuaternion(roll.setFromAxisAngle(T[i], spine[i].roll));
    N.push(nrm);
    B.push(new THREE.Vector3().crossVectors(T[i], nrm).normalize());
  }

  /* `arc` sweeps part of a turn, which turns the same function into a maker of
   * open shells — a mantle over a pair of shoulders, a cowl, a hood. An open
   * sweep needs BOTH edge columns, so it carries one more column than it has
   * faces, and it takes no end caps: a shell has no ends to cap. */
  const arc = opt.arc || null;
  const cols = arc ? radial + 1 : radial;
  const pos = [], uvs = [], idx = [];

  for (let i = 0; i < n; i++) {
    const s = spine[i];
    const rx = s.rx;
    const ry = s.ry === undefined ? s.rx : s.ry;
    const t = i / (n - 1);
    for (let j = 0; j < cols; j++) {
      const f = j / radial;
      const a = arc ? arc[0] + (arc[1] - arc[0]) * f : f * Math.PI * 2;
      const k = s.shape ? s.shape(a, t) : 1;
      const v = P[i].clone()
        .addScaledVector(N[i], Math.cos(a) * rx * k)
        .addScaledVector(B[i], Math.sin(a) * ry * k);
      pos.push(v.x, v.y, v.z);
      uvs.push(f, t);
    }
  }

  // Closed rings wrap onto a shared vertex rather than a duplicated seam. The
  // uv is then wrong for exactly one column and the SHADING is right the whole
  // way round, which is the better trade for organic forms.
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * cols + j;
      const b = i * cols + (arc ? j + 1 : (j + 1) % radial);
      idx.push(a, b, a + cols, b, b + cols, a + cols);
    }
  }

  const cap = (i, flip) => {
    const c = pos.length / 3;
    pos.push(P[i].x, P[i].y, P[i].z);
    uvs.push(0.5, flip ? 0 : 1);
    for (let j = 0; j < radial; j++) {
      const a = i * cols + j, b = i * cols + (j + 1) % radial;
      if (flip) idx.push(c, b, a); else idx.push(c, a, b);
    }
  };
  if (!arc && opt.capA !== false) cap(0, true);
  if (!arc && opt.capB !== false) cap(n - 1, false);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

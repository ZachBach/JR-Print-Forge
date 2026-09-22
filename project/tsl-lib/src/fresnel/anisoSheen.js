/**
 * anisoSheen — the Kajiya–Kay fibre highlight: a surface made of parallel
 * strands has no single mirror normal, it has a whole cone of them around the
 * strand direction. So the highlight is a BAND running perpendicular to the
 * fibres, not a dot, and it slides along the fibres as the view moves. That
 * band is chatoyancy in a gemstone and the sheen on brushed metal and carbon.
 *
 * The tangent is a domain input (positional): it must be a world-space unit
 * vector lying in the surface. `surfaceTangent` builds one from the world
 * normal when the geometry has no tangents to hand.
 *
 * @param   {object} TSL
 * @param   {Node}   tangent  vec3 world-space fibre direction, normalized
 * @param   {object} opts
 * @param   {number[]|Node} [opts.dir=[.5,.7,.5]]  light direction
 * @param   {number} [opts.power=24]     band tightness
 * @param   {Node|number} [opts.shift=0] slide the band along the normal —
 *                                       feed it noise for a broken sheen
 * @param   {Node}   [opts.normal]       shift axis (defaults to normalWorld)
 * @returns {Node} float 0..1 sheen intensity
 * @cost    class ② — two dots + two sqrt + pow
 * @backend wgsl ✓ / glsl ✓ — view-dependent, like fresnel: parity widens on
 *          curved geometry (BACKEND-NOTES #5)
 */
export const anisoSheen = (TSL, tangent, { dir = [0.5, 0.7, 0.5], power = 24, shift = 0, normal } = {}) => {
  const { vec3, float, cameraPosition, positionWorld, normalWorld } = TSL;
  const n = normal || normalWorld;
  const L = Array.isArray(dir) ? vec3(...dir).normalize() : dir.normalize();
  const V = cameraPosition.sub(positionWorld).normalize();
  const T = (shift === 0 ? tangent : tangent.add(n.mul(shift))).normalize();
  const tl = T.dot(L);
  const tv = T.dot(V);
  // sin of each angle to the strand — the cone of mirror normals, not one normal
  const sl = float(1).sub(tl.mul(tl)).max(0).sqrt();
  const sv = float(1).sub(tv.mul(tv)).max(0).sqrt();
  return sl.mul(sv).sub(tl.mul(tv)).max(0).pow(power);
};

/**
 * surfaceTangent — a stable world-space tangent frame from the world normal
 * alone: `axis` crossed into the normal gives the first tangent, and crossing
 * back gives its perpendicular. Degenerates only where the normal is parallel
 * to `axis`, hence the fallback axis.
 *
 * @returns {object} { u, v } — orthonormal vec3 tangents in the surface
 */
export const surfaceTangent = (TSL, { axis = [0, 1, 0], normal } = {}) => {
  const { vec3, mix, step } = TSL;
  const n = normal || TSL.normalWorld;
  const a = vec3(...axis);
  const alt = vec3(axis[2], axis[0], axis[1]); // swizzled axis for the pole
  const pick = step(0.99, n.dot(a).abs());
  const base = mix(a, alt, pick);
  const u = base.cross(n).normalize();
  return { u, v: n.cross(u).normalize() };
};

export const source = () => `const { u, v } = surfaceTangent();
const T = mix(v, u, alongWarp);
const sheen = anisoSheen(T, { power: 26,
  shift: grain.mul(.08) });
// sl·sv − tl·tv : the cone of mirror normals
// around a strand — a BAND, never a dot`;
/**
 * valueNoise — pure-TSL 3D value noise: hashed lattice corners, smoothstep
 * fade, trilinear blend. The guaranteed-present base tier under fbm's
 * fallback path; softer character than gradient (mx) noise.
 *
 * @param   {object} TSL
 * @param   {Node}   p  vec3 sample position
 * @returns {Node} float in [-1, 1]
 * @cost    class ② — 8 corner hashes + 7 mixes
 * @backend wgsl ✓ / glsl ✓ — corner hashes ride TSL's hash(); cross-backend
 *          agreement is exactly what the parity gate checks
 */
// lattice offset into positive territory: dot-product hashes correlate
// symmetrically around zero (see the matching note in worley.js)
const corner = (TSL, i) =>
  TSL.hash(i.add(TSL.vec3(101.3, 211.7, 313.1)).dot(TSL.vec3(1.0, 57.0, 113.0)));

export const valueNoise = (TSL, p) => {
  const { vec3, mix } = TSL;
  const i = p.floor();
  const f = p.fract();
  const u = f.mul(f).mul(f.mul(-2).add(3)); // smoothstep fade per axis
  const c = (dx, dy, dz) => corner(TSL, i.add(vec3(dx, dy, dz)));
  const x00 = mix(c(0, 0, 0), c(1, 0, 0), u.x);
  const x10 = mix(c(0, 1, 0), c(1, 1, 0), u.x);
  const x01 = mix(c(0, 0, 1), c(1, 0, 1), u.x);
  const x11 = mix(c(0, 1, 1), c(1, 1, 1), u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z).mul(2).sub(1);
};

export const source = () => `const n = valueNoise(posL.mul(4));
colorNode = ice.mul(n.mul(.5).add(.5));`;

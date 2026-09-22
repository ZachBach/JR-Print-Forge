/**
 * curl — divergence-free curl noise via central differences over three
 * offset fbm potentials. The classic smoke/flow field: use it to advect
 * particles or shade by flow direction. Honest cost warning: 12 fbm
 * evaluations — the library's most expensive node; budget accordingly.
 *
 * @param   {object} TSL
 * @param   {Node}   p  vec3 sample position
 * @param   {object} opts
 * @param   {number} [opts.octaves=3]
 * @param   {number} [opts.eps=0.12]  finite-difference step
 * @returns {Node} vec3 divergence-free flow vector (≈[-1,1] per axis)
 * @cost    class ⑤ — 12 fbm evals
 * @backend wgsl ✓ / glsl ✓
 */
import { fbm } from './fbm.js';

export const curl = (TSL, p, { octaves = 3, eps = 0.12 } = {}) => {
  const { vec3 } = TSL;
  const o1 = vec3(0, 31.4, 15.9), o2 = vec3(27.1, 0, 82.8);
  const F = (q) => fbm(TSL, q, { octaves });
  const G = (q) => fbm(TSL, q.add(o1), { octaves });
  const H = (q) => fbm(TSL, q.add(o2), { octaves });
  const dx = vec3(eps, 0, 0), dy = vec3(0, eps, 0), dz = vec3(0, 0, eps);
  const inv = 1 / (2 * eps);
  // curl = (dHz/dy − dGy/dz, dFx/dz − dHz/dx, dGy/dx − dFx/dy)
  return vec3(
    H(p.add(dy)).sub(H(p.sub(dy))).sub(G(p.add(dz)).sub(G(p.sub(dz)))).mul(inv),
    F(p.add(dz)).sub(F(p.sub(dz))).sub(H(p.add(dx)).sub(H(p.sub(dx)))).mul(inv),
    G(p.add(dx)).sub(G(p.sub(dx))).sub(F(p.add(dy)).sub(F(p.sub(dy)))).mul(inv));
};

export const source = () => `const flow = curl(posL.mul(1.5));
colorNode = flow.mul(.5).add(.5); // direction as color`;

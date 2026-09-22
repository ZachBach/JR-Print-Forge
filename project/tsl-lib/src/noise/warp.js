/**
 * warp — domain warping: displace a sample position by three offset fbm
 * fields before sampling anything through it. The marble/flow-lines
 * ingredient (fbm(warp(p)) = veined marble).
 *
 * @param   {object} TSL
 * @param   {Node}   p  vec3 position to warp
 * @param   {object} opts
 * @param   {number} [opts.amp=0.6]     displacement strength
 * @param   {number} [opts.freq=1]      warp-field frequency (vs p's scale)
 * @param   {number} [opts.octaves=3]   warp-field detail
 * @returns {Node} vec3 warped position — feed to any noise/pattern
 * @cost    class ③ — three fbm evaluations
 * @backend wgsl ✓ / glsl ✓
 */
import { fbm } from './fbm.js';

export const warp = (TSL, p, { amp = 0.6, freq = 1, octaves = 3 } = {}) => {
  const { vec3 } = TSL;
  const q = p.mul(freq);
  return p.add(vec3(
    fbm(TSL, q, { octaves }),
    fbm(TSL, q.add(vec3(5.2, 1.3, 8.7)), { octaves }),
    fbm(TSL, q.add(vec3(9.1, 4.4, 2.8)), { octaves })).mul(amp));
};

export const source = () => `const veins = fbm(warp(posL.mul(2), { amp: .8 }));
colorNode = mix(slate, ice, veins.mul(.5).add(.5));`;

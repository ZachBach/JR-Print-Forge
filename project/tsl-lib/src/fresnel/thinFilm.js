/**
 * thinFilm — soap-bubble/oil-slick iridescence approximation: the fresnel
 * term drives a cyclic cosine palette, so hue sweeps with view angle like
 * interference bands. Cheap — no spectral math, just fresnel + one cos.
 *
 * @param   {object} TSL
 * @param   {object} opts
 * @param   {number} [opts.cycles=2.2]  hue revolutions across the rim
 * @param   {number} [opts.shift=0]     palette phase offset
 * @param   {number} [opts.power=1]     fresnel sharpness
 * @returns {Node} vec3 iridescent color (multiply by your intensity)
 * @cost    class ② — fresnel + cos
 * @backend wgsl ✓ / glsl ✓ — view-dependent (parity on sphere)
 */
import { fresnel } from './fresnel.js';
import { cosinePalette } from '../ramp/cosinePalette.js';

export const thinFilm = (TSL, { cycles = 2.2, shift = 0, power = 1 } = {}) => {
  const f = fresnel(TSL, { power });
  return cosinePalette(TSL, f.mul(cycles).add(shift), {
    a: [0.5, 0.5, 0.5], b: [0.45, 0.45, 0.45], c: [1, 1, 1], d: [0.0, 0.33, 0.67],
  }).mul(f.mul(0.8).add(0.2));
};

export const source = () => `// fresnel drives a cyclic palette — hue
// sweeps with view angle like interference
colorNode = base.add(thinFilm({ cycles: 2.2 }));`;

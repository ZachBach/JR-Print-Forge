/**
 * fbm — fractal Brownian motion over a base noise. Native path is the mx
 * adapter (what all 11 shipped call sites use — see docs/INVENTORY.md §1);
 * fallback is a JS-unrolled octave loop over pure-TSL valueNoise with the
 * SAME unnormalized amplitude sum as mx (range grows with octaves; at
 * gain 0.5 it approaches ±2).
 *
 * @param   {object} TSL
 * @param   {Node}   p  vec3 sample position
 * @param   {object} opts
 * @param   {number} [opts.octaves=4]      3–5 in all shipped uses
 * @param   {number} [opts.lacunarity=2]   always 2.0 in shipped uses
 * @param   {number} [opts.gain=0.5]       0.5–0.55 in shipped uses
 * @param   {string} [opts.base='auto']    'auto' (mx native, else fallback)
 *                                         | 'value' (force pure-TSL)
 * @returns {Node} float, ≈[-Σgainⁱ, Σgainⁱ]
 * @cost    class ② native · class ③ fallback (octaves × valueNoise)
 * @backend wgsl ✓ / glsl ✓ — both paths parity-gated separately
 *          (bench entries noise-fbm and noise-fbm-fallback)
 */
import { mxFractalNoise } from './adapters/mx.js';
import { valueNoise } from './valueNoise.js';

export const fbm = (TSL, p, { octaves = 4, lacunarity = 2, gain = 0.5, base = 'auto' } = {}) => {
  const mx = base === 'auto' ? mxFractalNoise(TSL) : null;
  if (mx) return mx(p, octaves, lacunarity, gain);
  let amp = 1, freq = 1, sum = null;
  for (let o = 0; o < octaves; o++) {
    const n = valueNoise(TSL, p.mul(freq)).mul(amp);
    sum = sum ? sum.add(n) : n;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum;
};

export const fbmImpl = (TSL, opts = {}) =>
  (opts.base === 'auto' || opts.base === undefined) && mxFractalNoise(TSL) ? 'native' : 'fallback';

export const source = () => `const n = fbm(posL.mul(2.4), { octaves: 4 })
  .mul(.5).add(.5);`;

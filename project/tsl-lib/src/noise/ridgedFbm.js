/**
 * ridgedFbm — fbm with per-octave ridge transform (1−|n|)²: sharp crests
 * with soft valleys. The generalized shape behind the aurora ridgeline
 * (docs/INVENTORY.md §1) and the classic terrain/lightning look.
 *
 * Always its own octave loop (mx has no ridged variant); base noise is
 * gradient (native mx when present, else pure-TSL fallback).
 *
 * @param   {object} TSL
 * @param   {Node}   p  vec3 sample position
 * @param   {object} opts
 * @param   {number} [opts.octaves=4]
 * @param   {number} [opts.lacunarity=2]
 * @param   {number} [opts.gain=0.5]
 * @returns {Node} float 0..≈1 (normalized by amplitude sum)
 * @cost    class ③ — octaves × base noise
 * @backend wgsl ✓ / glsl ✓
 */
import { gradientNoise } from './gradientNoise.js';

export const ridgedFbm = (TSL, p, { octaves = 4, lacunarity = 2, gain = 0.5 } = {}) => {
  let amp = 1, freq = 1, sum = null, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = gradientNoise(TSL, p.mul(freq));
    const r = TSL.float(1).sub(n.abs());
    sum = sum ? sum.add(r.mul(r).mul(amp)) : r.mul(r).mul(amp);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum.div(norm);
};

export const source = () => `const ridge = ridgedFbm(posL.mul(2), { octaves: 4 });
colorNode = cyan.mul(ridge.pow(3));`;

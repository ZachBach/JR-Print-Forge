/**
 * turbulence — fbm over |noise|: all-positive billows with sharp creases.
 * The smoke/fire-density classic.
 *
 * @param   {object} TSL
 * @param   {Node}   p  vec3 sample position
 * @param   {object} opts
 * @param   {number} [opts.octaves=4]
 * @param   {number} [opts.lacunarity=2]
 * @param   {number} [opts.gain=0.5]
 * @returns {Node} float 0..≈1 (normalized)
 * @cost    class ③ — octaves × base noise
 * @backend wgsl ✓ / glsl ✓
 */
import { gradientNoise } from './gradientNoise.js';

export const turbulence = (TSL, p, { octaves = 4, lacunarity = 2, gain = 0.5 } = {}) => {
  let amp = 1, freq = 1, sum = null, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = gradientNoise(TSL, p.mul(freq)).abs().mul(amp);
    sum = sum ? sum.add(n) : n;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum.div(norm);
};

export const source = () => `const smoke = turbulence(posL.mul(2.5));
colorNode = mist.mul(smoke);`;

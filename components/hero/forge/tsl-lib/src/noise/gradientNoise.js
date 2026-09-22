/**
 * gradientNoise — 3D perlin-style noise. Native path is the mx adapter
 * (mx_noise_float); fallback is pure-TSL classic gradient noise: hashed unit
 * gradients at lattice corners, dotted with the corner offset, fade-blended.
 * Sharper, more directional character than valueNoise.
 *
 * @param   {object} TSL
 * @param   {Node}   p  vec3 sample position
 * @param   {object} opts
 * @param   {string} [opts.impl='auto']  'auto' | 'fallback'
 * @returns {Node} float ≈[-1, 1]
 * @cost    class ② native · class ③ fallback (8 corners × hash3 + dot)
 * @backend wgsl ✓ / glsl ✓ — both paths parity-gated
 */
import { mxGradientNoise } from './adapters/mx.js';

// same positive-offset rule as worley/valueNoise: dot-product hashes
// correlate symmetrically around zero
const grad = (TSL, c) => {
  const { vec3, hash } = TSL;
  const q = c.add(vec3(101.3, 211.7, 313.1));
  return vec3(
    hash(q.dot(vec3(1.0, 57.0, 113.0))),
    hash(q.dot(vec3(57.0, 113.0, 1.0))),
    hash(q.dot(vec3(113.0, 1.0, 57.0)))).mul(2).sub(1);
};

export const gradientNoise = (TSL, p, { impl = 'auto' } = {}) => {
  const mx = impl === 'auto' ? mxGradientNoise(TSL) : null;
  if (mx) return mx(p);
  const { vec3, mix } = TSL;
  const i = p.floor();
  const f = p.fract();
  const u = f.mul(f).mul(f.mul(-2).add(3));
  const c = (dx, dy, dz) => {
    const o = vec3(dx, dy, dz);
    return grad(TSL, i.add(o)).dot(f.sub(o));
  };
  const x00 = mix(c(0, 0, 0), c(1, 0, 0), u.x);
  const x10 = mix(c(0, 1, 0), c(1, 1, 0), u.x);
  const x01 = mix(c(0, 0, 1), c(1, 0, 1), u.x);
  const x11 = mix(c(0, 1, 1), c(1, 1, 1), u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z).mul(1.4);
};

export const gradientImpl = (TSL, opts = {}) =>
  (opts.impl === 'auto' || opts.impl === undefined) && mxGradientNoise(TSL) ? 'native' : 'fallback';

export const source = () => `const n = gradientNoise(posL.mul(3));
colorNode = silver.mul(n.mul(.5).add(.5));`;

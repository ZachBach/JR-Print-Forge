/**
 * rimLight — colored silhouette light, optionally biased toward a
 * direction (lit rim on the light side, dark rim opposite).
 *
 * @param   {object} TSL
 * @param   {object} opts
 * @param   {number|Node} [opts.color=0xEAF7FF]  rim color (hex or node)
 * @param   {number} [opts.power=3]      rim sharpness
 * @param   {Node}   [opts.dir]          bias direction (e.g. light dir)
 * @param   {number} [opts.biasAmount=0.6]  0 = uniform rim, 1 = fully one-sided
 * @returns {Node} vec3 additive rim contribution
 * @cost    class ① — fresnel + optional dot
 * @backend wgsl ✓ / glsl ✓ — view-dependent (parity on sphere)
 */
import { fresnel } from './fresnel.js';

export const rimLight = (TSL, { color = 0xEAF7FF, power = 3, dir, biasAmount = 0.6 } = {}) => {
  const c = typeof color === 'number' ? TSL.color(color) : color;
  let rim = fresnel(TSL, { power });
  if (dir) {
    const facing = TSL.normalWorld.dot(dir).mul(0.5).add(0.5);
    rim = rim.mul(facing.mul(biasAmount).add(1 - biasAmount));
  }
  return c.mul(rim);
};

export const source = () => `colorNode = base
  .add(rimLight({ color: ice, power: 3, dir: L }));`;

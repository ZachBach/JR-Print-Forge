/**
 * stripes / checker — the elementary tilings.
 *
 * @param   {object} TSL
 * @param   {Node}   x | p  scalar (stripes) or vec2 (checker)
 * @param   {object} opts
 * @param   {number} [opts.freq=8]
 * @param   {number} [opts.duty=0.5]   stripes: on-fraction of each period
 * @param   {number} [opts.soft=0.02]  edge softness (0 = hard step)
 * @returns {Node} float 0..1
 * @cost    class ① — fract + step
 * @backend wgsl ✓ / glsl ✓
 */
export const stripes = (TSL, x, { freq = 8, duty = 0.5, soft = 0.02 } = {}) => {
  const t = x.mul(freq).fract();
  if (!soft) return TSL.step(t, duty);
  return TSL.smoothstep(0, soft, t).mul(TSL.smoothstep(duty + soft, duty, t));
};

export const checker = (TSL, p, { freq = 8 } = {}) => {
  const c = p.mul(freq).floor();
  return c.x.add(c.y).mod(2);
};

export const source = () => `const bands = stripes(posL.y, { freq: 8, duty: .4 });
const board = checker(posL.xy, { freq: 6 });`;

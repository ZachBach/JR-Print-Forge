/**
 * radialPulse — rings expanding from a center, as shipped in the Lab SHIELD
 * (docs/INVENTORY.md §4: sin(len·9 − t·5) ^2).
 *
 * @param   {object} TSL
 * @param   {Node}   p  vec3 position relative to the pulse center
 * @param   {object} opts
 * @param   {number} [opts.freq=9]        ring frequency
 * @param   {number} [opts.speed=5]       outward speed (units of clock)
 * @param   {number} [opts.sharpness=2]   pow exponent
 * @param   {Node}   [opts.clock]
 * @returns {Node} float 0..1
 * @cost    class ① — length + sin + pow
 * @backend wgsl ✓ / glsl ✓
 */
export const radialPulse = (TSL, p, { freq = 9, speed = 5, sharpness = 2, clock } = {}) => {
  let arg = p.length().mul(freq);
  if (clock) arg = arg.sub(clock.mul(speed));
  return TSL.sin(arg).mul(0.5).add(0.5).pow(sharpness);
};

export const source = () => `const pulse = radialPulse(posL, { freq: 9, clock: t });
colorNode = ice.mul(pulse.mul(lattice).mul(.6));`;

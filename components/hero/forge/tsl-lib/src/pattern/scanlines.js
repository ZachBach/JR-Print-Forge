/**
 * scanlines — traveling emission bands along an axis, as shipped in the Lab
 * HOLOGRAM (docs/INVENTORY.md §4: sin(posW.y·46 − t·6) ^3).
 *
 * @param   {object} TSL
 * @param   {Node}   axisPos  scalar position along the band axis (e.g. posW.y)
 * @param   {object} opts
 * @param   {number} [opts.freq=46]       band frequency
 * @param   {number} [opts.speed=6]       travel speed (units of clock)
 * @param   {number} [opts.sharpness=3]   pow exponent — higher = thinner bands
 * @param   {Node}   [opts.clock]         animation clock (required for motion)
 * @returns {Node} float 0..1
 * @cost    class ① — one sin + pow
 * @backend wgsl ✓ / glsl ✓
 */
export const scanlines = (TSL, axisPos, { freq = 46, speed = 6, sharpness = 3, clock } = {}) => {
  let arg = axisPos.mul(freq);
  if (clock) arg = arg.sub(clock.mul(speed));
  return TSL.sin(arg).mul(0.5).add(0.5).pow(sharpness);
};

export const source = () => `const scan = scanlines(posW.y, { freq: 46, clock: t });
opacityNode = fres.mul(.85).add(scan.mul(.25));`;

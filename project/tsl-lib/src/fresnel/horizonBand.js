/**
 * horizonBand — fake-chrome horizon reflections: sine bands across a normal
 * axis, sheared by a scalar field, as shipped in LIQUID METAL
 * (docs/INVENTORY.md §3). The cheap "reflective" look with zero environment.
 *
 * @param   {object} TSL
 * @param   {object} opts
 * @param   {string} [opts.axis='y']       normal component the bands cross
 * @param   {number} [opts.freq=5.5]       band frequency
 * @param   {Node}   [opts.shear]          scalar field added to the phase
 *                                         (swirl noise makes it liquid)
 * @param   {number} [opts.shearAmount=3.2]
 * @param   {number} [opts.sharpness=3]
 * @param   {Node}   [opts.clock]          slow drift
 * @param   {number} [opts.speed=0.7]
 * @returns {Node} float 0..1 band mask
 * @cost    class ① — sin + pow (plus caller's shear field)
 * @backend wgsl ✓ / glsl ✓ — view/normal-dependent (parity on sphere)
 */
export const horizonBand = (TSL, { axis = 'y', freq = 5.5, shear, shearAmount = 3.2, sharpness = 3, clock, speed = 0.7 } = {}) => {
  let arg = TSL.normalWorld[axis].mul(freq);
  if (shear) arg = arg.add(shear.mul(shearAmount));
  if (clock) arg = arg.add(clock.mul(speed));
  return TSL.sin(arg).mul(0.5).add(0.5).pow(sharpness);
};

export const source = () => `const band = horizonBand({ shear: swirl, clock: t });
colorNode = mix(void_, silver, band.mul(.7))
  .add(rimLight({ color: ice, power: 6 }));`;

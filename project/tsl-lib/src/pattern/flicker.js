/**
 * flicker — bounded sinusoidal brightness wobble. Five hand-rolled shipped
 * instances (particle twinkle, crystal glint, sun flick, city lights, Lab
 * hologram — docs/INVENTORY.md §4) collapse into this.
 *
 * flash() is the spiky sibling: max(0)-rectified and pow-sharpened with a
 * waxing/waning envelope floor — the Terra lightning shape.
 *
 * @param   {object} TSL
 * @param   {Node}   clock
 * @param   {object} opts
 * @param   {number|Node} [opts.rate=1]    oscillation rate
 * @param   {Node}   [opts.phase]          per-instance phase (hash channel)
 * @param   {number} [opts.depth=0.2]      swing: 1−depth .. 1
 * @returns {Node} float (1−depth)..1
 * @cost    class ① — one sin
 * @backend wgsl ✓ / glsl ✓
 */
export const flicker = (TSL, clock, { rate = 1, phase, depth = 0.2 } = {}) => {
  let arg = clock.mul(rate);
  if (phase) arg = arg.add(phase);
  return TSL.sin(arg).mul(depth * 0.5).add(1 - depth * 0.5);
};

/**
 * flash — rare sharp spikes inside a slow envelope that never fully quiets.
 * @param {number} [opts.sharpness=16]  pow exponent — higher = rarer/sharper
 * @param {number} [opts.envRate=0.26]  envelope rate (vs clock)
 * @param {number} [opts.floor=0.28]    envelope minimum (storms always simmer)
 */
export const flash = (TSL, clock, { rate = 3, phase, sharpness = 16, envRate = 0.26, envPhase, floor = 0.28 } = {}) => {
  const { sin } = TSL;
  let arg = clock.mul(rate);
  if (phase) arg = arg.add(phase);
  let env = clock.mul(envRate);
  if (envPhase) env = env.add(envPhase);
  const envelope = sin(env).max(0).mul(1 - floor).add(floor);
  return sin(arg).max(0).pow(sharpness).mul(envelope);
};

export const source = () => `const tw = flicker(t, { rate: hRate, phase: hPh, depth: .5 });
const bolt = flash(t, { rate: 4, sharpness: 16 });`;

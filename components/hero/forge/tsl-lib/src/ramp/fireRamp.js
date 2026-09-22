/**
 * fireRamp — blackbody-ish fire colors from a scalar: vec3(b, b², b⁴),
 * as shipped in the El-Sol sun body (docs/INVENTORY.md §2).
 *
 * THE CLAMP IS LOAD-BEARING and lives inside the node: above b≈0.95 the
 * channel ordering inverts (b⁴ overtakes) and plasma turns blue-white —
 * paid for in production, callers cannot hit the trap.
 *
 * @param   {object} TSL
 * @param   {Node}   x  brightness driver (any range; scaled then clamped)
 * @param   {object} opts
 * @param   {number} [opts.scale=0.25]  x → b prescale (shipped value)
 * @param   {number} [opts.gain=2.4]    output brightness (shipped 4·0.6)
 * @returns {Node} vec3 linear color — deep red → orange → yellow-white
 * @cost    class ① — three muls
 * @backend wgsl ✓ / glsl ✓
 */
export const fireRamp = (TSL, x, { scale = 0.25, gain = 2.4 } = {}) => {
  const b = x.mul(scale).clamp(0.0, 0.95);
  const b2 = b.mul(b);
  return TSL.vec3(b, b2, b2.mul(b2)).mul(gain);
};

export const source = () => `// clamp ≤.95 is inside — past it the ramp inverts
colorNode = fireRamp(bright)
  .add(fireRamp(fres.mul(4)).mul(vec3(1, .55, .25)));`;

/**
 * ramp — N-stop color gradient: smoothstep-blended stops along a scalar.
 * Generalizes every hand-nested `mix(a, mix(b, c, smoothstep…))` chain in
 * the hero (sun body color, Terra surface — docs/INVENTORY.md §2).
 *
 * @param   {object} TSL
 * @param   {Node}   x  scalar driver (any range covered by the stops)
 * @param   {Array}  stops  [[t, color], …] ascending t; color = hex number
 *                   or a color/vec3 node
 * @returns {Node} vec3 color
 * @cost    class ① — (stops−1) × smoothstep+mix
 * @backend wgsl ✓ / glsl ✓
 */
export const ramp = (TSL, x, stops) => {
  if (!stops || stops.length < 2) throw new Error('ramp needs ≥2 stops');
  const col = (c) => (typeof c === 'number' ? TSL.color(c) : c);
  let out = col(stops[0][1]);
  for (let i = 1; i < stops.length; i++) {
    out = TSL.mix(out, col(stops[i][1]), TSL.smoothstep(stops[i - 1][0], stops[i][0], x));
  }
  return out;
};

export const source = () => `colorNode = ramp(rN, [
  [0.12, solar.hot], [0.55, solar.mid], [1.0, solar.limb]]);`;

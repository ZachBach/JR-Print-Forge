/**
 * dissolve — noise-threshold cutout with a glowing edge band, generalized
 * from the Lab DISSOLVE (docs/INVENTORY.md §4).
 *
 * @param   {object} TSL
 * @param   {Node}   n          noise field in 0..1 (e.g. fbm·.5+.5)
 * @param   {Node|number} threshold  cut level — animate for the burn effect
 * @param   {object} opts
 * @param   {number} [opts.edgeWidth=0.1]  ember band width above the cut
 * @returns {object} { alive, edge } — alive: 0|1 opacity mask;
 *                   edge: 0..1, hottest exactly at the burn line
 * @cost    class ① — step + smoothstep
 * @backend wgsl ✓ / glsl ✓
 */
export const dissolve = (TSL, n, threshold, { edgeWidth = 0.1 } = {}) => {
  const { float, step, smoothstep } = TSL;
  const th = typeof threshold === 'number' ? float(threshold) : threshold;
  const alive = step(th, n);
  const edge = float(1).sub(smoothstep(0.0, edgeWidth, n.sub(th))).mul(alive);
  return { alive, edge };
};

export const source = () => `const { alive, edge } = dissolve(n, th, { edgeWidth: .1 });
colorNode = base.add(gold.mul(edge.mul(2.4)))
  .add(ember.mul(edge.mul(edge).mul(1.6)));
opacityNode = alive;`;

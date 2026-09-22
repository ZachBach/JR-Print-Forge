/**
 * makeFlux — the Lab's shared parameter: one uniform driving a scaled clock.
 * The caller owns the uniform (library nodes never own uniforms); pass the
 * returned clock into any animated node.
 *
 * @param   {object} TSL
 * @param   {object} opts
 * @param   {number} [opts.initial=0.5]  starting flux (0..1)
 * @param   {number} [opts.rate=1.8]     clock speed at flux 1
 * @param   {number} [opts.base=0.25]    clock speed at flux 0
 * @param   {Node}   [opts.time]         time source (parity harnesses inject
 *                                       a frozen constant here)
 * @returns {object} { uniform, clock } — set uniform.value from your UI
 * @cost    class ① — one mul/add
 * @backend wgsl ✓ / glsl ✓
 */
export const makeFlux = (TSL, { initial = 0.5, rate = 1.8, base = 0.25, time } = {}) => {
  const u = TSL.uniform(initial);
  const t = (time || TSL.time).mul(u.mul(rate).add(base));
  return { uniform: u, clock: t };
};

export const source = () => `const flux = makeFlux(TSL);
slider.oninput = () => flux.uniform.value = slider.value;
const n = fbm(posL.add(flux.clock));`;

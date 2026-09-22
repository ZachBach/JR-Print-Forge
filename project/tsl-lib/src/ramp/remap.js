/**
 * remap — map x from [inLo, inHi] to [outLo, outHi], clamped by default.
 * The idiom behind every hand-tuned `mul().add().max()` brightness shaping
 * in the hero (e.g. the sun body's `nz·3.4 + 1.15, max(.28)`).
 *
 * @param   {object} TSL
 * @param   {Node}   x
 * @param   {number|Node} inLo, inHi, outLo, outHi
 * @param   {object} [opts]
 * @param   {boolean} [opts.clamp=true]  clamp x into the input range first
 * @returns {Node} float
 * @cost    class ① — sub/div/mul/add
 * @backend wgsl ✓ / glsl ✓
 */
export const remap = (TSL, x, inLo, inHi, outLo, outHi, { clamp = true } = {}) => {
  let t = x.sub(inLo).div(TSL.float(inHi).sub(inLo));
  if (clamp) t = t.clamp(0, 1);
  return t.mul(TSL.float(outHi).sub(outLo)).add(outLo);
};

export const source = () => `const bright = remap(nz, -1, 1, 0.28, 2.3);`;

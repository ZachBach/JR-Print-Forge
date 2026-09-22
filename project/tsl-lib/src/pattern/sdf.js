/**
 * sdf — 2D signed-distance minis + smooth boolean ops, for HUD-style
 * materials (rings, panels, connectors). Negative inside, positive outside.
 *
 * @param   {object} TSL
 * @param   {Node}   p  vec2 coordinates
 * @cost    class ① each
 * @backend wgsl ✓ / glsl ✓
 */
export const sdCircle = (TSL, p, r) => p.length().sub(r);

export const sdBox = (TSL, p, bx, by) => {
  const { vec2, min, max } = TSL;
  const d = p.abs().sub(vec2(bx, by));
  return d.max(0).length().add(min(max(d.x, d.y), 0));
};

// segment from a to b ([ax,ay]..[bx,by] as JS numbers), radius r
export const sdSegment = (TSL, p, a, b, r = 0) => {
  const { vec2 } = TSL;
  const A = vec2(...a), B = vec2(...b);
  const pa = p.sub(A), ba = B.sub(A);
  const h = pa.dot(ba).div(ba.dot(ba)).clamp(0, 1);
  return pa.sub(ba.mul(h)).length().sub(r);
};

// polynomial smooth-min union / subtraction (IQ)
export const opSmoothUnion = (TSL, d1, d2, k = 0.2) => {
  const h = TSL.float(0.5).add(d2.sub(d1).mul(0.5 / k)).clamp(0, 1);
  return TSL.mix(d2, d1, h).sub(h.mul(h.oneMinus()).mul(k));
};

export const opSmoothSubtract = (TSL, d1, d2, k = 0.2) =>
  opSmoothUnion(TSL, d1, d2.negate(), k).negate();

// distance → antialiased fill / outline masks
export const sdFill = (TSL, d, { soft = 0.01 } = {}) => TSL.smoothstep(soft, -soft, d);
export const sdOutline = (TSL, d, { width = 0.02, soft = 0.01 } = {}) =>
  TSL.smoothstep(width + soft, width - soft, d.abs());

export const source = () => `const d = opSmoothUnion(
  sdCircle(p, .5), sdBox(p.sub(vec2(.4, 0)), .3, .2), .15);
colorNode = cyan.mul(sdOutline(d)).add(blue.mul(sdFill(d).mul(.3)));`;

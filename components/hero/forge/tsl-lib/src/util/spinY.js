/**
 * spinY — rotate a direction around the y axis, as shipped for Terra's
 * body-frame spin (continents glued to the frame, render position rotated).
 *
 * @param   {object} TSL
 * @param   {Node}   dir    vec3
 * @param   {Node}   angle  rotation (e.g. clock·rate)
 * @returns {Node} vec3
 * @cost    class ① — sin/cos + 4 muls
 * @backend wgsl ✓ / glsl ✓
 */
export const spinY = (TSL, dir, angle) => {
  const { vec3, cos, sin } = TSL;
  const c = cos(angle), s = sin(angle);
  return vec3(
    dir.x.mul(c).add(dir.z.mul(s)),
    dir.y,
    dir.z.mul(c).sub(dir.x.mul(s)));
};

export const source = () => `const rdir = spinY(bodyDir, clock.mul(.1));
positionNode = center.add(rdir.mul(R));`;

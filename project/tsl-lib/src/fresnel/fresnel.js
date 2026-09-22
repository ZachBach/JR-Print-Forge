/**
 * fresnel — view-angle rim term, unifying the four shipped variants
 * (docs/INVENTORY.md §3): Lab shared fres (abs), El-Sol body (front-only),
 * Terra atmosphere (abs + pow 3.5), and the cheap z-axis rim.
 *
 * @param   {object} TSL
 * @param   {object} opts
 * @param   {number} [opts.power=1]      sharpness; shipped uses 1–6
 * @param   {number} [opts.bias=0]       added before pow (lifts the floor)
 * @param   {string} [opts.facing='abs'] 'abs'   — double-sided (Lab, atmo)
 *                                       'front' — max(dot,0) (sun body)
 *                                       'z'     — cheap |dir.z| rim; pass
 *                                                 opts.dir (view along z)
 * @param   {Node}   [opts.dir]          direction for facing:'z'
 * @returns {Node} float 0..1+ — 0 facing the camera, 1 at the silhouette
 * @cost    class ① — dot + pow
 * @backend wgsl ✓ / glsl ✓ — view-dependent: parity runs on parityGeo
 *          'sphere' with widened tolerance (BACKEND-NOTES #5)
 */
export const fresnel = (TSL, { power = 1, bias = 0, facing = 'abs', dir } = {}) => {
  const { float, cameraPosition, positionWorld, normalWorld } = TSL;
  let f;
  if (facing === 'z') {
    f = dir.z.abs().oneMinus();
  } else {
    const eye = cameraPosition.sub(positionWorld).normalize();
    const d = eye.dot(normalWorld);
    f = float(1).sub(facing === 'front' ? d.max(0) : d.abs());
  }
  if (bias) f = f.add(bias);
  return power === 1 ? f : f.pow(power);
};

export const source = () => `const fres = fresnel({ power: 3 });
colorNode = cyan.mul(fres.mul(1.4))
  .add(ice.mul(fres.pow(2)));`;

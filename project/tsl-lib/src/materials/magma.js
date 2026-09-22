/**
 * MAGMA — domain-warped fbm through the fire ramp, with a cooling crust and
 * ember crack edges. fireRamp's internal 0.95 clamp keeps the melt from ever
 * going blue-white.
 *
 * @cost    see REGISTRY materials/magma
 * @backend wgsl ✓ / glsl ✓
 */
import { palette } from '../util/palette.js';
import { fbm } from '../noise/fbm.js';
import { warp } from '../noise/warp.js';
import { fireRamp } from '../ramp/fireRamp.js';
import { remap } from '../ramp/remap.js';
import { dissolve } from '../pattern/dissolve.js';

export const name = 'MAGMA';

export const apply = (TSL, mat, { clock } = {}) => {
  const { brand } = palette(TSL);
  const p = TSL.positionLocal.mul(2.2).add(TSL.vec3(0, clock.mul(-0.12), 0));
  const n = fbm(TSL, warp(TSL, p, { amp: 0.7 }), { octaves: 4 }).mul(0.5).add(0.5);
  const melt = fireRamp(TSL, remap(TSL, n, 0, 1, 0.6, 4.2));
  const crust = TSL.smoothstep(0.56, 0.74, n);
  const { edge } = dissolve(TSL, n, 0.56, { edgeWidth: 0.16 });
  mat.colorNode = TSL.mix(melt, brand.slate.mul(0.5), crust)
    .add(brand.ember.mul(edge.mul(1.8)));
  return { impl: 'native' };
};

export const source = () => `const n = fbm(warp(posL, { amp: .7 }))
  .mul(.5).add(.5);
const melt = fireRamp(remap(n, 0, 1, .6, 4.2));
const crust = smoothstep(.56, .74, n);
const { edge } = dissolve(n, .56,
  { edgeWidth: .16 });
colorNode = mix(melt, slate.mul(.5), crust)
  .add(ember.mul(edge.mul(1.8)));`;

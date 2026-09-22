/**
 * DAMASCUS — pattern-welded steel. Folded layers are just stripes; the
 * figure comes from warping the domain hard before sampling them, which is
 * exactly what grinding into a twisted billet does to the layer boundaries.
 *
 * @cost    see REGISTRY materials/damascus
 * @backend wgsl ✓ / glsl ✓
 */
import { palette } from '../util/palette.js';
import { warp } from '../noise/warp.js';
import { stripes } from '../pattern/stripes.js';
import { ramp } from '../ramp/ramp.js';
import { fresnel } from '../fresnel/fresnel.js';

export const name = 'DAMASCUS';

export const apply = (TSL, mat) => {
  const { brand } = palette(TSL);
  const billet = warp(TSL, TSL.positionLocal.mul(1.1), { amp: 0.85, octaves: 3 });
  const layers = stripes(TSL, billet.y, { freq: 9, duty: 0.5, soft: 0.14 });
  const etch = ramp(TSL, layers, [
    [0.0, brand.slate],
    [0.45, brand.silver],
    [1.0, brand.ice],
  ]);
  mat.colorNode = etch.mul(0.85).add(brand.ice.mul(fresnel(TSL, { power: 3 }).mul(0.45)));
  return { impl: 'native' };
};

export const source = () => `const billet = warp(posL.mul(1.1),
  { amp: .85 });               // the twist in the bar
const layers = stripes(billet.y,
  { freq: 9, soft: .14 });     // the folds
const etch = ramp(layers,
  [[0, slate], [.45, silver], [1, ice]]);
colorNode = etch.mul(.85)
  .add(ice.mul(fresnel({ power: 3 }).mul(.45)));`;

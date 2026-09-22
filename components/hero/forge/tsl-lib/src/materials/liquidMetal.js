/**
 * LIQUID METAL — fbm vertex ripple + dark chrome via sheared horizon bands.
 * Library rebuild of the shipped Lab material.
 *
 * @param   {object} TSL
 * @param   {object} mat
 * @param   {object} opts  { clock }
 * @cost    see REGISTRY materials/liquidMetal
 * @backend wgsl ✓ / glsl ✓
 */
import { palette } from '../util/palette.js';
import { fresnel } from '../fresnel/fresnel.js';
import { fbm } from '../noise/fbm.js';
import { horizonBand } from '../fresnel/horizonBand.js';

export const name = 'LIQUID METAL';

export const apply = (TSL, mat, { clock } = {}) => {
  const { brand } = palette(TSL);
  const wob = fbm(TSL, TSL.positionLocal.mul(1.6)
    .add(TSL.vec3(clock.mul(0.4), 0, clock.mul(0.3))), { octaves: 4 });
  mat.positionNode = TSL.positionLocal.add(TSL.normalLocal.mul(wob.mul(0.12)));
  const swirl = fbm(TSL, TSL.positionWorld.mul(1.4)
    .add(TSL.vec3(0, clock.mul(0.5), 0)), { octaves: 3 });
  const band = horizonBand(TSL, { freq: 5.5, shear: swirl, shearAmount: 3.2, sharpness: 3, clock, speed: 0.7 });
  const fres = fresnel(TSL);
  mat.colorNode = TSL.mix(brand.void, brand.silver, band.mul(0.7))
    .add(brand.ice.mul(fres.pow(6).mul(0.8)))
    .add(brand.gold.mul(fres.pow(5).mul(0.35)));
  return { impl: 'native' };
};

export const source = () => `const wob = fbm(posL.mul(1.6), { octaves: 4 });
positionNode = posL
  .add(normalL.mul(wob.mul(.12)));
const swirl = fbm(posW.mul(1.4), { octaves: 3 });
const band = horizonBand(
  { shear: swirl, clock: t });
colorNode = mix(void_, silver, band.mul(.7))
  .add(ice.mul(fresnel().pow(6).mul(.8)))
  .add(gold.mul(fresnel().pow(5).mul(.35)));`;

/**
 * BRUSHED METAL — anisotropically stretched noise grooves shearing a
 * horizon-band highlight, dark steel with an ice glint and a faint
 * thin-film sheen at grazing angles.
 *
 * @cost    see REGISTRY materials/brushedMetal
 * @backend wgsl ✓ / glsl ✓
 */
import { palette } from '../util/palette.js';
import { fbm } from '../noise/fbm.js';
import { horizonBand } from '../fresnel/horizonBand.js';
import { fresnel } from '../fresnel/fresnel.js';
import { thinFilm } from '../fresnel/thinFilm.js';

export const name = 'BRUSHED METAL';

export const apply = (TSL, mat, { clock } = {}) => {
  const { brand } = palette(TSL);
  const grooves = fbm(TSL, TSL.positionLocal.mul(TSL.vec3(2.2, 90, 2.2)), { octaves: 3 });
  const band = horizonBand(TSL, { freq: 4.2, shear: grooves, shearAmount: 0.9, sharpness: 4, clock, speed: 0.25 });
  const fres = fresnel(TSL);
  mat.colorNode = TSL.mix(brand.void, brand.silver, grooves.mul(0.12).add(0.3))
    .add(brand.ice.mul(band.mul(grooves.mul(0.25).add(0.75)).mul(0.9)))
    .add(brand.ice.mul(fres.pow(5).mul(0.6)))
    .add(thinFilm(TSL, { cycles: 1.4, power: 3 }).mul(0.18));
  return { impl: 'native' };
};

export const source = () => `const grooves = fbm(
  posL.mul(vec3(2.2, 90, 2.2)), { octaves: 3 });
const band = horizonBand({ freq: 4.2,
  shear: grooves, shearAmount: .9, clock: t });
colorNode = mix(void_, silver, grooves.mul(.12).add(.3))
  .add(ice.mul(band.mul(.9)))
  .add(thinFilm({ cycles: 1.4, power: 3 }).mul(.18));`;

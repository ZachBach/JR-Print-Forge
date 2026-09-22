/**
 * blackbody — star/ember color from temperature in Kelvin. Chromaticity
 * only: channels normalized so the max ≈ 1 — brightness stays the
 * caller's business (ramp-family behavior). Born on echoGalaxy's G2
 * star field (per-star color from a core→rim temperature gradient).
 *
 * Anchors are the published blackbody sRGB swatches (Mitchell Charity's
 * bbr_color table, CIE 1964 10deg CMF rows), placed on the mired axis
 * (1e6/T) where color shift is perceptually ~linear, so the ramp between
 * anchors tracks the Planckian locus: verified at five non-anchor temps
 * against the published rows — worst channel error 8/255, most within
 * 1–3. TSL.color converts the published sRGB hexes to working space.
 *
 * Deliberately zero options: the physics doesn't have knobs. Callers
 * wanting stylization remap T before the call.
 *
 * @param   {object} TSL
 * @param   {Node|number} T  temperature in Kelvin; clamped 1,700–30,000
 * @returns {Node} vec3 linear color
 * @cost    class ② — 8 smoothstep+mix pairs (via ramp); gate-measured
 * @backend wgsl ✓ / glsl ✓ — parity-gated (bench ramp-blackbody)
 */
import { ramp } from './ramp.js';

const STOPS = [
  [33.3, 0x9fbfff],  // 30,000 K — hot O/B blue-white (159,191,255)
  [66.7, 0xb3ccff],  // 15,000 K (179,204,255)
  [100.0, 0xccdbff], // 10,000 K — A-star blue-white (204,219,255)
  [125.0, 0xe3e9ff], // 8,000 K (227,233,255)
  [151.5, 0xfef9ff], // 6,600 K — near the white point (254,249,255)
  [172.4, 0xfff0e9], // 5,800 K — the Sun (255,240,233)
  [222.2, 0xffdbba], // 4,500 K (255,219,186)
  [333.3, 0xffb46b], // 3,000 K — K/M orange (255,180,107)
  [500.0, 0xff8912], // 2,000 K — deep ember (255,137,18)
];

export const blackbody = (TSL, T) => {
  const mired = TSL.float(1e6).div(TSL.float(T).clamp(1700, 30000));
  return ramp(TSL, mired, STOPS);
};

export const source = () => `colorNode = blackbody(mix(uCore, uRim, t));
// Kelvin in, Planckian locus out — red 2,000 K … blue-white 30,000 K`;

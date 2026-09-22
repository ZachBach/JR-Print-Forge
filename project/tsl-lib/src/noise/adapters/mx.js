/**
 * MaterialX adapters — the ONLY file allowed to touch mx_* symbols
 * (BACKLOG §3 architecture rule). Every accessor feature-detects and returns
 * null when the build lacks the node, so a three.js upgrade that drops mx_*
 * degrades to the pure-TSL fallbacks instead of crashing the library.
 *
 * Audited r178 surface (docs/tsl-exports.json): mx_fractal_noise_float,
 * mx_noise_float, mx_worley_noise_float/vec2/vec3, mx_cell_noise_float all
 * present. vec2 worley = (F1, F2) — verified visually in the bench
 * (worley-f2f1 entry: y−x darkens at cell borders).
 */
export const mxFractalNoise = (TSL) =>
  TSL.mx_fractal_noise_float
    ? (p, octaves, lacunarity, gain) => TSL.mx_fractal_noise_float(p, octaves, lacunarity, gain)
    : null;

export const mxGradientNoise = (TSL) =>
  TSL.mx_noise_float ? (p) => TSL.mx_noise_float(p) : null;

export const mxWorleyFloat = (TSL) =>
  TSL.mx_worley_noise_float ? (p) => TSL.mx_worley_noise_float(p) : null;

export const mxWorleyVec2 = (TSL) =>
  TSL.mx_worley_noise_vec2 ? (p) => TSL.mx_worley_noise_vec2(p) : null;

export const mxCellNoise = (TSL) =>
  TSL.mx_cell_noise_float ? (p) => TSL.mx_cell_noise_float(p) : null;

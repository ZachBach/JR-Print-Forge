/**
 * hashChannels — n independent deterministic hash channels from one seed.
 * Retires the hero's magic-salt zoo (18 distinct literals, docs/INVENTORY.md
 * §1) with a fixed stride.
 *
 * DETERMINISM CONTRACT: the same (seed, channel index) yields the same value
 * in every pass — compute, render, anywhere. The hero relies on this (strand
 * identity is decided in compute and re-derived in the material), so
 * CHANNEL_STRIDE is frozen forever; changing it is a breaking change to every
 * consumer.
 *
 * @param   {object} TSL
 * @param   {Node}   seed  e.g. instanceIndex
 * @param   {number} n     channel count
 * @returns {Node[]} n float nodes in [0, 1)
 * @cost    class ① — one hash per channel
 * @backend wgsl ✓ / glsl ✓ — precision caveat on BACKEND-NOTES watch list;
 *          the parity gate exercises hash-driven value noise on both backends
 */
export const CHANNEL_STRIDE = 7919; // prime — FROZEN, see determinism contract

export const hashChannels = (TSL, seed, n) =>
  Array.from({ length: n }, (_, i) =>
    i === 0 ? TSL.hash(seed) : TSL.hash(seed.add(i * CHANNEL_STRIDE)));

export const source = () => `const [hAngle, hLat, hSize] =
  hashChannels(instanceIndex, 3);`;

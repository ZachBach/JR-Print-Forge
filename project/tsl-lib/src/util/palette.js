/**
 * palette — every brand color in the Aurelius universe as color() nodes.
 * The single source for hexes: node and material code never writes a literal.
 * Four groups, from the Phase 1 census (docs/INVENTORY.md §6).
 *
 * @param   {object} TSL  the THREE.TSL namespace
 * @returns {object} { brand, solar, terra, nebula } — color nodes by name
 * @cost    class ① — constants
 * @backend wgsl ✓ / glsl ✓ — no divergence possible
 */
export const HEX = {
  brand: { gold: 0xF4C95D, cyan: 0x57D4FF, blue: 0x2B6CF6, ice: 0xEAF7FF,
           ember: 0xFF7A1A, void: 0x0A0E14, silver: 0x98A8BE, slate: 0x1E2836,
           mist: 0x9AA7BC },
  solar: { hot: 0xFFF2C9, mid: 0xFFC24D, limb: 0xFF7A1A, ember: 0xFF5A28,
           cmeCore: 0xFFF3D6, cmeTail: 0xFF7A24, swarmWarm: 0xFFB552,
           white: 0xFFFFFF },
  terra: { ocean: 0x2E6BF0, land: 0x27C08A, cloud: 0xEAF3FF, bolt: 0xBFD9FF,
           atmo: 0x7FD4FF, city: 0xFFC97A, ice: 0xE9F3FF, swarmCool: 0x59D6FF },
  nebula: { deep: 0x14264F },
};

export const palette = (TSL) => {
  const out = {};
  for (const [group, colors] of Object.entries(HEX)) {
    out[group] = {};
    for (const [name, hex] of Object.entries(colors)) out[group][name] = TSL.color(hex);
  }
  return out;
};

export const source = () => `const { brand } = palette(TSL);
colorNode = brand.gold; // never a hex literal in material code`;

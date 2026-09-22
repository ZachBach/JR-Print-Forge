/**
 * jr-palette — JR Print Forge brand colors as color() nodes.
 * Same contract as tsl-lib/src/util/palette.js: material code never writes a
 * hex literal, it asks the palette.
 *
 * @param   {object} TSL  the THREE.TSL namespace
 * @returns {object} { forge, metal } — color nodes by name
 * @cost    class ① — constants
 */
export const HEX = {
  forge: { blue: 0x00BFFF, ember: 0xFF6B00, hot: 0xFFC46B, white: 0xF5F5F5 },
  metal: { graphite: 0x1A1A1A, charcoal: 0x252525, steel: 0x6E787E,
           bright: 0xB9C4C9, ground: 0x0B0C0D, oak: 0x2A2018 },
};

export const palette = (TSL) => {
  const out = {};
  for (const [group, colors] of Object.entries(HEX)) {
    out[group] = {};
    for (const [name, hex] of Object.entries(colors)) out[group][name] = TSL.color(hex);
  }
  return out;
};

/**
 * Timing for the sketch-to-print pipeline at realistic sizes.
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON lib/relief/bench.ts
 *
 * Numbers are for Node on the dev machine; a mid-range laptop browser is
 * typically within 1.5× of them. The page rebuilds on every settings change,
 * so build + mesh is the number that decides whether the UI feels live.
 */
import { meshHeightField } from './mesh.ts';
import { artSize, build, DEFAULT_IMAGE, DEFAULTS, planCell, type ProductSpec, type ImageSettings } from './products.ts';
import { to3mf, toStl } from './export.ts';

function napkin(cols: number, rows: number) {
  const g = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const paper = 0.93 - 0.3 * (x / cols);
      // A scribble of overlapping rings, like a doodle.
      let ink = false;
      for (let k = 0; k < 5; k++) {
        const cx = cols * (0.25 + 0.12 * k);
        const cy = rows * (0.35 + 0.07 * (k % 3));
        const d = Math.abs(Math.hypot(x - cx, y - cy) - Math.min(cols, rows) * (0.12 + 0.03 * k));
        if (d < Math.max(1.5, cols * 0.006)) ink = true;
      }
      g[y * cols + x] = ink ? paper - 0.5 : paper;
    }
  }
  return g;
}

function photo(cols: number, rows: number) {
  const g = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      g[y * cols + x] = 0.5 + 0.25 * Math.sin(x / 9) * Math.cos(y / 13) + 0.2 * Math.sin((x + y) / 31);
    }
  }
  return g;
}

const cases: Array<[string, ProductSpec, ImageSettings, number, typeof napkin]> = [
  ['keychain 70 mm @0.3', DEFAULTS.relief, DEFAULT_IMAGE, 0.3, napkin],
  ['plaque 150 mm @0.3', { ...DEFAULTS.relief, width: 150, shape: 'rect' }, DEFAULT_IMAGE, 0.3, napkin],
  ['outline keychain 80 mm @0.2', { ...DEFAULTS.relief, width: 80, shape: 'outline' }, DEFAULT_IMAGE, 0.2, napkin],
  ['cookie cutter 90 mm @0.3', { ...DEFAULTS.cutter, width: 90 }, DEFAULT_IMAGE, 0.3, napkin],
  ['lithophane 120 mm @0.3', DEFAULTS.lithophane, { ...DEFAULT_IMAGE, mode: 'photo' }, 0.3, photo],
  ['lithophane 150 mm @0.2', { ...DEFAULTS.lithophane, width: 150 }, { ...DEFAULT_IMAGE, mode: 'photo' }, 0.2, photo],
];

const ms = (t: number) => `${(performance.now() - t).toFixed(0)} ms`.padStart(7);
const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`.padStart(8);

console.log('case                             grid        build    mesh    tris       stl      3mf   3mf-time');
for (const [name, spec, img, want, source] of cases) {
  const aspect = 4 / 3;
  const cell = planCell(spec, aspect, want);
  const { cols, rows } = artSize(spec, aspect, cell);
  const art = source(cols, rows);
  let t = performance.now();
  const b = build(spec, img, art, cols, rows, cell);
  const tb = ms(t);
  t = performance.now();
  const mesh = meshHeightField(b.field);
  const tm = ms(t);
  const stl = toStl(mesh).byteLength;
  t = performance.now();
  const three = to3mf(mesh, { title: name }).byteLength;
  const tz = ms(t);
  console.log(
    `${name.padEnd(32)} ${`${b.field.cols}×${b.field.rows}`.padEnd(10)} ${tb} ${tm} ${String(mesh.triangles).padStart(8)} ${mb(stl)} ${mb(three)} ${tz}`,
  );
}

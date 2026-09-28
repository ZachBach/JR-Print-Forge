/**
 * Timing and file sizes for the CAD half of the pipeline, at realistic sizes.
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON lib/cad/bench.ts
 *
 * The CAD model is recovered after a build settles rather than on every slider
 * drag, so this number does not have to be interactive — but it does have to stay
 * well under a second, or sending an order feels like it hung. The triangle column
 * is the point of the exercise: the same part, described as faces instead of cells.
 *
 * Pass `--write <dir>` to drop the STEP, DXF and 3MF somewhere openable.
 */
import { meshHeightField } from '../relief/mesh.ts';
import {
  artSize,
  build,
  DEFAULT_IMAGE,
  DEFAULTS,
  planCell,
  type ImageSettings,
  type ProductSpec,
} from '../relief/products.ts';
import { bodyNames, toCad } from './model.ts';
import { bodyFeatures, describeFeatures } from './features.ts';
import { printReport } from './print.ts';
import { toStep } from './step.ts';
import { toDxf } from './dxf.ts';
import { toMulti3mf } from './threemf.ts';

function napkin(cols: number, rows: number) {
  const g = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      // Paper with a shadow across it, the case adaptive thresholding exists for.
      const paper = 0.93 - 0.3 * (x / cols);
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

const photo = (cols: number, rows: number) => {
  const g = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      g[y * cols + x] = 0.5 + 0.25 * Math.sin(x / 9) * Math.cos(y / 13) + 0.2 * Math.sin((x + y) / 31);
    }
  }
  return g;
};

const cases: Array<[string, ProductSpec, ImageSettings, number, typeof napkin]> = [
  ['keychain 70 mm @0.3', DEFAULTS.relief, DEFAULT_IMAGE, 0.3, napkin],
  ['plaque 150 mm @0.3', { ...DEFAULTS.relief, width: 150, shape: 'rect' }, DEFAULT_IMAGE, 0.3, napkin],
  ['outline keychain 80 mm @0.2', { ...DEFAULTS.relief, width: 80, shape: 'outline' }, DEFAULT_IMAGE, 0.2, napkin],
  ['engraved coaster 90 mm @0.2', { ...DEFAULTS.relief, width: 90, shape: 'circle', style: 'engraved' }, DEFAULT_IMAGE, 0.2, napkin],
  ['cookie cutter 90 mm @0.3', { ...DEFAULTS.cutter, width: 90 }, DEFAULT_IMAGE, 0.3, napkin],
  ['lithophane 120 mm @0.3', DEFAULTS.lithophane, { ...DEFAULT_IMAGE, mode: 'photo' }, 0.3, photo],
];

const ms = (t: number) => `${(performance.now() - t).toFixed(0)} ms`.padStart(7);
const kb = (n: number) => `${(n / 1024).toFixed(0)} kB`.padStart(9);

const writeAt = process.argv.indexOf('--write');
const outDir = writeAt >= 0 ? process.argv[writeAt + 1] : null;

console.log(
  'case                          grid       bodies  mesh tris   cad tris    cad    step     dxf     3mf   g',
);
for (const [name, spec, img, want, source] of cases) {
  const aspect = 4 / 3;
  const cell = planCell(spec, aspect, want);
  const { cols, rows } = artSize(spec, aspect, cell);
  const b = build(spec, img, source(cols, rows), cols, rows, cell);
  const mesh = meshHeightField(b.field);

  const t = performance.now();
  const res = toCad(b.field, { names: (n) => bodyNames(spec.kind, n) });
  const tc = ms(t);
  if (!res.ok) {
    console.log(`${name.padEnd(29)} ${`${b.field.cols}×${b.field.rows}`.padEnd(10)} ${'—'.padStart(6)} ${String(mesh.triangles).padStart(10)}   no CAD: ${res.reason.slice(0, 44)}…`);
    continue;
  }
  const { model } = res;
  const step = toStep(model.bodies, { title: name });
  const dxf = toDxf(
    model.bodies.map((x) => ({ name: x.name, profiles: x.profiles, z: x.z1 })),
    { circleTolerance: model.tolerance + model.cell * 0.75 },
  );
  const three = toMulti3mf(
    model.bodies.map((x, i) => ({ name: x.name, mesh: x.mesh, colour: i ? '#FF6B00' : '#2A2C2E', extruder: i + 1 })),
    { title: name },
  );
  const report = printReport(model);
  const featureTol = model.tolerance + model.cell * 0.75;

  console.log(
    `${name.padEnd(29)} ${`${b.field.cols}×${b.field.rows}`.padEnd(10)} ${String(model.bodies.length).padStart(6)} ` +
      `${String(mesh.triangles).padStart(9)} ${String(model.mesh.triangles).padStart(10)} ${tc} ` +
      `${kb(step.length)} ${kb(dxf.length)} ${kb(three.length)} ${report.grams.toFixed(1).padStart(5)}`,
  );
  for (const b2 of model.bodies) {
    const f = describeFeatures(bodyFeatures(b2.profiles, featureTol));
    if (f.length) console.log(`      ${b2.name}: ${f.join(', ')}`);
  }
  for (const w of report.warnings) console.log(`      ! ${w}`);

  if (outDir) {
    const fs = await import('node:fs/promises');
    const slug = name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    await fs.writeFile(`${outDir}/${slug}.step`, step);
    await fs.writeFile(`${outDir}/${slug}.dxf`, dxf);
    await fs.writeFile(`${outDir}/${slug}.3mf`, three);
  }
}

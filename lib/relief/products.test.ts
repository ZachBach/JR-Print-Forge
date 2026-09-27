import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'three/addons/libs/fflate.module.js';
import { meshHeightField } from './mesh.ts';
import { assertWatertight } from './testing.ts';
import { distanceTo, fillHoles, otsu, removeSmall, count } from './raster.ts';
import {
  artSize,
  build,
  DEFAULT_IMAGE,
  DEFAULTS,
  findArt,
  planCell,
  type ImageSettings,
  type ProductSpec,
} from './products.ts';
import { to3mf, toStl } from './export.ts';

/** A synthetic "napkin photo": off-white paper with a shadow gradient and a dark ring drawn on it. */
function napkin(cols: number, rows: number, opts: { gap?: boolean } = {}) {
  const g = new Float32Array(cols * rows);
  const cx = cols / 2;
  const cy = rows / 2;
  const R = Math.min(cols, rows) * 0.32;
  const stroke = Math.max(2, Math.min(cols, rows) * 0.025);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const paper = 0.93 - 0.35 * (x / cols); // shadow across the page
      const d = Math.abs(Math.hypot(x - cx, y - cy) - R);
      const angle = Math.atan2(y - cy, x - cx);
      const broken = opts.gap && Math.abs(angle) < 0.35;
      g[y * cols + x] = d < stroke && !broken ? paper - 0.45 : paper;
    }
  }
  return g;
}

const drawing: ImageSettings = { ...DEFAULT_IMAGE, mode: 'sketch' };
const photo: ImageSettings = { ...DEFAULT_IMAGE, mode: 'photo' };

function make(spec: ProductSpec, img: ImageSettings, source: (c: number, r: number) => Float32Array, cell = 0.4) {
  const { cols, rows } = artSize(spec, 1, cell);
  const b = build(spec, img, source(cols, rows), cols, rows, cell);
  return { ...b, mesh: meshHeightField(b.field) };
}

test('raster: otsu splits a two-tone image between the tones', () => {
  const g = new Float32Array(1000).map((_, i) => (i < 400 ? 0.2 : 0.8));
  const t = otsu(g);
  assert.ok(t > 0.2 && t < 0.8, `threshold ${t}`);
});

test('raster: distance transform is exact on a single seed', () => {
  const m = new Uint8Array(25);
  m[12] = 1; // centre of 5×5
  const d = distanceTo(m, 5, 5, 1);
  assert.equal(d[12], 0);
  assert.ok(Math.abs(d[0] - Math.hypot(2, 2)) < 1e-6);
  assert.equal(d[14], 2);
});

test('raster: fillHoles turns a closed ring solid; removeSmall drops specks', () => {
  const n = 21;
  const ring = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const r = Math.hypot(x - 10, y - 10);
    if (r > 6 && r < 8) ring[y * n + x] = 1;
  }
  const filled = fillHoles(ring, n, n);
  assert.equal(filled[10 * n + 10], 1);
  assert.equal(filled[0], 0);
  const specks = ring.slice();
  specks[0] = 1;
  const clean = removeSmall(specks, n, n, 1, 5);
  assert.equal(clean[0], 0);
  assert.equal(count(clean), count(ring));
});

test('findArt crops a napkin photo to the drawing, through the shadow', () => {
  const g = napkin(200, 160);
  const box = findArt(g, 200, 160, drawing);
  assert.ok(box, 'found the drawing');
  // Ring spans roughly 100 ± 51 by 80 ± 51 (plus stroke and padding).
  assert.ok(box!.x > 30 && box!.x < 60, `x ${box!.x}`);
  assert.ok(box!.w > 90 && box!.w < 140, `w ${box!.w}`);
});

test('relief keychain: watertight, right size, hole through the tab', () => {
  const spec = { ...DEFAULTS.relief, width: 60, shape: 'rounded' as const, hole: true };
  const { mesh, field, warnings } = make(spec, drawing, napkin);
  assertWatertight(mesh);
  assert.ok(Math.abs(mesh.size[0] - 60) < 1, `width ${mesh.size[0]}`);
  assert.ok(Math.abs(mesh.size[2] - (spec.base + spec.relief)) < 1e-3, `height ${mesh.size[2]}`);
  // A hole is an enclosed empty region: filling holes adds cells.
  assert.ok(count(fillHoles(field.mask, field.cols, field.rows)) > count(field.mask), 'has a hole');
  assert.deepEqual(warnings, []);
});

test('relief: every shape and both styles stay watertight', () => {
  for (const shape of ['rect', 'rounded', 'circle', 'outline'] as const) {
    for (const style of ['raised', 'engraved'] as const) {
      const spec = { ...DEFAULTS.relief, width: 40, shape, style };
      const { mesh } = make(spec, drawing, napkin, 0.5);
      assertWatertight(mesh);
      assert.ok(mesh.volume > 0, `${shape}/${style}`);
    }
  }
});

test('relief from a photo uses tones, not ink', () => {
  const spec = { ...DEFAULTS.relief, width: 40, shape: 'rect' as const, border: 0, hole: false };
  const ramp = (c: number, r: number) => new Float32Array(c * r).map((_, i) => (i % c) / c);
  const { mesh } = make(spec, photo, ramp, 0.5);
  assertWatertight(mesh);
});

test('lithophane: thickness spans min..max, frame at max', () => {
  const spec = { ...DEFAULTS.lithophane, width: 60 };
  const ramp = (c: number, r: number) => new Float32Array(c * r).map((_, i) => (i % c) / (c - 1));
  const { mesh, field } = make(spec, photo, ramp, 0.4);
  assertWatertight(mesh);
  let lo = Infinity;
  let hi = 0;
  for (let k = 0; k < field.height.length; k++) {
    if (!field.mask[k]) continue;
    lo = Math.min(lo, field.height[k]);
    hi = Math.max(hi, field.height[k]);
  }
  assert.ok(Math.abs(lo - spec.minThickness) < 0.05, `min ${lo}`);
  assert.ok(Math.abs(hi - spec.maxThickness) < 1e-6, `max ${hi}`);
});

test('cookie cutter from a closed sketch: open middle, wall at full height', () => {
  const spec = DEFAULTS.cutter;
  const { mesh, field, warnings } = make(spec, drawing, napkin);
  assertWatertight(mesh);
  const c = Math.floor(field.rows / 2) * field.cols + Math.floor(field.cols / 2);
  assert.equal(field.mask[c], 0, 'middle is open');
  assert.ok(Math.abs(mesh.size[2] - spec.height) < 1e-3);
  assert.deepEqual(warnings, []);
});

test('cookie cutter warns when the outline is not closed', () => {
  const spec = { ...DEFAULTS.cutter, gapClose: 0.5 };
  const { warnings, mesh } = make(spec, drawing, (c, r) => napkin(c, r, { gap: true }));
  assertWatertight(mesh);
  assert.ok(warnings.some((w) => w.includes("doesn't close")), warnings.join(' | '));
});

test('a blank page warns instead of producing nonsense', () => {
  const spec = { ...DEFAULTS.relief, width: 40 };
  const blank = (c: number, r: number) => new Float32Array(c * r).fill(0.92);
  const { warnings, mesh } = make(spec, drawing, blank, 0.5);
  assert.ok(warnings.some((w) => w.startsWith('No lines found')));
  assertWatertight(mesh);
});

test('planCell coarsens only when the grid would be too large', () => {
  assert.equal(planCell(DEFAULTS.relief, 1, 0.3), 0.3);
  const huge = { ...DEFAULTS.lithophane, width: 400 };
  assert.ok(planCell(huge, 0.5, 0.2) > 0.2);
});

test('exports: STL size matches; 3MF unzips to a valid model with every vertex and triangle', () => {
  const { mesh } = make({ ...DEFAULTS.relief, width: 30 }, drawing, napkin, 0.5);
  const stl = toStl(mesh);
  assert.equal(stl.byteLength, 84 + 50 * mesh.triangles);
  assert.equal(new DataView(stl).getUint32(80, true), mesh.triangles);

  const files = unzipSync(to3mf(mesh, { title: 'Test & <keychain>' }));
  assert.ok(files['[Content_Types].xml'] && files['_rels/.rels']);
  const xml = strFromU8(files['3D/3dmodel.model']);
  assert.ok(xml.includes('unit="millimeter"'));
  assert.ok(xml.includes('Test &amp; &lt;keychain&gt;'));
  assert.equal(xml.match(/<vertex /g)?.length, mesh.positions.length / 3);
  assert.equal(xml.match(/<triangle /g)?.length, mesh.triangles);
});

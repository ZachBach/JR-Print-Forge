import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'three/addons/libs/fflate.module.js';
import type { HeightField } from '../relief/mesh.ts';
import { toCad, type CadModel } from './model.ts';
import { toStep } from './step.ts';
import { toDxf } from './dxf.ts';
import { toMulti3mf } from './threemf.ts';
import { printReport, LAYER } from './print.ts';
import { assertStepSolid, parseStep, stepAll } from './testing.ts';
import { pointCount } from './polygon.ts';

function field(cols: number, rows: number, cell: number, fn: (i: number, j: number) => number): HeightField {
  const height = new Float32Array(cols * rows);
  const mask = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const h = fn(i, j);
      if (h > 0) {
        height[j * cols + i] = h;
        mask[j * cols + i] = 1;
      }
    }
  }
  return { cols, rows, cell, height, mask };
}

/** A plate with a hole in it and a raised cross on top — two levels, one hole. */
function keychain(): CadModel {
  const res = toCad(
    field(80, 50, 0.4, (i, j) => {
      if (i < 3 || i >= 77 || j < 3 || j >= 47) return 0;
      if (Math.hypot(i - 9, j - 25) < 4) return 0; // keyring hole
      const bar = Math.abs(j - 25) < 4 && i > 20 && i < 70;
      const post = Math.abs(i - 45) < 4 && j > 12 && j < 38;
      return bar || post ? 3.2 : 2;
    }),
    { names: ['Plate', 'Design'] },
  );
  if (!res.ok) throw new Error(res.reason);
  return res.model;
}

test('a plate is a closed STEP solid: refs resolve, shell closed, faces face out', () => {
  const model = keychain();
  assert.equal(model.bodies.length, 2);
  const step = toStep(model.bodies, { title: 'JR keychain', now: '2026-09-27T00:00:00' });
  const { solids, faces, edges } = assertStepSolid(step);
  assert.deepEqual(solids, ['Plate', 'Design']);
  // Two caps plus one side face per outline segment, over both bodies.
  assert.equal(faces, model.segments + 2 * solids.length);
  assert.ok(edges > faces, `${edges} edges for ${faces} faces`);
});

test('STEP declares millimetres and AP214', () => {
  const step = toStep(keychain().bodies, { title: 'Units', now: '2026-09-27T00:00:00' });
  assert.match(step, /FILE_SCHEMA\(\('AUTOMOTIVE_DESIGN/);
  assert.match(step, /SI_UNIT\(\.MILLI\.,\.METRE\.\)/);
  assert.match(step, /^ISO-10303-21;/);
  assert.match(step, /END-ISO-10303-21;\n$/);
  // One part, one shape, and the product structure that hangs off it.
  const recs = parseStep(step);
  assert.equal(stepAll(recs, 'PRODUCT').length, 1);
  assert.equal(stepAll(recs, 'SHAPE_DEFINITION_REPRESENTATION').length, 1);
  assert.equal(stepAll(recs, 'APPLICATION_PROTOCOL_DEFINITION').length, 1);
});

test('a hole in the plate is an inner loop of the cap face, not a separate solid', () => {
  const model = keychain();
  assert.equal(model.bodies[0].profiles.length, 1);
  assert.equal(model.bodies[0].profiles[0].holes.length, 1, 'the keyring hole');
  const recs = parseStep(toStep([model.bodies[0]], { title: 'Plate', now: '2026-09-27T00:00:00' }));
  assert.equal(stepAll(recs, 'MANIFOLD_SOLID_BREP').length, 1);
  // The hole is an inner bound on the top cap and on the bottom cap — two in all,
  // rather than a second solid sitting inside the first.
  assert.equal(stepAll(recs, 'FACE_BOUND').length, 2, 'one inner bound on each cap');
  assert.equal(stepAll(recs, 'FACE_OUTER_BOUND').length, stepAll(recs, 'ADVANCED_FACE').length);
});

test('every STEP coordinate is a real, never a bare integer', () => {
  const step = toStep(keychain().bodies, { title: 'Reals', now: '2026-09-27T00:00:00' });
  // parseStep's tuple reader asserts this for every point and direction it
  // touches; assertStepSolid walks all of them.
  assertStepSolid(step);
  assert.ok(!/CARTESIAN_POINT\('',\(-?\d+,/.test(step), 'found an integer x coordinate');
});

test('DXF R12 carries one closed polyline per ring, on a layer per body', () => {
  const model = keychain();
  const dxf = toDxf(model.bodies.map((b) => ({ name: b.name, profiles: b.profiles, z: b.z1 })));
  assert.match(dxf, /\$ACADVER\n1\nAC1009\n/);
  assert.match(dxf, /\$INSUNITS\n70\n4\n/);
  assert.ok(dxf.trimEnd().endsWith('EOF'));

  const rings = model.bodies.reduce(
    (n, b) => n + b.profiles.reduce((k, p) => k + 1 + p.holes.length, 0),
    0,
  );
  const polylines = dxf.match(/\n0\nPOLYLINE\n/g)?.length ?? 0;
  assert.equal(polylines, rings, `${polylines} polylines for ${rings} rings`);
  assert.equal(dxf.match(/\n0\nSEQEND\n/g)?.length ?? 0, rings);

  const points = model.bodies.reduce(
    (n, b) => n + b.profiles.reduce((k, p) => k + pointCount(p.outer) + p.holes.reduce((h, r) => h + pointCount(r), 0), 0),
    0,
  );
  assert.equal(dxf.match(/\n0\nVERTEX\n/g)?.length ?? 0, points);
  assert.match(dxf, /\n0\nLAYER\n2\nPLATE\n/);
  assert.match(dxf, /\n0\nLAYER\n2\nDESIGN\n/);
});

test('multi-body 3MF is one object per body with its own colour and extruder', () => {
  const model = keychain();
  const bytes = toMulti3mf(
    model.bodies.map((b, i) => ({
      name: b.name,
      mesh: b.mesh,
      colour: i === 0 ? '#1b1b1b' : '#ff6a13',
      extruder: i + 1,
    })),
    { title: 'Two-colour keychain', description: 'plate + design' },
  );
  const files = unzipSync(bytes);
  assert.ok(files['3D/3dmodel.model'], 'no model part');
  assert.ok(files['[Content_Types].xml']);
  assert.ok(files['_rels/.rels']);
  assert.ok(files['Metadata/model_settings.config'], 'no Bambu object settings');

  const xml = strFromU8(files['3D/3dmodel.model']);
  assert.match(xml, /unit="millimeter"/);
  assert.equal(xml.match(/<object /g)?.length, 2);
  assert.equal(xml.match(/<base /g)?.length, 2);
  assert.equal(xml.match(/<item /g)?.length, 2);
  assert.match(xml, /displaycolor="#1B1B1BFF"/);
  assert.match(xml, /displaycolor="#FF6A13FF"/);
  // Objects reference the material group by index, which is how the colours
  // reach the slicer's filament mapping.
  assert.match(xml, /<object id="2" type="model" name="Plate" pid="1" pindex="0">/);
  assert.match(xml, /<object id="3" type="model" name="Design" pid="1" pindex="1">/);

  const total = model.bodies.reduce((n, b) => n + b.mesh.positions.length / 3, 0);
  assert.equal(xml.match(/<vertex /g)?.length, total);
  const tris = model.bodies.reduce((n, b) => n + b.mesh.triangles, 0);
  assert.equal(xml.match(/<triangle /g)?.length, tris);

  const config = strFromU8(files['Metadata/model_settings.config']);
  assert.match(config, /<object id="2">/);
  assert.match(config, /key="extruder" value="1"/);
  assert.match(config, /key="extruder" value="2"/);
});

test('the print report does the layer arithmetic and flags what will not land', () => {
  const model = keychain();
  const r = printReport(model, { layer: 'standard', material: 'PLA' });
  assert.equal(r.layerHeight, LAYER.standard);
  assert.equal(r.steps.length, 2);
  // 2 mm plate is exactly 10 layers; the 1.2 mm design is exactly 6.
  assert.equal(r.steps[0].whole, 10);
  assert.ok(Math.abs(r.steps[0].off) < 1e-9);
  assert.equal(r.steps[1].whole, 6);
  assert.ok(Math.abs(r.steps[1].off) < 1e-9);
  assert.ok(r.grams > 0 && r.grams < 100, `${r.grams} g`);
  assert.ok(!r.warnings.some((w) => /layers at/.test(w)), r.warnings.join(' | '));
});

test('a step that is not a whole number of layers is called out with both options', () => {
  const res = toCad(field(40, 40, 0.4, (i, j) => (i < 2 || j < 2 || i > 37 || j > 37 ? 0 : 1.3)));
  if (!res.ok) throw new Error(res.reason);
  const r = printReport(res.model, { layer: 'standard' });
  const hit = r.warnings.find((w) => /1\.2 or 1\.4 mm/.test(w));
  assert.ok(hit, r.warnings.join(' | '));
});

test('a part too big for the plate is reported against that plate', () => {
  // 300 × 300 mm: inside the H2D's plate, well outside a 256 mm machine's.
  const res = toCad(field(200, 200, 1.5, () => 2), { tolerance: 0.1 });
  if (!res.ok) throw new Error(res.reason);
  const big = printReport(res.model, { plate: 'x1' });
  assert.ok(big.warnings.some((w) => /X1C \/ P1S \/ A1 plate/.test(w)), big.warnings.join(' | '));
  const h2d = printReport(res.model, { plate: 'h2d' });
  assert.ok(!h2d.warnings.some((w) => /does not fit/.test(w)), h2d.warnings.join(' | '));
});

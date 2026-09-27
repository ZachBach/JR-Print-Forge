import { test } from 'node:test';
import assert from 'node:assert/strict';
import { meshHeightField, type HeightField } from './mesh.ts';
import { assertWatertight } from './testing.ts';

/** Seeded PRNG so a failure reproduces. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

test('a flat plate is a closed box with exact volume and very few triangles', () => {
  const m = meshHeightField(field(40, 20, 0.5, () => 2));
  assertWatertight(m);
  assert.ok(Math.abs(m.volume - 40 * 20 * 0.25 * 2) < 1e-3, `volume ${m.volume}`);
  assert.deepEqual(m.size, [20, 10, 2]);
  // Top and bottom collapse to strips: nowhere near 2 × 40 × 20 × 2.
  assert.ok(m.triangles < 600, `${m.triangles} triangles`);
});

test('a ring (plate with a hole) stays closed around the hole', () => {
  const m = meshHeightField(
    field(30, 30, 1, (i, j) => {
      const r = Math.hypot(i - 14.5, j - 14.5);
      return r < 14 && r > 6 ? 3 : 0;
    }),
  );
  assertWatertight(m);
  assert.ok(m.volume > 0);
});

test('corner-only contacts are healed instead of left non-manifold', () => {
  const m = meshHeightField(field(12, 12, 1, (i, j) => ((i + j) % 2 === 0 ? 1.5 : 0)));
  assertWatertight(m);
});

test('random masks and stepped heights are always watertight', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const r = rng(seed);
    const levels = [0, 0.6, 1.2, 2.4];
    const m = meshHeightField(
      field(37, 29, 0.3, () => (r() < 0.3 ? 0 : levels[1 + Math.floor(r() * 3)])),
    );
    assertWatertight(m);
    assert.ok(m.volume > 0, `seed ${seed}: volume ${m.volume}`);
  }
});

test('continuous heights (lithophane-like) are watertight with volume in range', () => {
  const r = rng(99);
  const f = field(50, 40, 0.2, () => 0.8 + r() * 2.2);
  const m = meshHeightField(f);
  assertWatertight(m);
  const area = 50 * 40 * 0.04;
  assert.ok(m.volume >= area * 0.8 && m.volume <= area * 3.0, `volume ${m.volume}`);
});

test('an empty field gives an empty mesh, not a crash', () => {
  const m = meshHeightField(field(5, 5, 1, () => 0));
  assert.equal(m.triangles, 0);
  assert.deepEqual(m.size, [0, 0, 0]);
});

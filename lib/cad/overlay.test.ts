import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HeightField } from '../relief/mesh.ts';
import { toCad } from './model.ts';
import { outlinePaths } from './overlay.ts';

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

const points = (d: string) =>
  [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as [number, number]);

test('the overlay puts the outline back on the cells it came from', () => {
  const cols = 40;
  const rows = 30;
  // A block from cell 5..35 across and 4..26 down.
  const f = field(cols, rows, 0.5, (i, j) => (i >= 5 && i < 35 && j >= 4 && j < 26 ? 2 : 0));
  const res = toCad(f);
  if (!res.ok) throw new Error(res.reason);
  const out = outlinePaths(res.model, cols, rows);

  assert.equal(out.width, cols);
  assert.equal(out.height, rows);
  assert.equal(out.paths.length, 1);
  assert.ok(out.paths[0].startsWith('M'), 'a path must start with a move');
  assert.ok(out.paths[0].endsWith('Z'), 'each ring must close');

  const pts = points(out.paths[0]);
  assert.equal(pts.length, 4, `squared up to ${pts.length} points`);
  const xs = pts.map((p) => p[0]).sort((a, b) => a - b);
  const ys = pts.map((p) => p[1]).sort((a, b) => a - b);
  // Back in cell coordinates with the origin top-left, exactly where the block is.
  assert.deepEqual([xs[0], xs[3]], [5, 35]);
  assert.deepEqual([ys[0], ys[3]], [4, 26]);
});

test('a hole is its own closed subpath inside the body path', () => {
  const f = field(60, 60, 0.4, (i, j) => {
    if (i < 5 || i >= 55 || j < 5 || j >= 55) return 0;
    return Math.hypot(i - 29.5, j - 29.5) < 8 ? 0 : 2;
  });
  const res = toCad(f);
  if (!res.ok) throw new Error(res.reason);
  const out = outlinePaths(res.model, 60, 60);
  assert.equal(out.paths.length, 1);
  // Two subpaths: the plate and the hole in it.
  assert.equal(out.paths[0].match(/M/g)?.length, 2);
  assert.equal(out.paths[0].match(/Z/g)?.length, 2);
  // Everything lands inside the grid, so nothing is drawn off the thumbnail.
  for (const [x, y] of points(out.paths[0])) {
    assert.ok(x >= 0 && x <= 60 && y >= 0 && y <= 60, `point ${x},${y} is off the grid`);
  }
});

test('each body gets its own path, bottom up', () => {
  const f = field(50, 40, 0.4, (i, j) => {
    if (i < 3 || i >= 47 || j < 3 || j >= 37) return 0;
    return Math.abs(j - 20) < 6 ? 3.2 : 2;
  });
  const res = toCad(f);
  if (!res.ok) throw new Error(res.reason);
  const out = outlinePaths(res.model, 50, 40);
  assert.equal(out.paths.length, res.model.bodies.length);
  assert.equal(out.paths.length, 2);
  for (const d of out.paths) assert.ok(d.length > 10, 'every body must draw something');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertWatertight } from '../relief/testing.ts';
import type { HeightField } from '../relief/mesh.ts';
import { contourProfiles, contourRings } from './contour.ts';
import { nest, pointCount, profileArea, signedArea } from './polygon.ts';
import { sharpenRing, simplifyProfile, simplifyRing } from './simplify.ts';
import { triangulateProfile } from './triangulate.ts';
import { extrudeProfile, extrudedVolume, mergeMeshes } from './solid.ts';
import { bodyNames, toCad } from './model.ts';

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

function mask(cols: number, rows: number, fn: (i: number, j: number) => boolean): Uint8Array {
  const m = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) m[j * cols + i] = fn(i, j) ? 1 : 0;
  return m;
}

function field(cols: number, rows: number, cell: number, fn: (i: number, j: number) => number): HeightField {
  const height = new Float32Array(cols * rows);
  const m = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const h = fn(i, j);
      if (h > 0) {
        height[j * cols + i] = h;
        m[j * cols + i] = 1;
      }
    }
  }
  return { cols, rows, cell, height, mask: m };
}

test('the contour of a block sits on the cell boundary, with the corners chamfered', () => {
  const cell = 0.4;
  const m = mask(20, 12, (i, j) => i >= 4 && i < 16 && j >= 2 && j < 10);
  const profiles = contourProfiles(m, 20, 12, cell, { smooth: 0 });
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].holes.length, 0);
  // 12 × 8 cells of 0.4 mm, less the half-cell chamfer the grid puts on each of
  // the four corners (cell² / 8 apiece).
  const block = 12 * cell * 8 * cell;
  assert.ok(Math.abs(profileArea(profiles[0]) - (block - 4 * (cell * cell) / 8)) < 1e-6, `area ${profileArea(profiles[0])}`);
  assert.ok(signedArea(profiles[0].outer) > 0, 'outer ring must be counter-clockwise');
});

test('a rectangle simplifies and squares back up to its four corners', () => {
  const cell = 0.2;
  const m = mask(30, 30, (i, j) => i >= 5 && i < 25 && j >= 5 && j < 25);
  const [p] = contourProfiles(m, 30, 30, cell, { smooth: 0 });
  assert.ok(pointCount(p.outer) > 50, 'raw contour has a point per cell boundary');
  const chamfered = simplifyRing(p.outer, 0.05)!;
  assert.equal(pointCount(chamfered), 8, 'the grid chamfer shows up as four short segments');
  const sharp = sharpenRing(chamfered, cell * 1.2);
  assert.equal(pointCount(sharp), 4, `sharpened to ${pointCount(sharp)} points`);
  // 20 cells of 0.2 mm square, exactly — the corners are back.
  assert.ok(Math.abs(Math.abs(signedArea(sharp)) - 16) < 1e-9, `area ${signedArea(sharp)}`);
});

test('a ring comes back as one profile with one hole, wound opposite', () => {
  const m = mask(40, 40, (i, j) => {
    const r = Math.hypot(i - 19.5, j - 19.5);
    return r < 18 && r > 8;
  });
  const profiles = contourProfiles(m, 40, 40, 0.25, { smooth: 0.25 });
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].holes.length, 1);
  assert.ok(signedArea(profiles[0].outer) > 0, 'outer counter-clockwise');
  assert.ok(signedArea(profiles[0].holes[0]) < 0, 'hole clockwise');
  const annulus = Math.PI * (18 * 18 - 8 * 8) * 0.25 * 0.25;
  const got = profileArea(profiles[0]);
  assert.ok(Math.abs(got - annulus) / annulus < 0.03, `area ${got} vs ${annulus}`);
});

test('an island inside a hole reads as solid again, not as a hole', () => {
  const m = mask(60, 60, (i, j) => {
    const r = Math.hypot(i - 29.5, j - 29.5);
    return r < 28 && !(r > 10 && r < 20);
  });
  const profiles = contourProfiles(m, 60, 60, 0.2, { smooth: 0 });
  assert.equal(profiles.length, 2, 'the disc and the island are two profiles');
  assert.equal(profiles.filter((p) => p.holes.length === 1).length, 1);
  for (const p of profiles) {
    assert.ok(signedArea(p.outer) > 0);
    for (const h of p.holes) assert.ok(signedArea(h) < 0);
  }
});

test('triangulation covers the profile exactly, holes included', () => {
  const m = mask(40, 40, (i, j) => {
    const inner = i >= 15 && i < 25 && j >= 15 && j < 25;
    return i >= 5 && i < 35 && j >= 5 && j < 35 && !inner;
  });
  const [p] = contourProfiles(m, 40, 40, 0.3, { smooth: 0 });
  const s = simplifyProfile(p, 0.05, 0.36)!;
  assert.equal(s.holes.length, 1);
  const tri = triangulateProfile(s);
  assert.ok(tri, 'square with a square hole must triangulate');
  const n = tri!.points.length / 2;
  // A polygon with h holes takes at most n + 2h − 2 triangles; collinear
  // vertices get dropped along the way, so fewer is fine — what has to hold is
  // that the triangles cover the profile exactly, which triangulateProfile
  // checks by area before returning anything at all.
  assert.ok(tri!.indices.length / 3 <= n + 2 * s.holes.length - 2, `${tri!.indices.length / 3} triangles for n=${n}`);
  let area = 0;
  for (let k = 0; k < tri!.indices.length; k += 3) {
    const [a, b, c] = [tri!.indices[k] * 2, tri!.indices[k + 1] * 2, tri!.indices[k + 2] * 2];
    const pts = tri!.points;
    area += ((pts[b] - pts[a]) * (pts[c + 1] - pts[a + 1]) - (pts[c] - pts[a]) * (pts[b + 1] - pts[a + 1])) / 2;
  }
  assert.ok(Math.abs(area - profileArea(s)) < 1e-6, `covered ${area} of ${profileArea(s)}`);
});

test('an extruded profile is a watertight solid of the right volume', () => {
  const m = mask(50, 30, (i, j) => {
    const inner = Math.hypot(i - 25, j - 15) < 5;
    return i >= 2 && i < 48 && j >= 2 && j < 28 && !inner;
  });
  const [p] = contourProfiles(m, 50, 30, 0.4, { smooth: 0.4 });
  const s = simplifyProfile(p, 0.08)!;
  const mesh = extrudeProfile(s, 0, 2.4)!;
  assert.ok(mesh, 'must extrude');
  assertWatertight(mesh);
  const want = extrudedVolume([s], 0, 2.4);
  assert.ok(Math.abs(mesh.volume - want) / want < 1e-3, `volume ${mesh.volume} vs ${want}`);
  assert.ok(Math.abs(mesh.size[2] - 2.4) < 1e-5);
  // The same part through the cell-by-cell mesher would be tens of thousands.
  assert.ok(mesh.triangles < 400, `${mesh.triangles} triangles`);
});

test('a two-level relief becomes a base body and a design body', () => {
  const f = field(60, 40, 0.3, (i, j) => {
    if (i < 2 || i >= 58 || j < 2 || j >= 38) return 0;
    const stroke = Math.abs(i - j - 8) < 3 || Math.abs(i + j - 50) < 3;
    return stroke ? 3.2 : 2;
  });
  const res = toCad(f, { tolerance: 0.06, smooth: 0.3, names: ['Base', 'Design'] });
  if (!res.ok) throw new Error(res.reason);
  const { model } = res;
  assert.equal(model.bodies.length, 2);
  assert.deepEqual(
    model.bodies.map((b) => b.name),
    ['Base', 'Design'],
  );
  assert.deepEqual(model.levels, [2, 3.2]);
  assert.equal(model.bodies[0].z0, 0);
  assert.equal(model.bodies[0].z1, 2);
  assert.equal(model.bodies[1].z0, 2);
  assert.equal(model.bodies[1].z1, 3.2);
  for (const b of model.bodies) assertWatertight(b.mesh);
  assertWatertight(model.mesh);
  // The plate is 56 × 36 cells of 0.3 mm, 2 mm thick, and the strokes sit on it.
  const plate = 56 * 0.3 * 36 * 0.3 * 2;
  assert.ok(Math.abs(model.bodies[0].mesh.volume - plate) / plate < 0.02, `base ${model.bodies[0].mesh.volume}`);
  assert.ok(model.bodies[1].mesh.volume > 0);
  assert.ok(model.segments > 8 && model.segments < 2000, `${model.segments} segments`);
});

test('a continuous relief is refused with a reason, not mangled', () => {
  const r = rng(7);
  const f = field(40, 40, 0.25, () => 1 + r() * 2);
  const res = toCad(f);
  assert.equal(res.ok, false);
  assert.match((res as { reason: string }).reason, /thickness|lithophane/i);
});

test('an empty field is refused', () => {
  assert.equal(toCad(field(10, 10, 0.3, () => 0)).ok, false);
});

test('blobby random masks extrude watertight, or decline cleanly', () => {
  let built = 0;
  for (let seed = 1; seed <= 24; seed++) {
    const r = rng(seed);
    // A few overlapping discs: convoluted outlines with holes, but not noise.
    const discs = Array.from({ length: 5 }, () => ({
      x: 6 + r() * 28,
      y: 6 + r() * 28,
      r: 3 + r() * 7,
    }));
    const m = mask(40, 40, (i, j) => discs.some((d) => Math.hypot(i - d.x, j - d.y) < d.r));
    const profiles = nest(contourRings(m, 40, 40, 0.35, { smooth: 0.35 }));
    for (const raw of profiles) {
      const s = simplifyProfile(raw, 0.09);
      if (!s) continue;
      const mesh = extrudeProfile(s, 0, 1.6);
      if (!mesh) continue;
      assertWatertight(mesh);
      const want = extrudedVolume([s], 0, 1.6);
      assert.ok(Math.abs(mesh.volume - want) / want < 1e-3, `seed ${seed}: volume ${mesh.volume} vs ${want}`);
      built++;
    }
  }
  assert.ok(built >= 24, `only ${built} solids built across 24 seeds`);
});

test('bodies are named for the product, but only when the level count matches', () => {
  assert.deepEqual(bodyNames('relief', 2), ['Plate', 'Design']);
  assert.deepEqual(bodyNames('cutter', 2), ['Grip lip', 'Cutting wall']);
  assert.deepEqual(bodyNames('lithophane', 1), ['Panel']);
  // A relief that came out with three levels gets neutral labels rather than two
  // right names and one wrong one.
  assert.deepEqual(bodyNames('relief', 3), ['Level 1', 'Level 2', 'Level 3']);
});

test('merging keeps every triangle and sums the volume', () => {
  const m = mask(20, 20, (i, j) => i >= 2 && i < 18 && j >= 2 && j < 18);
  const [p] = contourProfiles(m, 20, 20, 0.5, { smooth: 0 });
  const s = simplifyProfile(p, 0.05)!;
  const a = extrudeProfile(s, 0, 1)!;
  const b = extrudeProfile(s, 1, 2.5)!;
  const merged = mergeMeshes([a, b]);
  assert.equal(merged.triangles, a.triangles + b.triangles);
  assert.ok(Math.abs(merged.volume - (a.volume + b.volume)) < 1e-6);
  assert.ok(Math.abs(merged.size[2] - 2.5) < 1e-6);
});

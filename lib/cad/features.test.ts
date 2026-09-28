import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contourProfiles } from './contour.ts';
import { simplifyProfile } from './simplify.ts';
import { asCircle, bodyFeatures, describeFeatures, fitCircle } from './features.ts';
import { toDxf } from './dxf.ts';
import { toCad } from './model.ts';
import type { HeightField } from '../relief/mesh.ts';
import type { Ring } from './polygon.ts';

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

/** An exact circle of `n` points, for checking the fit against known truth. */
function circleRing(cx: number, cy: number, r: number, n: number): Ring {
  const out: Ring = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  return out;
}

test('the circle fit recovers a known centre and radius exactly', () => {
  const [cx, cy, r, n] = [12.5, -7.25, 4.75, 40];
  const fit = fitCircle(circleRing(cx, cy, r, n))!;
  assert.ok(fit, 'must fit');
  assert.ok(Math.abs(fit.cx - cx) < 1e-6, `cx ${fit.cx}`);
  assert.ok(Math.abs(fit.cy - cy) < 1e-6, `cy ${fit.cy}`);
  assert.ok(Math.abs(fit.r - r) < 1e-6, `r ${fit.r}`);
  // The vertices are exactly on the circle, so the whole residual is the bow of
  // the chords between them: r(1 − cos(π/n)), 0.015 mm here.
  const sagitta = r * (1 - Math.cos(Math.PI / n));
  assert.ok(Math.abs(fit.residual - sagitta) < 1e-9, `residual ${fit.residual} vs sagitta ${sagitta}`);
});

test('a square is not mistaken for a circle', () => {
  // A square inscribes a circle 29% of its half-diagonal away; that must not pass.
  const square: Ring = [0, 0, 10, 0, 10, 10, 0, 10];
  assert.equal(asCircle(square, 1), null);
  const octagon: Ring = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    octagon.push(10 * Math.cos(a), 10 * Math.sin(a));
  }
  // An octagon is within 0.76 mm of its circle: a circle at 1 mm, not at 0.5.
  assert.ok(asCircle(octagon, 1));
  assert.equal(asCircle(octagon, 0.5), null);
});

test('a traced keyring hole reads back as its nominal diameter', () => {
  const cell = 0.3;
  // A 5 mm hole punched in a plate, exactly as products.ts rasterises one.
  const R = 2.5 / cell;
  const m = mask(80, 80, (i, j) => {
    const inside = i >= 5 && i < 75 && j >= 5 && j < 75;
    return inside && Math.hypot(i - 39.5, j - 39.5) > R;
  });
  const [p] = contourProfiles(m, 80, 80, cell, { smooth: 0 });
  const s = simplifyProfile(p, 0.15, cell * 1.2)!;
  assert.equal(s.holes.length, 1);
  const fit = asCircle(s.holes[0], 0.15 + cell * 0.75);
  assert.ok(fit, 'the hole should read as round');
  // Ø5 mm, recovered from a 0.3 mm grid to well inside a quarter millimetre.
  assert.ok(Math.abs(fit!.r * 2 - 5) < 0.25, `Ø${(fit!.r * 2).toFixed(2)} mm`);

  const described = describeFeatures(bodyFeatures([s], 0.15 + cell * 0.75));
  assert.ok(
    described.some((d) => /^1 round hole Ø[45](\.\d+)? mm$/.test(d)),
    described.join(' | '),
  );
});

test('equal holes are grouped in one line, shaped ones counted separately', () => {
  const round = [circleRing(0, 0, 2.5, 32), circleRing(20, 0, 2.5, 32)].map((r) => r.slice().reverse());
  const shaped: Ring = [0, 30, 4, 30, 4, 34, 2, 36, 0, 34];
  const out = describeFeatures(
    bodyFeatures([{ outer: [-10, -10, 40, -10, 40, 40, -10, 40], holes: [...round, shaped] }], 0.2),
  );
  assert.ok(out.some((d) => d === '2 round holes Ø5 mm'), out.join(' | '));
  assert.ok(out.some((d) => d === '1 shaped opening'), out.join(' | '));
});

test('DXF writes a round hole as a CIRCLE, and a shaped one as a polyline', () => {
  const cell = 0.3;
  const R = 2.5 / cell;
  const m = mask(80, 80, (i, j) => {
    const inside = i >= 5 && i < 75 && j >= 5 && j < 75;
    return inside && Math.hypot(i - 39.5, j - 39.5) > R;
  });
  const [p] = contourProfiles(m, 80, 80, cell, { smooth: 0 });
  const s = simplifyProfile(p, 0.15, cell * 1.2)!;
  const body = [{ name: 'Plate', profiles: [s], z: 2 }];

  const withCircles = toDxf(body, { circleTolerance: 0.15 + cell * 0.75 });
  assert.equal(withCircles.match(/\n0\nCIRCLE\n/g)?.length, 1, 'the hole is a CIRCLE');
  assert.equal(withCircles.match(/\n0\nPOLYLINE\n/g)?.length, 1, 'the square plate stays a polyline');
  // Group 40 is the radius.
  const radius = Number(withCircles.match(/\n0\nCIRCLE\n(?:\d+\n[^\n]*\n)*?40\n([\d.-]+)\n/)![1]);
  assert.ok(Math.abs(radius * 2 - 5) < 0.25, `Ø${(radius * 2).toFixed(2)} mm`);

  // Off by default, so nothing changes for callers that did not ask.
  const plain = toDxf(body);
  assert.equal(plain.match(/\n0\nCIRCLE\n/g), null);
  assert.equal(plain.match(/\n0\nPOLYLINE\n/g)?.length, 2);
});

test('every body sits on the one below it — no floating geometry', () => {
  // Stacked pads are built from "height >= this level", so each body's footprint
  // is contained in the next one down. Nothing can print in mid-air.
  const res = toCad(
    field(70, 50, 0.4, (i, j) => {
      if (i < 3 || i >= 67 || j < 3 || j >= 47) return 0;
      if (Math.hypot(i - 10, j - 25) < 5) return 0;
      return Math.abs(j - 25) < 5 && i > 20 ? 3.2 : 2;
    }),
  );
  if (!res.ok) throw new Error(res.reason);
  const { bodies } = res.model;
  assert.ok(bodies.length >= 2);
  for (let k = 1; k < bodies.length; k++) {
    assert.equal(bodies[k].z0, bodies[k - 1].z1, 'bodies must stack without a gap');
    const below = bodies[k - 1].mesh;
    const above = bodies[k].mesh;
    // Everything above is inside the footprint below it, to within a cell.
    const bounds = (m: typeof below, axis: 0 | 1) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = axis; i < m.positions.length; i += 3) {
        if (m.positions[i] < lo) lo = m.positions[i];
        if (m.positions[i] > hi) hi = m.positions[i];
      }
      return [lo, hi];
    };
    for (const axis of [0, 1] as const) {
      const [blo, bhi] = bounds(below, axis);
      const [alo, ahi] = bounds(above, axis);
      assert.ok(alo >= blo - 0.4 && ahi <= bhi + 0.4, `body ${k} overhangs on axis ${axis}`);
    }
  }
});

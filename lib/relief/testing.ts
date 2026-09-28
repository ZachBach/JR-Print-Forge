/** Test-only helpers for the relief pipeline. */
import assert from 'node:assert/strict';
import type { Mesh } from './mesh.ts';

/**
 * Closed and consistently oriented: every directed edge appears exactly once
 * and its reverse exactly once. Also rejects zero-area triangles.
 */
export function assertWatertight(m: Mesh) {
  const nv = m.positions.length / 3;
  const edges = new Map<number, number>();
  const p = m.positions;
  for (let k = 0; k < m.indices.length; k += 3) {
    const t = [m.indices[k], m.indices[k + 1], m.indices[k + 2]];
    for (let e = 0; e < 3; e++) {
      const a = t[e];
      const b = t[(e + 1) % 3];
      assert.notEqual(a, b, 'triangle repeats a vertex');
      const key = a * nv + b;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
    const [a, b, c] = t.map((i) => i * 3);
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    assert.ok(cx * cx + cy * cy + cz * cz > 1e-12, `zero-area triangle at ${k / 3}`);
  }
  for (const [key, n] of edges) {
    assert.equal(n, 1, 'directed edge used twice — inconsistent winding');
    const a = Math.floor(key / nv);
    const b = key % nv;
    assert.equal(edges.get(b * nv + a), 1, `edge ${a}→${b} has no twin — mesh is open`);
  }
}

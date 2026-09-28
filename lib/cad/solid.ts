/**
 * Profile → solid. The CAD equivalent of a pad: sweep a closed 2D profile
 * between two Z planes and cap both ends.
 *
 * The walls are one quad per profile segment instead of one per grid cell, so a
 * straight edge is two triangles however long it is. A keychain that the
 * height-field mesher writes as ~40 000 triangles comes out in the low hundreds,
 * and every facet corresponds to a face a CAD tool can select.
 *
 * Watertightness is structural: the caps and the walls index the same points, so
 * each vertical edge is shared by two wall quads, each cap edge by one wall quad
 * and one cap triangle, and each interior diagonal by two cap triangles.
 */
import type { Mesh } from '../relief/mesh.ts';
import { signedArea, type Profile } from './polygon.ts';
import { triangulateProfile } from './triangulate.ts';

/** The index range each ring of a profile occupies in the flattened points. */
function ranges(p: Profile): [number, number][] {
  const out: [number, number][] = [];
  let at = p.outer.length / 2;
  out.push([0, at]);
  for (const h of p.holes) {
    const n = h.length / 2;
    out.push([at, at + n]);
    at += n;
  }
  return out;
}

/**
 * Extrude one profile from z0 to z1. Returns null when the profile could not be
 * triangulated reliably — the caller falls back rather than exporting a solid
 * with a hole in it.
 */
export function extrudeProfile(p: Profile, z0: number, z1: number): Mesh | null {
  if (!(z1 > z0)) return null;
  const tri = triangulateProfile(p);
  if (!tri) return null;
  const n = tri.points.length / 2;
  const positions = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    const x = tri.points[i * 2];
    const y = tri.points[i * 2 + 1];
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z0;
    positions[(n + i) * 3] = x;
    positions[(n + i) * 3 + 1] = y;
    positions[(n + i) * 3 + 2] = z1;
  }

  const ix: number[] = [];
  // Bridging a hole duplicates a vertex, which can leave a triangle naming the
  // same point twice. It has no area, and dropping it removes a matched pair of
  // opposite edges, so the edge bookkeeping stays balanced.
  for (let k = 0; k < tri.indices.length; k += 3) {
    const a = tri.indices[k];
    const b = tri.indices[k + 1];
    const c = tri.indices[k + 2];
    if (a === b || b === c || c === a) continue;
    ix.push(a, c, b); // bottom cap, wound to face −Z
    ix.push(n + a, n + b, n + c); // top cap, +Z
  }

  // With the outer ring counter-clockwise and holes clockwise, the outward
  // normal of the quad on edge i→j is (dy, −dx) in both cases, so one winding
  // serves every wall.
  for (const [s, e] of ranges(p)) {
    const len = e - s;
    for (let i = s; i < e; i++) {
      const j = s + ((i - s + 1) % len);
      ix.push(i, j, n + j);
      ix.push(i, n + j, n + i);
    }
  }

  const indices = new Uint32Array(ix);
  return { positions, indices, triangles: indices.length / 3, ...measure(positions, indices) };
}

/** Volume by the divergence theorem and the overall extent, as mesh.ts reports. */
function measure(positions: Float32Array, indices: Uint32Array) {
  let volume = 0;
  for (let k = 0; k < indices.length; k += 3) {
    const a = indices[k] * 3;
    const b = indices[k + 1] * 3;
    const c = indices[k + 2] * 3;
    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
    const bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
    const cx = positions[c], cy = positions[c + 1], cz = positions[c + 2];
    volume += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < positions.length; k += 3) {
    for (let e = 0; e < 3; e++) {
      const v = positions[k + e];
      if (v < lo[e]) lo[e] = v;
      if (v > hi[e]) hi[e] = v;
    }
  }
  const empty = positions.length === 0;
  return {
    volume: volume / 6,
    size: (empty ? [0, 0, 0] : [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]]) as [number, number, number],
  };
}

/** Exact extruded volume from the profiles, for checking the mesh against. */
export function extrudedVolume(profiles: Profile[], z0: number, z1: number): number {
  let a = 0;
  for (const p of profiles) {
    a += Math.abs(signedArea(p.outer));
    for (const h of p.holes) a -= Math.abs(signedArea(h));
  }
  return a * (z1 - z0);
}

/** One mesh from several, for preview and single-object export. */
export function mergeMeshes(meshes: Mesh[]): Mesh {
  let nv = 0;
  let ni = 0;
  for (const m of meshes) {
    nv += m.positions.length;
    ni += m.indices.length;
  }
  const positions = new Float32Array(nv);
  const indices = new Uint32Array(ni);
  let vo = 0;
  let io = 0;
  let volume = 0;
  for (const m of meshes) {
    positions.set(m.positions, vo);
    for (let k = 0; k < m.indices.length; k++) indices[io + k] = m.indices[k] + vo / 3;
    vo += m.positions.length;
    io += m.indices.length;
    volume += m.volume;
  }
  const { size } = measure(positions, indices);
  return { positions, indices, triangles: indices.length / 3, volume, size };
}

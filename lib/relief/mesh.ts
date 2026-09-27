/**
 * Height field → closed triangle mesh, in millimetres, Z up, ready to slice.
 *
 * The field is a grid of cells, each either solid (mask 1, with a height) or
 * empty. The result is one watertight, consistently wound solid: a top surface
 * over the solid cells, a flat bottom at z = 0, and vertical walls wherever a
 * solid cell meets an empty one — outer edges, keyring holes, the open middle
 * of a cookie cutter.
 *
 * Three properties the tests hold it to:
 *   - every edge is shared by exactly two triangles, in opposite directions
 *     (closed, 2-manifold, outward normals — what 3MF requires and what
 *     slicers need to not "repair" the part);
 *   - no zero-area triangles;
 *   - flat regions cost almost nothing. A cell whose four corners sit at one
 *     height is merged with its flat row-neighbours into a strip, and only
 *     the vertices other geometry depends on are kept. A plain plate's bottom
 *     is O(W + H) triangles instead of O(W × H), and a drawing's raised lines
 *     and flat background shrink the same way.
 */

export interface HeightField {
  cols: number;
  rows: number;
  /** Cell edge length, mm. */
  cell: number;
  /** Per-cell top height, mm. Ignored where mask is 0. */
  height: Float32Array;
  mask: Uint8Array;
}

export interface Mesh {
  /** xyz triples, mm. XY centred on the origin, bottom at z = 0. */
  positions: Float32Array;
  indices: Uint32Array;
  triangles: number;
  /** Enclosed volume, mm³. */
  volume: number;
  /** Overall extent [x, y, z], mm. */
  size: [number, number, number];
}

/** Solid cells never go thinner than this, so no wall is ever zero-height. */
const MIN_Z = 0.05;

class Tris {
  a: Uint32Array;
  n = 0;
  constructor(capacity: number) {
    this.a = new Uint32Array(Math.max(1024, capacity));
  }
  push(p: number, q: number, r: number) {
    if (this.n + 3 > this.a.length) {
      const b = new Uint32Array(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = p;
    this.a[this.n++] = q;
    this.a[this.n++] = r;
  }
}

/**
 * Two solid cells that touch only at a corner would share a vertical edge
 * among four wall faces — a non-manifold edge. Filling one of the two empty
 * cells of every such 2×2 checkerboard removes the case entirely; at
 * sub-millimetre cells the change is invisible in the print.
 */
function healDiagonals(mask: Uint8Array, h: Float32Array, W: number, H: number) {
  let changed = true;
  while (changed) {
    changed = false;
    for (let j = 0; j < H - 1; j++) {
      for (let i = 0; i < W - 1; i++) {
        const a = j * W + i;
        const b = a + 1;
        const c = a + W;
        const d = c + 1;
        if (mask[a] && mask[d] && !mask[b] && !mask[c]) {
          mask[b] = 1;
          h[b] = Math.min(h[a], h[d]);
          changed = true;
        } else if (mask[b] && mask[c] && !mask[a] && !mask[d]) {
          mask[a] = 1;
          h[a] = Math.min(h[b], h[c]);
          changed = true;
        }
      }
    }
  }
}

export function meshHeightField(field: HeightField): Mesh {
  const { cols: W, rows: H, cell } = field;
  const mask = field.mask.slice();
  const h = field.height.slice();
  healDiagonals(mask, h, W, H);

  // Vertex grid: (W+1) × (H+1). A vertex takes the highest of its solid
  // neighbours, which keeps a one-cell raised line at full height rather than
  // averaging it down into a ridge.
  const VW = W + 1;
  const NV = VW * (H + 1);
  const vz = new Float32Array(NV);
  const vn = new Uint8Array(NV);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const c = j * W + i;
      if (!mask[c]) continue;
      const z = Math.max(h[c], MIN_Z);
      const v = j * VW + i;
      vn[v]++;
      vn[v + 1]++;
      vn[v + VW]++;
      vn[v + VW + 1]++;
      if (z > vz[v]) vz[v] = z;
      if (z > vz[v + 1]) vz[v + 1] = z;
      if (z > vz[v + VW]) vz[v + VW] = z;
      if (z > vz[v + VW + 1]) vz[v + VW + 1] = z;
    }
  }

  const flat = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const c = j * W + i;
      if (!mask[c]) continue;
      const v = j * VW + i;
      const z = vz[v];
      flat[c] = vz[v + 1] === z && vz[v + VW] === z && vz[v + VW + 1] === z ? 1 : 0;
    }
  }

  // Which vertices each surface needs. The top drops a vertex only when all
  // four cells around it are solid and flat (it is then interior to a strip
  // on both rows it touches). The bottom is flat everywhere, so it keeps only
  // boundary vertices — the ones the walls stand on.
  const topIdx = new Int32Array(NV).fill(-1);
  const botIdx = new Int32Array(NV).fill(-1);
  let nv = 0;
  for (let y = 0; y <= H; y++) {
    for (let x = 0; x <= W; x++) {
      const v = y * VW + x;
      const n = vn[v];
      if (!n) continue;
      let interior = false;
      if (n === 4) {
        const a = (y - 1) * W + (x - 1);
        interior = !!(flat[a] && flat[a + 1] && flat[a + W] && flat[a + W + 1]);
      }
      if (!interior) topIdx[v] = nv++;
      if (n < 4) botIdx[v] = nv++;
    }
  }

  const positions = new Float32Array(nv * 3);
  const x0 = (-W * cell) / 2;
  const y0 = (H * cell) / 2;
  for (let y = 0; y <= H; y++) {
    for (let x = 0; x <= W; x++) {
      const v = y * VW + x;
      const px = x0 + x * cell;
      const py = y0 - y * cell;
      const t = topIdx[v];
      if (t >= 0) {
        positions[t * 3] = px;
        positions[t * 3 + 1] = py;
        positions[t * 3 + 2] = vz[v];
      }
      const b = botIdx[v];
      if (b >= 0) {
        positions[b * 3] = px;
        positions[b * 3 + 1] = py;
        positions[b * 3 + 2] = 0;
      }
    }
  }

  const tris = new Tris(W * H * 2);
  const upper: number[] = [];
  const upperX: number[] = [];
  const lower: number[] = [];
  const lowerX: number[] = [];

  /**
   * Triangulate the strip of cells i0..i1 in row j as a zipper between the
   * kept vertices on its upper line and its lower line. Each triangle has two
   * vertices on one line and one on the other, so none is degenerate, and
   * every kept vertex lands on the strip's edge — no T-junctions with the
   * neighbouring strips or walls. `down` flips the winding for the bottom.
   */
  const strip = (j: number, i0: number, i1: number, idx: Int32Array, down: boolean) => {
    upper.length = upperX.length = lower.length = lowerX.length = 0;
    for (let x = i0; x <= i1 + 1; x++) {
      const u = idx[j * VW + x];
      if (u >= 0) {
        upper.push(u);
        upperX.push(x);
      }
      const l = idx[(j + 1) * VW + x];
      if (l >= 0) {
        lower.push(l);
        lowerX.push(x);
      }
    }
    const emit = down
      ? (a: number, b: number, c: number) => tris.push(a, c, b)
      : (a: number, b: number, c: number) => tris.push(a, b, c);
    let p = 0;
    let q = 0;
    const nu = upper.length - 1;
    const nl = lower.length - 1;
    while (p < nu || q < nl) {
      if (q === nl || (p < nu && upperX[p + 1] <= lowerX[q + 1])) {
        emit(upper[p], lower[q], upper[p + 1]);
        p++;
      } else {
        emit(upper[p], lower[q], lower[q + 1]);
        q++;
      }
    }
  };

  // Top surface.
  for (let j = 0; j < H; j++) {
    let i = 0;
    while (i < W) {
      const c = j * W + i;
      if (!mask[c]) {
        i++;
        continue;
      }
      if (!flat[c]) {
        const tl = j * VW + i;
        const TL = topIdx[tl];
        const TR = topIdx[tl + 1];
        const BL = topIdx[tl + VW];
        const BR = topIdx[tl + VW + 1];
        // Split along the diagonal whose ends are closest in height, so a
        // sloped edge follows the drawing instead of zig-zagging across it.
        if (Math.abs(vz[tl] - vz[tl + VW + 1]) <= Math.abs(vz[tl + 1] - vz[tl + VW])) {
          tris.push(TL, BL, BR);
          tris.push(TL, BR, TR);
        } else {
          tris.push(TL, BL, TR);
          tris.push(TR, BL, BR);
        }
        i++;
        continue;
      }
      let i1 = i;
      while (i1 + 1 < W && mask[c + i1 + 1 - i] && flat[c + i1 + 1 - i]) i1++;
      strip(j, i, i1, topIdx, false);
      i = i1 + 1;
    }
  }

  // Bottom: every solid cell is flat at z = 0.
  for (let j = 0; j < H; j++) {
    let i = 0;
    while (i < W) {
      if (!mask[j * W + i]) {
        i++;
        continue;
      }
      let i1 = i;
      while (i1 + 1 < W && mask[j * W + i1 + 1]) i1++;
      strip(j, i, i1, botIdx, true);
      i = i1 + 1;
    }
  }

  // Walls, outward-facing, on every solid/empty cell edge.
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const c = j * W + i;
      if (!mask[c]) continue;
      const tl = j * VW + i;
      const tr = tl + 1;
      const bl = tl + VW;
      const br = bl + 1;
      if (j === 0 || !mask[c - W]) {
        tris.push(botIdx[tr], botIdx[tl], topIdx[tl]);
        tris.push(botIdx[tr], topIdx[tl], topIdx[tr]);
      }
      if (j === H - 1 || !mask[c + W]) {
        tris.push(botIdx[bl], botIdx[br], topIdx[br]);
        tris.push(botIdx[bl], topIdx[br], topIdx[bl]);
      }
      if (i === 0 || !mask[c - 1]) {
        tris.push(botIdx[tl], botIdx[bl], topIdx[bl]);
        tris.push(botIdx[tl], topIdx[bl], topIdx[tl]);
      }
      if (i === W - 1 || !mask[c + 1]) {
        tris.push(botIdx[br], botIdx[tr], topIdx[tr]);
        tris.push(botIdx[br], topIdx[tr], topIdx[br]);
      }
    }
  }

  const indices = tris.a.slice(0, tris.n);

  // Divergence theorem: sum of signed tetrahedra against the origin.
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
      const p = positions[k + e];
      if (p < lo[e]) lo[e] = p;
      if (p > hi[e]) hi[e] = p;
    }
  }
  const empty = positions.length === 0;

  return {
    positions,
    indices,
    triangles: indices.length / 3,
    volume: volume / 6,
    size: empty ? [0, 0, 0] : [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]],
  };
}

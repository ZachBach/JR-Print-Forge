/**
 * Raster operations on row-major grids — the 2D half of the sketch-to-print
 * pipeline. Everything here is a pure function over typed arrays, with no DOM,
 * so the same code runs in the page, in a worker, and under `node --test`.
 *
 * Conventions: a grey grid is a Float32Array in [0, 1] (0 = black); a mask is
 * a Uint8Array of 0/1. Distances are in cells; callers convert from mm.
 */

export type Grey = Float32Array;
export type Mask = Uint8Array;

/** Otsu's threshold for a grey grid: the level that best splits it in two. */
export function otsu(g: Grey): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < g.length; i++) hist[Math.min(255, Math.max(0, Math.round(g[i] * 255)))]++;
  const total = g.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let level = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      level = t;
    }
  }
  return (level + 0.5) / 255;
}

/** Summed-area table, (cols+1) × (rows+1), for O(1) box sums. */
function integral(g: Grey, cols: number, rows: number): Float64Array {
  const W = cols + 1;
  const s = new Float64Array(W * (rows + 1));
  for (let y = 0; y < rows; y++) {
    let run = 0;
    for (let x = 0; x < cols; x++) {
      run += g[y * cols + x];
      s[(y + 1) * W + x + 1] = s[y * W + x + 1] + run;
    }
  }
  return s;
}

/** Mean over a (2r+1)² box around every cell, clipped at the edges. */
export function boxMean(g: Grey, cols: number, rows: number, r: number): Grey {
  const out = new Float32Array(g.length);
  if (r < 1) {
    out.set(g);
    return out;
  }
  const s = integral(g, cols, rows);
  const W = cols + 1;
  for (let y = 0; y < rows; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(rows, y + r + 1);
    for (let x = 0; x < cols; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(cols, x + r + 1);
      const sum = s[y1 * W + x1] - s[y0 * W + x1] - s[y1 * W + x0] + s[y0 * W + x0];
      out[y * cols + x] = sum / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

/**
 * Local-mean threshold: a cell is ink when it is darker than its
 * neighbourhood by more than `c`. This is what makes a phone photo of a napkin
 * usable — the shadow across the paper moves the local mean with it, where a
 * single global level would swallow the shaded half.
 */
export function adaptiveThreshold(
  g: Grey,
  cols: number,
  rows: number,
  radius: number,
  c: number,
): Mask {
  const mean = boxMean(g, cols, rows, radius);
  const out = new Uint8Array(g.length);
  for (let i = 0; i < g.length; i++) out[i] = g[i] < mean[i] - c ? 1 : 0;
  return out;
}

/** Stretch so the given low/high percentiles land on 0 and 1. */
export function stretch(g: Grey, lo = 0.02, hi = 0.98): Grey {
  const hist = new Uint32Array(256);
  for (let i = 0; i < g.length; i++) hist[Math.min(255, Math.max(0, Math.round(g[i] * 255)))]++;
  const find = (q: number) => {
    const target = q * g.length;
    let acc = 0;
    for (let i = 0; i < 256; i++) {
      acc += hist[i];
      if (acc >= target) return i / 255;
    }
    return 1;
  };
  const a = find(lo);
  const b = find(hi);
  const out = new Float32Array(g.length);
  if (b - a < 1e-3) {
    out.set(g);
    return out;
  }
  for (let i = 0; i < g.length; i++) out[i] = Math.min(1, Math.max(0, (g[i] - a) / (b - a)));
  return out;
}

const INF = 1e20;

/** Felzenszwalb–Huttenlocher 1D squared distance transform, in place into d. */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

/**
 * Exact Euclidean distance, in cells, from every cell to the nearest cell whose
 * mask value equals `target`. With `edgeIsTarget` the world outside the grid
 * counts as target too — what erosion and rim-width need, so a shape touching
 * the border is measured against the border.
 */
export function distanceTo(
  m: Mask,
  cols: number,
  rows: number,
  target: 0 | 1 = 1,
  edgeIsTarget = false,
): Float32Array {
  const p = edgeIsTarget ? 1 : 0;
  const W = cols + 2 * p;
  const H = rows + 2 * p;
  const grid = new Float64Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ix = x - p;
      const iy = y - p;
      const inside = ix >= 0 && iy >= 0 && ix < cols && iy < rows;
      const hit = inside ? m[iy * cols + ix] === target : true;
      grid[y * W + x] = hit ? 0 : INF;
    }
  }
  const n = Math.max(W, H);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = grid[y * W + x];
    edt1d(f, H, d, v, z);
    for (let y = 0; y < H; y++) grid[y * W + x] = d[y];
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) f[x] = grid[y * W + x];
    edt1d(f, W, d, v, z);
    for (let x = 0; x < W; x++) grid[y * W + x] = d[x];
  }
  const out = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) out[y * cols + x] = Math.sqrt(grid[(y + p) * W + x + p]);
  }
  return out;
}

/** Grow a mask by a disc of radius r cells. */
export function dilate(m: Mask, cols: number, rows: number, r: number): Mask {
  if (r <= 0) return m.slice();
  const d = distanceTo(m, cols, rows, 1);
  const out = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) out[i] = d[i] <= r ? 1 : 0;
  return out;
}

/** Shrink a mask by a disc of radius r cells; the grid edge counts as outside. */
export function erode(m: Mask, cols: number, rows: number, r: number): Mask {
  if (r <= 0) return m.slice();
  const d = distanceTo(m, cols, rows, 0, true);
  const out = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) out[i] = d[i] > r ? 1 : 0;
  return out;
}

/**
 * Fill every enclosed hole: whatever background cannot reach the grid edge
 * (4-connected) becomes solid. A closed outline becomes its silhouette.
 */
export function fillHoles(m: Mask, cols: number, rows: number): Mask {
  const outside = new Uint8Array(m.length);
  const queue = new Int32Array(m.length);
  let head = 0;
  let tail = 0;
  const seed = (i: number) => {
    if (!m[i] && !outside[i]) {
      outside[i] = 1;
      queue[tail++] = i;
    }
  };
  for (let x = 0; x < cols; x++) {
    seed(x);
    seed((rows - 1) * cols + x);
  }
  for (let y = 0; y < rows; y++) {
    seed(y * cols);
    seed(y * cols + cols - 1);
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % cols;
    if (x > 0) seed(i - 1);
    if (x < cols - 1) seed(i + 1);
    if (i >= cols) seed(i - cols);
    if (i < (rows - 1) * cols) seed(i + cols);
  }
  const out = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) out[i] = outside[i] ? 0 : 1;
  return out;
}

/**
 * Flip every connected region of `value` smaller than `minArea` cells. Ink
 * uses 8-connectivity (a diagonal pen stroke is one stroke); background uses
 * 4, its topological dual.
 */
export function removeSmall(m: Mask, cols: number, rows: number, value: 0 | 1, minArea: number): Mask {
  const out = m.slice();
  if (minArea <= 1) return out;
  const seen = new Uint8Array(m.length);
  const stack = new Int32Array(m.length);
  const region: number[] = [];
  const eight = value === 1;
  for (let start = 0; start < m.length; start++) {
    if (seen[start] || m[start] !== value) continue;
    region.length = 0;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top > 0) {
      const i = stack[--top];
      region.push(i);
      const x = i % cols;
      const y = (i - x) / cols;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= rows) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (!eight && dx !== 0 && dy !== 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= cols) continue;
          const j = ny * cols + nx;
          if (!seen[j] && m[j] === value) {
            seen[j] = 1;
            stack[top++] = j;
          }
        }
      }
    }
    if (region.length < minArea) for (const i of region) out[i] = value ? 0 : 1;
  }
  return out;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Tight bounding box of the set cells, or null when there are none. */
export function bounds(m: Mask, cols: number, rows: number): Box | null {
  let x0 = cols;
  let y0 = rows;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!m[y * cols + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function count(m: Mask): number {
  let n = 0;
  for (let i = 0; i < m.length; i++) n += m[i];
  return n;
}

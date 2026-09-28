/**
 * Runs the sketch-to-print pipeline off the main thread. A rebuild is 50–250
 * ms and a lithophane's 3MF can take seconds (lib/relief/bench.ts); neither
 * should ever freeze a slider.
 *
 * The worker keeps the last mesh it built, so an export writes exactly the
 * geometry on screen without shipping it back across the boundary.
 */
import { build, sizeWarnings, type ImageSettings, type ProductSpec } from '@/lib/relief/products';
import { meshHeightField, type HeightField, type Mesh } from '@/lib/relief/mesh';
import { to3mf, toStl } from '@/lib/relief/export';

export type WorkerRequest =
  | {
      id: number;
      type: 'build';
      spec: ProductSpec;
      img: ImageSettings;
      art: Float32Array;
      cols: number;
      rows: number;
      cell: number;
    }
  | { id: number; type: 'export'; format: '3mf' | 'stl'; title: string; description: string };

export interface Built {
  positions: Float32Array;
  indices: Uint32Array;
  triangles: number;
  volume: number;
  size: [number, number, number];
  warnings: string[];
  /** Top-down height map for the 2D readout, RGBA. */
  thumb: { width: number; height: number; rgba: Uint8ClampedArray };
  ms: number;
}

export type WorkerResponse =
  | ({ id: number; type: 'built' } & Built)
  | { id: number; type: 'exported'; bytes: ArrayBuffer; ms: number }
  | { id: number; type: 'error'; message: string };

let last: Mesh | null = null;

function thumbnail(f: HeightField, max = 240): Built['thumb'] {
  const s = Math.min(1, max / Math.max(f.cols, f.rows));
  const width = Math.max(1, Math.round(f.cols * s));
  const height = Math.max(1, Math.round(f.rows * s));
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k < f.mask.length; k++) {
    if (!f.mask[k]) continue;
    if (f.height[k] < lo) lo = f.height[k];
    if (f.height[k] > hi) hi = f.height[k];
  }
  const span = hi - lo || 1;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const cy = Math.min(f.rows - 1, Math.floor(y / s));
    for (let x = 0; x < width; x++) {
      const k = cy * f.cols + Math.min(f.cols - 1, Math.floor(x / s));
      if (!f.mask[k]) continue;
      const v = 70 + Math.round(((f.height[k] - lo) / span) * 180);
      const o = (y * width + x) * 4;
      rgba[o] = v;
      rgba[o + 1] = v;
      rgba[o + 2] = v;
      rgba[o + 3] = 255;
    }
  }
  return { width, height, rgba };
}

const post = (msg: WorkerResponse, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  const t0 = performance.now();
  try {
    if (req.type === 'build') {
      const b = build(req.spec, req.img, req.art, req.cols, req.rows, req.cell);
      const mesh = meshHeightField(b.field);
      last = mesh;
      const thumb = thumbnail(b.field);
      // Copies go to the page for the preview; the worker keeps the original for export.
      const positions = mesh.positions.slice();
      const indices = mesh.indices.slice();
      post(
        {
          id: req.id,
          type: 'built',
          positions,
          indices,
          triangles: mesh.triangles,
          volume: mesh.volume,
          size: mesh.size,
          warnings: [...b.warnings, ...sizeWarnings(mesh.size)],
          thumb,
          ms: performance.now() - t0,
        },
        [positions.buffer, indices.buffer, thumb.rgba.buffer],
      );
      return;
    }
    if (!last) throw new Error('Nothing to export yet.');
    const bytes =
      req.format === 'stl'
        ? toStl(last, req.title)
        : (to3mf(last, { title: req.title, description: req.description }).buffer as ArrayBuffer);
    post({ id: req.id, type: 'exported', bytes, ms: performance.now() - t0 }, [bytes]);
  } catch (err) {
    post({ id: req.id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};

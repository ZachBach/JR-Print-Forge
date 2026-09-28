/**
 * Runs the sketch-to-print pipeline off the main thread. A rebuild is 50–250
 * ms and a lithophane's 3MF can take seconds (lib/relief/bench.ts); neither
 * should ever freeze a slider.
 *
 * The worker keeps the last mesh it built, so an export writes exactly the
 * geometry on screen without shipping it back across the boundary.
 */
import { build, sizeWarnings, type ImageSettings, type ProductKind, type ProductSpec } from '@/lib/relief/products';
import { meshHeightField, type HeightField, type Mesh } from '@/lib/relief/mesh';
import { to3mf, toStl } from '@/lib/relief/export';
import { bodyNames, toCad, type CadModel } from '@/lib/cad/model';
import { printReport, type LayerKey, type PlateKey } from '@/lib/cad/print';
import { toStep } from '@/lib/cad/step';
import { toDxf } from '@/lib/cad/dxf';
import { toMulti3mf } from '@/lib/cad/threemf';

export type CadFormat = 'step' | 'dxf' | 'cad3mf';

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
  | { id: number; type: 'export'; format: '3mf' | 'stl'; title: string; description: string }
  | {
      id: number;
      type: 'cad';
      tolerance?: number;
      smooth?: number;
      material?: string;
      layer?: LayerKey;
      plate?: PlateKey;
    }
  | {
      id: number;
      type: 'exportCad';
      format: CadFormat;
      title: string;
      description: string;
      /** One per body, bottom up; short lists repeat their last entry. */
      colours: string[];
    };

/** What the page shows about the CAD model; the geometry itself stays here. */
export interface CadSummary {
  bodies: {
    name: string;
    z0: number;
    z1: number;
    /** Straight segments in this body's outlines. */
    segments: number;
    holes: number;
    triangles: number;
    /** Thickness in layers at the chosen layer height. */
    layers: number;
  }[];
  /** Outline simplification tolerance, mm. */
  tolerance: number;
  segments: number;
  triangles: number;
  layerHeight: number;
  /** Solid mass at the chosen material's density, g. */
  grams: number;
  warnings: string[];
  ms: number;
}

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
  | { id: number; type: 'cad'; summary: CadSummary }
  | { id: number; type: 'noCad'; reason: string }
  | { id: number; type: 'error'; message: string };

/** Outline segments past which the CAD model is retraced at a coarser tolerance. */
const SEGMENT_BUDGET = 20_000;

let last: Mesh | null = null;
// The field the last mesh came from, and the CAD model derived from it. Both stay
// in the worker: the page only ever needs the numbers, and an export has to write
// the exact geometry that was measured.
let lastField: HeightField | null = null;
let lastKind: ProductKind = 'relief';
let cad: CadModel | null = null;

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

/** STEP and DXF are text; the transport is bytes either way. */
const strToArrayBuffer = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer as ArrayBuffer;

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  const t0 = performance.now();
  try {
    if (req.type === 'build') {
      const b = build(req.spec, req.img, req.art, req.cols, req.rows, req.cell);
      const mesh = meshHeightField(b.field);
      last = mesh;
      lastField = b.field;
      lastKind = req.spec.kind;
      cad = null;
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
    if (req.type === 'cad') {
      if (!lastField) throw new Error('Nothing to model yet.');
      const names = (n: number) => bodyNames(lastKind, n);
      let res = toCad(lastField, { tolerance: req.tolerance, smooth: req.smooth, names });
      // A fussy drawing can trace into tens of thousands of segments, and a STEP
      // file grows with every one of them. Coarsen and retrace rather than hand
      // the shop a part their CAD tool takes a minute to open.
      for (let pass = 0; pass < 3 && res.ok && res.model.segments > SEGMENT_BUDGET; pass++) {
        res = toCad(lastField, { tolerance: res.model.tolerance * 2, smooth: req.smooth, names });
      }
      if (!res.ok) {
        cad = null;
        post({ id: req.id, type: 'noCad', reason: res.reason });
        return;
      }
      cad = res.model;
      const report = printReport(cad, { layer: req.layer, material: req.material, plate: req.plate });
      post({
        id: req.id,
        type: 'cad',
        summary: {
          bodies: cad.bodies.map((b, i) => ({
            name: b.name,
            z0: b.z0,
            z1: b.z1,
            segments: b.profiles.reduce((n, p) => n + p.outer.length / 2 + p.holes.reduce((h, r) => h + r.length / 2, 0), 0),
            holes: b.profiles.reduce((n, p) => n + p.holes.length, 0),
            triangles: b.mesh.triangles,
            layers: report.steps[i]?.layers ?? 0,
          })),
          tolerance: cad.tolerance,
          segments: cad.segments,
          triangles: cad.mesh.triangles,
          layerHeight: report.layerHeight,
          grams: report.grams,
          warnings: report.warnings,
          ms: performance.now() - t0,
        },
      });
      return;
    }

    if (req.type === 'exportCad') {
      if (!cad) throw new Error('No CAD model for this part.');
      const colour = (i: number) => req.colours[Math.min(i, req.colours.length - 1)] ?? '#808080';
      let bytes: ArrayBuffer;
      if (req.format === 'step') {
        bytes = strToArrayBuffer(toStep(cad.bodies, { title: req.title, description: req.description }));
      } else if (req.format === 'dxf') {
        bytes = strToArrayBuffer(toDxf(cad.bodies.map((b) => ({ name: b.name, profiles: b.profiles, z: b.z1 }))));
      } else {
        bytes = toMulti3mf(
          cad.bodies.map((b, i) => ({ name: b.name, mesh: b.mesh, colour: colour(i), extruder: i + 1 })),
          { title: req.title, description: req.description },
        ).buffer as ArrayBuffer;
      }
      post({ id: req.id, type: 'exported', bytes, ms: performance.now() - t0 }, [bytes]);
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

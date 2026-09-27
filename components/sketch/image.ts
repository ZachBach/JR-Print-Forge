/**
 * Browser-side image handling for the sketch studio: decode an upload once
 * into a working canvas, then resample regions of it to exactly the grid the
 * pipeline asks for. The pipeline itself never touches the DOM.
 */
import type { Box } from '@/lib/relief/raster';

export interface Source {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  name: string;
  /** The original upload, attached to a print request as-is. */
  file: File | null;
}

/** Long side of the working copy. Past this, a phone photo only adds decode time. */
const WORKING = 2048;

export async function loadFile(file: File): Promise<Source> {
  // createImageBitmap applies EXIF orientation by default, so a portrait
  // phone photo of a napkin arrives upright.
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, WORKING / Math.max(bmp.width, bmp.height));
  const width = Math.max(1, Math.round(bmp.width * scale));
  const height = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, width, height);
  bmp.close();
  return { canvas, width, height, name: file.name, file };
}

/**
 * Luminance of a region of the source, resampled to cols × rows, in [0, 1].
 * Transparent pixels read as white paper, so a PNG logo on transparency
 * behaves like one printed on white.
 */
export function greyGrid(src: Source, crop: Box, cols: number, rows: number): Float32Array {
  const c = document.createElement('canvas');
  c.width = cols;
  c.height = rows;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cols, rows);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src.canvas, crop.x, crop.y, crop.w, crop.h, 0, 0, cols, rows);
  const d = ctx.getImageData(0, 0, cols, rows).data;
  const out = new Float32Array(cols * rows);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = (0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]) / 255;
  }
  return out;
}

/** A small whole-image grid for finding where the drawing is. */
export function analysisGrid(src: Source, maxSide = 400) {
  const s = Math.min(1, maxSide / Math.max(src.width, src.height));
  const cols = Math.max(8, Math.round(src.width * s));
  const rows = Math.max(8, Math.round(src.height * s));
  return {
    grey: greyGrid(src, { x: 0, y: 0, w: src.width, h: src.height }, cols, rows),
    cols,
    rows,
    /** Source pixels per analysis cell. */
    scale: src.width / cols,
  };
}

/** Blob of the source as PNG — for uploads the quote form can't take as-is. */
export function toPng(src: Source): Promise<Blob> {
  return new Promise((resolve, reject) =>
    src.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), 'image/png'),
  );
}

/**
 * The sample: a biro heart with "JR" inside, drawn on a slightly shaded
 * napkin so the shadow-proof threshold has something to prove. Our own
 * artwork — nothing to clear.
 */
export function sampleSketch(): Source {
  const width = 900;
  const height = 760;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const paper = ctx.createLinearGradient(0, 0, width, height);
  paper.addColorStop(0, '#f4f1ea');
  paper.addColorStop(1, '#c9c4b8');
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, width, height);

  // Deterministic wobble so the "hand" is the same on every visit.
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647 - 0.5;
  };

  ctx.strokeStyle = '#1b2230';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const stroke = (pts: Array<[number, number]>, w: number) => {
    ctx.lineWidth = w;
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      const jx = x + rand() * 3;
      const jy = y + rand() * 3;
      if (i === 0) ctx.moveTo(jx, jy);
      else ctx.lineTo(jx, jy);
    });
    ctx.stroke();
  };

  // Heart: the classic parametric curve, drawn once round and a little past.
  const heart: Array<[number, number]> = [];
  for (let t = 0; t <= Math.PI * 2 + 0.12; t += 0.02) {
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    heart.push([450 + x * 19, 360 - y * 19]);
  }
  stroke(heart, 13);

  // "JR" in marker strokes.
  const arc = (cx: number, cy: number, r: number, a0: number, a1: number, ry = r) => {
    const pts: Array<[number, number]> = [];
    const n = 24;
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * ry]);
    }
    return pts;
  };
  stroke([[392, 307], [392, 453], ...arc(355, 453, 37, 0, Math.PI)], 15);
  stroke([[455, 485], [455, 307], [490, 307], ...arc(492, 346, 40, -Math.PI / 2, Math.PI / 2, 39), [455, 385]], 15);
  stroke([[488, 385], [540, 485]], 15);

  return { canvas, width, height, name: 'sample-sketch.png', file: null };
}

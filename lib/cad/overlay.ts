/**
 * The CAD outline as something you can look at.
 *
 * Everything else in `lib/cad/` produces files the customer never opens. This
 * produces the one thing they can check: the traced outline, drawn over the
 * height map of their own drawing. If the tracer has closed a gap that should
 * have stayed open, or swallowed a thin stroke, it is visible on the page before
 * anything is ordered — which is worth more than any number in the readout.
 *
 * Output is SVG path data in grid-cell coordinates with the origin at the
 * top-left, matching the thumbnail exactly, so the page only has to set a
 * viewBox and a stroke colour.
 */
import type { CadModel } from './model.ts';

export interface Outline {
  /** viewBox extent, in cells. */
  width: number;
  height: number;
  /** One path per body, bottom up. Each is a closed subpath per ring. */
  paths: string[];
}

/** Centimetre-of-a-cell precision is more than a 72 px thumbnail can show. */
const n = (v: number) => String(Math.round(v * 100) / 100);

/**
 * `toCad` works in millimetres centred on the origin with +Y up; the grid has
 * cell (0,0) at the top-left. This is that change of frame, and nothing else.
 */
export function outlinePaths(model: CadModel, cols: number, rows: number): Outline {
  const paths = model.bodies.map((b) => {
    let d = '';
    for (const p of b.profiles) {
      for (const ring of [p.outer, ...p.holes]) {
        for (let k = 0; k < ring.length; k += 2) {
          const x = ring[k] / model.cell + cols / 2;
          const y = rows / 2 - ring[k + 1] / model.cell;
          d += `${k === 0 ? 'M' : 'L'}${n(x)} ${n(y)}`;
        }
        d += 'Z';
      }
    }
    return d;
  });
  return { width: cols, height: rows, paths };
}

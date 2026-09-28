/**
 * Print engineering for the CAD model: what the slicer is actually going to do
 * with these numbers.
 *
 * A printer does not build a 1.3 mm step; it builds whole layers. At 0.2 mm that
 * step is six and a half layers, so what comes off the plate is 1.2 or 1.4 mm and
 * the design sits at a height nobody chose. Every dimension in the model is
 * checked against the layer height here, and a step that does not land on a layer
 * boundary is reported with the nearest two that do — the fix is to change the
 * number, which only the customer can decide, so this reports rather than snaps.
 *
 * Filament is worked out from the model's own volume, not from a bounding box,
 * and quoted as solid material: a sliced part with sparse infill uses less, so the
 * figure is an upper bound for a part this size.
 */
import { LIMITS } from '../relief/products.ts';
import type { CadModel } from './model.ts';

/** Layer heights a 0.4 mm nozzle runs well. */
export const LAYER = {
  fine: 0.12,
  standard: 0.2,
  draft: 0.28,
} as const;

export type LayerKey = keyof typeof LAYER;

/**
 * Filament density, g/cm³, keyed to the materials the shop quotes in
 * `lib/pricing.ts`. Published figures for unfilled spools; a filled or foaming
 * filament differs, which is why the estimate is labelled as one.
 */
export const DENSITY: Record<string, number> = {
  PLA: 1.24,
  PETG: 1.27,
  ABS: 1.04,
  ASA: 1.07,
  'PA12-CF': 1.06,
  TPU: 1.21,
};

/** Nominal build volumes, mm. Used only to say whether a part fits. */
export const PLATE = {
  h2d: { label: 'H2D', x: 350, y: 320, z: 325 },
  x1: { label: 'X1C / P1S / A1', x: 256, y: 256, z: 256 },
  mini: { label: 'A1 mini', x: 180, y: 180, z: 180 },
} as const;

export type PlateKey = keyof typeof PLATE;

export interface StepPlan {
  name: string;
  /** Height of this step on its own, mm. */
  thickness: number;
  /** Exact number of layers it works out to. */
  layers: number;
  /** Whole layers the slicer will actually put down. */
  whole: number;
  /** How far the step is from a whole number of layers, mm. */
  off: number;
}

export interface PrintReport {
  layerHeight: number;
  steps: StepPlan[];
  /** Solid volume, mm³. */
  volume: number;
  /** Solid mass at the given material's density, grams. */
  grams: number;
  /** Largest plate dimension used, mm: [x, y, z]. */
  size: [number, number, number];
  warnings: string[];
}

const fmt = (n: number, places = 2) => {
  const v = Math.round(n * 10 ** places) / 10 ** places;
  return String(v);
};

export interface PrintOptions {
  layer?: LayerKey | number;
  /** A key of DENSITY; anything else falls back to PLA. */
  material?: string;
  plate?: PlateKey;
}

export function printReport(model: CadModel, opts: PrintOptions = {}): PrintReport {
  const layerHeight = typeof opts.layer === 'number' ? opts.layer : LAYER[opts.layer ?? 'standard'];
  const density = DENSITY[opts.material ?? 'PLA'] ?? DENSITY.PLA;
  const plate = PLATE[opts.plate ?? 'h2d'];
  const warnings: string[] = [];

  const steps: StepPlan[] = model.bodies.map((b) => {
    const thickness = b.z1 - b.z0;
    const layers = thickness / layerHeight;
    const whole = Math.round(layers);
    return { name: b.name, thickness, layers, whole, off: Math.abs(layers - whole) * layerHeight };
  });

  for (const s of steps) {
    if (s.thickness < layerHeight - 1e-9) {
      warnings.push(
        `${s.name} is ${fmt(s.thickness)} mm — thinner than one ${fmt(layerHeight)} mm layer, so it will not print at all. ` +
          `Make it at least ${fmt(layerHeight)} mm.`,
      );
      continue;
    }
    if (s.whole === 1) {
      warnings.push(`${s.name} is a single layer. It will show, but it scratches off easily — two layers is safer.`);
    }
    if (s.off > 1e-6) {
      const down = Math.floor(s.layers) * layerHeight;
      const up = Math.ceil(s.layers) * layerHeight;
      warnings.push(
        `${s.name} is ${fmt(s.thickness)} mm, which is ${fmt(s.layers)} layers at ${fmt(layerHeight)} mm. ` +
          `It will print at ${fmt(down)} or ${fmt(up)} mm — pick one of those if the height matters.`,
      );
    }
  }

  const total = model.levels[model.levels.length - 1] ?? 0;
  const totalLayers = total / layerHeight;
  if (Math.abs(totalLayers - Math.round(totalLayers)) > 1e-6) {
    warnings.push(
      `Overall height ${fmt(total)} mm is ${fmt(totalLayers)} layers. ` +
        `Rounding the part to a multiple of ${fmt(layerHeight)} mm keeps the top surface clean.`,
    );
  }

  const [x, y, z] = model.mesh.size;
  if (x > plate.x || y > plate.y || z > plate.z) {
    warnings.push(
      `At ${Math.round(x)} × ${Math.round(y)} × ${fmt(z, 1)} mm this does not fit the ${plate.label} plate ` +
        `(${plate.x} × ${plate.y} × ${plate.z} mm). It would have to be split or scaled.`,
    );
  }

  if (model.tolerance > LIMITS.minFeature / 4) {
    warnings.push(
      `The outline is simplified to ${fmt(model.tolerance)} mm. That is a noticeable fraction of the ` +
        `${LIMITS.minFeature} mm smallest printable feature — lower it if fine detail matters.`,
    );
  }

  return {
    layerHeight,
    steps,
    volume: model.mesh.volume,
    grams: (model.mesh.volume / 1000) * density,
    size: model.mesh.size,
    warnings,
  };
}

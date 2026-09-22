/**
 * Pricing — handoff §03.
 *
 * `estimate()` is a pure function over the tables below, and it is the only
 * place a price is computed. The live panel and the server action that emails
 * the request both call it, so the number the visitor sees and the number the
 * shop receives cannot drift apart.
 */
import { addBusinessDays, formatShipBy } from './businessDays';

export const MATERIAL = {
  PLA: { factor: 1.0, label: 'PLA — concept models' },
  PETG: { factor: 1.15, label: 'PETG — tough & clear' },
  ABS: { factor: 1.2, label: 'ABS — classic engineering' },
  ASA: { factor: 1.3, label: 'ASA — UV stable, outdoor' },
  'PA12-CF': { factor: 2.4, label: 'PA12-CF — nylon carbon fiber' },
  'Resin 8K': { factor: 1.9, label: 'Resin 8K — fine detail' },
  TPU: { factor: 1.6, label: 'TPU — flexible' },
  unsure: { factor: 1.0, label: 'Not sure — have an engineer advise' },
} as const;

export const SIZE = {
  palm: { factor: 0.4, label: 'Palm — under 80 mm' },
  shoebox: { factor: 1.0, label: 'Shoebox — under 250 mm' },
  large: { factor: 2.5, label: 'Large — up to 400 mm' },
} as const;

export const SPEED = {
  standard: { factor: 1, days: 3, label: 'Standard — 3 business days' },
  expedited: { factor: 1.25, days: 2, label: 'Expedited — 2 business days' },
  rush: { factor: 1.65, days: 1, label: 'Rush — 24 hours' },
} as const;

export type MaterialKey = keyof typeof MATERIAL;
export type SizeKey = keyof typeof SIZE;
export type SpeedKey = keyof typeof SPEED;

/** Flat setup & engineering-review fee, quoted up front. Replace before launch. */
export const SETUP_FEE = 65;
const UNIT_BASE = 42;

export const MIN_QTY = 1;
export const MAX_QTY = 5000;

export interface EstimateInput {
  material: MaterialKey;
  size: SizeKey;
  speed: SpeedKey;
  qty: number;
}

export interface Estimate {
  unit: number;
  setup: number;
  total: number;
  low: number;
  high: number;
  qty: number;
  shipBy: Date;
  shipByLabel: string;
}

/** Volume breaks. Stepped rather than continuous so the quote is explainable. */
function quantityDiscount(qty: number): number {
  if (qty >= 100) return 0.6;
  if (qty >= 20) return 0.74;
  if (qty >= 5) return 0.88;
  return 1;
}

export function estimate(input: EstimateInput, now: Date = new Date()): Estimate {
  const qty = Math.max(MIN_QTY, Math.min(MAX_QTY, Math.floor(input.qty) || MIN_QTY));
  const material = MATERIAL[input.material] ?? MATERIAL.PLA;
  const size = SIZE[input.size] ?? SIZE.palm;
  const speed = SPEED[input.speed] ?? SPEED.standard;

  const unit = UNIT_BASE * material.factor * size.factor * quantityDiscount(qty) * speed.factor;
  const total = unit * qty + SETUP_FEE;

  // +1 business day covers the engineering review before the build starts.
  const shipBy = addBusinessDays(now, speed.days + 1);

  return {
    unit,
    setup: SETUP_FEE,
    total,
    low: total * 0.88,
    high: total * 1.16,
    qty,
    shipBy,
    shipByLabel: formatShipBy(shipBy),
  };
}

export function money(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

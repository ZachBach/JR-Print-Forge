'use server';

import { z } from 'zod';
import {
  estimate,
  MATERIAL,
  MAX_QTY,
  MIN_QTY,
  money,
  SIZE,
  SPEED,
  type MaterialKey,
  type SizeKey,
  type SpeedKey,
} from '@/lib/pricing';

const keys = <T extends object>(o: T) => Object.keys(o) as [string, ...string[]];

const QuoteSchema = z.object({
  email: z.string().email('Enter an address we can reply to.'),
  description: z.string().max(4000).default(''),
  material: z.enum(keys(MATERIAL)),
  size: z.enum(keys(SIZE)),
  speed: z.enum(keys(SPEED)),
  qty: z.coerce.number().int().min(MIN_QTY).max(MAX_QTY),
});

const MAX_FILES = 10;
const MAX_BYTES = 100 * 1024 * 1024;
const ALLOWED = ['.stl', '.step', '.stp', '.obj', '.3mf', '.pdf', '.png', '.jpg', '.jpeg'];

export type QuoteResult =
  | { ok: true; reference: string }
  | { ok: false; error: string };

/**
 * Accepts the request, prices it with the same pure function the live panel
 * uses, and hands it to the shop. The estimate is recomputed here rather than
 * trusted from the client — the number in the panel and the number in the
 * email come from one table either way.
 */
export async function submitQuote(formData: FormData): Promise<QuoteResult> {
  const parsed = QuoteSchema.safeParse({
    email: formData.get('email'),
    description: formData.get('description') ?? '',
    material: formData.get('material'),
    size: formData.get('size'),
    speed: formData.get('speed'),
    qty: formData.get('qty'),
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  const files = formData.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);

  if (files.length > MAX_FILES) {
    return { ok: false, error: `Attach at most ${MAX_FILES} files.` };
  }

  let total = 0;
  for (const f of files) {
    total += f.size;
    const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase();
    if (!ALLOWED.includes(ext)) {
      return { ok: false, error: `${f.name} is not a file type we can read.` };
    }
  }
  if (total > MAX_BYTES) {
    return { ok: false, error: 'Attachments exceed the 100 MB limit.' };
  }

  const data = parsed.data;
  const priced = estimate({
    material: data.material as MaterialKey,
    size: data.size as SizeKey,
    speed: data.speed as SpeedKey,
    qty: data.qty,
  });

  const reference = `JRPF-${Date.now().toString(36).toUpperCase()}`;

  // TODO(launch): persist the attachments to object storage and send the
  // request to quotes@jrprintforge.com. Everything the email needs is below;
  // the transport is the only missing piece, so nothing here has to change
  // when it is wired up.
  const summary = {
    reference,
    email: data.email,
    description: data.description,
    material: data.material,
    size: data.size,
    speed: data.speed,
    qty: priced.qty,
    files: files.map((f) => ({ name: f.name, bytes: f.size })),
    estimate: {
      unit: money(priced.unit),
      setup: money(priced.setup),
      range: `${money(priced.low)}–${money(priced.high)}`,
      shipBy: priced.shipByLabel,
    },
  };
  console.info('[quote] request received', summary);

  return { ok: true, reference };
}

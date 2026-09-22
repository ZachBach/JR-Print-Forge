'use client';

import { useEffect, useState } from 'react';
import { estimate, money, type EstimateInput } from '@/lib/pricing';

/**
 * Live estimate panel. All arithmetic comes from lib/pricing's pure
 * `estimate()`, which the server action also calls, so the number here and the
 * number in the shop's inbox cannot drift.
 */
export default function Estimator({ input }: { input: EstimateInput }) {
  // The money is a pure function of the spec, so it renders on the server.
  const e = estimate(input);

  // The ship-by date is not: this page is statically prerendered, so a date
  // computed during the render would be frozen at build time and would differ
  // from the visitor's own clock. It is filled in after mount instead.
  const { material, size, speed, qty } = input;
  const [shipBy, setShipBy] = useState<string | null>(null);
  useEffect(() => {
    setShipBy(estimate({ material, size, speed, qty }, new Date()).shipByLabel);
  }, [material, size, speed, qty]);

  const rows: Array<[string, string, string]> = [
    ['Per unit', money(e.unit), 'text-ink'],
    ['Quantity', String(e.qty), 'text-ink'],
    ['Setup & review', money(e.setup), 'text-ink'],
    ['Material', input.material, 'text-blue'],
    ['Ships by', shipBy ?? '—', 'text-ember'],
  ];

  return (
    <div className="border border-blue/30 bg-gradient-to-b from-blue/[.08] to-blue/[.02] p-[clamp(24px,3vw,34px)]">
      <div className="mb-[22px] font-mono text-[10px] uppercase tracking-[.24em] text-blue">
        Live estimate
      </div>
      <div className="mb-1.5 flex items-baseline gap-2.5">
        <span className="font-display text-[clamp(34px,4.6vw,52px)] font-bold leading-none text-ink">
          {money(e.low)}
        </span>
        <span className="font-display text-[22px] font-medium text-dim">–</span>
        <span className="font-display text-[clamp(34px,4.6vw,52px)] font-bold leading-none text-ink">
          {money(e.high)}
        </span>
      </div>
      <p className="mb-6 font-mono text-[10px] uppercase tracking-[.14em] text-body">
        Non-binding · firm quote by email
      </p>
      <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-4 gap-y-3 border-t border-white/10 pt-5 text-[13.5px]">
        {rows.map(([label, value, tone]) => (
          <div key={label} className="contents">
            <dt className="text-body">{label}</dt>
            <dd className={`m-0 text-right font-mono ${tone}`}>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

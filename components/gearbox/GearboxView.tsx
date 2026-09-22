'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import type { GearboxSpec } from './GearboxStage';

// three plus the viewer stays off the critical path, same as the hero.
const GearboxStage = dynamic(() => import('./GearboxStage'), {
  ssr: false,
  loading: () => (
    <div className="grid min-h-[64vh] place-items-center">
      <span className="font-mono text-[10px] uppercase tracking-[.28em] text-dim">
        Building geometry…
      </span>
    </div>
  ),
});

// The scene is built in metres; the spec sheet is quoted in millimetres.
const mm = (metres: number) => {
  const v = metres * 1000;
  return `${v < 10 ? v.toFixed(1).replace(/\.0$/, '') : v.toFixed(0)} mm`;
};

export default function GearboxView() {
  const [info, setInfo] = useState<{ spec: GearboxSpec; parts: number } | null>(null);
  const s = info?.spec;

  // The figures come from the geometry that is actually on screen rather than
  // from a table typed beside it, so the two can never disagree.
  const rows: Array<[string, string]> = [
    ['Reduction', s ? `${s.ratio.toFixed(0)}:1` : '—'],
    ['Module', s ? mm(s.module) : '—'],
    ['Teeth (S/P/R)', s ? `${s.teeth.sun} / ${s.teeth.planet} / ${s.teeth.ring}` : '—'],
    ['Face width', s ? mm(s.faceWidth) : '—'],
    ['Outer diameter', s ? mm(s.outerDiameter) : '—'],
    ['Named parts', info ? String(info.parts) : '—'],
    ['Materials', '5'],
  ];

  return (
    <>
      <GearboxStage onReady={setInfo} />

      <aside className="border-t border-hairline bg-[#0E0F10] p-[clamp(24px,3vw,36px)] lg:border-l lg:border-t-0">
        <div className="mb-3.5 font-mono text-[10px] uppercase tracking-[.28em] text-blue">
          Reference part · 001
        </div>
        <h1 className="mb-3 font-display text-[28px] font-bold leading-[1.05] text-ink">
          4:1 Planetary Gearbox
        </h1>
        <p className="mb-[22px] text-sm leading-[1.65] text-body">
          Printed sun, planets and internal ring gear on steel pins — the part we hand people when
          they ask whether printed gears can carry anything. Drag to orbit, scroll to zoom, then
          take the geometry with you.
        </p>

        <dl className="mb-6 grid grid-cols-[1fr_auto] gap-x-3.5 gap-y-2.5 border-t border-hairline pt-[18px] text-[13px]">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-body">{label}</dt>
              <dd className="m-0 text-right font-mono text-ink">{value}</dd>
            </div>
          ))}
        </dl>

        <a
          href="/#quote"
          className="inline-flex items-center gap-2.5 whitespace-nowrap border border-ember bg-ember px-[22px] py-3.5 font-mono text-[11px] uppercase tracking-[.2em] text-ground transition-colors hover:border-ember-hot hover:bg-ember-hot"
        >
          Quote a part like this <span aria-hidden="true">→</span>
        </a>

        <div className="mt-[18px] font-mono text-[9.5px] uppercase tracking-[.14em] text-dim">
          Download STL, OBJ + MTL, or GLB from the stage toolbar. Dimensions scaled for display —
          tell us your real envelope.
        </div>
      </aside>
    </>
  );
}

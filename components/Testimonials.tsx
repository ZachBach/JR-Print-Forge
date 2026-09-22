'use client';

import { useState } from 'react';
import PulseSurface from './PulseSurface';
import { TESTIMONIALS } from '@/lib/content';

/**
 * No autoplay: quotes are read, not watched — handoff §04. Three rules act as
 * position rather than as controls, and the arrows are the only way to move.
 */
export default function Testimonials() {
  const [i, setI] = useState(0);
  const n = TESTIMONIALS.length;
  const current = TESTIMONIALS[i];

  return (
    <>
      <div className="mb-10 flex flex-wrap items-end justify-between gap-5">
        <div>
          <div className="mb-4 font-mono text-[10px] uppercase tracking-[.3em] text-blue">
            05 — Clients
          </div>
          <h2 className="font-display text-[clamp(28px,3.4vw,44px)] font-semibold leading-[1.05] tracking-[-.015em] text-ink">
            What engineers say after the first order.
          </h2>
        </div>
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={() => setI((v) => (v + n - 1) % n)}
            aria-label="Previous testimonial"
            className="size-[46px] border border-white/[.16] text-base text-meta transition-colors hover:border-blue hover:text-blue"
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => setI((v) => (v + 1) % n)}
            aria-label="Next testimonial"
            className="size-[46px] border border-white/[.16] text-base text-meta transition-colors hover:border-blue hover:text-blue"
          >
            →
          </button>
        </div>
      </div>

      <PulseSurface className="relative overflow-hidden border border-white/10 bg-gradient-to-b from-[#151617] to-[#111213]">
        <div
          className="pm-layer pm-reveal pm-fade"
          style={{
            backgroundImage:
              'repeating-linear-gradient(90deg,rgba(0,191,255,.12) 0 1px,transparent 1px 9px)',
          }}
        />
        <div className="relative flex min-h-[260px] flex-col justify-between gap-7 p-[clamp(34px,5vw,64px)]">
          <blockquote
            aria-live="polite"
            className="m-0 max-w-[44ch] font-display text-[clamp(20px,2.6vw,30px)] font-medium leading-[1.34] text-ink"
          >
            “{current.quote}”
          </blockquote>
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-hairline pt-5">
            <div className="font-mono text-[10.5px] uppercase tracking-[.18em] text-meta">
              {current.who}
            </div>
            <div className="flex gap-[7px]">
              {TESTIMONIALS.map((t, idx) => (
                <span
                  key={t.who}
                  className={`h-0.5 w-[26px] ${idx === i ? 'bg-ember' : 'bg-white/[.18]'}`}
                />
              ))}
            </div>
          </div>
        </div>
      </PulseSurface>

      <p className="mt-3.5 font-mono text-[9.5px] uppercase tracking-[.16em] text-dim">
        Placeholder quotes — swap for real client words before launch.
      </p>
    </>
  );
}

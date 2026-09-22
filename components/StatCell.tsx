'use client';

import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import type { Stat } from '@/lib/content';

/**
 * Count-up on first intersection — handoff §05.
 *
 * The final value is rendered on the server and only replaced once the
 * animation starts, so the number is correct with JS disabled and correct for
 * anyone who asked for less motion.
 */
export default function StatCell({ stat }: { stat: Stat }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(stat.value);

  useEffect(() => {
    if (reduce) return;
    const el = ref.current;
    if (!el) return;

    let frame = 0;
    const io = new IntersectionObserver(
      ([en]) => {
        if (!en.isIntersecting) return;
        io.disconnect();
        const t0 = performance.now();
        const tick = (t: number) => {
          const p = Math.min((t - t0) / 1100, 1);
          const e = 1 - Math.pow(1 - p, 3);
          setShown(stat.value * e);
          if (p < 1) frame = requestAnimationFrame(tick);
        };
        setShown(0);
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.18 },
    );
    io.observe(el);
    return () => { io.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [reduce, stat.value]);

  const tone = stat.tone === 'ember' ? 'text-ember' : 'text-blue';

  return (
    <div ref={ref} className="bg-panel px-[26px] py-[34px]">
      <div className="mb-3.5 flex items-baseline gap-1.5">
        {stat.prefix && (
          <span className={`font-display text-[clamp(40px,5vw,60px)] font-bold leading-none ${tone}`}>
            {stat.prefix}
          </span>
        )}
        <span className={`font-display text-[clamp(40px,5vw,60px)] font-bold leading-none ${tone}`}>
          {shown.toFixed(stat.decimals)}
        </span>
        <span className="font-mono text-[11px] tracking-[.14em] text-body">{stat.unit}</span>
      </div>
      <h3 className="mb-2 font-display text-base font-semibold text-ink">{stat.title}</h3>
      <p className="text-[13.5px] leading-[1.6] text-body">{stat.blurb}</p>
    </div>
  );
}

'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import PulseSurface from '@/components/PulseSurface';
import type { ForgeInfo } from './ForgeStage';

// ~600KB of three must never touch the critical path — handoff §07.
const ForgeStage = dynamic(() => import('./ForgeStage'), { ssr: false });

/** Height of the readout strip the rig has to clear. */
const READOUT_INSET = 58;

const SCRIM = [
  'linear-gradient(90deg,rgba(11,12,13,.94) 0%,rgba(11,12,13,.86) 38%,rgba(11,12,13,.42) 66%,rgba(11,12,13,.2) 100%)',
  'linear-gradient(rgba(0,191,255,.10) 1px,transparent 1px)',
  'linear-gradient(90deg,rgba(0,191,255,.10) 1px,transparent 1px)',
  'linear-gradient(rgba(0,191,255,.04) 1px,transparent 1px)',
  'linear-gradient(90deg,rgba(0,191,255,.04) 1px,transparent 1px)',
].join(',');

const BACKEND_LABEL: Record<ForgeInfo['backend'], string> = {
  webgpu: 'WebGPU',
  'webgl2-fallback': 'WebGL2 fallback',
  unavailable: 'static fallback',
};

export default function Hero() {
  const sectionRef = useRef<HTMLElement>(null);
  const [mount3d, setMount3d] = useState(false);
  const [info, setInfo] = useState<ForgeInfo | null>(null);

  // Only build the scene once the hero is actually near the viewport.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([en]) => { if (en.isIntersecting) { setMount3d(true); io.disconnect(); } },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <PulseSurface
      as="section"
      id="top"
      ref={sectionRef}
      className="pm-hero relative flex min-h-[min(92vh,880px)] items-end overflow-hidden border-b border-hairline"
    >
      <>
        {mount3d && (
          <ForgeStage
            bottomInset={READOUT_INSET}
            logoUrl="/jr-print-forge.jpg"
            onReady={setInfo}
          />
        )}

        {/* CAD grid over a left-weighted scrim; the cursor burns a hole in it. */}
        <div
          className="pm-layer pm-wipe z-[1]"
          style={{ backgroundImage: SCRIM, backgroundSize: '100% 100%,120px 120px,120px 120px,24px 24px,24px 24px' }}
        />
        <div
          className="pm-layer z-[2]"
          style={{
            background:
              'radial-gradient(circle var(--pm-r) at var(--mx) var(--my),rgba(0,191,255,.13),transparent 70%)',
          }}
        />

        <div className="pointer-events-none relative z-[3] mx-auto w-full max-w-[1320px] px-5 pb-[clamp(116px,11vw,130px)] pt-[clamp(96px,14vh,170px)] sm:px-10 lg:px-16">
          <div className="mb-[26px] flex items-center gap-3">
            <span className="size-[7px] flex-none bg-ember shadow-[0_0_14px_#FF6B00]" />
            <span className="font-mono text-[10.5px] uppercase tracking-[.3em] text-meta">
              Engineering-grade additive manufacturing
            </span>
          </div>

          <h1 className="mb-5 max-w-[16ch] font-display text-[clamp(40px,6.6vw,84px)] font-bold leading-[.98] tracking-[-.02em] text-ink text-balance">
            Precision 3D Printing.
            <br />
            <span className="text-ember">Forged</span> for Innovation.
          </h1>

          <p className="mb-[34px] max-w-[52ch] text-[clamp(15.5px,1.5vw,18.5px)] leading-[1.62] text-body-bright">
            From concept to production-quality parts, JR Print Forge transforms ideas into reality.
          </p>

          <div className="pointer-events-auto flex flex-wrap gap-3.5">
            <a
              href="#quote"
              className="inline-flex items-center gap-2.5 border border-ember bg-ember px-7 py-4 font-mono text-[11.5px] font-medium uppercase tracking-[.2em] text-ground transition-colors hover:border-ember-hot hover:bg-ember-hot"
            >
              Get a Quote <span aria-hidden="true">→</span>
            </a>
            <a
              href="#quote"
              onClick={(e) => {
                const input = document.getElementById('qfile') as HTMLInputElement | null;
                // Without the field there is nothing to open, so let the anchor
                // fall through to the quote section on its own.
                if (!input) return;
                e.preventDefault();
                document.getElementById('quote')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                // Stays inside the click gesture: Safari refuses a file dialog
                // opened from a timeout, which is how the prototype did it.
                input.click();
              }}
              className="inline-flex items-center gap-2.5 border border-blue/45 bg-blue/[.06] px-7 py-4 font-mono text-[11.5px] font-medium uppercase tracking-[.2em] text-blue transition-colors hover:bg-blue/15 hover:text-ink"
            >
              Upload Your Design
            </a>
          </div>
        </div>

        {/* The honest readout: it prints the path actually taken, not the one
            we hoped for — handoff §07. */}
        <div className="absolute inset-x-0 bottom-0 z-[3] flex flex-wrap border-t border-hairline bg-ground/70 font-mono text-[10px] uppercase tracking-[.16em] text-[#6E777C] backdrop-blur-[10px]">
          <span className="flex-[1_1_180px] border-r border-white/[.06] px-5 py-[13px] sm:px-10 lg:px-16">
            Live render · <span className="text-blue">{info ? BACKEND_LABEL[info.backend] : 'initializing…'}</span>
          </span>
          {/* Narrow screens keep one proof and one promise, so the strip stays
              a single row and never grows up over the CTAs. */}
          {/* Particles actually drawn this second, not the pool: the quality
              manager lowers the count on hardware that can't hold it. */}
          <span className="hidden flex-[1_1_150px] border-r border-white/[.06] px-5 py-[13px] sm:block">
            {info && info.pool > 0 ? (
              <>
                Particles <span className="text-ink tabular-nums">{info.particles.toLocaleString('en-US')}</span>
              </>
            ) : (
              <>
                Vertices <span className="text-ink">{info ? info.vertices.toLocaleString('en-US') : '—'}</span>
              </>
            )}
          </span>
          <span className="hidden flex-[1_1_140px] border-r border-white/[.06] px-5 py-[13px] sm:block">
            {/* The cadence the scene actually runs, not a number typed beside it. */}
            Strikes <span className="text-ink">{info && info.strikesPerMin > 0 ? `${Math.round(info.strikesPerMin)}/min` : '—'}</span>
          </span>
          <span className="flex-[1_1_190px] border-r border-white/[.06] px-5 py-[13px]">
            Quote in <span className="text-ember">1 business day</span>
          </span>
          <span className="hidden flex-[1_1_200px] px-5 py-[13px] sm:block">
            Printed planetary gearbox ·{' '}
            <a href="/gearbox" className="pointer-events-auto text-ember hover:text-blue">
              inspect &amp; download
            </a>
          </span>
        </div>
      </>
    </PulseSurface>
  );
}

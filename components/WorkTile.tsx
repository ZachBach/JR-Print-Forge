import Image from 'next/image';
import PulseSurface from './PulseSurface';
import { RevealItem } from './Reveal';
import type { Work } from '@/lib/content';

/**
 * The CAD-to-print transformation as an interaction rather than a claim: photo
 * underneath, blueprint grid on top, cursor wipes the CAD away.
 *
 * `src` is optional on purpose. The prototype's slots were drop targets and no
 * real part photography has landed yet, so a tile without a photo renders an
 * honest empty state instead of a broken image. Handoff §09.6 also wants a
 * material and a lead time in the caption once the real photos arrive.
 */
export default function WorkTile({ work }: { work: Work }) {
  return (
    <RevealItem>
      <PulseSurface
        as="figure"
        className="relative m-0 aspect-[4/3] overflow-hidden border border-white/10 bg-panel"
      >
        {work.src ? (
          <Image
            src={work.src}
            alt={work.alt}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center px-6 text-center">
            <span className="font-mono text-[9.5px] uppercase tracking-[.2em] text-dim">
              Photography pending
            </span>
          </div>
        )}

        <div
          className="pm-layer pm-wipe"
          style={{
            backgroundColor: 'rgba(11,12,13,.9)',
            backgroundImage:
              'linear-gradient(rgba(0,191,255,.22) 1px,transparent 1px),linear-gradient(90deg,rgba(0,191,255,.22) 1px,transparent 1px)',
            backgroundSize: '26px 26px',
          }}
        />

        <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 flex items-baseline justify-between gap-3 bg-gradient-to-b from-transparent to-ground/[.92] px-[18px] py-4">
          <span className="font-display text-[17px] font-semibold text-ink">{work.title}</span>
          <span className="whitespace-nowrap font-mono text-[9.5px] uppercase tracking-[.18em] text-blue">
            {work.tag}
          </span>
        </figcaption>
      </PulseSurface>
    </RevealItem>
  );
}

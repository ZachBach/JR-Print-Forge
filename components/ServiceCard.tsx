import PulseSurface from './PulseSurface';
import { RevealItem } from './Reveal';
import type { Service } from '@/lib/content';

/**
 * Two spec chips per card, so every capability is measurable rather than
 * adjectival — handoff §01. Hover fades in a hatch layer masked to the cursor.
 */
export default function ServiceCard({ service }: { service: Service }) {
  return (
    <RevealItem>
      <PulseSurface
        as="article"
        className="relative h-full min-h-[270px] overflow-hidden bg-panel px-[30px] pb-8 pt-9 transition-colors hover:bg-panel-raised"
      >
        <div
          className="pm-layer pm-reveal pm-fade"
          style={{
            backgroundImage:
              'repeating-linear-gradient(135deg,rgba(0,191,255,.16) 0 1px,transparent 1px 7px)',
          }}
        />
        <div className="relative flex h-full flex-col">
          <div className="mb-[22px] font-mono text-[10px] tracking-[.2em] text-ember">
            {service.index}
          </div>
          <h3 className="mb-3 font-display text-[21px] font-semibold text-ink">{service.title}</h3>
          <p className="mb-[22px] text-[14.5px] leading-[1.62] text-body">{service.blurb}</p>
          <div className="mt-auto flex flex-wrap gap-2 font-mono text-[9.5px] uppercase tracking-[.14em] text-blue">
            {service.chips.map((chip) => (
              <span
                key={chip}
                className="whitespace-nowrap border border-blue/25 bg-blue/5 px-2.5 py-[5px]"
              >
                {chip}
              </span>
            ))}
          </div>
        </div>
      </PulseSurface>
    </RevealItem>
  );
}

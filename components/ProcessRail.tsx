import { RevealGroup, RevealItem, WipeBar } from './Reveal';
import { STEPS } from '@/lib/content';

/**
 * Four steps with their durations — the duration is the commitment, so it is
 * the one thing set in ember mono. An ember bar wipes across each cell's top
 * edge as it enters.
 */
export default function ProcessRail() {
  return (
    <RevealGroup className="grid gap-px border border-hairline bg-hairline [grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr))]">
      {STEPS.map((step) => (
        <RevealItem key={step.index} className="relative bg-panel px-7 pb-[30px] pt-[34px]">
          <WipeBar className="absolute left-0 top-0 block h-0.5 w-full bg-ember" />
          <div className="mb-[18px] font-display text-[44px] font-bold leading-none text-blue/20">
            {step.index}
          </div>
          <h3 className="mb-2.5 font-display text-[19px] font-semibold text-ink">{step.title}</h3>
          <p className="mb-[18px] text-sm leading-[1.6] text-body">{step.blurb}</p>
          <span className="font-mono text-[9.5px] uppercase tracking-[.16em] text-ember">
            {step.duration}
          </span>
        </RevealItem>
      ))}
    </RevealGroup>
  );
}

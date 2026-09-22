import Image from 'next/image';

const SERVICE_LINKS = [
  'Rapid Prototyping',
  'Functional Parts',
  'Resin & FDM Printing',
  'CAD Design',
  'Production Runs',
];

const SOCIALS = [
  ['IG', 'Instagram'],
  ['LI', 'LinkedIn'],
  ['X', 'X'],
] as const;

export default function Footer() {
  return (
    <footer className="border-t border-hairline bg-ground">
      <div className="mx-auto grid max-w-[1320px] gap-10 px-5 pb-[30px] pt-[clamp(48px,7vw,84px)] sm:px-10 lg:px-16 [grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr))]">
        <div>
          <div className="mb-[18px] flex items-center gap-[11px]">
            <Image
              src="/jr-print-forge.jpg"
              alt=""
              width={40}
              height={40}
              className="block border border-white/[.14]"
            />
            <span className="font-display text-base font-bold tracking-[.12em] text-ink">
              JR PRINT FORGE
            </span>
          </div>
          <p className="max-w-[30ch] text-[13.5px] leading-[1.65] text-body">
            Precision additive manufacturing for engineers, inventors and the people who have to
            ship.
          </p>
        </div>

        <div>
          <div className="mb-4 font-mono text-[9.5px] uppercase tracking-[.24em] text-dim">
            Services
          </div>
          <div className="flex flex-col gap-[9px] text-[13.5px]">
            {SERVICE_LINKS.map((label) => (
              <a key={label} href="#services" className="text-meta transition-colors hover:text-blue">
                {label}
              </a>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-4 font-mono text-[9.5px] uppercase tracking-[.24em] text-dim">
            Contact
          </div>
          <div className="flex flex-col gap-[9px] text-[13.5px]">
            <a href="mailto:quotes@jrprintforge.com" className="text-blue hover:text-ember">
              quotes@jrprintforge.com
            </a>
            <a href="/gearbox" className="text-meta transition-colors hover:text-blue">
              3D part viewer
            </a>
            <span className="font-mono text-[11px] tracking-[.1em] text-dim">
              Mon–Fri · quotes in 1 business day
            </span>
          </div>
          <div className="mt-[18px] flex gap-2.5 font-mono text-[9.5px] uppercase tracking-[.16em]">
            {SOCIALS.map(([short, full]) => (
              <a
                key={short}
                href="#"
                aria-label={full}
                className="border border-white/[.14] px-[11px] py-[7px] text-meta transition-colors hover:border-blue hover:text-blue"
              >
                {short}
              </a>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-4 font-mono text-[9.5px] uppercase tracking-[.24em] text-dim">
            Start a job
          </div>
          <a
            href="#quote"
            className="inline-flex items-center gap-2.5 border border-ember bg-ember px-[22px] py-[15px] font-mono text-[11px] font-medium uppercase tracking-[.2em] text-ground transition-colors hover:border-ember-hot hover:bg-ember-hot"
          >
            Get a Quote <span aria-hidden="true">→</span>
          </a>
        </div>
      </div>

      {/* Ends on the renderer line, which is the same honesty the rest of the
          page trades on — handoff §04. */}
      <div className="mx-auto flex max-w-[1320px] flex-wrap justify-between gap-x-[26px] gap-y-3 border-t border-white/[.06] px-5 pb-10 pt-[22px] font-mono text-[9.5px] uppercase tracking-[.14em] text-dim sm:px-10 lg:px-16">
        <span className="whitespace-nowrap">© 2026 JR Print Forge</span>
        <span>Hero rendered live · WebGPU with WebGL2 fallback</span>
      </div>
    </footer>
  );
}

import Image from 'next/image';

const LINKS = [
  ['#services', 'Services'],
  ['#process', 'Process'],
  ['#work', 'Work'],
  ['#why', 'Why Us'],
] as const;

export default function Header() {
  return (
    <header className="sticky top-0 z-40 flex items-center justify-between gap-5 border-b border-hairline bg-ground/[.88] px-4 py-3 backdrop-blur-[14px] sm:px-8 lg:px-11">
      <a href="#top" className="flex items-center gap-[11px]">
        <Image
          src="/jr-print-forge.jpg"
          alt="JR Print Forge"
          width={36}
          height={36}
          className="block border border-white/[.14]"
          priority
        />
        <span className="flex flex-col leading-none">
          <span className="whitespace-nowrap font-display text-[15px] font-bold tracking-[.14em] text-ink">
            JR PRINT FORGE
          </span>
          <span className="mt-1 whitespace-nowrap font-mono text-[8px] tracking-[.32em] text-[#6E777C]">
            ADDITIVE MANUFACTURING
          </span>
        </span>
      </a>

      <nav className="flex items-center gap-[22px] font-mono text-[10px] uppercase tracking-[.18em]">
        {/* Below sm there is no room for section links beside the CTA, and the
            CTA is the one that has to survive. */}
        {LINKS.map(([href, label]) => (
          <a
            key={href}
            href={href}
            className="hidden text-meta transition-colors hover:text-blue md:inline"
          >
            {label}
          </a>
        ))}
        <a
          href="#quote"
          className="inline-block border border-ember px-4 py-[9px] tracking-[.18em] text-ember transition-colors hover:bg-ember hover:text-ground"
        >
          Get a Quote
        </a>
      </nav>
    </header>
  );
}

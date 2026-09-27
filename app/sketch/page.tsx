import type { Metadata } from 'next';
import Image from 'next/image';
import SketchStudio from '@/components/sketch/SketchStudio';

export const metadata: Metadata = {
  title: 'Sketch to Print — JR Print Forge',
  description:
    'Turn a napkin sketch, a drawing or a photo into a keychain, plaque, lithophane or cookie cutter. Shape it in 3D, then JR Print Forge prints it and ships it to you.',
  alternates: { canonical: '/sketch' },
};

export default function SketchPage() {
  return (
    <>
      <header className="sticky top-0 z-20 flex h-[57px] items-center justify-between gap-4 border-b border-hairline bg-ground/[.88] px-4 backdrop-blur-[14px] sm:px-8 lg:px-11">
        <a href="/" className="flex items-center gap-[11px]">
          <Image
            src="/jr-print-forge.jpg"
            alt="JR Print Forge"
            width={32}
            height={32}
            className="block border border-white/[.14]"
            priority
          />
          <span className="font-display text-sm font-bold tracking-[.14em] text-ink">JR PRINT FORGE</span>
        </a>
        <a href="/" className="font-mono text-[10px] uppercase tracking-[.18em] text-meta hover:text-blue">
          ← Back to site
        </a>
      </header>

      <main id="top" className="grid min-h-[calc(100vh-57px)] grid-cols-1 items-start lg:grid-cols-[minmax(0,1fr)_420px]">
        <SketchStudio />
      </main>
    </>
  );
}

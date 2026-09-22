import type { Metadata } from 'next';
import Image from 'next/image';
import GearboxView from '@/components/gearbox/GearboxView';

export const metadata: Metadata = {
  title: 'Planetary Gearbox — JR Print Forge',
  description:
    'A printed 4:1 planetary gearbox from JR Print Forge. Orbit it, inspect it, download the OBJ or GLB.',
  alternates: { canonical: '/gearbox' },
};

export default function GearboxPage() {
  return (
    <>
      <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-hairline bg-ground/[.88] px-4 py-3 backdrop-blur-[14px] sm:px-8 lg:px-11">
        <a href="/" className="flex items-center gap-[11px]">
          <Image
            src="/jr-print-forge.jpg"
            alt="JR Print Forge"
            width={32}
            height={32}
            className="block border border-white/[.14]"
            priority
          />
          <span className="font-display text-sm font-bold tracking-[.14em] text-ink">
            JR PRINT FORGE
          </span>
        </a>
        <a href="/" className="font-mono text-[10px] uppercase tracking-[.18em] text-meta hover:text-blue">
          ← Back to site
        </a>
      </header>

      <main className="grid min-h-[calc(100vh-57px)] grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]">
        <GearboxView />
      </main>
    </>
  );
}

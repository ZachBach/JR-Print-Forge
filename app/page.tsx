import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Hero from '@/components/hero/Hero';
import ServiceCard from '@/components/ServiceCard';
import ProcessRail from '@/components/ProcessRail';
import WorkTile from '@/components/WorkTile';
import StatCell from '@/components/StatCell';
import Testimonials from '@/components/Testimonials';
import QuoteForm from '@/components/quote/QuoteForm';
import { Reveal, RevealGroup, RevealItem } from '@/components/Reveal';
import { SERVICES, STATS, WORK } from '@/lib/content';

const SECTION = 'mx-auto max-w-[1320px] px-5 py-[clamp(72px,10vw,140px)] sm:px-10 lg:px-16';
const EYEBROW = 'mb-4 font-mono text-[10px] uppercase tracking-[.3em] text-blue';
const HEADLINE =
  'font-display text-[clamp(30px,4vw,52px)] font-semibold leading-[1.04] tracking-[-.015em] text-ink';

export default function Home() {
  return (
    <>
      <Header />

      <main>
        {/* 01 — Hero */}
        <Hero />

        {/* 02 — Services */}
        <section id="services" className={SECTION}>
          <div className="mb-12 grid items-end gap-x-10 gap-y-6 [grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))]">
            <div>
              <div className={EYEBROW}>01 — Capabilities</div>
              <h2 className={HEADLINE}>Five ways we make your part real.</h2>
            </div>
            <p className="max-w-[34ch] text-[15px] leading-[1.65] text-body">
              Hover any card — the scan reveals what the machine sees.
            </p>
          </div>

          <RevealGroup className="grid gap-px border border-hairline bg-hairline [grid-template-columns:repeat(auto-fit,minmax(min(100%,290px),1fr))]">
            {SERVICES.map((service) => (
              <ServiceCard key={service.index} service={service} />
            ))}
          </RevealGroup>
        </section>

        {/* 03 — Process */}
        <section
          id="process"
          className="border-y border-hairline bg-gradient-to-b from-[#0E0F10] to-ground"
        >
          <div className={SECTION}>
            <div className={EYEBROW}>02 — Process</div>
            <h2 className={`${HEADLINE} mb-3.5 max-w-[18ch]`}>Four steps. No black boxes.</h2>
            <p className="mb-14 max-w-[56ch] text-[15.5px] leading-[1.65] text-body">
              Every job runs the same route, and you can see where yours is at each stage.
            </p>
            <ProcessRail />
          </div>
        </section>

        {/* 04 — Portfolio */}
        <section id="work" className={SECTION}>
          <div className="mb-12 grid items-end gap-x-10 gap-y-6 [grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))]">
            <div>
              <div className={EYEBROW}>03 — Selected work</div>
              <h2 className={HEADLINE}>CAD in. Part out.</h2>
            </div>
            <p className="max-w-[34ch] text-[15px] leading-[1.65] text-body">
              Move your cursor across a tile to burn through the CAD layer.
            </p>
          </div>

          <RevealGroup className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))]">
            {WORK.map((work) => (
              <WorkTile key={work.id} work={work} />
            ))}
          </RevealGroup>
        </section>

        {/* 05 — Why */}
        <section id="why" className="border-t border-hairline bg-[#0E0F10]">
          <div className={SECTION}>
            <div className={EYEBROW}>04 — Why JR Print Forge</div>
            <h2 className={`${HEADLINE} mb-14 max-w-[20ch]`}>The numbers we hold ourselves to.</h2>

            <RevealGroup className="grid gap-px border border-hairline bg-hairline [grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr))]">
              {STATS.map((stat) => (
                <RevealItem key={stat.title}>
                  <StatCell stat={stat} />
                </RevealItem>
              ))}
            </RevealGroup>
          </div>
        </section>

        {/* 06 — Testimonials */}
        <section className="overflow-hidden border-t border-hairline">
          <div className="mx-auto max-w-[1320px] px-5 py-[clamp(72px,10vw,120px)] sm:px-10 lg:px-16">
            <Reveal>
              <Testimonials />
            </Reveal>
          </div>
        </section>

        {/* 07 — Quote */}
        <section
          id="quote"
          className="border-t border-hairline bg-gradient-to-b from-[#0E0F10] to-ground"
        >
          <div className={SECTION}>
            <div className="mb-4 font-mono text-[10px] uppercase tracking-[.3em] text-ember">
              06 — Request a quote
            </div>
            <h2 className={`${HEADLINE} mb-3.5 max-w-[20ch]`}>Price it now. Confirm it tomorrow.</h2>
            <p className="mb-12 max-w-[56ch] text-[15.5px] leading-[1.65] text-body">
              The estimator below gives you a live, non-binding range as you type. A real engineer
              sends the firm number within one business day.
            </p>
            <QuoteForm />
          </div>
        </section>
      </main>

      {/* 08 — Footer */}
      <Footer />
    </>
  );
}

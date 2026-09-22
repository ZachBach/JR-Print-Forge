/**
 * Page copy, lifted verbatim from the design prototype.
 *
 * Figures marked REPLACE BEFORE LAUNCH in handoff §01 are: the ±0.10 mm
 * tolerance, 12 materials, 100% inspected, the $65 setup fee (lib/pricing.ts)
 * and all three testimonials. The 1-business-day quote and 3-business-day
 * build are accurate and stay.
 */

export interface Service {
  index: string;
  title: string;
  blurb: string;
  chips: [string, string];
}

export const SERVICES: Service[] = [
  {
    index: '01',
    title: 'Rapid Prototyping',
    blurb:
      'Iterate in days, not quarters. Functional prototypes off the plate and onto your bench while the idea is still hot.',
    chips: ['24–72 h', 'FDM + resin'],
  },
  {
    index: '02',
    title: 'Functional Parts',
    blurb:
      'End-use components engineered to carry load, heat and abuse — not just to look the part on a shelf.',
    chips: ['PA12-CF · ASA', 'Load tested'],
  },
  {
    index: '03',
    title: 'Resin Printing',
    blurb:
      '8K masked stereolithography for surfaces that need no apology. Housings, masters, miniatures, optics fixtures.',
    chips: ['25 µm layers', 'Cast ready'],
  },
  {
    index: '04',
    title: 'FDM Printing',
    blurb:
      'Production-grade filament printing in engineering polymers, with hardened nozzles and enclosed chambers.',
    chips: ['0.4 / 0.6 mm', 'Enclosed'],
  },
  {
    index: '05',
    title: 'CAD Design Services',
    blurb:
      'Napkin sketch, mesh scan or half-finished STEP file — we take it to a model that manufactures cleanly.',
    chips: ['DFM review', 'STEP + STL out'],
  },
  {
    index: '06',
    title: 'Production Runs',
    blurb:
      'Small-batch manufacturing with repeatable fixtures, batch inspection and serialized, archived output.',
    chips: ['10–5,000 units', 'Batch QC'],
  },
];

export interface Step {
  index: string;
  title: string;
  blurb: string;
  duration: string;
}

export const STEPS: Step[] = [
  {
    index: '01',
    title: 'Submit Design',
    blurb:
      'Upload STL, STEP or a sketch. Tell us the load case, the fit that matters and the finish you want.',
    duration: '5 minutes',
  },
  {
    index: '02',
    title: 'Engineering Review',
    blurb:
      'A human checks wall thickness, print orientation, tolerance stack and material fit — then quotes it.',
    duration: '≤ 1 business day',
  },
  {
    index: '03',
    title: 'Print & Manufacture',
    blurb:
      'Machines assigned by geometry, not convenience. De-supported, finished and dimensionally checked.',
    duration: '3 business days',
  },
  {
    index: '04',
    title: 'Delivery',
    blurb:
      'Packed, labeled, tracked. Files and settings archived so the reorder is one line of email.',
    duration: 'Tracked shipping',
  },
];

export interface Work {
  id: string;
  title: string;
  tag: string;
  /**
   * Drop a real part photograph in public/work and point `src` at it. Left
   * unset the tile renders an honest empty state — the prototype's slots were
   * drop targets and no part photography has landed yet.
   */
  src?: string;
  alt: string;
}

export const WORK: Work[] = [
  {
    id: 'work-engineering',
    title: 'Engineering Parts',
    tag: 'CAD → Print',
    alt: 'Machined and printed engineering components',
  },
  {
    id: 'work-consumer',
    title: 'Consumer Products',
    tag: 'CAD → Print',
    alt: 'Finished consumer product housings',
  },
  {
    id: 'work-custom',
    title: 'Custom Projects',
    tag: 'CAD → Print',
    alt: 'One-off custom fabricated project',
  },
  {
    id: 'work-prototypes',
    title: 'Prototypes',
    tag: 'CAD → Print',
    alt: 'Iterative printed prototypes',
  },
];

export interface Stat {
  prefix?: string;
  value: number;
  decimals: number;
  unit: string;
  title: string;
  blurb: string;
  /** Ember marks a promise we make; blue marks a capability we have. */
  tone: 'ember' | 'blue';
}

export const STATS: Stat[] = [
  {
    value: 1,
    decimals: 0,
    unit: 'day',
    title: 'Fast Turnaround',
    blurb: 'Quotes land in your inbox within one business day of upload.',
    tone: 'ember',
  },
  {
    value: 3,
    decimals: 0,
    unit: 'days',
    title: 'Production Standard',
    blurb: 'Standard build time after you approve the quote. Rush available.',
    tone: 'ember',
  },
  {
    prefix: '±',
    value: 0.1,
    decimals: 2,
    unit: 'mm',
    title: 'Precision Manufacturing',
    blurb: 'Typical achievable tolerance on FDM features. Tighter on resin.',
    tone: 'blue',
  },
  {
    value: 12,
    decimals: 0,
    unit: 'materials',
    title: 'Quality Materials',
    blurb: 'Named, traceable polymers and resins — never mystery filament.',
    tone: 'blue',
  },
  {
    value: 100,
    decimals: 0,
    unit: '% checked',
    title: 'Expert Support',
    blurb: 'Every part is inspected by the engineer who set it up, before it ships.',
    tone: 'blue',
  },
  {
    prefix: '$',
    value: 65,
    decimals: 0,
    unit: 'setup',
    title: 'Competitive Pricing',
    blurb: 'One flat setup fee, quoted up front — never discovered on the invoice.',
    tone: 'blue',
  },
];

export interface Testimonial {
  quote: string;
  who: string;
}

/** Placeholder quotes — swap for real client words before launch. */
export const TESTIMONIALS: Testimonial[] = [
  {
    quote:
      'They caught a wall-thickness problem our CAD reviewer missed, quoted the fix, and still shipped inside the week.',
    who: 'Mechanical engineer · robotics startup',
  },
  {
    quote:
      'First run of 240 housings came off dimensionally identical. That is the whole reason we moved the batch here.',
    who: 'Operations lead · instrumentation OEM',
  },
  {
    quote:
      'I sent a napkin sketch. I got back a STEP file, a printed prototype, and an honest note about what would fail.',
    who: 'Independent inventor · consumer hardware',
  },
];

export interface Faq {
  q: string;
  a: string;
}

export const FAQS: Faq[] = [
  {
    q: 'What tolerance can you actually hold?',
    a: 'Typically ±0.10 mm on FDM features and tighter on resin. Anything critical gets called out on the quote before we print, not after.',
  },
  {
    q: 'Do press-fits and threads come out to size?',
    a: 'Tell us the mating part. We compensate holes and bosses per material shrink, or design in heat-set inserts where threads take load.',
  },
  {
    q: 'What if the first article is wrong?',
    a: 'Send it back with the measurement. If it missed the tolerance we quoted, the reprint is on us.',
  },
];

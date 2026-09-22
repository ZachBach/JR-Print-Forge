# JR Print Forge

Next.js implementation of the JR Print Forge homepage, built from the Claude
Design handoff bundle in [`project/`](project/).

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build
npm run typecheck  # tsc --noEmit
```

## Stack

Next.js 15 App Router · React 19 · Tailwind v4 · Framer Motion · three.js r184
(WebGPU). Design tokens live in [`app/globals.css`](app/globals.css) under
`@theme`; no brand colour is written anywhere else.

## Layout

```
app/
  layout.tsx           fonts, metadata, JSON-LD, skip link
  page.tsx             composes the eight sections (server component)
  gearbox/page.tsx     the reference-part viewer
  globals.css          @theme tokens + the PulseMask stylesheet
  quote/actions.ts     server action: validates, prices, hands off the request
components/
  hero/Hero.tsx        copy, CTAs, readout strip (client)
  hero/ForgeStage.tsx  dynamic(ssr:false) wrapper around the WebGPU scene
  hero/forge/          scene · materials · flame · lattice · palette
                       + geo-lib, tsl-lib
  gearbox/             GearboxView (spec panel) · GearboxStage · gearbox.js
  PulseSurface.tsx     cursor-mask primitive
  ServiceCard · ProcessRail · WorkTile · StatCell · Testimonials
  quote/               QuoteForm · Estimator · ToleranceFaq
lib/
  pricing.ts           MATERIAL / SIZE / SPEED tables + estimate()
  businessDays.ts      ship-by date math
  motion.ts            shared variants
  content.ts           all page copy
project/               the original design bundle — reference, not built
```

Only six components are client components: ForgeStage, PulseSurface,
Testimonials, StatCell, QuoteForm and Estimator. Everything else renders on the
server, which is what keeps first load at ~123 kB despite the 3D hero — three.js
is dynamically imported and never enters the initial bundle.

## Before launch

These are deliberate placeholders, not oversights:

- **Portfolio photography.** All four `WORK` tiles in `lib/content.ts` have no
  `src` and render a "Photography pending" state. Drop real part photos in
  `public/work/` and set `src`. The bundle's `uploads/` images are third-party
  artwork and are not used.
- **Quote email transport.** `app/quote/actions.ts` validates, prices and logs
  the request but does not yet send it. The payload the email needs is already
  assembled at the `TODO(launch)` marker.
- **Unverified figures**, per handoff §01: ±0.10 mm tolerance, 12 materials,
  100% inspected, the $65 setup fee, and all three testimonials. The
  1-business-day quote and 3-business-day build are accurate.
- **The gearbox's outer diameter reads 120 mm, not the 66 mm printed in the
  prototype.** 120 mm is what the geometry actually measures — a 54-tooth ring
  at module 2 mm has a 108 mm pitch diameter, so the housing cannot be 66 mm.
  The spec panel computes every figure from the mesh on screen rather than from
  a table typed beside it, so the label and the part cannot disagree. Change
  the geometry if 66 mm was the intent.

## Two renderers, on purpose

The hero runs `three/webgpu` for TSL node materials. The gearbox viewer runs
the plain `three` build, because OrbitControls and both exporters
`import from 'three'` — pulling them in beside `three/webgpu` would put two
copies of three on one page, which handoff §07 says never to do. No single page
loads both. Navigating between the two routes does fetch both builds; aliasing
`three` → `three/webgpu` in `next.config.ts` would collapse that to one, at the
cost of the larger build on the gearbox route.

---

## About the design bundle

`project/` is the original handoff from Claude Design — HTML/CSS/JS prototypes,
not production code. `project/Design Handoff.dc.html` is the written spec
(strategy, tokens, component architecture, animation timings, PulseMask,
the forge stage, Tailwind mapping, conversion notes) and the section numbers
referenced in code comments point at it. `project/JR Print Forge.dc.html` is the
prototype this implementation reproduces.

The forge scene modules under `components/hero/forge/` are copied from the
bundle and keep their original relative imports, so `geo-lib` and `tsl-lib` sit
alongside them unchanged.

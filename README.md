# JR Print Forge

Next.js implementation of the JR Print Forge homepage, built from the Claude
Design handoff bundle in [`project/`](project/).

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build
npm run typecheck  # tsc --noEmit
npm test           # node --test over lib/**/*.test.ts (Node 22.18+, no test deps)
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
  sketch/page.tsx      Sketch to Print: image → printable part
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
  sketch/              SketchStudio (UI) · SketchStage · pipeline worker · image
lib/
  relief/              image → height field → watertight mesh → 3MF/STL (pure, tested)
  pricing.ts           MATERIAL / SIZE / SPEED tables + estimate()
  businessDays.ts      ship-by date math
  motion.ts            shared variants
  content.ts           all page copy
project/               the original design bundle — reference, not built
```

Client components are kept to the interactive pieces: the hero (Hero,
ForgeStage), PulseSurface, Reveal and MotionProvider, Testimonials, StatCell,
QuoteForm and Estimator, the gearbox viewer, and the sketch studio. Everything
else renders on the server. three.js is dynamically imported on every page that
uses it and never enters the initial bundle.

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
  100% inspected, the $55 setup fee, and all three testimonials. The
  1-business-day quote and 3-business-day build are accurate.
- **The gearbox's outer diameter reads 120 mm, not the 66 mm printed in the
  prototype.** 120 mm is what the geometry actually measures — a 54-tooth ring
  at module 2 mm has a 108 mm pitch diameter, so the housing cannot be 66 mm.
  The spec panel computes every figure from the mesh on screen rather than from
  a table typed beside it, so the label and the part cannot disagree. Change
  the geometry if 66 mm was the intent.

## Sketch to Print (`/sketch`)

A customer uploads a napkin photo, drawing, logo or photograph and gets a
printable part: a **keychain / plaque / coaster** (design raised or engraved on a
plate, optionally cut to the drawing's outline, keyring tab, rim), a
**lithophane**, or a **cookie cutter** that follows the outline. Everything runs
in the browser; nothing is uploaded until they send it to the shop.

- `lib/relief/raster.ts` — thresholding (a local-mean threshold that ignores
  shadows across a phone photo), exact distance transform, hole fill, despeckle.
- `lib/relief/products.ts` — the three products and their printability checks
  (0.8 mm minimum feature for a 0.4 mm nozzle, plate/lithophane/wall limits,
  open outlines, bed size). Warnings are shown to the customer and written into
  the request.
- `lib/relief/mesh.ts` — height field → one closed, consistently wound solid.
  Flat areas merge into strips, so a keychain is ~15k triangles, not ~200k.
- `lib/relief/export.ts` — 3MF (streamed and zipped) and binary STL, straight
  from the mesh arrays.
- `components/sketch/pipeline.worker.ts` — builds and exports off the main thread.

The tests assert every mesh is watertight (each edge shared by exactly two
triangles in opposite directions). Timings: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON lib/relief/bench.ts`.
A keychain builds in about 100 ms; a 150 mm lithophane at 0.2 mm is about 770k
triangles and takes about 3 s to write as 3MF.

"Send it to the shop" goes through the same `submitQuote` action as the main
quote form, with the 3MF, the original image and a spec summary attached, and
requires the customer to confirm they have rights to the image.

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

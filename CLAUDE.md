# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # http://localhost:3000 (the user often runs it on 8080: npm run dev -- -p 8080)
npm run build        # production build
npm run typecheck    # tsc --noEmit — the only static check; there is no linter
npm test             # node --test over lib/**/*.test.ts (Node 22.18+, type stripping, no test deps)

# one test file
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test lib/relief/mesh.test.ts
# relief pipeline timings
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON lib/relief/bench.ts
```

Tests run TypeScript directly in Node, so files under `lib/relief/` import each other with explicit
`.ts` extensions (`./mesh.ts`). Keep that; code outside `lib/` imports them through `@/lib/relief/...`.

This is a Next.js 15 app, not a static folder: `python -m http.server` on this repo serves nothing useful
(that command belongs to the sibling `project-phoenix-uav` repo's `site/`).

## What this is

The JR Print Forge marketing site (a 3D-printing shop), built from the Claude Design handoff in
`project/`. `project/Design Handoff.dc.html` is the written spec; "handoff §NN" in code comments points at
its sections. `project/` is reference only — excluded from `tsconfig` and from routing
(`pageExtensions: ['ts','tsx']` means its `.js`/`.html` can never become pages). Never import from it.

`README.md` lists deliberate launch placeholders (portfolio photos, quote email transport at
`TODO(launch)`, unverified figures from handoff §01). Don't "fix" those figures by inventing numbers.

## Architecture

**Server-first.** `app/page.tsx` composes the sections as server components; client components are only the
interactive pieces (hero, PulseSurface, Reveal/MotionProvider, Testimonials, StatCell, QuoteForm, Estimator,
gearbox viewer, sketch studio). All page copy lives in `lib/content.ts`.

**One price table, one intake path.** `lib/pricing.ts` (`estimate()`, `MATERIAL`/`SIZE`/`SPEED`) is used by the
live Estimator, QuoteForm and SketchStudio, and is recomputed server-side in `app/quote/actions.ts`
(`submitQuote`) rather than trusted from the client. Every request — the main form and "send it to the
shop" from `/sketch` — goes through `submitQuote` (zod schema, 10 files, 100 MB, extension allow-list;
`next.config.ts` raises the server-action body limit to match).

**Design tokens.** Brand colours exist only as Tailwind v4 `@theme` tokens in `app/globals.css`, and in the
WebGL code only through `components/hero/forge/jr-palette.js` — no hex literals in material code. No
`rounded-*` anywhere (handoff §08).

**Two three.js builds, never on one page.** The hero uses `three/webgpu` (TSL node materials); the gearbox
viewer uses plain `three` because OrbitControls and the exporters import `'three'`. Loading both on one
page puts two copies of three in memory. three is always dynamically imported (`dynamic(..., { ssr:false })`
behind an IntersectionObserver) so it never enters the initial bundle.

### The hero (`components/hero/`)

Built on Project Phoenix's rendering pattern (`../project-phoenix-uav/site`): benchmark/telemetry →
quality manager → director → systems.

- `ForgeStage.tsx` is the director: one `setAnimationLoop`, `quality.tick → forge.tick → particles.frame →
  RenderPipeline.render`. It reports the backend *actually* obtained and the particle count *actually*
  drawn to the readout strip in `Hero.tsx`; the strip must never claim more than is on screen.
- `forge/quality.js` is the **only** place performance decisions are made (device classification from the
  adapter, 1 s windows, step down/up with hysteresis and a doubling ban, eased particle count, render
  scale). Systems apply the settings they are given; a system that measures its own fps is a bug.
- `forge/particles.js` — GPU compute particles (TSL `instancedArray` + kernels): the JR "cast" (targets
  generated on the GPU by area-weighted triangle sampling of the extruded glyphs, snapped to print layers,
  deposited bottom-up), strike sparks, and forge embers. WebGPU only.
- `forge/scene.js` (anvil, hammer swing, glyph path data for the serif JR), `materials.js`, `flame.js`
  (raymarched fire), `lattice.js` (CAD wireframe of the glyphs) take the `THREE`/`TSL` namespaces as
  arguments (geo-lib convention); `geo-lib/` and `tsl-lib/` are vendored from the bundle, keep their
  relative imports.
- WebGL2 fallback (no WebGPU adapter): no particles — its transform-feedback compute draws nothing — so it
  keeps the extruded wordmark mesh and CPU sprite sparks. A failed boot degrades to a CSS gradient.
- `?particles=N` pins the pool and disables the adaptive manager. `window.__forge.stats` exposes live
  metrics for local inspection; telemetry is local only, never transmitted.

Hard-won gotchas in this code:

- React Strict Mode runs effects twice in dev. Anything created before an `await` (the canvas) must have
  its cleanup registered before the `await`, or a dead canvas stacks over the live one.
- WGSL `pow(x, y)` is `exp2(y·log2 x)` — NaN for `x < 0`, and a NaN velocity never recovers. Square with
  `q.mul(q)`, clamp bases before `pow`.
- Normalize stored normals in the shader before high-exponent specular; a few percent over unit length
  becomes an 8× highlight that blooms the scene white.
- `SpriteNodeMaterial` is `transparent: true` by default. Dense additive particle surfaces sum past the
  bloom threshold; the cast is drawn as alpha-tested, depth-written dots instead. The bloom input is
  clamped (`sceneColor.min(3)`).
- TSL `hash()` casts its seed to uint: seed with uint index arithmetic, not floats (exact only to 2^24).
- `renderer.compute(kernel, count)` dispatches only the drawn prefix; kernels are built over the full pool.
- `THREE.PostProcessing` is renamed `THREE.RenderPipeline` in r184; `pass()` inherits the renderer's MSAA.

### Sketch to Print (`/sketch`)

Image → printable part (keychain/plaque/coaster, lithophane, cookie cutter), entirely in the browser.
`lib/relief/` is pure and tested: `raster.ts` (threshold, distance transform, cleanup) → `products.ts`
(product specs and printability checks, 0.8 mm min feature) → `mesh.ts` (height field → one closed,
consistently wound solid) → `export.ts` (streamed 3MF, binary STL). The invariant the tests enforce: every
mesh is watertight (each edge shared by exactly two triangles in opposite directions).
`components/sketch/pipeline.worker.ts` runs build/export off the main thread.

### Gearbox (`/gearbox`)

`components/gearbox/` — reference-part viewer. The spec panel computes every figure from the mesh on
screen, so labels cannot disagree with the geometry (hence 120 mm OD, not the prototype's 66 mm).

## Review

`AGENT_REVIEW_CHECKLIST.md` applies to every agent-proposed change; its §13 merge gate (typecheck/tests pass,
every API exists in the pinned version, no frame-time regression, visual diff reviewed, works on the
no-WebGPU path, simplest version) must hold before merge.

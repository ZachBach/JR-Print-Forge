'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { submitQuote } from '@/app/quote/actions';
import Estimator from '@/components/quote/Estimator';
import {
  MATERIAL,
  MAX_QTY,
  MIN_QTY,
  SPEED,
  type MaterialKey,
  type SizeKey,
  type SpeedKey,
} from '@/lib/pricing';
import {
  artSize,
  DEFAULT_IMAGE,
  DEFAULTS,
  effectiveMode,
  findArt,
  planCell,
  type CutterSpec,
  type ImageMode,
  type ImageSettings,
  type LithophaneSpec,
  type ProductKind,
  type ReliefSpec,
} from '@/lib/relief/products';
import type { Box } from '@/lib/relief/raster';
import { analysisGrid, greyGrid, loadFile, sampleSketch, toPng, type Source } from './image';
import { Pipeline, type Built, type CadState } from './pipeline';

// three.js and the viewer stay off the critical path, same as the other stages.
const SketchStage = dynamic(() => import('./SketchStage'), {
  ssr: false,
  loading: () => (
    <div className="grid min-h-[52vh] place-items-center">
      <span className="font-mono text-[10px] uppercase tracking-[.28em] text-dim">Loading preview…</span>
    </div>
  ),
});

const LABEL = 'mb-3 block font-mono text-[10px] uppercase tracking-[.2em] text-blue';
const SUB = 'font-mono text-[10px] uppercase tracking-[.14em] text-body';
const FIELD = 'w-full border border-white/[.14] bg-ground p-3 text-[14px] text-ink';

const PRODUCTS: Record<ProductKind, { title: string; blurb: string }> = {
  relief: { title: 'Keychain & plaque', blurb: 'Your lines raised on a plate — keychains, coasters, name plates.' },
  lithophane: { title: 'Lithophane', blurb: 'A thin panel that shows the picture when light shines through.' },
  cutter: { title: 'Cookie cutter', blurb: 'A cutter that follows the outline of the drawing.' },
};

const MODES: Record<ImageMode, string> = {
  sketch: 'Napkin sketch',
  artwork: 'Clean artwork',
  photo: 'Photo',
};

const MODE_HINT: Record<ImageMode, string> = {
  sketch: 'Pen or pencil on paper, photographed. Shadows across the page are ignored.',
  artwork: 'Digital line art or a logo. Solid fills stay solid.',
  photo: 'Shades of grey become heights.',
};

const SHAPES: Array<[ReliefSpec['shape'], string]> = [
  ['rounded', 'Rounded'],
  ['rect', 'Square'],
  ['circle', 'Circle'],
  ['outline', 'Cut to drawing'],
];

const DETAIL: Array<[number, string]> = [
  [0.4, 'Standard'],
  [0.3, 'Fine'],
  [0.2, 'Ultra'],
];

const COLORS: Array<[string, string]> = [
  ['#ECEAE4', 'White'],
  ['#2A2C2E', 'Black'],
  ['#8E969B', 'Grey'],
  ['#FF6B00', 'Forge orange'],
  ['#2F7FC1', 'Blue'],
  ['#C23B2E', 'Red'],
];

type Specs = typeof DEFAULTS;

const mm = (v: number, d = 1) => `${v.toFixed(d).replace(/\.0+$/, '')} mm`;

function sizeKey(size: [number, number, number]): SizeKey {
  const longest = Math.max(size[0], size[1]);
  if (longest < 80) return 'palm';
  if (longest < 250) return 'shoebox';
  return 'large';
}

function describe(kind: ProductKind, specs: Specs, mode: ImageMode, cell: number, built: Built, color: string) {
  const [w, h, t] = built.size;
  let line: string;
  if (kind === 'relief') {
    const s = specs.relief;
    const shape = SHAPES.find(([k]) => k === s.shape)?.[1] ?? s.shape;
    line =
      `Keychain & plaque — ${shape.toLowerCase()} plate, design ${s.style} ${mm(s.relief)} on a ${mm(s.base)} base` +
      (s.border > 0 ? `, ${mm(s.border)} rim` : '') +
      (s.hole ? ', keyring tab' : '') +
      '.';
  } else if (kind === 'lithophane') {
    const s = specs.lithophane;
    line =
      `Lithophane — ${mm(s.minThickness)} to ${mm(s.maxThickness)} thick` +
      (s.frame > 0 ? `, ${mm(s.frame)} frame` : '') +
      (s.hole ? ', hanging tab' : '') +
      '.';
  } else {
    const s = specs.cutter;
    line = `Cookie cutter — ${mm(s.wall)} wall, ${mm(s.height)} tall, ${mm(s.flangeWidth)} lip.`;
  }
  const parts = [
    `Made with Sketch to Print. ${line}`,
    `Finished size ${w.toFixed(1)} × ${h.toFixed(1)} × ${t.toFixed(1)} mm. Image read as: ${MODES[mode].toLowerCase()}. Grid ${cell.toFixed(2)} mm. Preview colour: ${color}.`,
  ];
  if (built.warnings.length) parts.push(`Checks flagged: ${built.warnings.join(' ')}`);
  return parts.join('\n');
}

export default function SketchStudio() {
  const pipeline = useRef<Pipeline | null>(null);
  const thumbRef = useRef<HTMLCanvasElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);

  const [source, setSource] = useState<Source | null>(null);
  const [kind, setKind] = useState<ProductKind>('relief');
  const [specs, setSpecs] = useState<Specs>(DEFAULTS);
  const [img, setImg] = useState<ImageSettings>(DEFAULT_IMAGE);
  const [detail, setDetail] = useState(0.3);
  const [color, setColor] = useState(COLORS[0]);
  const [backlit, setBacklit] = useState(true);

  const [built, setBuilt] = useState<Built | null>(null);
  const [cad, setCad] = useState<CadState | null>(null);
  const [cell, setCell] = useState(detail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const [order, setOrder] = useState<{ material: MaterialKey; speed: SpeedKey; qty: number }>({
    material: 'PLA',
    speed: 'standard',
    qty: 1,
  });
  const [sending, startSending] = useTransition();
  const [reference, setReference] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const mode = effectiveMode(kind, img.mode);

  useEffect(() => {
    const p = new Pipeline(
      (b) => {
        setBuilt(b);
        setError(null);
      },
      (message) => setError(message),
      setBusy,
    );
    pipeline.current = p;
    setSource(sampleSketch());
    return () => {
      p.dispose();
      pipeline.current = null;
    };
  }, []);

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError(`${file.name} isn't an image. JPG, PNG or WebP work best.`);
      return;
    }
    try {
      setSource(await loadFile(file));
      setError(null);
      setReference(null);
    } catch {
      setError(`We couldn't read ${file.name}. Try saving it as a JPG or PNG.`);
    }
  }

  // Paste an image from the clipboard anywhere on the page.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (file) void onFile(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const analysis = useMemo(() => (source ? analysisGrid(source) : null), [source]);

  // Drawings are cropped to their ink, so the napkin and the table around it
  // don't end up in the part. Photos are used whole.
  const crop = useMemo<Box | null>(() => {
    if (!source || !analysis) return null;
    const whole = { x: 0, y: 0, w: source.width, h: source.height };
    if (mode === 'photo') return whole;
    const b = findArt(analysis.grey, analysis.cols, analysis.rows, { ...img, mode });
    if (!b) return whole;
    const sx = source.width / analysis.cols;
    const sy = source.height / analysis.rows;
    return { x: b.x * sx, y: b.y * sy, w: b.w * sx, h: b.h * sy };
    // Only the settings that change what counts as ink move the crop.
  }, [source, analysis, mode, img.sensitivity, img.invert]);

  useEffect(() => {
    if (!source || !crop) return;
    const t = setTimeout(() => {
      const p = pipeline.current;
      if (!p) return;
      const spec = specs[kind];
      const aspect = crop.w / crop.h;
      const c = planCell(spec, aspect, detail);
      const { cols, rows } = artSize(spec, aspect, c);
      const art = greyGrid(source, crop, cols, rows);
      setCell(c);
      p.build({ spec, img: { ...img, mode }, art, cols, rows, cell: c });
    }, 90);
    return () => clearTimeout(t);
  }, [source, crop, kind, specs, img, mode, detail]);

  /**
   * Recover the CAD model once the build has settled. It costs more than a
   * rebuild — tracing outlines and triangulating them — so it deliberately lags
   * behind the sliders instead of running on every drag.
   */
  useEffect(() => {
    setCad(null);
    if (!built || built.triangles === 0) return;
    const t = setTimeout(() => {
      const p = pipeline.current;
      if (!p) return;
      void p.cad({ material: order.material }).then(setCad, () => setCad(null));
    }, 400);
    return () => clearTimeout(t);
  }, [built, order.material]);

  useEffect(() => {
    const canvas = thumbRef.current;
    if (!canvas || !built) return;
    const { width, height, rgba } = built.thumb;
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')?.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
  }, [built]);

  const setRelief = (p: Partial<ReliefSpec>) => setSpecs((s) => ({ ...s, relief: { ...s.relief, ...p } }));
  const setLitho = (p: Partial<LithophaneSpec>) => setSpecs((s) => ({ ...s, lithophane: { ...s.lithophane, ...p } }));
  const setCutter = (p: Partial<CutterSpec>) => setSpecs((s) => ({ ...s, cutter: { ...s.cutter, ...p } }));
  const setImage = (p: Partial<ImageSettings>) => setImg((s) => ({ ...s, ...p }));

  const size = built?.size ?? [0, 0, 0];
  const title = `${PRODUCTS[kind].title} ${Math.round(size[0])}×${Math.round(size[1])} mm`;
  const fileBase = `jrpf-${kind}-${Math.round(size[0])}x${Math.round(size[1])}mm`;
  const summary = built ? describe(kind, specs, mode, cell, built, color[1]) : '';
  const ready = !!built && !busy && built.triangles > 0;

  // Order-only: the model file goes to the shop with the request and is never
  // offered as a download.
  function onSend(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const p = pipeline.current;
    if (!p || !built || !source) return;
    setSendError(null);
    const form = new FormData(e.currentTarget);
    startSending(async () => {
      try {
        const bytes = await p.export('3mf', title, summary);
        const fd = new FormData();
        fd.set('email', String(form.get('email') ?? ''));
        fd.set('material', order.material);
        fd.set('speed', order.speed);
        fd.set('qty', String(order.qty));
        fd.set('size', sizeKey(built.size));
        const notes = String(form.get('notes') ?? '').trim();
        const lines = [summary];
        if (cad?.ok) {
          const s = cad.summary;
          lines.push(
            `CAD: ${s.bodies.length} extruded ${s.bodies.length === 1 ? 'body' : 'bodies'} ` +
              `(${s.bodies.map((b) => `${b.name} ${mm(b.z1 - b.z0)}`).join(', ')}), outlines simplified to ` +
              `±${s.tolerance.toFixed(2)} mm, ${s.segments} segments. STEP solid + DXF outlines attached` +
              (s.bodies.length > 1 ? ', plus a 3MF split per body for two-colour printing' : '') +
              `. ${s.grams.toFixed(1)} g solid at ${mm(s.layerHeight, 2)} layers.`,
          );
        }
        if (notes) lines.push(`Customer notes: ${notes}`);
        fd.set('description', lines.join('\n\n'));
        fd.append('files', new File([bytes], `${fileBase}.3mf`, { type: 'model/3mf' }));

        // The CAD model goes with it: a STEP solid the shop can put a fillet on,
        // the outlines as a DXF to redraw from, and — when the part has more than
        // one level — a 3MF split into bodies so it can be printed in two colours.
        if (cad?.ok) {
          const second = COLORS.find((c) => c[0] !== color[0]) ?? COLORS[0];
          const colours = [color[0], second[0]];
          const step = await p.exportCad('step', title, summary, colours);
          fd.append('files', new File([step], `${fileBase}.step`, { type: 'application/step' }));
          const dxf = await p.exportCad('dxf', title, summary, colours);
          fd.append('files', new File([dxf], `${fileBase}.dxf`, { type: 'application/dxf' }));
          if (cad.summary.bodies.length > 1) {
            const split = await p.exportCad('cad3mf', title, summary, colours);
            fd.append('files', new File([split], `${fileBase}-bodies.3mf`, { type: 'model/3mf' }));
          }
        }

        // The original goes too, so the shop can redraw it if the auto-trace
        // isn't good enough. The quote form takes PNG and JPG as they are.
        if (source.file && /\.(png|jpe?g)$/i.test(source.file.name)) {
          fd.append('files', source.file);
        } else {
          fd.append('files', new File([await toPng(source)], `${fileBase}-source.png`, { type: 'image/png' }));
        }
        const res = await submitQuote(fd);
        if (!res.ok) {
          setSendError(res.error);
          return;
        }
        setReference(res.reference);
        requestAnimationFrame(() => confirmRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      } catch (err) {
        setSendError(err instanceof Error ? err.message : 'Something went wrong sending the request.');
      }
    });
  }

  const rows: Array<[string, string]> = built
    ? [
        ['Size', `${size[0].toFixed(1)} × ${size[1].toFixed(1)} × ${size[2].toFixed(1)} mm`],
        ['Volume', `${(built.volume / 1000).toFixed(1)} cm³`],
        ['Triangles', built.triangles.toLocaleString('en-US')],
        ['STL size', `${((84 + 50 * built.triangles) / 1048576).toFixed(1)} MB`],
        ['Grid', cell > detail + 1e-9 ? `${cell.toFixed(2)} mm (capped for size)` : `${cell.toFixed(2)} mm`],
        ['Built in', `${Math.round(built.ms)} ms`],
      ]
    : [];

  return (
    <>
      <section className="relative border-b border-hairline lg:sticky lg:top-[57px] lg:h-[calc(100vh-57px)] lg:border-b-0">
        <SketchStage built={built} kind={kind} color={color[0]} backlit={backlit} />
        <div className="pointer-events-none absolute left-4 top-4 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[.18em]">
          <span className="border border-white/15 bg-ground/80 px-2.5 py-1.5 text-ink">{PRODUCTS[kind].title}</span>
          {built && built.triangles > 0 && (
            <span className="border border-white/15 bg-ground/80 px-2.5 py-1.5 text-body-bright">
              {size[0].toFixed(0)} × {size[1].toFixed(0)} × {size[2].toFixed(1)} mm
            </span>
          )}
          {busy && <span className="border border-ember/50 bg-ground/80 px-2.5 py-1.5 text-ember">Building…</span>}
        </div>
      </section>

      <aside className="flex flex-col gap-8 border-hairline bg-[#0E0F10] p-[clamp(22px,3vw,34px)] lg:border-l">
        <header>
          <div className="mb-3 font-mono text-[10px] uppercase tracking-[.28em] text-blue">Sketch to print</div>
          <h1 className="mb-3 font-display text-[28px] font-bold leading-[1.05] text-ink">
            Your drawing, printed.
          </h1>
          <p className="text-sm leading-[1.65] text-body">
            Upload a photo of a napkin sketch, a kid&rsquo;s drawing, a logo or a photograph. We turn it
            into a part you can hold — shape it here, then we print it and ship it to you.
          </p>
        </header>

        {/* 01 — Image */}
        <section>
          <span className={LABEL}>01 · Your image</span>
          <div className="grid grid-cols-[minmax(0,1fr)_104px] gap-3">
            <label
              htmlFor="sketch-file"
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void onFile(e.dataTransfer.files[0]);
              }}
              className={`flex cursor-pointer flex-col justify-center gap-2 border border-dashed px-4 py-5 transition-colors hover:border-blue hover:bg-blue/[.09] ${
                dragging ? 'border-blue bg-blue/[.09]' : 'border-blue/40 bg-blue/[.04]'
              }`}
            >
              <span className="break-words font-display text-[15px] font-semibold leading-tight text-ink">
                {source?.file ? source.name : 'Drop a photo or drawing'}
              </span>
              <span className="font-mono text-[9.5px] uppercase tracking-[.14em] text-body">
                Click to browse · or paste · JPG PNG WebP
              </span>
            </label>
            <figure className="m-0 flex flex-col items-center justify-center gap-1.5 border border-white/10 bg-ground p-2">
              <canvas ref={thumbRef} className="max-h-[72px] w-full object-contain" aria-label="Height map of the part, top-down" />
              <figcaption className="font-mono text-[8.5px] uppercase tracking-[.14em] text-dim">Height map</figcaption>
            </figure>
          </div>
          <input
            id="sketch-file"
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <p className="mt-2.5 text-[12.5px] leading-[1.55] text-dim">
            {source && !source.file ? (
              'Showing our sample sketch until you add yours.'
            ) : (
              <button type="button" onClick={() => setSource(sampleSketch())} className="text-blue hover:text-ember">
                Back to the sample sketch
              </button>
            )}
          </p>
        </section>

        {/* 02 — Product */}
        <section>
          <span className={LABEL}>02 · Make it into</span>
          <div role="radiogroup" aria-label="Product" className="grid gap-2">
            {(Object.keys(PRODUCTS) as ProductKind[]).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => setKind(k)}
                className={`border px-4 py-3 text-left transition-colors ${
                  kind === k ? 'border-ember bg-ember/[.08]' : 'border-white/[.12] hover:border-white/30'
                }`}
              >
                <span className="block font-display text-[15px] font-semibold text-ink">{PRODUCTS[k].title}</span>
                <span className="block text-[12.5px] leading-[1.5] text-body">{PRODUCTS[k].blurb}</span>
              </button>
            ))}
          </div>
        </section>

        {/* 03 — Image reading */}
        <section className="flex flex-col gap-4">
          <span className={`${LABEL} mb-0`}>03 · Read the image as</span>
          {kind !== 'lithophane' && (
            <Choice
              label="Image type"
              value={mode}
              onChange={(m) => setImage({ mode: m })}
              options={(kind === 'cutter' ? ['sketch', 'artwork'] : ['sketch', 'artwork', 'photo']).map(
                (m) => [m as ImageMode, MODES[m as ImageMode]],
              )}
            />
          )}
          <p className="-mt-1 text-[12.5px] leading-[1.5] text-dim">{MODE_HINT[mode]}</p>
          {mode === 'photo' ? (
            <Slider id="smooth" label="Smoothing" value={img.smoothing} min={0} max={2} step={0.1} onChange={(v) => setImage({ smoothing: v })} />
          ) : (
            <>
              <Slider id="sens" label="Sensitivity" value={img.sensitivity} min={0} max={1} step={0.05} unit="" digits={2} onChange={(v) => setImage({ sensitivity: v })} />
              <Slider id="bold" label="Line boost" value={img.bolden} min={0} max={2} step={0.1} onChange={(v) => setImage({ bolden: v })} />
              <Slider id="speck" label="Speck filter" value={img.despeckle} min={0} max={10} step={0.5} unit="mm²" onChange={(v) => setImage({ despeckle: v })} />
            </>
          )}
          <Check id="invert" label="Light lines on a dark background" checked={img.invert} onChange={(v) => setImage({ invert: v })} />
        </section>

        {/* 04 — Shape & size */}
        <section className="flex flex-col gap-4">
          <span className={`${LABEL} mb-0`}>04 · Shape &amp; size</span>
          {kind === 'relief' && (
            <>
              <Choice label="Shape" value={specs.relief.shape} onChange={(v) => setRelief({ shape: v })} options={SHAPES} />
              <Choice
                label="Style"
                value={specs.relief.style}
                onChange={(v) => setRelief({ style: v })}
                options={[
                  ['raised', 'Raised'],
                  ['engraved', 'Engraved'],
                ]}
              />
              <Slider id="rw" label={specs.relief.shape === 'circle' ? 'Diameter' : 'Width'} value={specs.relief.width} min={20} max={250} step={1} digits={0} onChange={(v) => setRelief({ width: v })} />
              <Slider id="rb" label="Plate" value={specs.relief.base} min={0.8} max={6} step={0.1} onChange={(v) => setRelief({ base: v })} />
              <Slider id="rr" label={specs.relief.style === 'raised' ? 'Raised by' : 'Engraved by'} value={specs.relief.relief} min={0.2} max={5} step={0.1} onChange={(v) => setRelief({ relief: v })} />
              <Slider id="rm" label="Margin" value={specs.relief.margin} min={0} max={15} step={0.5} onChange={(v) => setRelief({ margin: v })} />
              <Slider id="rim" label="Rim" value={specs.relief.border} min={0} max={4} step={0.2} onChange={(v) => setRelief({ border: v })} />
              <Check id="rhole" label="Keyring tab" checked={specs.relief.hole} onChange={(v) => setRelief({ hole: v })} />
            </>
          )}
          {kind === 'lithophane' && (
            <>
              <Slider id="lw" label="Width" value={specs.lithophane.width} min={40} max={250} step={1} digits={0} onChange={(v) => setLitho({ width: v })} />
              <Slider id="lmin" label="Thinnest" value={specs.lithophane.minThickness} min={0.4} max={2} step={0.1} onChange={(v) => setLitho({ minThickness: v })} />
              <Slider id="lmax" label="Thickest" value={specs.lithophane.maxThickness} min={1.5} max={6} step={0.1} onChange={(v) => setLitho({ maxThickness: v })} />
              <Slider id="lf" label="Frame" value={specs.lithophane.frame} min={0} max={10} step={0.5} onChange={(v) => setLitho({ frame: v })} />
              <Check id="lhole" label="Hanging tab" checked={specs.lithophane.hole} onChange={(v) => setLitho({ hole: v })} />
              <Check id="lit" label="Preview lit from behind" checked={backlit} onChange={setBacklit} />
            </>
          )}
          {kind === 'cutter' && (
            <>
              <Slider id="cw" label="Width" value={specs.cutter.width} min={30} max={200} step={1} digits={0} onChange={(v) => setCutter({ width: v })} />
              <Slider id="ch" label="Cutting depth" value={specs.cutter.height} min={6} max={30} step={0.5} onChange={(v) => setCutter({ height: v })} />
              <Slider id="cwall" label="Wall" value={specs.cutter.wall} min={0.6} max={3} step={0.1} onChange={(v) => setCutter({ wall: v })} />
              <Slider id="clw" label="Grip lip" value={specs.cutter.flangeWidth} min={0} max={10} step={0.5} onChange={(v) => setCutter({ flangeWidth: v })} />
              <Slider id="clh" label="Lip height" value={specs.cutter.flangeHeight} min={0.8} max={4} step={0.2} onChange={(v) => setCutter({ flangeHeight: v })} />
              <Slider id="cgap" label="Gap closing" value={specs.cutter.gapClose} min={0} max={5} step={0.25} digits={2} onChange={(v) => setCutter({ gapClose: v })} />
              <p className="text-[12.5px] leading-[1.5] text-dim">
                Follows the outer edge only — lines inside the shape are ignored. Hand-wash; printed plastic isn&rsquo;t dishwasher-safe.
              </p>
            </>
          )}
        </section>

        {/* 05 — Detail & colour */}
        <section className="flex flex-col gap-4">
          <span className={`${LABEL} mb-0`}>05 · Detail &amp; colour</span>
          <Choice label="Detail" value={detail} onChange={setDetail} options={DETAIL} />
          {!(kind === 'lithophane' && backlit) && (
            <div role="radiogroup" aria-label="Preview colour" className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c[0]}
                  type="button"
                  role="radio"
                  aria-checked={color[0] === c[0]}
                  aria-label={c[1]}
                  title={c[1]}
                  onClick={() => setColor(c)}
                  className={`size-7 border-2 ${color[0] === c[0] ? 'border-ember' : 'border-white/15 hover:border-white/40'}`}
                  style={{ background: c[0] }}
                />
              ))}
            </div>
          )}
        </section>

        {/* Readout */}
        <section aria-live="polite">
          <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-3.5 gap-y-2.5 border-t border-hairline pt-[18px] text-[13px]">
            {rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-body">{label}</dt>
                <dd className="m-0 text-right font-mono text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          {error && (
            <p role="alert" className="mt-4 font-mono text-[11px] uppercase leading-[1.6] tracking-[.12em] text-ember">
              {error}
            </p>
          )}
          {built && (
            <ul className="mt-4 flex list-none flex-col gap-2 p-0 text-[13px] leading-[1.55]">
              {built.warnings.length ? (
                built.warnings.map((w) => (
                  <li key={w} className="border-l-2 border-ember pl-3 text-body-bright">
                    {w}
                  </li>
                ))
              ) : (
                <li className="border-l-2 border-blue/60 pl-3 text-body">No problems found by our automatic checks.</li>
              )}
            </ul>
          )}

          {/* What the shop gets: the part as CAD geometry, not just a mesh. */}
          {cad && (
            <div className="mt-5 border-t border-hairline pt-4">
              <span className={SUB}>CAD model</span>
              {cad.ok ? (
                <>
                  <dl className="m-0 mt-3 grid grid-cols-[1fr_auto] gap-x-3.5 gap-y-2.5 text-[13px]">
                    {cad.summary.bodies.map((b) => (
                      <div key={b.name} className="contents">
                        <dt className="text-body">{b.name}</dt>
                        <dd className="m-0 text-right font-mono text-ink">
                          {mm(b.z1 - b.z0)} · {Math.round(b.layers)} layers · {b.segments} seg
                          {b.holes > 0 ? ` · ${b.holes} hole${b.holes > 1 ? 's' : ''}` : ''}
                        </dd>
                      </div>
                    ))}
                    <div className="contents">
                      <dt className="text-body">Outline tolerance</dt>
                      <dd className="m-0 text-right font-mono text-ink">±{cad.summary.tolerance.toFixed(2)} mm</dd>
                    </div>
                    <div className="contents">
                      <dt className="text-body">Solid triangles</dt>
                      <dd className="m-0 text-right font-mono text-ink">
                        {cad.summary.triangles.toLocaleString('en-US')}
                        {built && built.triangles > 0
                          ? ` (${Math.round((1 - cad.summary.triangles / built.triangles) * 100)}% fewer)`
                          : ''}
                      </dd>
                    </div>
                    <div className="contents">
                      <dt className="text-body">Filament, solid</dt>
                      <dd className="m-0 text-right font-mono text-ink">{cad.summary.grams.toFixed(1)} g</dd>
                    </div>
                  </dl>
                  <p className="mt-3 text-[13px] leading-[1.55] text-body">
                    Sent with your request as a STEP solid and a DXF of the outlines, at{' '}
                    {mm(cad.summary.layerHeight, 2)} layers
                    {cad.summary.bodies.length > 1
                      ? ', plus a 3MF split into bodies so the design can print in a second colour.'
                      : '.'}
                  </p>
                  {cad.summary.warnings.length > 0 && (
                    <ul className="mt-3 flex list-none flex-col gap-2 p-0 text-[13px] leading-[1.55]">
                      {cad.summary.warnings.map((w) => (
                        <li key={w} className="border-l-2 border-blue/60 pl-3 text-body-bright">
                          {w}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p className="mt-3 text-[13px] leading-[1.55] text-body">{cad.reason}</p>
              )}
            </div>
          )}
        </section>

        {/* 06 — Order */}
        <section>
          <span className={LABEL}>06 · Get it printed</span>
          <form onSubmit={onSend} className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-2">
                <span className={SUB}>Material</span>
                <select
                  value={order.material}
                  onChange={(e) => setOrder((o) => ({ ...o, material: e.target.value as MaterialKey }))}
                  className={FIELD}
                >
                  {(Object.keys(MATERIAL) as MaterialKey[]).map((k) => (
                    <option key={k} value={k}>
                      {MATERIAL[k].label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-2">
                <span className={SUB}>Quantity</span>
                <input
                  type="number"
                  min={MIN_QTY}
                  max={MAX_QTY}
                  step={1}
                  value={order.qty}
                  onChange={(e) => setOrder((o) => ({ ...o, qty: parseInt(e.target.value, 10) || MIN_QTY }))}
                  className={FIELD}
                />
              </label>
            </div>
            <label className="flex flex-col gap-2">
              <span className={SUB}>Timeline</span>
              <select
                value={order.speed}
                onChange={(e) => setOrder((o) => ({ ...o, speed: e.target.value as SpeedKey }))}
                className={FIELD}
              >
                {(Object.keys(SPEED) as SpeedKey[]).map((k) => (
                  <option key={k} value={k}>
                    {SPEED[k].label}
                  </option>
                ))}
              </select>
            </label>

            {built && built.triangles > 0 && (
              <Estimator input={{ material: order.material, size: sizeKey(built.size), speed: order.speed, qty: order.qty }} />
            )}

            <label className="flex flex-col gap-2">
              <span className={SUB}>Anything we should know</span>
              <textarea
                name="notes"
                rows={3}
                maxLength={2000}
                placeholder="Colours, a name to add, what it's for…"
                className={`${FIELD} resize-y leading-[1.55]`}
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className={SUB}>Where do we send the quote</span>
              <input name="email" type="email" required placeholder="you@example.com" className={FIELD} />
            </label>
            <label className="flex items-start gap-3 text-[13px] leading-[1.5] text-body">
              <input type="checkbox" name="rights" required className="mt-[3px] size-4 shrink-0 accent-ember" />
              <span>It&rsquo;s for my own personal use, or I have permission to reproduce this image.</span>
            </label>

            {sendError && (
              <p role="alert" className="font-mono text-[11px] uppercase tracking-[.12em] text-ember">
                {sendError}
              </p>
            )}
            <button
              type="submit"
              disabled={!ready || sending}
              className="border border-ember bg-ember px-6 py-4 font-mono text-[11px] font-medium uppercase tracking-[.22em] text-ground transition-colors hover:border-ember-hot hover:bg-ember-hot disabled:opacity-60"
            >
              {sending ? 'Sending…' : 'Send it to the shop'}
            </button>
            <p className="text-[12px] leading-[1.55] text-dim">
              We attach the 3MF and your original image. An engineer checks it and emails a firm quote,
              typically within 1 business day.
            </p>
          </form>

          {reference && (
            <div ref={confirmRef} className="mt-5 border border-ember bg-gradient-to-b from-ember/10 to-ember/[.02] p-5">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[.24em] text-ember">
                Request received · {reference}
              </div>
              <p className="text-[14px] leading-[1.6] text-body-bright">
                Thanks — we have the model and your image. Questions? Contact{' '}
                <a href="mailto:quotes@jrprintforge.com" className="text-blue hover:text-ember">
                  quotes@jrprintforge.com
                </a>
                .
              </p>
            </div>
          )}
        </section>
      </aside>
    </>
  );
}

function Slider(props: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  digits?: number;
  onChange: (v: number) => void;
}) {
  const { id, label, value, min, max, step, unit = 'mm', digits = 1, onChange } = props;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className={SUB}>
          {label}
        </label>
        <output htmlFor={id} className="font-mono text-[12px] text-ink">
          {value.toFixed(digits)}
          {unit && ` ${unit}`}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-ember"
      />
    </div>
  );
}

function Choice<T extends string | number>(props: {
  label: string;
  value: T;
  options: Array<[T, string]>;
  onChange: (v: T) => void;
}) {
  const { label, value, options, onChange } = props;
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map(([v, text]) => (
        <button
          key={String(v)}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`border px-3 py-2 font-mono text-[10px] uppercase tracking-[.14em] transition-colors ${
            value === v ? 'border-ember bg-ember/10 text-ink' : 'border-white/[.12] text-body hover:border-white/30'
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function Check(props: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={props.id} className="flex cursor-pointer items-center gap-3 text-[13px] text-body-bright">
      <input
        id={props.id}
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
        className="size-4 accent-ember"
      />
      {props.label}
    </label>
  );
}

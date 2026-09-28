'use client';

import { useRef, useState, useTransition } from 'react';
import { submitQuote } from '@/app/quote/actions';
import {
  MATERIAL,
  MAX_QTY,
  MIN_QTY,
  SIZE,
  SPEED,
  type MaterialKey,
  type SizeKey,
  type SpeedKey,
} from '@/lib/pricing';
import Estimator from './Estimator';
import ToleranceFaq from './ToleranceFaq';

const LABEL =
  'mb-2.5 block font-mono text-[10px] uppercase tracking-[.2em] text-blue';
const FIELD =
  'w-full border border-white/[.14] bg-[#0E0F10] p-[13px] text-[14.5px] text-ink';

export default function QuoteForm() {
  const fileInput = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [fileLabel, setFileLabel] = useState('Drop files here or click to browse');

  // The four inputs the price depends on. Kept here so the panel updates on
  // every change without the form owning a pricing concern.
  const [spec, setSpec] = useState<{
    material: MaterialKey;
    size: SizeKey;
    speed: SpeedKey;
    qty: number;
  }>({ material: 'PLA', size: 'palm', speed: 'standard', qty: 1 });

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await submitQuote(form);
      if (!res.ok) { setError(res.error); return; }
      setReference(res.reference);
      requestAnimationFrame(() => {
        const el = confirmRef.current;
        if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 120, behavior: 'smooth' });
      });
    });
  }

  return (
    <>
      <div className="grid items-start gap-6 [grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr))]">
        {/* Price uncertainty, not form length, is what stops an upload — so on
            a narrow screen the estimate comes first. Handoff §09.1. */}
        <form
          onSubmit={onSubmit}
          className="order-2 flex flex-col gap-[22px] border border-white/10 bg-panel p-[clamp(24px,3vw,38px)] lg:order-1"
        >
          <div>
            <span className={LABEL}>01 · Your files</span>
            <label
              htmlFor="qfile"
              className="flex cursor-pointer flex-col items-center justify-center gap-2.5 border border-dashed border-blue/40 bg-blue/[.04] px-5 py-[34px] text-center transition-colors hover:border-blue hover:bg-blue/[.09]"
            >
              <span className="font-display text-base font-semibold text-ink">{fileLabel}</span>
              <span className="font-mono text-[9.5px] uppercase tracking-[.16em] text-body">
                STL · STEP · OBJ · 3MF · sketch — 100 MB max
              </span>
            </label>
            <input
              id="qfile"
              name="files"
              ref={fileInput}
              type="file"
              multiple
              accept=".stl,.step,.stp,.obj,.3mf,.pdf,.png,.jpg,.jpeg"
              onChange={(ev) => {
                const f = [...(ev.target.files ?? [])];
                setFileLabel(
                  f.length
                    ? `${f.length} file${f.length > 1 ? 's' : ''} attached · ${f[0].name}`
                    : 'Drop files here or click to browse',
                );
              }}
              className="pointer-events-none absolute size-px opacity-0"
            />
            <a
              href="/sketch"
              className="mt-2.5 inline-block font-mono text-[10px] uppercase tracking-[.14em] text-blue hover:text-ember"
            >
              Only have a drawing? Preview it in 3D first →
            </a>
          </div>

          <div>
            <label htmlFor="qdesc" className={LABEL}>
              02 · Project description
            </label>
            <textarea
              id="qdesc"
              name="description"
              rows={4}
              placeholder="What does the part do, what does it mate with, and what has to hold?"
              className={`${FIELD} resize-y leading-[1.6]`}
            />
          </div>

          <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr))]">
            <div>
              <label htmlFor="qmat" className={LABEL}>
                03 · Material
              </label>
              <select
                id="qmat"
                name="material"
                value={spec.material}
                onChange={(ev) => setSpec((s) => ({ ...s, material: ev.target.value as MaterialKey }))}
                className={FIELD}
              >
                {(Object.keys(MATERIAL) as MaterialKey[]).map((k) => (
                  <option key={k} value={k}>
                    {MATERIAL[k].label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="qsize" className={LABEL}>
                04 · Part size
              </label>
              <select
                id="qsize"
                name="size"
                value={spec.size}
                onChange={(ev) => setSpec((s) => ({ ...s, size: ev.target.value as SizeKey }))}
                className={FIELD}
              >
                {(Object.keys(SIZE) as SizeKey[]).map((k) => (
                  <option key={k} value={k}>
                    {SIZE[k].label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr))]">
            <div>
              <label htmlFor="qqty" className={LABEL}>
                05 · Quantity
              </label>
              <input
                id="qqty"
                name="qty"
                type="number"
                min={MIN_QTY}
                max={MAX_QTY}
                step={1}
                value={spec.qty}
                onChange={(ev) =>
                  setSpec((s) => ({ ...s, qty: parseInt(ev.target.value, 10) || MIN_QTY }))
                }
                className={FIELD}
              />
            </div>
            <div>
              <label htmlFor="qtime" className={LABEL}>
                06 · Timeline
              </label>
              <select
                id="qtime"
                name="speed"
                value={spec.speed}
                onChange={(ev) => setSpec((s) => ({ ...s, speed: ev.target.value as SpeedKey }))}
                className={FIELD}
              >
                {(Object.keys(SPEED) as SpeedKey[]).map((k) => (
                  <option key={k} value={k}>
                    {SPEED[k].label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="qemail" className={LABEL}>
              07 · Where do we send it
            </label>
            <input
              id="qemail"
              name="email"
              type="email"
              required
              placeholder="you@company.com"
              className={FIELD}
            />
          </div>

          {error && (
            <p role="alert" className="font-mono text-[11px] uppercase tracking-[.14em] text-ember">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="border border-ember bg-ember px-6 py-[18px] font-mono text-[11.5px] font-medium uppercase tracking-[.22em] text-ground transition-colors hover:border-ember-hot hover:bg-ember-hot disabled:opacity-60"
          >
            {pending ? 'Sending…' : 'Send quote request'}
          </button>
        </form>

        <aside className="order-1 flex flex-col gap-5 lg:order-2">
          <Estimator input={spec} />
          <ToleranceFaq />
        </aside>
      </div>

      {reference && (
        <div
          ref={confirmRef}
          className="mt-6 border border-ember bg-gradient-to-b from-ember/10 to-ember/[.02] p-[clamp(26px,4vw,40px)]"
        >
          <div className="mb-3.5 font-mono text-[10px] uppercase tracking-[.24em] text-ember">
            Quote request received · {reference}
          </div>
          <p className="mb-3 max-w-[66ch] font-display text-[clamp(17px,2vw,21px)] font-medium leading-[1.45] text-ink">
            Thanks for choosing JR Print Forge. We&rsquo;ve received your project details and files.
          </p>
          <p className="max-w-[66ch] text-[14.5px] leading-[1.65] text-body-bright">
            Our team will review your requirements and send a custom quote to your email, typically
            within 1 business day. Standard production turnaround is 3 business days after quote
            approval. Questions? Contact{' '}
            <a href="mailto:quotes@jrprintforge.com" className="text-blue hover:text-ember">
              quotes@jrprintforge.com
            </a>
            .
          </p>
        </div>
      )}
    </>
  );
}

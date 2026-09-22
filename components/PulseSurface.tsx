'use client';

import { forwardRef, useCallback, useEffect, useRef } from 'react';

type Props = {
  /** Where the mask lives is the child's business; this only supplies coords. */
  children: React.ReactNode;
  className?: string;
  id?: string;
  /** Mask radius in px. Exposed so a section can be tuned without a code change. */
  radius?: number;
  /** Kill switch — handoff §06. Off leaves a composition that still reads. */
  enabled?: boolean;
  as?: 'div' | 'section' | 'article' | 'figure';
};

/**
 * PulseSurface — handoff §06.
 *
 * One rAF-throttled pointer handler per surface writes `--mx` / `--my` onto
 * this element. Masked children pick the values up by inheritance, so the
 * cursor never touches React state and never re-renders a component.
 */
const PulseSurface = forwardRef<HTMLElement, Props>(function PulseSurface(
  { children, className = '', id, radius = 200, enabled = true, as: Tag = 'div' },
  forwarded,
) {
  const inner = useRef<HTMLElement | null>(null);
  const pending = useRef<{ x: number; y: number } | null>(null);
  const frame = useRef(0);

  const setRefs = useCallback(
    (node: HTMLElement | null) => {
      inner.current = node;
      if (typeof forwarded === 'function') forwarded(node);
      else if (forwarded) forwarded.current = node;
    },
    [forwarded],
  );

  const flush = useCallback(() => {
    frame.current = 0;
    const el = inner.current;
    const p = pending.current;
    if (!el || !p) return;
    el.style.setProperty('--mx', `${p.x}%`);
    el.style.setProperty('--my', `${p.y}%`);
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!enabled) return;
      const b = e.currentTarget.getBoundingClientRect();
      pending.current = {
        x: ((e.clientX - b.left) / b.width) * 100,
        y: ((e.clientY - b.top) / b.height) * 100,
      };
      if (!frame.current) frame.current = requestAnimationFrame(flush);
    },
    [enabled, flush],
  );

  useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current); }, []);

  return (
    <Tag
      ref={setRefs as never}
      id={id}
      onPointerMove={onPointerMove}
      className={`pm-surface ${className}`}
      style={{ '--pm-r': enabled ? `${radius}px` : '0px' } as React.CSSProperties}
    >
      {children}
    </Tag>
  );
});

export default PulseSurface;

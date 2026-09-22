'use client';

import { m, useReducedMotion } from 'framer-motion';
import { lattice, riseIn, still, VIEWPORT, wipeX } from '@/lib/motion';

type Props = { children: React.ReactNode; className?: string };

/** A single element that rises into place the first time it is seen. */
export function Reveal({ children, className }: Props) {
  const reduce = useReducedMotion();
  return (
    <m.div
      className={className}
      variants={reduce ? still : riseIn}
      initial="hidden"
      whileInView="show"
      viewport={VIEWPORT}
    >
      {children}
    </m.div>
  );
}

/**
 * Stagger container. Children must be `RevealItem`s and must not carry their
 * own whileInView, or each one re-triggers and the stagger falls apart.
 */
export function RevealGroup({ children, className }: Props) {
  const reduce = useReducedMotion();
  return (
    <m.div
      className={className}
      variants={reduce ? still : lattice}
      initial="hidden"
      whileInView="show"
      viewport={VIEWPORT}
    >
      {children}
    </m.div>
  );
}

export function RevealItem({ children, className }: Props) {
  const reduce = useReducedMotion();
  return (
    <m.div className={className} variants={reduce ? still : riseIn}>
      {children}
    </m.div>
  );
}

/** The ember bar that wipes across a process cell's top edge. */
export function WipeBar({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  return (
    <m.span
      aria-hidden="true"
      className={className}
      style={{ transformOrigin: 'left' }}
      variants={reduce ? still : wipeX}
    />
  );
}

/**
 * Shared motion — handoff §05. One easing curve, no overshoot, no spring.
 * Nothing animates twice and nothing animates on scroll-out, which is what
 * `once: true` on the viewport below buys.
 */
import type { Variants } from 'framer-motion';

export const EASE = [0.2, 0.7, 0.2, 1] as const;

export const VIEWPORT = { once: true, amount: 0.18 } as const;

export const riseIn: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
};

export const lattice: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.055 } },
};

export const wipeX: Variants = {
  hidden: { scaleX: 0 },
  show: { scaleX: 1, transition: { duration: 0.9, ease: EASE } },
};

/** The variant set to use when the visitor asked for less motion. */
export const still: Variants = {
  hidden: { opacity: 1, y: 0, scaleX: 1 },
  show: { opacity: 1, y: 0, scaleX: 1 },
};

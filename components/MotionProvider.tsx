'use client';

import { domAnimation, LazyMotion } from 'framer-motion';

/**
 * The page needs no layout animations, so the full framer-motion bundle is
 * dead weight — handoff §05. `strict` makes the compiler reject `motion.*`,
 * which would drag the whole bundle back in.
 */
export default function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      {children}
    </LazyMotion>
  );
}

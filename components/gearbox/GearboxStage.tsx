'use client';

import { useEffect, useRef } from 'react';
import { buildGearbox } from './gearbox.js';
import './three-d-stage.js'; // registers <three-d-stage>

export interface GearboxSpec {
  module: number;
  teeth: { sun: number; planet: number; ring: number };
  ratio: number;
  faceWidth: number;
  outerDiameter: number;
}

interface Props {
  onReady?: (info: { spec: GearboxSpec; parts: number }) => void;
}

/**
 * The reference-part viewer — a thin shell around `<three-d-stage>`, the
 * actual web component this page used before (`project/Planetary
 * Gearbox.html`, and originally from the ZachBach/pulsemask repo). It owns
 * the renderer, studio lighting, OrbitControls, camera framing and the
 * OBJ+MTL / GLB / STL export toolbar — none of that is reimplemented here.
 *
 * `import('three')` inside the component resolves through npm to the classic
 * WebGL build (not `three/webgpu`), same as the hero's plumbing note: two
 * separate three builds, never both on one page.
 */
export default function GearboxStage({ onReady }: Props) {
  const hostRef = useRef<HTMLElement | null>(null);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  useEffect(() => {
    const stage = hostRef.current as (HTMLElement & {
      ready: Promise<{ THREE: typeof import('three') }>;
      setObject: (o: import('three').Object3D) => void;
    }) | null;
    if (!stage) return;

    let cancelled = false;

    stage.ready
      .then(({ THREE }) => {
        if (cancelled) return;

        const makeMaterial = (
          name: string,
          spec: { color: number; metalness: number; roughness: number },
        ) => {
          const m = new THREE.MeshStandardMaterial({
            color: spec.color,
            metalness: Math.min(spec.metalness, 0.35),
            roughness: spec.roughness,
          });
          if (name === 'steelShaft') m.color.set(0xd6dde1);
          if (name === 'nylonPA12') m.color.set(0x35393d);
          m.name = name;
          return m;
        };

        const { group, tick, spec } = buildGearbox(THREE, makeMaterial);
        stage.setObject(group);

        let parts = 0;
        group.traverse((o: import('three').Object3D) => {
          if ((o as import('three').Mesh).isMesh) parts++;
        });
        readyRef.current?.({ spec, parts });

        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduce) return;

        let raf = 0;
        const clock = new THREE.Clock();
        const loop = () => {
          tick(clock.getElapsedTime() * 0.6);
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
        cleanupTick = () => cancelAnimationFrame(raf);
      })
      .catch((e) => console.error('[GearboxStage] boot failed', e));

    let cleanupTick: (() => void) | undefined;
    return () => {
      cancelled = true;
      cleanupTick?.();
    };
  }, []);

  return (
    <three-d-stage
      ref={hostRef}
      name="jr-planetary-gearbox"
      background="#0B0C0D"
      autorotate
      style={{ width: '100%', height: '100%', minHeight: '64vh' }}
    />
  );
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'three-d-stage': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        name?: string;
        background?: string;
        autorotate?: boolean;
        'hide-toolbar'?: boolean;
        forcewebgl?: boolean;
      };
    }
  }
}

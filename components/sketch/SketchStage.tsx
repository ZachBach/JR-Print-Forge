'use client';

import { useEffect, useRef, useState } from 'react';
import type * as THREEns from 'three';
import type { ProductKind } from '@/lib/relief/products';
import type { Built } from './pipeline';
import '../gearbox/three-d-stage.js'; // registers <three-d-stage>

type Stage = HTMLElement & {
  ready: Promise<{ THREE: typeof THREEns }>;
  setObject: (o: THREEns.Object3D) => void;
  camera: THREEns.PerspectiveCamera;
  controls: { target: THREEns.Vector3; update: () => void };
  scene: THREEns.Scene;
};

interface Scene {
  THREE: typeof THREEns;
  stage: Stage;
  group: THREEns.Group;
  mesh: THREEns.Mesh;
  solid: THREEns.MeshStandardMaterial;
  glow: THREEns.MeshBasicMaterial;
  framed: { kind: ProductKind; span: number } | null;
}

interface Props {
  built: Built | null;
  kind: ProductKind;
  /** Filament colour for the solid preview. */
  color: string;
  /** Lithophanes: show the part lit from behind instead of from the front. */
  backlit: boolean;
}

/**
 * Preview for the sketch studio, on the same `<three-d-stage>` the gearbox
 * page uses (renderer, studio lights, orbit, framing). The toolbar is hidden:
 * downloads come from the pipeline's own 3MF/STL writers, so the file is the
 * checked mesh rather than a re-export of the scene.
 *
 * The mesh arrives in print coordinates (mm, Z up); one group scales it to the
 * stage's metres and stands it Y-up. New builds swap the geometry in place so
 * the camera only moves when the part's size or kind really changes.
 */
export default function SketchStage({ built, kind, color, backlit }: Props) {
  const hostRef = useRef<HTMLElement | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stage = hostRef.current as Stage | null;
    if (!stage) return;
    let cancelled = false;
    stage.ready
      .then(({ THREE }) => {
        if (cancelled) return;
        const group = new THREE.Group();
        group.name = 'sketch_print';
        group.rotation.x = -Math.PI / 2;
        group.scale.setScalar(0.001);
        const solid = new THREE.MeshStandardMaterial({
          color,
          roughness: 0.62,
          metalness: 0.04,
          flatShading: true,
        });
        const glow = new THREE.MeshBasicMaterial({ vertexColors: true });
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), solid);
        group.add(mesh);
        // A low raking light from the left: relief reads by its shadows.
        const rake = new THREE.DirectionalLight(0xfff1e0, 0.9);
        rake.position.set(-6, 2.2, 2.5);
        stage.scene.add(rake);
        sceneRef.current = { THREE, stage, group, mesh, solid, glow, framed: null };
        setReady(true);
      })
      .catch((e) => console.error('[SketchStage] boot failed', e));
    return () => {
      cancelled = true;
    };
    // Boot once; colour and mode are applied by the effects below.
  }, []);

  useEffect(() => {
    const s = sceneRef.current;
    if (!ready || !s || !built) return;
    const { THREE } = s;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(built.positions, 3));
    g.setIndex(new THREE.BufferAttribute(built.indices, 1));
    if (kind === 'lithophane') g.setAttribute('color', backlightColors(THREE, built.positions));
    const old = s.mesh.geometry;
    s.mesh.geometry = g;
    old.dispose();

    const span = Math.max(built.size[0], built.size[1]);
    const f = s.framed;
    if (!f || f.kind !== kind || span > f.span * 1.25 || span < f.span * 0.75) {
      // The stage measures meshes with Box3.expandByObject, which does not
      // update parents — without this it frames the part at millimetre scale.
      s.group.updateMatrixWorld(true);
      s.stage.setObject(s.group);
      // The stage frames from a low three-quarter view; a flat part reads
      // better from higher up.
      const cam = s.stage.camera;
      const target = s.stage.controls.target;
      const dist = cam.position.distanceTo(target);
      const dir = new THREE.Vector3(0.28, 1.3, 1).normalize();
      cam.position.copy(target).addScaledVector(dir, dist * 0.92);
      s.stage.controls.update();
      s.framed = { kind, span };
    }
  }, [ready, built, kind]);

  useEffect(() => {
    const s = sceneRef.current;
    if (!ready || !s) return;
    s.solid.color.set(color);
    s.mesh.material = kind === 'lithophane' && backlit ? s.glow : s.solid;
  }, [ready, color, backlit, kind]);

  return (
    <three-d-stage
      ref={hostRef}
      name="jr-sketch-print"
      background="#0B0C0D"
      hide-toolbar
      style={{ width: '100%', height: '100%', minHeight: '52vh' }}
    />
  );
}

/**
 * Light through a lithophane falls off roughly exponentially with thickness.
 * k ≈ 1.1 per mm is in the range for white PLA; this is a preview, not a
 * photometric model — it shows which way the picture reads, not exact values.
 */
function backlightColors(THREE: typeof THREEns, p: Float32Array) {
  let thinnest = Infinity;
  for (let i = 2; i < p.length; i += 3) if (p[i] > 0 && p[i] < thinnest) thinnest = p[i];
  const c = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    const t = Math.max(0, p[i + 2] - thinnest);
    const v = 0.03 + 0.97 * Math.exp(-1.1 * t);
    c[i] = v;
    c[i + 1] = v * 0.84;
    c[i + 2] = v * 0.62;
  }
  return new THREE.BufferAttribute(c, 3);
}

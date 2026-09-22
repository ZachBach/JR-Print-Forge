'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { buildForge, logoGlyphs, WORD } from './forge/scene.js';
import { makeForgeMaterials } from './forge/materials.js';
import { volumetricFire } from './forge/flame.js';
import { buildLogoMorph } from './forge/lattice.js';

export interface ForgeInfo {
  backend: 'webgpu' | 'webgl2-fallback' | 'unavailable';
  vertices: number;
}

interface Props {
  /** Height of the readout strip the rig must clear, in px. */
  bottomInset?: number;
  logoUrl?: string;
  onReady?: (info: ForgeInfo) => void;
}

/**
 * Midpoint subdivision until every edge is under maxEdge — the wordmark needs
 * real vertices before a vertex-stage displacement can say anything.
 */
function subdivide(
  geo: THREE.BufferGeometry,
  maxEdge = 0.055,
  iterations = 5,
  triCap = 240000,
): THREE.BufferGeometry {
  let g = geo.index ? geo.toNonIndexed() : geo;
  const max2 = maxEdge * maxEdge;
  for (let it = 0; it < iterations; it++) {
    const p = g.attributes.position.array as ArrayLike<number>;
    if (p.length / 9 > triCap) break;
    const out: number[] = [];
    let split = false;
    const d2 = (i: number, j: number) => {
      const dx = p[i] - p[j], dy = p[i + 1] - p[j + 1], dz = p[i + 2] - p[j + 2];
      return dx * dx + dy * dy + dz * dz;
    };
    const push = (...v: number[]) => out.push(...v);
    for (let i = 0; i < p.length; i += 9) {
      const A = [p[i], p[i + 1], p[i + 2]];
      const B = [p[i + 3], p[i + 4], p[i + 5]];
      const C = [p[i + 6], p[i + 7], p[i + 8]];
      const ab = d2(i, i + 3), bc = d2(i + 3, i + 6), ca = d2(i + 6, i);
      const longest = Math.max(ab, bc, ca);
      if (longest <= max2) { push(...A, ...B, ...C); continue; }
      split = true;
      const mid = (u: number[], v: number[]) => [
        (u[0] + v[0]) / 2, (u[1] + v[1]) / 2, (u[2] + v[2]) / 2,
      ];
      if (longest === ab) { const m = mid(A, B); push(...A, ...m, ...C, ...m, ...B, ...C); }
      else if (longest === bc) { const m = mid(B, C); push(...A, ...B, ...m, ...A, ...m, ...C); }
      else { const m = mid(C, A); push(...A, ...B, ...m, ...m, ...B, ...C); }
    }
    if (!split) break;
    const next = new THREE.BufferGeometry();
    next.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
    g = next;
  }
  g.computeVertexNormals();
  return g;
}

/**
 * ForgeStage — handoff §07.
 *
 * Geometry from geo-lib, shading from tsl-lib through forge/materials. Mounted
 * by Hero via dynamic(ssr:false) behind an IntersectionObserver, so the ~600KB
 * of three never lands on the critical path.
 *
 * The element reports the backend actually taken rather than the one asked
 * for: claiming WebGPU on a machine that quietly fell back to WebGL2 would be
 * the rendering equivalent of rounding a metric in our favour.
 */
export default function ForgeStage({
  bottomInset = 0,
  logoUrl = '/jr-print-forge.jpg',
  onReady,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Held in a ref so re-renders never re-enter boot; the scene owns its clock.
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    const cleanups: Array<() => void> = [];

    (async () => {
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'display:block;width:100%;height:100%';
      host.appendChild(canvas);

      // Opaque, cleared to the page ground. A transparent canvas would have to
      // survive being composited through the bloom pass; clearing to the exact
      // colour the section sits on looks identical and avoids the question.
      const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
      await renderer.init();
      if (disposed) { renderer.dispose(); return; }

      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setClearColor(0x0b0c0d, 1);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;

      const backend: ForgeInfo['backend'] =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (renderer.backend as any)?.isWebGPUBackend ? 'webgpu' : 'webgl2-fallback';

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 40);

      const { material, uniforms } = makeForgeMaterials(THREE, TSL);
      const forge = buildForge(THREE, material, {
        logoUrl,
        refine: (geo: THREE.BufferGeometry) => subdivide(geo, 0.05, 5),
        flame: () => volumetricFire(THREE, TSL, { heat: uniforms.uHeat }),
      });
      scene.add(forge.group);

      // The lattice sits behind the rig and slightly below, so the anvil reads
      // against it and the JR wordmark rises out of it.
      // The wireframe sits exactly on the wordmark — CAD layers over the
      // printed part — and is a child of the rig group so it inherits the
      // recentre rather than needing its own world-space placement.
      const lattice = buildLogoMorph(THREE, TSL, {
        strike: uniforms.uStrike,
        glyphs: logoGlyphs(THREE),
        height: WORD.height,
        depth: WORD.depth,
      });
      lattice.mesh.position.copy(forge.wordAnchor);
      forge.group.add(lattice.mesh);
      cleanups.push(() => lattice.dispose());

      // The strip prints what is actually on screen, so the lattice counts too.
      let vertices = lattice.mesh.geometry.attributes.position.count;
      forge.group.traverse((o: THREE.Object3D) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) vertices += m.geometry.attributes.position.count;
      });
      readyRef.current?.({ backend, vertices });

      scene.add(new THREE.HemisphereLight(0x33424a, 0x08090a, 0.75));
      const key = new THREE.DirectionalLight(0xffffff, 2.6);
      key.position.set(0.9, 1.4, 1.1);
      scene.add(key);
      const rimBlue = new THREE.PointLight(0x00bfff, 4.0, 6, 2);
      rimBlue.position.set(-1.1, 0.7, -0.5);
      scene.add(rimBlue);
      const fill = new THREE.DirectionalLight(0x9fd8ff, 0.8);
      fill.position.set(-1.2, 0.4, 0.8);
      scene.add(fill);

      // ---- interaction ----------------------------------------------------
      let targetX = 0, targetY = 0, curX = 0, curY = 0, hover = 0;
      const onMove = (e: PointerEvent) => {
        const r = host.getBoundingClientRect();
        targetX = (((e.clientX - r.left) / r.width) * 2 - 1) * 0.22;
        targetY = -(((e.clientY - r.top) / r.height) * 2 - 1) * 0.12;
        hover = 1;
      };
      const onLeave = () => { hover = 0; targetX = 0; targetY = 0; };
      host.addEventListener('pointermove', onMove);
      host.addEventListener('pointerleave', onLeave);
      cleanups.push(() => {
        host.removeEventListener('pointermove', onMove);
        host.removeEventListener('pointerleave', onLeave);
      });

      let strikeAt = -10;
      forge.onStrike = () => {
        strikeAt = performance.now() / 1000;
        lattice.requestMorph();
      };

      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      const bounds = forge.coreBounds();
      const size = bounds.getSize(new THREE.Vector3());
      const mid = bounds.getCenter(new THREE.Vector3());

      let dist = 3.2;
      const resize = () => {
        const w = host.clientWidth || 1, h = host.clientHeight || 1;
        renderer.setSize(w, h, false);
        // Render a window onto a larger virtual frame: the subject stays
        // centred in the frame, the window crops it into the right third —
        // deterministic composition at any aspect, no lookAt guesswork.
        const wide = w / h > 1.3;
        // ky only moves the subject up the window (it cancels out of the fit),
        // so the size is set by pad alone. On a narrow screen the copy owns the
        // lower half: the rig sits both smaller and higher, which is a
        // different composition rather than the same one scaled down.
        const kx = wide ? 1.62 : 1.04;
        const ky = wide ? 1.2 : 1.72;
        const pad = wide ? 1.24 : 3.0;
        const fullW = w * kx, fullH = h * ky;
        camera.aspect = fullW / fullH;
        const tan = Math.tan((camera.fov * Math.PI) / 180 / 2);
        const usable = Math.max(h - bottomInset, h * 0.5);
        // The frustum spans the whole virtual frame, but the window shows only
        // 1/ky of it vertically and 1/kx horizontally — a fit computed against
        // the full frame lands the subject ky times too large in the window.
        const fitH = ((size.y * pad) / (2 * tan)) * ky * (h / usable);
        const fitW = ((size.x * 1.06) / (2 * tan * camera.aspect)) * kx;
        dist = Math.max(fitH, fitW) + size.z * 1.2;
        camera.setViewOffset(fullW, fullH, 0, (fullH - h) * 0.98 - bottomInset * 0.5, w, h);
      };
      const ro = new ResizeObserver(resize);
      ro.observe(host);
      resize();
      cleanups.push(() => ro.disconnect());

      // Pause when off-screen — but self-heal: an observer that reports false
      // before first layout must not freeze the hero forever.
      let visible = true, skipped = 0;
      const inView = () => {
        const r = host.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < (window.innerHeight || 1e4);
      };
      const io = new IntersectionObserver(
        ([en]) => { visible = en.isIntersecting || inView(); },
        { threshold: 0 },
      );
      io.observe(host);
      cleanups.push(() => io.disconnect());

      // Bloom is what the sketch used UnrealBloomPass for; on WebGPU it is a
      // TSL node graph instead. It is also what makes the flame, the sparks,
      // the molten billet and the lattice read as light rather than as paint.
      const postProcessing = new THREE.PostProcessing(renderer);
      const scenePass = pass(scene, camera);
      const sceneColor = scenePass.getTextureNode('output');
      // Threshold high enough that only genuinely emissive things glow — at a
      // lower one the hammer disappears into the flame's glare.
      postProcessing.outputNode = sceneColor.add(bloom(sceneColor, 0.5, 0.5, 0.36));
      cleanups.push(() => postProcessing.dispose?.());

      let errLogged = false;
      let last = performance.now() / 1000;
      renderer.setAnimationLoop(() => {
        const now = performance.now() / 1000;
        const dt = Math.min(now - last, 0.05);
        last = now;
        if (!visible) { if (++skipped % 20 === 0) visible = inView(); return; }

        try {
          forge.tick(reduce ? 0.35 : now, dt);
          lattice.tick(reduce ? 0.35 : now, reduce ? 0 : dt);
        } catch (e) {
          if (!errLogged) { errLogged = true; console.error('[ForgeStage] tick', e); }
        }

        uniforms.uWordFade.value = 1 - lattice.logoBlend;
        uniforms.uHeat.value = forge.heat;
        uniforms.uStrike.value = Math.min((now - strikeAt) / 0.9, 1);
        uniforms.uHover.value += (hover - uniforms.uHover.value) * 0.07;
        uniforms.uShock.value.copy(forge.impactWorld());

        curX += (targetX - curX) * 0.05;
        curY += (targetY - curY) * 0.05;
        const drift = reduce ? 0 : Math.sin(now * 0.11) * 0.08;
        const a = curX + drift;
        camera.position.set(
          mid.x + Math.sin(a) * dist,
          mid.y + 0.26 + curY,
          mid.z + Math.cos(a) * dist,
        );
        camera.lookAt(mid.x, mid.y, mid.z);

        try { postProcessing.render(); }
        catch (e) { if (!errLogged) { errLogged = true; console.error('[ForgeStage] render', e); } }
      });

      cleanups.push(() => {
        renderer.setAnimationLoop(null);
        renderer.dispose();
        canvas.remove();
      });
    })().catch((e) => {
      console.warn('[ForgeStage] falling back to static ground:', e);
      host.style.background =
        'radial-gradient(60% 60% at 58% 52%, rgba(255,107,0,.18), transparent 70%), #0b0c0d';
      readyRef.current?.({ backend: 'unavailable', vertices: 0 });
    });

    return () => {
      disposed = true;
      cleanups.forEach((fn) => fn());
    };
  }, [bottomInset, logoUrl]);

  return <div ref={hostRef} className="absolute inset-0 overflow-hidden" aria-hidden="true" />;
}

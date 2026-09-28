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
import { buildForgeParticles } from './forge/particles.js';
import { AdaptiveQuality, classify, type QualitySettings } from './forge/quality.js';

export interface ForgeInfo {
  backend: 'webgpu' | 'webgl2-fallback' | 'unavailable';
  vertices: number;
  /** Particles drawn right now; 0 when the particle system is not running. */
  particles: number;
  /** Particles allocated for the session. */
  pool: number;
  /** Frames per second over the last full second, once measured. */
  fps: number;
  /** Hammer blows per minute, as the scene runs them; 0 when nothing is running. */
  strikesPerMin: number;
}

export interface ForgeStats extends ForgeInfo {
  device: string;
  cappedBy: string | null;
  forced: boolean;
  targetFPS: number;
  renderScale: number;
  flameSteps: number;
  reason: string;
  gpuBytes: number;
}

declare global {
  interface Window {
    /** Live metrics for local inspection and the headless check. Never transmitted. */
    __forge?: { stats: ForgeStats };
  }
}

interface Props {
  /** Height of the readout strip the rig must clear, in px. */
  bottomInset?: number;
  logoUrl?: string;
  /** Called when the scene comes up, and again (at most 4×/s) as quality changes. */
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

/** `?particles=N` pins the pool and turns the adaptive manager off. */
function forcedCount(): number {
  const n = Number(new URLSearchParams(window.location.search).get('particles'));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/**
 * ForgeStage — handoff §07, rebuilt on Project Phoenix's rendering pattern.
 *
 * This component is the director: one frame loop, and the quality manager
 * is the only thing in it that makes performance decisions. The particle
 * system, the pixel ratio and the flame's step count all take what they are
 * given; none of them measures or adjusts itself.
 *
 *   loop: quality.tick → forge.tick → particles.frame → render
 *
 * On WebGPU a GPU-compute particle cast draws the JR monogram, throws the
 * sparks and feeds the fire. The WebGL2 fallback keeps the extruded wordmark
 * and CPU sparks, because transform-feedback compute there draws nothing.
 *
 * The element reports the backend actually taken and the particle count
 * actually drawn: claiming a million on a machine that settled at 250,000
 * would be the rendering equivalent of rounding a metric in our favour.
 *
 * Mounted by Hero via dynamic(ssr:false) behind an IntersectionObserver, so
 * the ~600KB of three never lands on the critical path.
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
      // Registered before the await: under Strict Mode the effect is torn down
      // while init() is still pending, and a canvas left behind here stacks
      // above the live one and pushes it out of the overflow-hidden host.
      cleanups.push(() => canvas.remove());

      // Opaque, cleared to the page ground. A transparent canvas would have to
      // survive being composited through the bloom pass; clearing to the exact
      // colour the section sits on looks identical and avoids the question.
      const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
      await renderer.init();
      if (disposed) { renderer.dispose(); return; }

      renderer.setClearColor(0x0b0c0d, 1);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gpu = renderer.backend as any;
      const backend: ForgeInfo['backend'] = gpu?.isWebGPUBackend ? 'webgpu' : 'webgl2-fallback';
      const info = gpu?.device?.adapterInfo;
      const cls = classify({
        backend,
        adapter: info ? `${info.vendor} ${info.architecture} ${info.description}` : '',
        coarsePointer: window.matchMedia('(pointer: coarse)').matches,
        deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 0,
        maxBufferBytes: gpu?.device?.limits?.maxStorageBufferBindingSize ?? 134217728,
        forceCount: backend === 'webgpu' ? forcedCount() : 0,
      });
      const useParticles = cls.pool > 0;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 40);

      const { material, uniforms } = makeForgeMaterials(THREE, TSL);
      const forge = buildForge(THREE, material, {
        logoUrl,
        wordmark: !useParticles,
        sparks: !useParticles,
        refine: (geo: THREE.BufferGeometry) => subdivide(geo, 0.05, 5),
        flame: () => volumetricFire(THREE, TSL, { heat: uniforms.uHeat, steps: cls.flameSteps }),
      });
      scene.add(forge.group);

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

      // ---- particles (WebGPU only) -------------------------------------------
      const particles = useParticles
        ? buildForgeParticles(THREE, TSL, {
          pool: cls.pool,
          word: forge.word,
          source: forge.impactGroup,
          flameBase: forge.flameGroup.clone().add(new THREE.Vector3(0, 0.004, 0)),
          floorY: WORD.y + WORD.height,
        })
        : null;
      if (particles) {
        forge.group.add(particles.group);
        await particles.init(renderer);
        if (disposed) { renderer.dispose(); return; }
        cleanups.push(() => particles.dispose());
      }

      // The strip prints what is actually on screen: hidden meshes don't count.
      let vertices = lattice.mesh.geometry.attributes.position.count;
      forge.group.traverseVisible((o: THREE.Object3D) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) vertices += m.geometry.attributes.position.count;
      });

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
      const ndc = new THREE.Vector2();
      let pointerIn = false;
      const onMove = (e: PointerEvent) => {
        const r = host.getBoundingClientRect();
        const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
        const ny = -(((e.clientY - r.top) / r.height) * 2 - 1);
        targetX = nx * 0.22;
        targetY = ny * 0.12;
        ndc.set(nx, ny);
        hover = 1;
        pointerIn = true;
      };
      const onLeave = () => { hover = 0; targetX = 0; targetY = 0; pointerIn = false; };
      host.addEventListener('pointermove', onMove);
      host.addEventListener('pointerleave', onLeave);
      cleanups.push(() => {
        host.removeEventListener('pointermove', onMove);
        host.removeEventListener('pointerleave', onLeave);
      });

      let strikeAt = -10;
      forge.onStrike = () => {
        strikeAt = performance.now() / 1000;
        // With the particle cast the wireframe stays on the letters: it is the
        // CAD the part is printed from, and a surface morph would bury the rig.
        if (!particles) lattice.requestMorph();
      };

      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      const bounds = forge.coreBounds();
      const size = bounds.getSize(new THREE.Vector3());
      const mid = bounds.getCenter(new THREE.Vector3());

      // ---- quality: the only thing that decides what the frame can afford ----
      const quality = new AdaptiveQuality(cls);
      const pixelRatio = () => Math.min(window.devicePixelRatio, 2) * settings.renderScale;
      let settings: QualitySettings = quality.settings();

      let dist = 3.2;
      const resize = () => {
        const w = host.clientWidth || 1, h = host.clientHeight || 1;
        renderer.setPixelRatio(pixelRatio());
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

      const stats: ForgeStats = {
        backend, vertices, particles: 0, pool: particles ? particles.pool : 0, fps: NaN,
        strikesPerMin: forge.strikesPerMin,
        device: cls.device, cappedBy: cls.cappedBy, forced: cls.forced, targetFPS: 60,
        renderScale: 1, flameSteps: cls.flameSteps, reason: '', gpuBytes: particles ? particles.bytes : 0,
      };
      window.__forge = { stats };
      cleanups.push(() => { if (window.__forge?.stats === stats) delete window.__forge; });

      let lastReport = -Infinity, lastKey = '';
      const report = (force = false) => {
        const now = performance.now();
        if (!force && now - lastReport < 250) return;
        // the strip shows thousands and whole frames; anything finer is noise
        const shown = Math.round(stats.particles / 1000) * 1000;
        const fps = Math.round(stats.fps);
        const k = `${shown}/${fps}`;
        if (!force && k === lastKey) return;
        lastReport = now; lastKey = k;
        readyRef.current?.({ backend, vertices, particles: shown, pool: stats.pool, fps, strikesPerMin: forge.strikesPerMin });
      };

      quality.subscribe((s) => {
        const scaleChanged = s.renderScale !== settings.renderScale;
        settings = s;
        particles?.applySettings(s);
        stats.particles = particles ? particles.drawn : 0;
        stats.fps = s.fps;
        stats.targetFPS = s.targetFPS;
        stats.renderScale = s.renderScale;
        stats.reason = s.reason;
        if (scaleChanged) resize();
        report();
      });
      report(true);

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
      const postProcessing = new THREE.RenderPipeline(renderer);
      const scenePass = pass(scene, camera);
      const sceneColor = scenePass.getTextureNode('output');
      // Threshold high enough that only genuinely emissive things glow — at a
      // lower one the hammer disappears into the flame's glare. The bloom sees
      // a clamped copy: a handful of additive pixels summing past a few units
      // would otherwise spread into a disc the size of the rig.
      postProcessing.outputNode = sceneColor.add(bloom(sceneColor.min(3), 0.5, 0.5, 0.36));
      cleanups.push(() => postProcessing.dispose?.());

      // pointer → group space, on the plane through the letters
      const ray = new THREE.Raycaster();
      const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
      const hit = new THREE.Vector3();
      const pointerGroup = (): THREE.Vector3 | null => {
        if (!pointerIn || reduce) return null;
        plane.constant = -(forge.group.position.z + WORD.z);
        ray.setFromCamera(ndc, camera);
        if (!ray.ray.intersectPlane(plane, hit)) return null;
        return forge.group.worldToLocal(hit);
      };

      let errLogged = false;
      const start = performance.now() / 1000;
      let last = start;
      renderer.setAnimationLoop(() => {
        const nowMs = performance.now();
        const now = nowMs / 1000;
        const dt = Math.min(now - last, 0.05);
        last = now;
        if (!visible) { if (++skipped % 20 === 0) visible = inView(); return; }

        quality.tick(nowMs);
        stats.fps = quality.fps;
        if (particles) stats.particles = particles.drawn;

        try {
          forge.tick(reduce ? 0.35 : now, dt);
          lattice.tick(reduce ? 0.35 : now, reduce ? 0 : dt);
          if (particles) {
            const since = now - strikeAt;
            // deposit the cast over ~5 s, bottom layer first
            const print = reduce ? 1.01 : Math.min(1.01, Math.max(0, (now - start - 0.4) / 5));
            // the CAD outline leads the print, then steps back to a faint trace
            lattice.fade = 0.3 + 0.7 * (1 - Math.max(0, Math.min(1, (print - 0.85) / 0.16)));
            particles.frame(renderer, {
              t: now - start,
              dt: reduce ? 0 : dt,
              print,
              strikes: forge.strikes,
              sinceStrike: since,
              impact: forge.impactGroup,
              pointer: pointerGroup(),
              heat: forge.heat,
              melt: 1 - lattice.logoBlend,
            });
          }
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
        // the blow travels up the camera: a few millimetres, gone in 0.2 s
        const shake = reduce ? 0 : Math.exp(-(now - strikeAt) * 22) * 0.006;
        // Standing eye-line: above the anvil face and looking down onto it, the
        // way anyone at a forge sees the work. Level with the face, a blade
        // lying flat is an edge-on line and turning it over is invisible.
        camera.position.set(
          mid.x + Math.sin(a) * dist + Math.sin(now * 91) * shake,
          mid.y + 1.0 + curY + Math.sin(now * 77 + 1.3) * shake,
          mid.z + Math.cos(a) * dist,
        );
        camera.lookAt(mid.x, mid.y, mid.z);

        try { postProcessing.render(); }
        catch (e) { if (!errLogged) { errLogged = true; console.error('[ForgeStage] render', e); } }
        report();
      });

      cleanups.push(() => {
        renderer.setAnimationLoop(null);
        renderer.dispose();
      });
    })().catch((e) => {
      console.warn('[ForgeStage] falling back to static ground:', e);
      host.style.background =
        'radial-gradient(60% 60% at 58% 52%, rgba(255,107,0,.18), transparent 70%), #0b0c0d';
      readyRef.current?.({ backend: 'unavailable', vertices: 0, particles: 0, pool: 0, fps: NaN, strikesPerMin: 0 });
    });

    return () => {
      disposed = true;
      cleanups.forEach((fn) => fn());
    };
  }, [bottomInset, logoUrl]);

  return <div ref={hostRef} className="absolute inset-0 overflow-hidden" aria-hidden="true" />;
}

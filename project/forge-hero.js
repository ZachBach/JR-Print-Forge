// <forge-hero> — WebGPU/TSL hero stage for JR Print Forge.
//
// three.webgpu.js is imported by absolute URL, so no import map is needed and
// TSL comes from the same module instance (THREE.TSL) — never a second copy.
// WebGPURenderer falls back to its own WebGL2 backend when there is no
// adapter; the element publishes the path actually taken on data-backend,
// because claiming WebGPU on a machine that quietly fell back would be the
// rendering equivalent of rounding a metric in our favour.
//
// Geometry: geo-lib. Shading: tsl-lib nodes through forge-materials.js.

import * as THREE from 'https://unpkg.com/three@0.184.0/build/three.webgpu.js';
import { buildForge } from './forge-scene.js';
import { makeForgeMaterials } from './forge-materials.js';
import { volumetricFire } from './flame-volume.js';

const T = THREE.TSL;

/**
 * Midpoint subdivision until every edge is under maxEdge — the wordmark needs
 * real vertices before a vertex-stage displacement can say anything. Written
 * here rather than pulled from three/addons: addons import the bare specifier
 * "three", and this page deliberately runs without an import map.
 */
function subdivide(geo, maxEdge = 0.055, iterations = 5, triCap = 240000) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  const max2 = maxEdge * maxEdge;
  for (let it = 0; it < iterations; it++) {
    const p = g.attributes.position.array;
    if (p.length / 9 > triCap) break;
    const out = [];
    let split = false;
    const d2 = (i, j) => {
      const dx = p[i] - p[j], dy = p[i + 1] - p[j + 1], dz = p[i + 2] - p[j + 2];
      return dx * dx + dy * dy + dz * dz;
    };
    const push = (...v) => out.push(...v);
    for (let i = 0; i < p.length; i += 9) {
      const A = [p[i], p[i + 1], p[i + 2]];
      const B = [p[i + 3], p[i + 4], p[i + 5]];
      const C = [p[i + 6], p[i + 7], p[i + 8]];
      const ab = d2(i, i + 3), bc = d2(i + 3, i + 6), ca = d2(i + 6, i);
      const longest = Math.max(ab, bc, ca);
      if (longest <= max2) { push(...A, ...B, ...C); continue; }
      split = true;
      const mid = (u, v) => [(u[0] + v[0]) / 2, (u[1] + v[1]) / 2, (u[2] + v[2]) / 2];
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

class ForgeHero extends HTMLElement {
  connectedCallback() {
    if (this._booted) return;
    this._booted = true;
    this.style.display = 'block';
    // Only establish a containing block if the page has not already positioned
    // us. Overwriting an inline position:absolute collapses the stage to
    // content size, which is intermittent because it depends on whether this
    // runs before or after the host framework re-applies its own style.
    if (getComputedStyle(this).position === 'static') this.style.position = 'relative';
    this.style.overflow = 'hidden';
    this.boot().catch((e) => {
      console.warn('[forge-hero] falling back to static ground:', e);
      this.setAttribute('data-backend', 'unavailable');
      this.style.background =
        'radial-gradient(60% 60% at 58% 52%, rgba(255,107,0,.18), transparent 70%), #0b0c0d';
    });
  }

  async boot() {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:100%;height:100%';
    this.appendChild(canvas);

    const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: true });
    await renderer.init();
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    const backend = renderer.backend?.isWebGPUBackend ? 'webgpu' : 'webgl2-fallback';
    this.setAttribute('data-backend', backend);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 40);

    const { material, uniforms } = makeForgeMaterials(THREE, T);
    const forge = buildForge(THREE, material, {
      logoUrl: this.getAttribute('logo') || 'uploads/jr-print-forge.jpg',
      refine: (geo) => subdivide(geo, 0.05, 5),
      flame: () => volumetricFire(THREE, T, { heat: uniforms.uHeat }),
    });
    scene.add(forge.group);
    this.vertexCount = 0;
    forge.group.traverse((o) => { if (o.isMesh) this.vertexCount += o.geometry.attributes.position.count; });
    this.setAttribute('data-vertices', String(this.vertexCount));
    this.dispatchEvent(new CustomEvent('forge-hero-ready', {
      bubbles: true, detail: { backend, vertices: this.vertexCount },
    }));

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

    // ---- interaction -------------------------------------------------------
    let targetX = 0, targetY = 0, curX = 0, curY = 0, hover = 0;
    const onMove = (e) => {
      const r = this.getBoundingClientRect();
      targetX = (((e.clientX - r.left) / r.width) * 2 - 1) * 0.22;
      targetY = -(((e.clientY - r.top) / r.height) * 2 - 1) * 0.12;
      hover = 1;
    };
    this.addEventListener('pointermove', onMove);
    this.addEventListener('pointerleave', () => { hover = 0; targetX = 0; targetY = 0; });

    let strikeAt = -10;
    forge.onStrike = () => { strikeAt = performance.now() / 1000; };

    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

    // framing bounds: the hammer's raised arc is allowed to overflow the top
    const bounds = forge.coreBounds();
    const size = bounds.getSize(new THREE.Vector3());
    const mid = bounds.getCenter(new THREE.Vector3());

    const resize = () => {
      const w = this.clientWidth || 1, h = this.clientHeight || 1;
      renderer.setSize(w, h, false);
      // Render a window onto a larger virtual frame: the subject stays
      // centred in the frame, the window crops it into the right third —
      // deterministic composition at any aspect, no lookAt guesswork.
      const wide = w / h > 1.3;
      // ky only moves the subject up the window (it cancels out of the fit),
      // so the size is set by pad alone. On a narrow screen the copy owns the
      // lower half: the rig has to sit both smaller and higher than on a wide
      // one, which is a different composition rather than the same one scaled.
      const kx = wide ? 1.62 : 1.04;
      const ky = wide ? 1.2 : 1.72;
      const pad = wide ? 1.24 : 3.0;
      const fullW = w * kx, fullH = h * ky;
      camera.aspect = fullW / fullH;
      const tan = Math.tan((camera.fov * Math.PI) / 180 / 2);
      const inset = Number(this.getAttribute('bottom-inset') || 0);
      const usable = Math.max(h - inset, h * 0.5);
      // The frustum spans the whole virtual frame, but the window shows only
      // 1/ky of it vertically and 1/kx horizontally — so a fit computed against
      // the full frame lands the subject ky times too large in the window.
      const fitH = ((size.y * pad) / (2 * tan)) * ky * (h / usable);
      const fitW = ((size.x * 1.06) / (2 * tan * camera.aspect)) * kx;
      this._dist = Math.max(fitH, fitW) + size.z * 1.2;
      camera.setViewOffset(fullW, fullH, 0, (fullH - h) * 0.98 - inset * 0.5, w, h);
    };
    new ResizeObserver(resize).observe(this);
    resize();

    // Pause when off-screen — but self-heal: an observer that reports false
    // before first layout must not freeze the hero forever.
    let visible = true, skipped = 0;
    const inView = () => {
      const r = this.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < (innerHeight || 1e4);
    };
    new IntersectionObserver(([en]) => { visible = en.isIntersecting || inView(); }, { threshold: 0 })
      .observe(this);

    this.api = { renderer, scene, camera, forge };
    let errLogged = false;
    let last = performance.now() / 1000;
    renderer.setAnimationLoop(() => {
      const now = performance.now() / 1000;
      const dt = Math.min(now - last, 0.05);
      last = now;
      if (!visible) { if (++skipped % 20 === 0) visible = inView(); return; }

      try { forge.tick(reduce ? 0.35 : now, dt); } catch (e) { if (!errLogged) { errLogged = true; console.error('[forge-hero] tick', e); } }
      uniforms.uHeat.value = forge.heat;
      uniforms.uStrike.value = Math.min((now - strikeAt) / 0.9, 1);
      uniforms.uHover.value += (hover - uniforms.uHover.value) * 0.07;
      uniforms.uShock.value.copy(forge.impactWorld());

      curX += (targetX - curX) * 0.05;
      curY += (targetY - curY) * 0.05;
      const drift = reduce ? 0 : Math.sin(now * 0.11) * 0.08;
      const a = curX + drift, d = this._dist || 3.2;
      camera.position.set(mid.x + Math.sin(a) * d, mid.y + 0.26 + curY, mid.z + Math.cos(a) * d);
      camera.lookAt(mid.x, mid.y, mid.z);
      try { renderer.render(scene, camera); } catch (e) { if (!errLogged) { errLogged = true; console.error('[forge-hero] render', e); } }
    });
  }
}

if (!customElements.get('forge-hero')) customElements.define('forge-hero', ForgeHero);

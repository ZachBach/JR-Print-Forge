/**
 * lattice — the JR wordmark as a wireframe that reconfigures into parametric
 * surfaces when the hammer lands.
 *
 * The three surface generators are the maths from the "Neon Structural
 * Geometry" sketch, unchanged. What changed is the plumbing and the subject.
 *
 *   - Plumbing: that sketch drives a raw GLSL ShaderMaterial on a
 *     WebGLRenderer and bolts UnrealBloomPass onto an EffectComposer, neither
 *     of which runs on the WebGPURenderer this hero uses. The vertex/fragment
 *     pair is expressed as TSL nodes here; the glow is TSL bloom in ForgeStage.
 *   - Subject: shape 0 is the JR wordmark, traced from the same letterform
 *     outlines the solid mesh is extruded from and stacked into print layers.
 *     So the morph runs logo → surface → logo rather than between four
 *     unrelated surfaces, and the effect says something about the company.
 *   - The Super-Torus is dropped. Its superformula cross-section reads as a
 *     flower, which is the one shape that looked decorative rather than
 *     engineered.
 *
 * The palette is the brand's: the sketch ramps deep blue to hot pink, and
 * nothing on this site gets a third accent, so it ramps blue to ember with a
 * blue pulse travelling through it.
 *
 * Nodes never own uniforms: the strike uniform comes in from the caller.
 */

const MORPH_OUT = 1.15;
const MORPH_BACK = 1.35;
const SURFACE_HOLD = 3.2;
const MIN_LOGO_HOLD = 4.5;

/** Distinct print layers the logo's depth axis collapses onto. */
const LAYERS = 9;

function getUV(i, res) {
  return { u: (i % res) / (res - 1), v: Math.floor(i / res) / (res - 1) };
}

/** Even-arc-length resample of a closed polyline; t=1 returns to the start. */
function resampleClosed(pts, n) {
  const seg = [];
  let total = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    seg.push(d);
    total += d;
  }

  const out = [];
  for (let k = 0; k < n; k++) {
    let t = (k / (n - 1)) * total;
    if (t >= total) t = total - 1e-9;
    let i = 0;
    while (i < seg.length - 1 && t > seg[i]) { t -= seg[i]; i++; }
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const f = seg[i] > 1e-12 ? t / seg[i] : 0;
    out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
  }
  return out;
}

export const SURFACES = [
  {
    name: 'Breather Surface',
    gen: (i, res, V) => {
      const { u: rawU, v: rawV } = getUV(i, res);
      const u = (rawU - 0.5) * 14;
      const v = (rawV - 0.5) * 30;

      const aa = 0.4;
      const w = Math.sqrt(1 - aa * aa);

      const cosh_au = Math.cosh(aa * u);
      const sinh_au = Math.sinh(aa * u);
      const sin_wv = Math.sin(w * v);
      const cos_wv = Math.cos(w * v);
      const den = aa * ((1 - aa * aa) * cosh_au * cosh_au + aa * aa * sin_wv * sin_wv);

      if (Math.abs(den) < 0.001) return new V(0, 0, 0);

      const x = -u + (2 * (1 - aa * aa) * cosh_au * sinh_au) / den;
      const y = (2 * w * cosh_au * (-w * Math.cos(v) * cos_wv - Math.sin(v) * sin_wv)) / den;
      const z = (2 * w * cosh_au * (-w * Math.sin(v) * cos_wv + Math.cos(v) * sin_wv)) / den;

      return new V(x, z, y);
    },
  },
  {
    name: 'Klein Bottle',
    gen: (i, res, V) => {
      const { u: rawU, v: rawV } = getUV(i, res);
      const u = rawU * Math.PI * 2;
      const v = rawV * Math.PI * 2;
      const r = 3;

      const cosU = Math.cos(u), sinU = Math.sin(u);
      const cosU2 = Math.cos(u / 2), sinU2 = Math.sin(u / 2);
      const sinV = Math.sin(v);
      const sin2V = Math.sin(2 * v);

      const x = (r + cosU2 * sinV - sinU2 * sin2V) * cosU;
      const y = (r + cosU2 * sinV - sinU2 * sin2V) * sinU;
      const z = sinU2 * sinV + cosU2 * sin2V;

      return new V(x, y, z * 3.0);
    },
  },
  {
    name: "Dini's Surface",
    gen: (i, res, V) => {
      const { u: rawU, v: rawV } = getUV(i, res);
      const u = rawU * 4 * Math.PI;
      const v = 0.01 + rawV * 2.0;

      const a = 1.0;
      const b = 0.2;

      const x = a * Math.cos(u) * Math.sin(v);
      const y = a * Math.sin(u) * Math.sin(v);
      const z = a * (Math.cos(v) + Math.log(Math.tan(v / 2))) + b * u;

      return new V(x * 3.0, z * 2.0 - 10.0, y * 3.0);
    },
  },
];

/**
 * Trace the wordmark: i runs around the letter outlines, j stacks print
 * layers through the extrusion. Several j values collapse onto the same layer
 * so the stack reads as discrete layers rather than a solid glowing block —
 * the rows that coincide draw zero-length segments, which cost nothing and
 * separate again the moment a morph pulls them apart.
 */
function traceLogo(THREE, glyphs, grid, height, depth) {
  const out = new Float32Array(grid * grid * 3);
  const perGlyph = Math.floor(grid / glyphs.length);

  const rings = glyphs.map((g) => {
    const pts = g.shape.getPoints(240).map((p) => ({
      x: (p.x + g.x) * height,
      y: p.y * height,
    }));
    return resampleClosed(pts, perGlyph);
  });

  for (let j = 0; j < grid; j++) {
    const v = j / (grid - 1);
    const layer = Math.min(Math.floor(v * LAYERS), LAYERS - 1);
    const z = (layer / (LAYERS - 1) - 0.5) * depth;

    for (let i = 0; i < grid; i++) {
      const g = Math.min(Math.floor(i / perGlyph), glyphs.length - 1);
      const ring = rings[g];
      const p = ring[(i - g * perGlyph) % ring.length];
      const o = (j * grid + i) * 3;
      out[o] = p.x;
      out[o + 1] = p.y;
      out[o + 2] = z;
    }
  }
  return { data: out, perGlyph };
}

function centreAndScale(THREE, arr, count, target) {
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const p = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    p.set(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]);
    min.min(p); max.max(p);
  }
  const c = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);
  const span = new THREE.Vector3().subVectors(max, min);
  const dim = Math.max(span.x, span.y, span.z);
  const scale = target ? target / dim : 1;
  for (let i = 0; i < count; i++) {
    arr[i * 3] = (arr[i * 3] - c.x) * scale;
    arr[i * 3 + 1] = (arr[i * 3 + 1] - c.y) * scale;
    arr[i * 3 + 2] = (arr[i * 3 + 2] - c.z) * scale;
  }
  return dim * scale;
}

/**
 * @param {*} THREE
 * @param {*} TSL
 * @param {{ strike?: *, glyphs: *[], height: number, depth: number,
 *           grid?: number, surfaceScale?: number }} opts
 */
export function buildLogoMorph(THREE, TSL, {
  strike, glyphs, height, depth, grid = 72, surfaceScale = 1.4,
} = {}) {
  const COUNT = grid * grid;

  // Shape 0 is the logo at its true built size; the surfaces are normalised
  // a little larger, so a reconfiguration blooms outward from the letters.
  const logo = traceLogo(THREE, glyphs, grid, height, depth);
  const logoSpan = centreAndScale(THREE, logo.data, COUNT, 0);

  const cache = [logo.data];
  for (const s of SURFACES) {
    const arr = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      const p = s.gen(i, grid, THREE.Vector3);
      arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z;
    }
    centreAndScale(THREE, arr, COUNT, logoSpan * surfaceScale);
    cache.push(arr);
  }

  // ---- wireframe topology -------------------------------------------------
  // i is the fast axis. On the logo that is the letter outline, so the one
  // segment that would jump from the J's last point to the R's first is left
  // out; on a surface that is a single missing line among thousands.
  const seam = logo.perGlyph - 1;
  const indices = [];
  for (let j = 0; j < grid; j++) {
    for (let i = 0; i < grid; i++) {
      const a = j * grid + i;
      if (i < grid - 1 && i % logo.perGlyph !== seam) indices.push(a, a + 1);
      if (j < grid - 1) indices.push(a, a + grid);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(cache[0]), 3));
  geometry.setAttribute('positionA', new THREE.Float32BufferAttribute(new Float32Array(cache[0]), 3));
  geometry.setAttribute('positionB', new THREE.Float32BufferAttribute(new Float32Array(cache[0]), 3));

  // ---- material -----------------------------------------------------------
  const uMorph = TSL.uniform(0);
  const uGlow = TSL.uniform(0);
  const uAway = TSL.uniform(0); // 0 while on the logo, 1 while fully a surface

  const mat = new THREE.LineBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  mat.name = 'logoLattice';

  const pA = TSL.attribute('positionA', 'vec3');
  const pB = TSL.attribute('positionB', 'vec3');
  const pos = TSL.mix(pA, pB, uMorph);
  mat.positionNode = pos;

  const p = TSL.varying(pos);
  const half = logoSpan * surfaceScale * 0.5;
  const heightPct = TSL.smoothstep(TSL.float(-half), TSL.float(half), p.y);

  const deep = TSL.color(0x062a4d);
  const ember = TSL.color(0xff6b00);
  const blue = TSL.color(0x00bfff);

  const pulse = TSL.sin(p.y.mul(9.0).sub(TSL.time.mul(3.0))).mul(0.5).add(0.5);
  const wave = TSL.smoothstep(TSL.float(0.86), TSL.float(1.0), pulse);

  // On the logo the wireframe is cool blue CAD over the hot metal underneath;
  // as it leaves the letters it takes on the forge's heat.
  const cad = TSL.mix(blue, TSL.color(0x9fd8ff), heightPct);
  const hot = TSL.mix(deep, ember, heightPct);
  const base = TSL.mix(cad, hot, uAway);

  mat.colorNode = base.add(blue.mul(wave.mul(0.8))).mul(TSL.float(1).add(uGlow.mul(1.8)));
  mat.opacityNode = TSL.float(0.30)
    .add(wave.mul(0.30))
    .add(uGlow.mul(0.30))
    .add(uAway.mul(0.12));

  const mesh = new THREE.LineSegments(geometry, mat);
  mesh.name = 'logo_lattice';
  // Positions are replaced in the vertex stage, so the baked bounding sphere
  // stops describing the mesh the moment a morph starts.
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;

  // ---- state machine ------------------------------------------------------
  // logo → (strike) → toSurface → surface → toLogo → logo
  let state = 'logo';
  let surfaceIdx = 0;
  let timer = 0;
  let t = 0;

  const easeOut = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));

  function setPair(fromIdx, toIdx) {
    geometry.attributes.positionA.array.set(cache[fromIdx]);
    geometry.attributes.positionB.array.set(cache[toIdx]);
    geometry.attributes.positionA.needsUpdate = true;
    geometry.attributes.positionB.needsUpdate = true;
    uMorph.value = 0;
  }

  return {
    mesh,
    get shapeName() {
      return state === 'logo' ? 'JR wordmark' : SURFACES[surfaceIdx].name;
    },
    /** 1 while the wireframe is on the letters, 0 while it is a surface. */
    get logoBlend() {
      if (state === 'logo') return 1;
      if (state === 'surface') return 0;
      return state === 'toSurface' ? 1 - uMorph.value : uMorph.value;
    },
    /** Called on every hammer blow; only one that lands on a settled logo takes. */
    requestMorph() {
      if (state !== 'logo' || timer < MIN_LOGO_HOLD) return;
      surfaceIdx = (surfaceIdx + 1) % SURFACES.length;
      setPair(0, surfaceIdx + 1);
      state = 'toSurface';
      t = 0;
    },
    tick(now, dt) {
      // A slow tumble, strongest while it is off the letters.
      const away = state === 'logo' ? 0 : 1 - this.logoBlend;
      mesh.rotation.y = Math.sin(now * 0.08) * 0.10 + away * now * 0.22;
      mesh.rotation.z = Math.sin(now * 0.05) * 0.05 * away;

      if (strike) uGlow.value = Math.max(0, 1 - strike.value) ** 2;
      uAway.value = 1 - this.logoBlend;

      timer += dt;
      if (state === 'toSurface') {
        t += dt;
        uMorph.value = easeOut(Math.min(t / MORPH_OUT, 1));
        if (t >= MORPH_OUT) { state = 'surface'; timer = 0; }
      } else if (state === 'surface') {
        if (timer >= SURFACE_HOLD) {
          setPair(surfaceIdx + 1, 0);
          state = 'toLogo';
          t = 0;
        }
      } else if (state === 'toLogo') {
        t += dt;
        uMorph.value = easeOut(Math.min(t / MORPH_BACK, 1));
        if (t >= MORPH_BACK) { state = 'logo'; timer = 0; }
      }
    },
    dispose() {
      geometry.dispose();
      mat.dispose();
    },
  };
}

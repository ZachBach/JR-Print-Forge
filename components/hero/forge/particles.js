/**
 * particles — the million-particle forge.
 *
 * Three GPU-resident systems built on one pattern (Project Phoenix's hero):
 * storage buffers seeded once in compute, a TSL kernel that integrates them
 * every frame, and an instanced SpriteNodeMaterial that draws them.
 *
 *   cast    the JR monogram, 97.5% of the pool. Targets are generated on the
 *           GPU: area-weighted sampling of the extruded letters by binary
 *           search over the triangle-area CDF, so no CPU loop touches a
 *           million points and the pool is not capped by a Worker transfer
 *           (the limit Phoenix hit at 2M). Targets snap to print layers and
 *           are deposited bottom-up, rastered left to right within a layer,
 *           each dropping into place white-hot and cooling behind the print
 *           head. Every hammer blow sends a heat wave through them; the
 *           pointer pushes and heats them.
 *   sparks  velocity-aligned streaks thrown from the impact on every blow,
 *           under gravity and drag, bouncing on the floor as they cool.
 *   embers  buoyant fire particles rising out of the flame through noise.
 *
 * Every dial (how many particles draw) arrives through applySettings() from
 * the quality manager. Nothing here measures frame time or adjusts itself.
 *
 * Takes the three and TSL namespaces as arguments, like the rest of forge/.
 */
import { palette } from './jr-palette.js';
import { fireRamp } from './tsl-lib/src/ramp/fireRamp.js';

/** Share of the pool each system gets; any prefix of a system is a fair sample. */
export const MIX = { cast: 0.975, sparks: 0.01, embers: 0.015 };
/** Print layers over the letter height: at hero size one is a few pixels tall. */
const LAYERS = 56;
/** Share of cast particles snapped onto a layer plane; the rest fill between. */
const ON_LAYER = 0.8;

/**
 * Triangle soup of the extruded letters in forge-group space, with the
 * running area the GPU samples against. Area-weighted, so the density of
 * particles is even across faces, bevels and side walls alike.
 * @param {*} THREE
 * @param {*} word  the wordmark group (letters as meshes)
 */
function logoSoup(THREE, word) {
  word.updateMatrix();
  const pos = [], nrm = [], cdf = [];
  let area = 0;
  const box = new THREE.Box3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
  for (const mesh of word.children) {
    mesh.updateMatrix();
    const m = new THREE.Matrix4().multiplyMatrices(word.matrix, mesh.matrix);
    const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    const P = g.attributes.position;
    for (let i = 0; i < P.count; i += 3) {
      a.fromBufferAttribute(P, i).applyMatrix4(m);
      b.fromBufferAttribute(P, i + 1).applyMatrix4(m);
      c.fromBufferAttribute(P, i + 2).applyMatrix4(m);
      e1.subVectors(b, a); e2.subVectors(c, a);
      n.crossVectors(e1, e2);
      const A = n.length() / 2;
      if (A < 1e-12) continue;
      n.normalize();
      area += A;
      cdf.push(area);
      for (const v of [a, b, c]) { pos.push(v.x, v.y, v.z, 0); box.expandByPoint(v); }
      nrm.push(n.x, n.y, n.z, 0);
    }
  }
  return {
    pos: new Float32Array(pos), nrm: new Float32Array(nrm), cdf: new Float32Array(cdf),
    tris: cdf.length, area, box,
  };
}

/**
 * @param {*} THREE
 * @param {*} TSL
 * @param {{ pool: number, word: *, source: *, flameBase: *, floorY: number }} o
 *        `word` is the wordmark group the cast samples; `source` is where
 *        undeposited particles wait and sparks leave from (the impact, in
 *        group space); `flameBase` is where embers are born.
 */
export function buildForgeParticles(THREE, TSL, o) {
  const {
    Fn, If, Loop, uniform, instancedArray, instanceIndex, float, int, vec2, vec3, vec4,
    mix, smoothstep, hash, uv, length, normalize, exp, sin, cos, clamp, max, min,
    select, mx_noise_vec3, sqrt, fract, floor, dot, abs, pow, atan,
    modelWorldMatrix, modelViewMatrix, cameraPosition,
  } = TSL;
  const { forge, metal } = palette(TSL);
  const TWO_PI = Math.PI * 2;

  const nCast = Math.max(1, Math.round(o.pool * MIX.cast));
  const nSparks = Math.max(1, Math.round(o.pool * MIX.sparks));
  const nEmbers = Math.max(1, Math.round(o.pool * MIX.embers));

  // ---- uniforms (owned here, written from frame()) -----------------------
  const U = {
    time: uniform(0), dt: uniform(1 / 60), print: uniform(0),
    source: uniform(o.source.clone()), shock: uniform(o.source.clone()), shockT: uniform(99),
    pointer: uniform(new THREE.Vector3(0, 99, 0)), pointerOn: uniform(0), melt: uniform(0),
    strikeId: uniform(0), sparkShare: uniform(0.45), floorY: uniform(o.floorY),
    flameBase: uniform(o.flameBase.clone()), boost: uniform(0), heat: uniform(0.6),
    size: uniform(0.0032),
  };

  // ---- the cast: logo triangles in, targets out -----------------------------
  const soup = logoSoup(THREE, o.word);
  const T = soup.tris;
  const SEARCH = Math.ceil(Math.log2(Math.max(2, T))) + 1;
  const yMin = soup.box.min.y, yMax = soup.box.max.y;
  const xMin = soup.box.min.x, width = Math.max(1e-6, soup.box.max.x - xMin);
  const layerH = (yMax - yMin) / LAYERS;

  const triV = instancedArray(soup.pos, 'vec4');
  const triN = instancedArray(soup.nrm, 'vec4');
  const cdf = instancedArray(soup.cdf, 'float');

  const cTgt = instancedArray(nCast, 'vec4');   // xyz target, w print order
  const cNrm = instancedArray(nCast, 'vec4');   // xyz normal, w seed
  const cPos = instancedArray(nCast, 'vec4');   // xyz position, w heat
  const cVel = instancedArray(nCast, 'vec4');   // xyz velocity

  /** Decorrelated streams per particle; uint maths, so seeds stay exact past 2^24. */
  const rnd = (base, k) => hash(base.mul(8).add(k));
  const jitter = (base, k, s) => vec3(rnd(base, k).sub(0.5), rnd(base, k + 1).sub(0.5), rnd(base, k + 2).sub(0.5)).mul(s);

  const initCast = Fn(() => {
    const i = instanceIndex;
    const r = rnd(i, 0).mul(soup.area);
    const lo = int(0).toVar(), hi = int(T - 1).toVar();
    Loop(SEARCH, () => {
      const mid = lo.add(hi).div(2).toVar();
      If(cdf.element(mid).lessThan(r), () => { lo.assign(mid.add(1)); }).Else(() => { hi.assign(mid); });
    });
    const t0 = min(lo, int(T - 1)).mul(3);
    const A = triV.element(t0).xyz, B = triV.element(t0.add(1)).xyz, C = triV.element(t0.add(2)).xyz;
    const su = sqrt(rnd(i, 1)), v = rnd(i, 2);
    const p = A.mul(su.oneMinus()).add(B.mul(su.mul(v.oneMinus()))).add(C.mul(su.mul(v)));
    const n = triN.element(min(lo, int(T - 1))).xyz;
    const ly = p.y.sub(yMin).div(layerH);
    const y = select(rnd(i, 3).lessThan(ON_LAYER), floor(ly.add(0.5)).mul(layerH).add(yMin), p.y);
    const layer = clamp(floor(ly), 0, LAYERS - 1);
    const order = layer.add(p.x.sub(xMin).div(width)).div(LAYERS);
    cTgt.element(i).assign(vec4(p.x, y, p.z, order));
    cNrm.element(i).assign(vec4(n.x, n.y, n.z, rnd(i, 4)));
    const s = U.source.add(jitter(i, 5, 0.02));
    cPos.element(i).assign(vec4(s.x, s.y, s.z, 1));
    cVel.element(i).assign(vec4(0, 0, 0, 0));
  })().compute(nCast);

  const updateCast = Fn(() => {
    const i = instanceIndex;
    const tg = cTgt.element(i), nm = cNrm.element(i);
    const P = cPos.element(i), V = cVel.element(i);
    const p = P.xyz.toVar(), v = V.xyz.toVar(), heat = P.w.toVar();
    const seed = nm.w;
    If(tg.w.greaterThanEqual(U.print), () => {
      // Waiting for the print head: a few millimetres above its place, like
      // a bead leaving a nozzle, so the moment the layer reaches it, it drops
      // in white-hot. (A stream thrown from the anvil was tried; at a million
      // particles it was a waterfall that buried the rig.)
      p.assign(tg.xyz.add(vec3(rnd(i, 8).sub(0.5).mul(0.006), rnd(i, 9).mul(0.012).add(0.008), rnd(i, 10).sub(0.5).mul(0.006))));
      v.assign(vec3(0, -0.25, 0));
      heat.assign(1);
    }).Else(() => {
      const d = tg.xyz.sub(p), dist = length(d).add(1e-5);
      // a spring near the target, a capped pull far from it — so a particle
      // in flight falls toward its place like a thrown thing, not a zip line
      const pull = d.div(dist).mul(min(dist.mul(mix(float(110), float(6), U.melt)), 16));
      // the blow's heat wave, travelling out from the anvil through the part
      const toS = p.sub(U.shock), ds = length(toS).add(1e-4);
      // q·q, never q.pow(2): WGSL's pow is exp2(y·log2(x)), NaN for x < 0,
      // and a NaN velocity never recovers — the wave would erase the logo
      const q = ds.sub(U.shockT.mul(1.8)).div(0.05);
      const ring = exp(q.mul(q).negate()).mul(exp(U.shockT.mul(-1.4)));
      // the pointer: a heat gun that pushes
      const toP = p.sub(U.pointer), dp = length(toP).add(1e-4);
      const push = exp(dp.mul(dp).div(0.004).negate()).mul(U.pointerOn);
      const sag = vec3(sin(seed.mul(40).add(U.time.mul(1.3))).mul(0.25), -0.8, cos(seed.mul(31).add(U.time)).mul(0.25)).mul(U.melt);
      // The wave is a nudge, not a blast: a few millimetres of travel that the
      // spring takes straight back, so the letterform never loses its edges.
      const acc = pull.add(toS.div(ds).mul(ring.mul(8))).add(toP.div(dp).mul(push.mul(16))).add(sag);
      // light drag in flight, heavy once it is home
      const drag = mix(float(12), float(1.2), smoothstep(0.02, 0.15, dist));
      v.assign(v.add(acc.mul(U.dt)).mul(exp(U.dt.mul(drag).negate())));
      p.assign(p.add(v.mul(U.dt)));
      // Reheat is a travelling band that cools within half a second. Blows
      // land every 1.7 s, so anything slower stacks heat across the whole cast
      // until it blooms white.
      const gain = ring.mul(4).add(push.mul(4)).add(U.melt.mul(0.9)).mul(U.dt);
      // cools toward the coals: the foot of each letter never goes fully dark
      const coals = float(1).sub(smoothstep(yMin, yMin + (yMax - yMin) * 0.38, tg.y)).mul(0.22);
      heat.assign(min(coals.add(heat.sub(coals).mul(exp(U.dt.mul(-1.6)))).add(gain), 1.2));
    });
    cPos.element(i).assign(vec4(p.x, p.y, p.z, heat));
    cVel.element(i).assign(vec4(v.x, v.y, v.z, 0));
  })().compute(nCast);

  // ---- sparks ---------------------------------------------------------------
  const sPos = instancedArray(nSparks, 'vec4');   // xyz position, w age / life
  const sVel = instancedArray(nSparks, 'vec4');   // xyz velocity, w strike it last saw

  const initSparks = Fn(() => {
    const i = instanceIndex;
    sPos.element(i).assign(vec4(U.source.x, U.source.y, U.source.z, 2));
    sVel.element(i).assign(vec4(0, 0, 0, 0));
  })().compute(nSparks);

  const updateSparks = Fn(() => {
    const i = instanceIndex;
    const P = sPos.element(i), V = sVel.element(i);
    const p = P.xyz.toVar(), v = V.xyz.toVar(), t = P.w.toVar();
    const life = rnd(i, 7).mul(0.65).add(0.35);
    If(V.w.notEqual(U.strikeId), () => {
      const s = i.add(U.strikeId.toUint().mul(1000003));
      If(rnd(s, 0).lessThan(U.sparkShare), () => {
        const th = rnd(s, 1).mul(TWO_PI);
        const dir = normalize(vec3(cos(th), rnd(s, 2).mul(0.9).add(0.25), sin(th).mul(0.55)));
        const speed = rnd(s, 3).pow(2).mul(1.6).add(0.45);
        p.assign(U.source.add(vec3(rnd(s, 4).sub(0.5).mul(0.05), 0.006, rnd(s, 5).sub(0.5).mul(0.02))));
        v.assign(dir.mul(speed));
        t.assign(0);
      });
    });
    If(t.lessThan(1), () => {
      v.assign(v.add(vec3(0, -5.5, 0).mul(U.dt)).mul(exp(U.dt.mul(-0.9))));
      p.assign(p.add(v.mul(U.dt)));
      If(p.y.lessThan(U.floorY).and(v.y.lessThan(0)), () => {
        p.assign(vec3(p.x, U.floorY, p.z));
        v.assign(vec3(v.x.mul(0.55), v.y.mul(-0.3), v.z.mul(0.55)));
      });
      t.assign(t.add(U.dt.div(life)));
    });
    sPos.element(i).assign(vec4(p.x, p.y, p.z, t));
    sVel.element(i).assign(vec4(v.x, v.y, v.z, U.strikeId));
  })().compute(nSparks);

  // ---- embers ---------------------------------------------------------------
  const ePos = instancedArray(nEmbers, 'vec4');   // xyz position, w age / life
  const eVel = instancedArray(nEmbers, 'vec4');   // xyz velocity, w 1 / life

  const initEmbers = Fn(() => {
    const i = instanceIndex;
    const t = rnd(i, 0);
    const b = U.flameBase.add(vec3(rnd(i, 1).sub(0.5).mul(0.06), t.mul(0.3), rnd(i, 2).sub(0.5).mul(0.05)));
    ePos.element(i).assign(vec4(b.x, b.y, b.z, t));
    eVel.element(i).assign(vec4(0, 0.25, 0, float(1).div(rnd(i, 3).pow(2).mul(2.2).add(0.6))));
  })().compute(nEmbers);

  const updateEmbers = Fn(() => {
    const i = instanceIndex;
    const P = ePos.element(i), V = eVel.element(i);
    const p = P.xyz.toVar(), v = V.xyz.toVar(), t = P.w.toVar(), rate = V.w.toVar();
    If(t.greaterThanEqual(1), () => {
      const s = i.add(U.time.mul(60).toUint().mul(2654435));
      const r = sqrt(rnd(s, 0)).mul(0.045), th = rnd(s, 1).mul(TWO_PI);
      p.assign(U.flameBase.add(vec3(r.mul(cos(th)), rnd(s, 2).mul(0.03), r.mul(sin(th)).mul(0.8))));
      v.assign(vec3(rnd(s, 3).sub(0.5).mul(0.08), rnd(s, 4).mul(0.25).add(0.2).add(U.boost.mul(0.55)), rnd(s, 5).sub(0.5).mul(0.08)));
      rate.assign(float(1).div(rnd(s, 6).pow(2).mul(2.2).add(0.6)));
      t.assign(0);
    }).Else(() => {
      const n = mx_noise_vec3(p.mul(7).add(vec3(0, U.time.mul(-1.6), fract(float(i).mul(0.618)).mul(9))));
      const acc = vec3(0, t.oneMinus().mul(0.55), 0).add(n.mul(0.9));
      v.assign(v.add(acc.mul(U.dt)).mul(exp(U.dt.mul(-1.3))));
      p.assign(p.add(v.mul(U.dt)));
      t.assign(t.add(U.dt.mul(rate)));
    });
    ePos.element(i).assign(vec4(p.x, p.y, p.z, t));
    eVel.element(i).assign(vec4(v.x, v.y, v.z, rate));
  })().compute(nEmbers);

  // ---- materials --------------------------------------------------------------
  const dEdge = length(uv().sub(0.5)).mul(2);
  const disc = float(1).sub(smoothstep(0.2, 1.0, dEdge));
  const additive = () => {
    const m = new THREE.SpriteNodeMaterial();
    m.transparent = true; m.depthWrite = false; m.blending = THREE.AdditiveBlending;
    return m;
  };

  // Cast: opaque, depth-tested dots, each lit from its stored normal. Opaque
  // is the load-bearing choice. Additive sprites sum, so a surface's
  // brightness grew with particle count and overlap — the snapped print
  // layers stacked into one-pixel lines at HDR ~5 and bloomed the letters
  // white. With depth, a pixel shows the nearest particle's shading and
  // nothing else, at any count, and only genuinely hot metal crosses the
  // bloom threshold. It is also far cheaper: early-z throws away hidden
  // fragments and there is no HDR blend traffic, which is exactly what an
  // integrated GPU runs short of.
  //
  // A tight specular from the key light gives the steel its glint, heat runs
  // the blackbody ramp over it, and a thin rim of brand blue picks the edges.
  // Back-facing particles seen through the gaps between layers are dimmed.
  const cP = cPos.toAttribute(), cN = cNrm.toAttribute(), cT = cTgt.toAttribute();
  const castMat = new THREE.SpriteNodeMaterial();
  castMat.name = 'particleCast';
  castMat.alphaTest = 0.5;
  castMat.positionNode = cP.xyz;
  {
    // Renormalized here: the stored normal can arrive a few percent over unit
    // length, and the 32nd-power specular turns a 7% overshoot into an 8×
    // highlight — that was the white haze over the letters.
    const heat = cP.w, N = normalize(cN.xyz), seed = cN.w;
    const deposited = select(cT.w.lessThan(U.print), float(1), float(0));
    const worldPos = modelWorldMatrix.mul(vec3(cP.xyz));
    const Vd = normalize(cameraPosition.sub(worldPos));
    const facing = dot(N, Vd);
    const KEY = normalize(vec3(0.9, 1.4, 1.1)), FILL = normalize(vec3(-1.2, 0.4, 0.8));
    const shade = float(0.08).add(pow(max(dot(N, KEY), 0), 0.9).mul(0.72)).add(max(dot(N, FILL), 0).mul(0.12));
    const spec = pow(clamp(dot(N, normalize(KEY.add(Vd))), 0, 1), 32).mul(0.7);
    const rim = pow(clamp(float(1).sub(abs(facing)), 0, 1), 4).mul(0.35);
    const vis = smoothstep(float(-0.3), float(0.15), facing).mul(0.8).add(0.2);
    // alternate print layers catch the light a touch differently
    const band = fract(cT.y.sub(yMin).div(layerH).mul(0.5)).step(0.5).mul(0.2).add(0.8);
    // Lit steel stays under the 0.36 bloom threshold; only glints and heat
    // cross it, so the letters glow where metal would and nowhere else.
    const steel = mix(metal.graphite, metal.steel, shade).mul(band).add(metal.bright.mul(spec)).mul(vis);
    const hot = fireRamp(TSL, heat.mul(4.0), { gain: 2.0 });
    castMat.colorNode = mix(steel, hot, smoothstep(0.03, 0.5, heat)).add(forge.blue.mul(rim));
    // a round dot, and nothing at all until the print head reaches it
    castMat.opacityNode = select(dEdge.lessThan(1), deposited, float(0));
    castMat.scaleNode = U.size.mul(seed.mul(0.5).add(0.75)).mul(heat.mul(0.4).add(1));
  }

  // Sparks: streaks along the projected velocity, bright at the head.
  const sP = sPos.toAttribute(), sV = sVel.toAttribute();
  const sparkMat = additive();
  sparkMat.name = 'particleSparks';
  sparkMat.positionNode = sP.xyz;
  {
    const t = sP.w;
    const hot = pow(clamp(t.oneMinus(), 0, 1), 1.3);
    const vView = modelViewMatrix.mul(vec4(sV.x, sV.y, sV.z, 0)).xy;
    const along = uv().x, across = abs(uv().y.sub(0.5)).mul(2);
    sparkMat.rotationNode = atan(vView.y, vView.x);
    sparkMat.scaleNode = vec2(max(length(vView).mul(0.03), 0.004), 0.0026).mul(hot.mul(0.8).add(0.5));
    sparkMat.colorNode = fireRamp(TSL, hot.mul(4).add(0.4), { gain: 2.6 });
    sparkMat.opacityNode = select(t.lessThan(1), float(1), float(0))
      .mul(smoothstep(1.0, 0.7, t)).mul(smoothstep(0.0, 1.0, along)).mul(float(1).sub(smoothstep(0.3, 1.0, across)));
  }

  // Embers: soft discs cooling through the fire ramp; a few big flakes.
  const eP = ePos.toAttribute();
  const emberMat = additive();
  emberMat.name = 'particleEmbers';
  emberMat.positionNode = eP.xyz;
  {
    const t = clamp(eP.w, 0, 1);
    const flake = select(hash(instanceIndex).greaterThan(0.94), float(2.4), float(1));
    const temp = pow(t.oneMinus(), 1.1).mul(U.heat.mul(0.4).add(0.75));
    emberMat.scaleNode = float(0.0038).mul(flake).mul(t.mul(-0.5).add(1));
    emberMat.colorNode = fireRamp(TSL, temp.mul(3.0), { gain: 2.0 });
    emberMat.opacityNode = disc.mul(smoothstep(0.0, 0.08, t)).mul(smoothstep(1.0, 0.6, t)).mul(0.8);
  }

  const sprite = (mat, n, name) => {
    const s = new THREE.Sprite(mat);
    s.count = n; s.frustumCulled = false; s.name = name;
    return s;
  };
  const cast = sprite(castMat, nCast, 'particle_cast');
  const sparks = sprite(sparkMat, nSparks, 'particle_sparks');
  const embers = sprite(emberMat, nEmbers, 'particle_embers');
  cast.renderOrder = 3; sparks.renderOrder = 12; embers.renderOrder = 11;
  const group = new THREE.Group();
  group.name = 'forge_particles';
  group.add(cast, sparks, embers);

  const draw = { cast: nCast, sparks: nSparks, embers: nEmbers };

  return {
    group,
    pool: nCast + nSparks + nEmbers,
    /** Particles drawn right now, across the three systems. */
    get drawn() { return draw.cast + draw.sparks + draw.embers; },
    /** Bytes held on the GPU: four vec4 buffers for the cast, two per other system. */
    get bytes() { return nCast * 64 + (nSparks + nEmbers) * 32 + soup.pos.byteLength * 2 + soup.cdf.byteLength; },
    /** Seed every buffer. Runs once, over the whole pool. @param {*} renderer */
    async init(renderer) {
      await renderer.computeAsync([initCast, initSparks, initEmbers]);
    },
    /** From the quality manager: how many particles to draw. @param {{ particles: number }} s */
    applySettings(s) {
      const f = Math.min(1, Math.max(0, s.particles / (nCast + nSparks + nEmbers)));
      draw.cast = Math.max(1000, Math.round(nCast * f));
      draw.sparks = Math.max(200, Math.round(nSparks * f));
      draw.embers = Math.max(300, Math.round(nEmbers * f));
      cast.count = Math.min(nCast, draw.cast);
      sparks.count = Math.min(nSparks, draw.sparks);
      embers.count = Math.min(nEmbers, draw.embers);
      // a blow throws a few thousand sparks, whatever the pool: more reads as fog
      U.sparkShare.value = Math.min(0.6, 3500 / sparks.count);
      // sparse pools draw bigger dots so the surface stays closed
      U.size.value = 0.0032 * Math.min(2, Math.max(1, Math.sqrt(400000 / cast.count)));
    },
    /**
     * Advance one frame. Only the drawn prefix of each system is simulated.
     * @param {*} renderer
     * @param {{ t: number, dt: number, print: number, strikes: number, sinceStrike: number,
     *           impact: *, pointer: * | null, heat: number, melt: number }} f
     *        `impact` is where the last blow landed, in group space: sparks
     *        leave from it and the heat wave spreads out of it.
     */
    frame(renderer, f) {
      U.time.value = f.t;
      U.dt.value = Math.min(f.dt, 1 / 20);
      U.print.value = f.print;
      U.strikeId.value = f.strikes;
      U.source.value.copy(f.impact);
      U.shock.value.copy(f.impact);
      U.shockT.value = f.strikes > 0 ? f.sinceStrike : 99;
      U.heat.value = f.heat;
      U.boost.value = Math.max(0, 1 - f.sinceStrike / 0.5);
      U.melt.value = f.melt;
      if (f.pointer) { U.pointer.value.copy(f.pointer); U.pointerOn.value += (1 - U.pointerOn.value) * 0.2; }
      else U.pointerOn.value *= 0.85;
      renderer.compute(updateCast, cast.count);
      renderer.compute(updateSparks, sparks.count);
      renderer.compute(updateEmbers, embers.count);
    },
    dispose() {
      castMat.dispose(); sparkMat.dispose(); emberMat.dispose();
    },
  };
}

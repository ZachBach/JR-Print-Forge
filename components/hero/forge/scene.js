// Forge hero scene — anvil, swinging hammer, hot billet, sparks, flame, and
// the JR wordmark cast across the floor.
//
// Imports nothing but geo-lib (which imports nothing either) and takes the
// three namespace as its first argument, per geo-lib/docs/CONVENTIONS.md.
// Real-world metres, y-up. Anvil face at y ≈ 0.20.

import { roundedBox } from './geo-lib/src/solid/roundedBox.js';
import { revolve } from './geo-lib/src/solid/revolve.js';
import { tube } from './geo-lib/src/solid/tube.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const easeInOut = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);

function sparkTexture(THREE, inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, outer);
  g.addColorStop(1, 'rgba(255,90,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---- JR: slab letterforms drawn as closed paths, extruded and bevelled ----
/** The wordmark's built dimensions, shared with the logo-morph lattice. */
export const WORD = { height: 0.46, depth: 0.14, x: 0.30, y: -0.66, z: 0.12, gap: 0.68 };

/** The two slab letterforms, for anything that needs to trace their outline. */
export function logoGlyphs(THREE) {
  return [
    { shape: glyphJ(THREE), x: 0 },
    { shape: glyphR(THREE), x: WORD.gap },
  ];
}

function glyphJ(THREE) {
  const s = new THREE.Shape();
  s.moveTo(0.30, 1.0);
  s.lineTo(0.54, 1.0);
  s.lineTo(0.54, 0.36);
  s.bezierCurveTo(0.54, 0.12, 0.43, 0.0, 0.26, 0.0);
  s.bezierCurveTo(0.10, 0.0, 0.0, 0.12, 0.0, 0.31);
  s.lineTo(0.24, 0.31);
  s.bezierCurveTo(0.24, 0.21, 0.265, 0.195, 0.30, 0.20);
  s.lineTo(0.30, 0.36);
  s.closePath();
  return s;
}

function glyphR(THREE) {
  const s = new THREE.Shape();
  s.moveTo(0.0, 0.0);
  s.lineTo(0.24, 0.0);
  s.lineTo(0.24, 0.52);
  s.lineTo(0.36, 0.52);
  s.lineTo(0.60, 0.0);
  s.lineTo(0.86, 0.0);
  s.lineTo(0.585, 0.565);
  s.bezierCurveTo(0.74, 0.62, 0.80, 0.70, 0.80, 0.80);
  s.bezierCurveTo(0.80, 0.93, 0.70, 1.0, 0.50, 1.0);
  s.lineTo(0.0, 1.0);
  s.closePath();
  const hole = new THREE.Path();
  hole.moveTo(0.24, 0.62);
  hole.lineTo(0.47, 0.62);
  hole.bezierCurveTo(0.54, 0.62, 0.56, 0.68, 0.56, 0.735);
  hole.bezierCurveTo(0.56, 0.79, 0.53, 0.83, 0.46, 0.83);
  hole.lineTo(0.24, 0.83);
  hole.closePath();
  s.holes.push(hole);
  return s;
}

export function buildWordmark(THREE, material, opts = {}) {
  const { height = 0.62, depth = 0.17, refine } = opts;
  const g = new THREE.Group();
  g.name = 'jr_wordmark';
  const letters = [
    ['letter_J', glyphJ(THREE), 0],
    ['letter_R', glyphR(THREE), 0.68],
  ];
  letters.forEach(([name, shape, x]) => {
    let geo = new THREE.ExtrudeGeometry(shape, {
      depth: depth / height, curveSegments: 64, steps: 6,
      bevelEnabled: true, bevelSize: 0.022, bevelThickness: 0.022, bevelSegments: 5,
    });
    geo.scale(height, height, height);
    geo.translate(x * height, 0, -depth / 2);
    if (refine) geo = refine(geo);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, material);
    m.name = name;
    g.add(m);
  });
  // centre the pair on x
  const b = new THREE.Box3().setFromObject(g);
  const c = b.getCenter(new THREE.Vector3());
  g.children.forEach((m) => m.geometry.translate(-c.x, 0, 0));
  return g;
}

/**
 * @param {*} THREE         the three namespace
 * @param {*} makeMaterial  (name, spec) => material, from forge-materials
 * @param {{ logoUrl?: string, refine?: (geo: *) => *, flame?: () => * }} [opts]
 */
export function buildForge(THREE, makeMaterial, opts = {}) {
  const STRIKE_PERIOD = 1.7;
  const group = new THREE.Group();
  group.name = 'forge_scene';

  const mat = {
    anvil: makeMaterial('anvilSteel', { color: 0x2f3438, metalness: 0.34, roughness: 0.52 }),
    face:  makeMaterial('anvilFace',  { color: 0x8d979d, metalness: 0.35, roughness: 0.22 }),
    stump: makeMaterial('oakStump',   { color: 0x2a2018, metalness: 0.02, roughness: 0.92 }),
    head:  makeMaterial('hammerHead', { color: 0x3a4045, metalness: 0.35, roughness: 0.42 }),
    haft:  makeMaterial('hickory',    { color: 0x6b4a28, metalness: 0.02, roughness: 0.78 }),
    hot:   makeMaterial('hotBillet',  { color: 0xff6b00, metalness: 0.1, roughness: 0.45 }),
    band:  makeMaterial('steelBand',  { color: 0x1b1e20, metalness: 0.3, roughness: 0.6 }),
    word:  makeMaterial('wordmark',   { color: 0x3a4045, metalness: 0.34, roughness: 0.45 }),
  };

  // ---- anvil body (extruded side profile, bevelled) ----------------------
  const P = [
    [-0.20, 0.20], [0.22, 0.20], [0.22, 0.152], [0.10, 0.128], [0.088, 0.052],
    [0.16, 0.018], [0.16, 0], [-0.16, 0], [-0.16, 0.018], [-0.088, 0.052],
    [-0.10, 0.128], [-0.20, 0.152],
  ];
  const shape = new THREE.Shape();
  P.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  shape.closePath();
  const bodyGeo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.13, curveSegments: 32, steps: 3,
    bevelEnabled: true, bevelSize: 0.005, bevelThickness: 0.005, bevelSegments: 3,
  });
  bodyGeo.translate(0, 0, -0.065);
  const body = new THREE.Mesh(bodyGeo, mat.anvil);
  body.name = 'anvil_body';
  group.add(body);

  const faceTop = new THREE.Mesh(roundedBox(THREE, 0.418, 0.011, 0.128, 0.004, 5), mat.face);
  faceTop.name = 'anvil_face';
  faceTop.position.set(0.01, 0.2045, 0);
  group.add(faceTop);

  const horn = new THREE.Mesh(new THREE.ConeGeometry(0.058, 0.23, 40), mat.anvil);
  horn.name = 'anvil_horn';
  horn.rotation.z = -Math.PI / 2;
  horn.scale.z = 0.85;
  horn.position.set(0.335, 0.171, 0);
  group.add(horn);

  // ---- brand plate: the JR badge, cast into the anvil flank --------------
  if (opts.logoUrl) {
    const tex = new THREE.TextureLoader().load(opts.logoUrl);
    tex.colorSpace = THREE.SRGBColorSpace;
    const plateMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.2 });
    plateMat.name = 'brandPlate';
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.074, 0.074), plateMat);
    plate.name = 'brand_plate';
    plate.position.set(-0.03, 0.128, 0.0662);
    group.add(plate);
    const back = plate.clone();
    back.name = 'brand_plate_back';
    back.position.z = -0.0662;
    back.rotation.y = Math.PI;
    group.add(back);
  }

  // ---- stump (revolved profile: [radius, y]) -----------------------------
  const stumpGeo = revolve(THREE, [
    [0.001, -0.53], [0.19, -0.525], [0.2, -0.50], [0.183, -0.30],
    [0.178, -0.14], [0.184, -0.08], [0.172, -0.03], [0.168, 0.0], [0.001, 0.002],
  ], { radial: 56 });
  const stump = new THREE.Mesh(stumpGeo, mat.stump);
  stump.name = 'oak_stump';
  group.add(stump);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.187, 0.187, 0.03, 56), mat.band);
  band.name = 'stump_band';
  band.position.y = -0.09;
  group.add(band);

  // ---- hot billet on the face -------------------------------------------
  const billet = new THREE.Mesh(roundedBox(THREE, 0.19, 0.021, 0.048, 0.006, 6), mat.hot);
  billet.name = 'hot_billet';
  billet.position.set(-0.03, 0.2205, 0);
  group.add(billet);
  const tongs = new THREE.Mesh(roundedBox(THREE, 0.17, 0.013, 0.024, 0.005, 4), mat.band);
  tongs.name = 'billet_tongs';
  tongs.position.set(-0.21, 0.2205, 0);
  group.add(tongs);

  // ---- hammer ------------------------------------------------------------
  const hammer = new THREE.Group();
  hammer.name = 'hammer';
  hammer.position.set(-0.03, 0.663, 0.015);
  const haftGeo = tube(THREE,
    [[0, 0.02, 0], [0.004, -0.12, 0], [0.004, -0.26, 0], [0, -0.378, 0]],
    (t) => 0.0135 + t * 0.007, { radial: 20 });
  const haft = new THREE.Mesh(haftGeo, mat.haft);
  haft.name = 'hammer_haft';
  hammer.add(haft);
  const headMesh = new THREE.Mesh(roundedBox(THREE, 0.16, 0.064, 0.064, 0.008, 6), mat.head);
  headMesh.name = 'hammer_head';
  headMesh.position.y = -0.40;
  hammer.add(headMesh);
  const peen = new THREE.Mesh(new THREE.ConeGeometry(0.032, 0.052, 4), mat.head);
  peen.name = 'hammer_peen';
  peen.rotation.z = -Math.PI / 2;
  peen.position.set(0.103, -0.40, 0);
  hammer.add(peen);
  group.add(hammer);

  // ---- JR wordmark across the floor, behind the anvil --------------------
  const word = buildWordmark(THREE, mat.word, {
    height: WORD.height, depth: WORD.depth, refine: opts.refine,
  });
  word.position.set(WORD.x, WORD.y, WORD.z);
  group.add(word);

  // ---- sparks + flame (sprites: WebGPU caps THREE.Points at one pixel) ---
  const impact = new THREE.Vector3(-0.03, 0.232, 0);
  const sparkTex = sparkTexture(THREE, 'rgba(255,245,215,1)', 'rgba(255,140,20,.9)');

  const sparks = [];
  for (let i = 0; i < 64; i++) {
    const m = new THREE.SpriteMaterial({
      map: sparkTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    m.name = 'sparkMaterial';
    const s = new THREE.Sprite(m);
    s.name = `spark_${i + 1}`;
    s.scale.setScalar(0.012);
    s.visible = false;
    s.userData = { v: new THREE.Vector3(), life: 0 };
    group.add(s);
    sparks.push(s);
  }

  // volumetric fire, supplied by the caller (it owns TSL and the uniforms)
  let volume = null;
  if (opts.flame) {
    volume = opts.flame();
    volume.position.set(impact.x, impact.y + volume.userData.height / 2 - 0.022, impact.z);
    group.add(volume);
  }

  const glow = new THREE.PointLight(0xff6b00, 0.4, 1.1, 2);
  glow.name = 'forge_glow';
  glow.position.copy(impact);
  group.add(glow);

  // the forging rig sits right of centre; the wordmark runs across the floor
  const rig = new THREE.Group();
  rig.name = 'forge_rig';
  [...group.children].forEach((c) => { if (c !== word) rig.add(c); });
  group.add(rig);
  rig.position.set(0.30, 0.40, 0);

  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  const c = box.getCenter(new THREE.Vector3());
  group.position.set(-c.x, -c.y, -c.z);

  let lastPhase = 0;
  const api = {
    group, rig, impact, word, strikePeriod: STRIKE_PERIOD, heat: 0.6,
    /** Centre of the wordmark in group space — where the logo lattice sits. */
    wordAnchor: new THREE.Vector3(WORD.x, WORD.y + WORD.height / 2, WORD.z),
    /** Fired on every hammer blow. @type {null | ((impact: *) => void)} */
    onStrike: /** @type {null | ((impact: *) => void)} */ (null),
    impactWorld: () => rig.localToWorld(impact.clone()),
    // framing bounds: the hammer's raised arc is allowed to overflow.
    // The refresh is load-bearing: the recentre on line 251 happens after the
    // updateMatrixWorld above, and expandByObject trusts its parent's
    // matrixWorld rather than recomputing it. Without this the box comes back
    // in pre-recentre space and the camera aims at empty air beside the rig.
    coreBounds: () => {
      group.updateMatrixWorld(true);
      const b = new THREE.Box3();
      [word, stump, body, faceTop, horn, billet, band].forEach((o) => b.expandByObject(o));
      return b;
    },
    tick(t, dt) {
      const p = (t % STRIKE_PERIOD) / STRIKE_PERIOD;
      let a;
      // raises to the smith's side (-x, away from the horn) and falls onto
      // the billet, which sits directly under the pivot
      if (p < 0.62) a = 1.05 * easeInOut(p / 0.62);
      else if (p < 0.735) a = 1.05 * (1 - Math.pow((p - 0.62) / 0.115, 1.7));
      else a = 0.14 * Math.sin(((p - 0.735) / 0.265) * Math.PI);
      hammer.rotation.z = a;

      const struck = p >= 0.735 && lastPhase < 0.735;
      lastPhase = p;

      if (struck) {
        sparks.forEach((s) => {
          const th = Math.random() * Math.PI * 2;
          const sp = 0.5 + Math.random() * 1.6;
          s.userData.v.set(Math.cos(th) * sp * 0.6, 0.4 + Math.random() * 1.2, Math.sin(th) * sp * 0.32);
          s.userData.life = 0.42 + Math.random() * 0.45;
          s.position.copy(impact);
          s.visible = true;
        });
        glow.intensity = 1.9;
        api.heat = 1;
        if (api.onStrike) api.onStrike(impact);
      }

      api.heat += (0.55 - api.heat) * Math.min(dt * 1.1, 1);
      glow.intensity += (0.3 + Math.sin(t * 9) * 0.05 - glow.intensity) * Math.min(dt * 5, 1);

      sparks.forEach((s) => {
        if (!s.visible) return;
        s.userData.life -= dt;
        if (s.userData.life <= 0) { s.visible = false; return; }
        s.userData.v.y -= 3.4 * dt;
        s.position.addScaledVector(s.userData.v, dt);
        if (s.position.y < impact.y - 0.24) s.userData.v.y = Math.abs(s.userData.v.y) * 0.22;
        const l = clamp01(s.userData.life / 0.7);
        s.material.opacity = l;
        s.scale.setScalar(0.005 + l * 0.012);
      });

      if (volume) {
        const f = 1 + (api.heat - 0.55) * 0.55 + Math.sin(t * 5.1) * 0.05;
        volume.scale.set(1 + (f - 1) * 0.35, f, 1 + (f - 1) * 0.35);
        volume.position.y = impact.y + (volume.userData.height * f) / 2 - 0.022;
      }
    },
  };
  return api;
}

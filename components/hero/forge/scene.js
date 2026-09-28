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

// ---- JR: bracketed-serif letterforms, extruded and bevelled ---------------
/** The wordmark's built dimensions, shared with the lattice and the particle cast. */
export const WORD = { height: 0.46, depth: 0.14, x: 0.30, y: -0.66, z: 0.12, gap: 0.78 };

// The monogram follows the brand mark (the serif JR over the anvil in
// public/jr-print-forge.jpg): bracketed slab serifs, a ball-terminal J, a
// straight-legged R with a foot serif. Path data in cap-height units — y up,
// baseline 0, cap 1 — so the same numbers can be previewed as SVG.
const GLYPH_J = [
  ['M', 0.14, 1.0], ['L', 0.70, 1.0], ['L', 0.70, 0.915],
  ['C', 0.615, 0.915, 0.555, 0.90, 0.545, 0.835],
  ['L', 0.545, 0.30],
  ['C', 0.545, 0.085, 0.425, -0.02, 0.24, -0.02],
  ['C', 0.075, -0.02, -0.035, 0.065, -0.035, 0.185],
  ['C', -0.035, 0.27, 0.025, 0.325, 0.10, 0.325],
  ['C', 0.175, 0.325, 0.225, 0.275, 0.225, 0.205],
  ['C', 0.225, 0.155, 0.205, 0.125, 0.185, 0.105],
  ['C', 0.215, 0.085, 0.24, 0.078, 0.262, 0.078],
  ['C', 0.29, 0.078, 0.305, 0.11, 0.305, 0.20],
  ['L', 0.305, 0.835],
  ['C', 0.295, 0.90, 0.23, 0.915, 0.14, 0.915],
  ['Z'],
];

const GLYPH_R = [
  ['M', 0.0, 1.0], ['L', 0.54, 1.0],
  ['C', 0.725, 1.0, 0.845, 0.915, 0.845, 0.775],
  ['C', 0.845, 0.66, 0.765, 0.59, 0.635, 0.568],
  ['L', 0.835, 0.13],
  ['C', 0.85, 0.098, 0.872, 0.085, 0.91, 0.085],
  ['L', 0.95, 0.085], ['L', 0.95, 0.0], ['L', 0.60, 0.0], ['L', 0.60, 0.085], ['L', 0.625, 0.085],
  ['L', 0.44, 0.525], ['L', 0.34, 0.525], ['L', 0.34, 0.14],
  ['C', 0.345, 0.10, 0.38, 0.085, 0.46, 0.085],
  ['L', 0.46, 0.0], ['L', 0.0, 0.0], ['L', 0.0, 0.085],
  ['C', 0.075, 0.085, 0.098, 0.10, 0.10, 0.14],
  ['L', 0.10, 0.86],
  ['C', 0.098, 0.90, 0.075, 0.915, 0.0, 0.915],
  ['Z'],
  // the bowl's counter
  ['M', 0.34, 0.605], ['L', 0.49, 0.605],
  ['C', 0.57, 0.605, 0.60, 0.665, 0.60, 0.76],
  ['C', 0.60, 0.855, 0.565, 0.915, 0.49, 0.915],
  ['L', 0.34, 0.915], ['Z'],
];

/** Path commands → a Shape; every subpath after the first is a hole. */
function pathShape(THREE, cmds) {
  const shape = new THREE.Shape();
  let cur = shape;
  let started = false;
  for (const [c, ...v] of cmds) {
    if (c === 'M') {
      if (started) { cur = new THREE.Path(); shape.holes.push(cur); }
      cur.moveTo(v[0], v[1]);
      started = true;
    } else if (c === 'L') cur.lineTo(v[0], v[1]);
    else if (c === 'C') cur.bezierCurveTo(v[0], v[1], v[2], v[3], v[4], v[5]);
    else if (c === 'Z') cur.closePath();
  }
  return shape;
}

const glyphJ = (THREE) => pathShape(THREE, GLYPH_J);
const glyphR = (THREE) => pathShape(THREE, GLYPH_R);

/** The two letterforms, for anything that needs to trace their outline. */
export function logoGlyphs(THREE) {
  return [
    { shape: glyphJ(THREE), x: 0 },
    { shape: glyphR(THREE), x: WORD.gap },
  ];
}

export function buildWordmark(THREE, material, opts = {}) {
  const { height = 0.62, depth = 0.17, refine } = opts;
  const g = new THREE.Group();
  g.name = 'jr_wordmark';
  const letters = [
    ['letter_J', glyphJ(THREE), 0],
    ['letter_R', glyphR(THREE), WORD.gap],
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

// ---- the bladesmith's blow ---------------------------------------------------
// Rig space, metres. The smith stands at the heel end (-x), tongs in one hand
// holding the blade by its tang, hammer in the other, and walks blows along
// the blade from the heel toward the point; after each pass the blade is
// turned over so both bevels are drawn evenly.
const FACE_TOP = 0.21;                  // anvil face
const BLADE_T = 0.008;                  // blade thickness at the spine
const BLADE_TOP = FACE_TOP + BLADE_T;
const HANDLE = 0.34;                    // grip → centre of the head
const FACE_DROP = 0.05;                 // centre of the head → striking face
const GRIP_Y = BLADE_TOP + FACE_DROP;   // handle height when the face lands flat
const LIFT = 0.95;                      // head angle at the top of the lift, rad
const REST = 0.3;                       // held low while the blade is turned
const TOP = { dx: -0.035, dy: 0.07 };   // grip travel up the elbow's arc
const BEVEL = 0.1;                      // hammer roll that forges the bevel, rad
const BLOW = 0.9;                       // seconds per blow
const TURN = 0.8;                       // seconds to turn the blade between passes
const PASS = [-0.075, -0.025, 0.025, 0.07];     // blows along the blade, heel → point
const CYCLE = PASS.length * BLOW + TURN;
/** The cadence the scene actually runs at, for the readout strip. */
export const STRIKES_PER_MIN = (60 * PASS.length) / CYCLE;

const gripX = (k) => PASS[k] - HANDLE;

/**
 * The smith's arm at time t. The grip rides the elbow's arc, up and back;
 * the head rides the wrist. Each lift starts fast — the hammer comes off the
 * anvil on its own rebound, which is the energy a smith saves for the next
 * blow — slows to a hang at the top, then the downswing accelerates with the
 * grip leading and the wrist snapping late, so the face whips flat onto the
 * work. Every segment ends exactly where the next begins.
 *
 * @returns {{ gx: number, gy: number, angle: number, roll: number, flip: number, landed: number }}
 *          grip position, head angle about z, bevel roll, blade turn (in half
 *          turns), and the number of blows landed by time t.
 */
function smithPose(t) {
  const n = Math.floor(t / CYCLE);
  const tc = t - n * CYCLE;
  const side = n % 2 ? 1 : -1;
  let gx, gy, angle, roll = side * BEVEL, flip = n, landed;

  if (tc < PASS.length * BLOW) {
    const k = Math.floor(tc / BLOW);
    const u = (tc - k * BLOW) / BLOW;
    landed = n * PASS.length + k;
    // where this segment starts: off the last blow, or from rest after a turn
    const x0 = k === 0 ? gripX(0) : gripX(k - 1);
    const y0 = k === 0 ? GRIP_Y + 0.03 : GRIP_Y;
    const a0 = k === 0 ? REST : 0;
    const xTop = gripX(k) + TOP.dx, yTop = GRIP_Y + TOP.dy;
    if (u < 0.52) {
      const v = u / 0.52;
      const e = easeInOut(v);
      // off a blow the rebound gives a fast start; from rest it is all arm
      angle = a0 + (LIFT - a0) * (k === 0 ? e : 1 - Math.pow(1 - v, 2.2));
      gx = x0 + (xTop - x0) * e;
      gy = y0 + (yTop - y0) * e;
    } else if (u < 0.62) {
      const w = (u - 0.52) / 0.1;
      angle = LIFT + 0.06 * Math.sin(w * Math.PI * 0.5);
      gx = xTop;
      gy = yTop + 0.005 * w;
    } else {
      const w = (u - 0.62) / 0.38;
      const lead = Math.pow(w, 1.6), snap = Math.pow(w, 2.8);
      angle = (LIFT + 0.06) * (1 - snap);
      gx = xTop - TOP.dx * lead;
      gy = yTop + 0.005 - (TOP.dy + 0.005) * lead;
    }
  } else {
    // the pass is done: the hammer comes off the last blow to rest while the
    // tongs turn the blade over, then drifts back to the heel
    const u = (tc - PASS.length * BLOW) / TURN;
    landed = (n + 1) * PASS.length;
    const v = Math.min(1, u / 0.4);
    angle = REST * (1 - Math.pow(1 - v, 2));
    gx = gripX(PASS.length - 1) + (gripX(0) - gripX(PASS.length - 1)) * easeInOut(Math.min(1, u / 0.85));
    gy = GRIP_Y + 0.03 * (1 - Math.pow(1 - v, 2));
    const turn = easeInOut(clamp01((u - 0.2) / 0.55));
    flip = n + turn;
    roll = side * BEVEL * (1 - 2 * turn);
  }
  return { gx, gy, angle, roll, flip, landed };
}

/**
 * A blade in plan view — tang, heel, straight spine, belly sweeping up to the
 * point — extruded to thickness and laid flat, then thinned toward the edge
 * so the cross-section is the double bevel being forged.
 */
function bladeGeometry(THREE) {
  const s = new THREE.Shape();
  s.moveTo(-0.19, 0.005);
  s.lineTo(-0.108, 0.006);
  s.lineTo(-0.1, 0.016);
  s.lineTo(0.075, 0.016);
  s.quadraticCurveTo(0.108, 0.015, 0.128, 0.0);
  s.quadraticCurveTo(0.092, -0.021, 0.02, -0.021);
  s.lineTo(-0.1, -0.019);
  s.lineTo(-0.108, -0.006);
  s.lineTo(-0.19, -0.005);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: BLADE_T, curveSegments: 18, steps: 1, bevelEnabled: false });
  geo.rotateX(Math.PI / 2);              // plan width → z, thickness → -y
  geo.translate(0, BLADE_T / 2, 0);      // centred on its mid-plane
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const edge = clamp01((0.012 - p.getZ(i)) / 0.03);
    p.setY(i, p.getY(i) * (1 - 0.75 * edge));
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * @param {*} THREE         the three namespace
 * @param {*} makeMaterial  (name, spec) => material, from forge-materials
 * @param {{ logoUrl?: string, refine?: (geo: *) => *, flame?: () => *,
 *           wordmark?: boolean, sparks?: boolean }} [opts]
 *        `wordmark: false` keeps the extruded letters for framing but hides
 *        them, and `sparks: false` drops the CPU sprite sparks — both for when
 *        the GPU particle cast draws the logo and throws the sparks instead.
 */
export function buildForge(THREE, makeMaterial, opts = {}) {
  const withSparks = opts.sparks !== false;
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

  // ---- the work: a hot blade held by its tang in the tongs ---------------
  // Grouped so the tongs can turn blade and all over between passes.
  const work = new THREE.Group();
  work.name = 'forge_work';
  work.position.set(0, FACE_TOP + BLADE_T / 2, 0);
  const billet = new THREE.Mesh(bladeGeometry(THREE), mat.hot);
  billet.name = 'hot_blade';
  work.add(billet);
  const jaws = new THREE.Mesh(roundedBox(THREE, 0.05, 0.016, 0.02, 0.004, 4), mat.band);
  jaws.name = 'tong_jaws';
  jaws.position.set(-0.17, 0, 0);
  work.add(jaws);
  const reins = new THREE.Mesh(roundedBox(THREE, 0.2, 0.009, 0.014, 0.003, 3), mat.band);
  reins.name = 'tong_reins';
  reins.position.set(-0.29, 0.004, 0);
  reins.rotation.z = -0.06;
  work.add(reins);
  group.add(work);

  // ---- hammer: a cross-peen, gripped at the end of the handle ------------
  // Built with the grip at the origin and the handle along +x, so the pose is
  // just "put the grip here, turn the wrist this far". The head stands across
  // the handle, face down, peen up.
  const hammer = new THREE.Group();
  hammer.name = 'hammer';
  const haftGeo = tube(THREE,
    [[-0.035, 0, 0], [0.09, 0.003, 0], [0.22, 0.003, 0], [HANDLE - 0.004, 0, 0]],
    (t) => 0.0155 - t * 0.0045, { radial: 20 });
  const haft = new THREE.Mesh(haftGeo, mat.haft);
  haft.name = 'hammer_haft';
  hammer.add(haft);
  const headMesh = new THREE.Mesh(roundedBox(THREE, 0.044, FACE_DROP * 2, 0.044, 0.006, 6), mat.head);
  headMesh.name = 'hammer_head';
  headMesh.position.set(HANDLE, 0, 0);
  hammer.add(headMesh);
  const peenGeo = new THREE.ConeGeometry(0.031, 0.045, 4);
  peenGeo.rotateY(Math.PI / 4);          // square base to the head's faces
  const peen = new THREE.Mesh(peenGeo, mat.head);
  peen.name = 'hammer_peen';
  peen.scale.x = 0.4;                    // pinched to a wedge across the handle
  peen.position.set(HANDLE, FACE_DROP + 0.02, 0);
  hammer.add(peen);
  group.add(hammer);

  // Room above the anvil for the lift, so framing leaves the swing in shot.
  const headroom = new THREE.Object3D();
  headroom.position.set(gripX(0), FACE_TOP + 0.26, 0);
  group.add(headroom);

  // ---- JR wordmark across the floor, behind the anvil --------------------
  const word = buildWordmark(THREE, mat.word, {
    height: WORD.height, depth: WORD.depth, refine: opts.wordmark === false ? undefined : opts.refine,
  });
  word.position.set(WORD.x, WORD.y, WORD.z);
  // Hidden rather than omitted: coreBounds frames on it either way.
  word.visible = opts.wordmark !== false;
  group.add(word);

  // ---- sparks + flame (sprites: WebGPU caps THREE.Points at one pixel) ---
  // The impact moves blow to blow along the blade; the flame stays put.
  const impact = new THREE.Vector3(PASS[0], BLADE_TOP + 0.002, 0);
  const flameAt = new THREE.Vector3(-0.005, BLADE_TOP + 0.002, 0);
  const sparkTex = sparkTexture(THREE, 'rgba(255,245,215,1)', 'rgba(255,140,20,.9)');

  const sparks = [];
  for (let i = 0; withSparks && i < 64; i++) {
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
    volume.position.set(flameAt.x, flameAt.y + volume.userData.height / 2 - 0.022, flameAt.z);
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

  let landed = -1;
  let squash = 0;
  const api = {
    group, rig, impact, word, heat: 0.6,
    /** Blows per minute, as the scene runs them. */
    strikesPerMin: STRIKES_PER_MIN,
    /** Blows landed so far; the particle sparks key their bursts on it. */
    strikes: 0,
    /** Centre of the wordmark in group space — where the logo lattice sits. */
    wordAnchor: new THREE.Vector3(WORD.x, WORD.y + WORD.height / 2, WORD.z),
    /** The last blow's impact in group space, for systems parented to the group. */
    impactGroup: rig.position.clone().add(impact),
    /** Where the flame stands, in group space; the embers rise from here. */
    flameGroup: rig.position.clone().add(flameAt),
    /** Fired on every hammer blow. @type {null | ((impact: *) => void)} */
    onStrike: /** @type {null | ((impact: *) => void)} */ (null),
    impactWorld: () => rig.localToWorld(impact.clone()),
    // framing bounds: the top of the lift is allowed to overflow, but the
    // headroom marker keeps the downswing in shot.
    // The refresh is load-bearing: the recentre above happens after the
    // updateMatrixWorld before it, and expandByObject trusts its parent's
    // matrixWorld rather than recomputing it. Without this the box comes back
    // in pre-recentre space and the camera aims at empty air beside the rig.
    coreBounds: () => {
      group.updateMatrixWorld(true);
      const b = new THREE.Box3();
      [word, stump, body, faceTop, horn, billet, band].forEach((o) => b.expandByObject(o));
      b.expandByPoint(headroom.getWorldPosition(new THREE.Vector3()));
      return b;
    },
    tick(t, dt) {
      const pose = smithPose(t);
      hammer.position.set(pose.gx, pose.gy, 0);
      hammer.rotation.set(pose.roll, 0, pose.angle);
      work.rotation.x = pose.flip * Math.PI;

      // Blows are counted from the clock, not from a phase crossing, so a
      // dropped frame can't swallow one. The first frame only syncs the count.
      const struck = landed >= 0 && pose.landed > landed;
      if (struck) impact.x = PASS[(pose.landed - 1) % PASS.length];
      landed = pose.landed;

      // the blade takes the blow: a thud through its thickness, then back
      squash *= Math.exp(-dt * 13);
      billet.scale.y = 1 - squash * 0.25;

      if (struck) {
        api.strikes++;
        api.impactGroup.copy(rig.position).add(impact);
        glow.position.copy(impact);
        squash = 1;
        sparks.forEach((s) => {
          const th = Math.random() * Math.PI * 2;
          const sp = 0.5 + Math.random() * 1.6;
          s.userData.v.set(Math.cos(th) * sp * 0.6, 0.4 + Math.random() * 1.2, Math.sin(th) * sp * 0.32);
          s.userData.life = 0.42 + Math.random() * 0.45;
          s.position.copy(impact);
          s.visible = true;
        });
        glow.intensity = 3.2;
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
        volume.position.y = flameAt.y + (volume.userData.height * f) / 2 - 0.022;
      }
    },
  };
  return api;
}

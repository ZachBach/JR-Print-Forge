// Planetary gearbox — parametric, dependency-free geometry.
// Follows the tsl-lib convention: the module imports nothing and takes the
// namespace as its first argument, so the same source builds against
// three.webgpu.js (hero) and three.module.js (viewer stage).
//
// Sizing is real-world metres. Module m = 0.02 (2 mm), y-up, base at y=0.
// Nr = Ns + 2*Np  ->  54 = 18 + 2*18, so the train closes exactly.

const TAU = Math.PI * 2;

function toothPoints(N, m, opts = {}) {
  const { tip = 1.0, root = 1.25, invert = false } = opts;
  const r = (m * N) / 2;
  const ra = invert ? r - m * tip : r + m * tip;
  const rf = invert ? r + m * root : r - m * root;
  const step = TAU / N;
  const wr = step * 0.31, wt = step * 0.17;
  const pts = [];
  for (let i = 0; i < N; i++) {
    const a = i * step;
    pts.push([rf, a - wr], [ra, a - wt], [ra, a + wt], [rf, a + wr]);
  }
  return pts.map(([rad, ang]) => [Math.cos(ang) * rad, Math.sin(ang) * rad]);
}

function shapeFrom(THREE, pts) {
  const s = new THREE.Shape();
  pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  return s;
}

function circlePath(THREE, r, segments = 48) {
  const p = new THREE.Path();
  p.absarc(0, 0, r, 0, TAU, false);
  return p;
}

function extrude(THREE, shape, depth, bevel = 0.0012) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel,
    bevelSegments: 2, curveSegments: 48,
  });
  g.translate(0, 0, -depth / 2);
  g.rotateX(-Math.PI / 2); // extrusion axis Z -> gear axis Y
  g.computeVertexNormals();
  return g;
}

/**
 * buildGearbox(THREE, makeMaterial) -> { group, parts, tick(t) }
 * makeMaterial(name, spec) must return a material; spec carries
 * { color, metalness, roughness, emissive } so a caller can swap in
 * node materials without this file knowing anything about them.
 */
export function buildGearbox(THREE, makeMaterial) {
  const m = 0.02, Ns = 18, Np = 18, Nr = 54;
  const rSun = (m * Ns) / 2, rPl = (m * Np) / 2, rRing = (m * Nr) / 2;
  const W = 0.13;            // gear face width
  const carrierOffset = W / 2 + 0.018;

  const mat = {
    nylon:  makeMaterial('nylonPA12',  { color: 0x1d2023, metalness: 0.08, roughness: 0.62 }),
    petg:   makeMaterial('bluePETG',   { color: 0x0b6f92, metalness: 0.22, roughness: 0.34 }),
    forge:  makeMaterial('forgeOrange',{ color: 0xff6b00, metalness: 0.18, roughness: 0.38 }),
    steel:  makeMaterial('steelShaft', { color: 0x9aa3a8, metalness: 0.92, roughness: 0.22 }),
    graph:  makeMaterial('graphite',   { color: 0x17191b, metalness: 0.12, roughness: 0.78 }),
  };

  const group = new THREE.Group();
  group.name = 'planetary_gearbox';

  // ---- ring gear: outer housing ring with internal teeth -----------------
  const housingR = rRing + m * 2.4;
  const ringShape = shapeFrom(THREE, [
    ...Array.from({ length: 96 }, (_, i) => {
      const a = (i / 96) * TAU;
      return [Math.cos(a) * housingR, Math.sin(a) * housingR];
    }),
  ]);
  const innerTeeth = toothPoints(Nr, m, { invert: true });
  const hole = new THREE.Path();
  innerTeeth.forEach(([x, y], i) => (i ? hole.lineTo(x, y) : hole.moveTo(x, y)));
  hole.closePath();
  ringShape.holes.push(hole);
  const ringGear = new THREE.Mesh(extrude(THREE, ringShape, W), mat.nylon);
  ringGear.name = 'ring_gear';
  group.add(ringGear);

  // housing flange + bolt bosses
  const flange = new THREE.Mesh(
    new THREE.CylinderGeometry(housingR + 0.011, housingR + 0.011, W + 0.014, 96, 1, true),
    mat.graph
  );
  flange.name = 'housing_shell';
  group.add(flange);

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + Math.PI / 6;
    const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, W + 0.004, 24), mat.graph);
    boss.name = `bolt_boss_${i + 1}`;
    boss.position.set(Math.cos(a) * (housingR + 0.006), 0, Math.sin(a) * (housingR + 0.006));
    group.add(boss);
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, W + 0.006, 16), mat.steel);
    bolt.name = `bolt_${i + 1}`;
    bolt.position.copy(boss.position);
    group.add(bolt);
  }

  // ---- sun gear ----------------------------------------------------------
  const sunShape = shapeFrom(THREE, toothPoints(Ns, m));
  sunShape.holes.push(circlePath(THREE, 0.014));
  const sun = new THREE.Mesh(extrude(THREE, sunShape, W), mat.forge);
  sun.name = 'sun_gear';
  group.add(sun);

  const inputShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0135, 0.0135, 0.20, 32), mat.steel);
  inputShaft.name = 'input_shaft';
  inputShaft.position.y = -0.045;
  group.add(inputShaft);

  // ---- planets + carrier -------------------------------------------------
  const planets = [];
  const planetShape = shapeFrom(THREE, toothPoints(Np, m));
  planetShape.holes.push(circlePath(THREE, 0.011));
  const planetGeo = extrude(THREE, planetShape, W);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU;
    const p = new THREE.Mesh(planetGeo, mat.petg);
    p.name = `planet_gear_${i + 1}`;
    p.position.set(Math.cos(a) * (rSun + rPl), 0, Math.sin(a) * (rSun + rPl));
    p.userData.baseAngle = a;
    group.add(p);
    planets.push(p);

    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.0105, 0.0105, W + 0.05, 24), mat.steel);
    pin.name = `planet_pin_${i + 1}`;
    pin.position.copy(p.position);
    group.add(pin);
  }

  const carrier = new THREE.Group();
  carrier.name = 'carrier_assembly';
  const pinR = rSun + rPl;

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.02, 48), mat.forge);
  hub.name = 'carrier_hub';
  hub.position.y = carrierOffset;
  carrier.add(hub);

  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(pinR - 0.022, 0.019, 0.04), mat.forge);
    arm.name = `carrier_arm_${i + 1}`;
    arm.position.set(Math.cos(a) * (pinR + 0.026) / 2, carrierOffset, Math.sin(a) * (pinR + 0.026) / 2);
    arm.rotation.y = -a;
    carrier.add(arm);
    const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.02, 28), mat.forge);
    boss.name = `carrier_boss_${i + 1}`;
    boss.position.set(Math.cos(a) * pinR, carrierOffset, Math.sin(a) * pinR);
    carrier.add(boss);
  }

  const outputShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0235, 0.0235, 0.15, 32), mat.steel);
  outputShaft.name = 'output_shaft';
  outputShaft.position.y = carrierOffset + 0.082;
  carrier.add(outputShaft);

  const key = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.055, 0.006), mat.steel);
  key.name = 'output_key';
  key.position.set(0.0245, carrierOffset + 0.1, 0);
  carrier.add(key);
  group.add(carrier);

  // 1 unit of construction = 0.1 m, so module 2 mm and a 66 mm housing.
  group.scale.setScalar(0.1);
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  group.position.y -= box.min.y;

  const ratio = 1 + Nr / Ns; // 4:1 reduction, carrier output
  function tick(t) {
    sun.rotation.y = t;
    inputShaft.rotation.y = t;
    const carrierRot = t / ratio;
    carrier.rotation.y = carrierRot;
    planets.forEach((p, i) => {
      const a = p.userData.baseAngle + carrierRot;
      p.position.set(Math.cos(a) * (rSun + rPl), p.position.y, Math.sin(a) * (rSun + rPl));
      p.rotation.y = -(t - carrierRot) * (Ns / Np);
      const pin = group.getObjectByName(`planet_pin_${i + 1}`);
      if (pin) pin.position.set(p.position.x, pin.position.y, p.position.z);
    });
  }

  return {
    group, tick, materials: mat,
    spec: { module: m * 0.1, teeth: { sun: Ns, planet: Np, ring: Nr }, ratio, faceWidth: W * 0.1,
            outerDiameter: (housingR + 0.011) * 2 * 0.1 },
  };
}

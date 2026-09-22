/**
 * flame-volume — single-pass volumetric fire.
 *
 * The three.js reference (mrdoob/three.js#33848) runs a voxel fluid sim in
 * compute and renders it with VolumeNodeMaterial. That needs nodes r184 does
 * not ship, so this takes the same physical approach in one fragment pass:
 * march the view ray through a box, sample a rising, swirling noise field for
 * density and temperature, integrate emission front-to-back with
 * Beer–Lambert absorption, and colour it through tsl-lib's fire ramp.
 *
 * Nodes never own uniforms: heat comes in from the caller.
 */
import { fbm } from './tsl-lib/src/noise/fbm.js';
import { fireRamp } from './tsl-lib/src/ramp/fireRamp.js';

/**
 * @param {*} THREE  the three namespace
 * @param {*} TSL    the THREE.TSL namespace
 * @param {{ heat?: *, steps?: number, size?: number[] }} [opts]
 *        `heat` is the caller's uniform — nodes never own one.
 */
export function volumetricFire(THREE, TSL, { heat, steps = 26, size = [0.3, 0.42, 0.3] } = {}) {
  const {
    Fn, Loop, vec3, vec4, float, positionLocal, cameraPosition, modelWorldMatrixInverse,
    time, length, smoothstep, clamp, mix, pow, exp, max, min, sin, cos,
  } = TSL;

  const hx = size[0] / 2, hy = size[1] / 2, hz = size[2] / 2;
  const half = vec3(hx, hy, hz);

  const field = Fn(() => {
    const camLocal = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1)).xyz;
    const rd = positionLocal.sub(camLocal).normalize();
    const invD = vec3(1, 1, 1).div(rd);
    const tA = half.negate().sub(camLocal).mul(invD);
    const tB = half.sub(camLocal).mul(invD);
    const tmin = min(tA, tB);
    const tmax = max(tA, tB);
    const tEnter = max(max(tmin.x, tmin.y), tmin.z).max(0);
    const tExit = min(min(tmax.x, tmax.y), tmax.z);
    const dt = tExit.sub(tEnter).div(float(steps)).max(0);

    const acc = vec3(0, 0, 0).toVar();
    const trans = float(1).toVar();
    const t = tEnter.toVar();

    Loop(steps, () => {
      const p = camLocal.add(rd.mul(t));
      // shear the sample space with height — a cheap stand-in for curl
      const ang = p.y.mul(7.0).add(time.mul(1.1));
      const cs = cos(ang), sn = sin(ang);
      const pr = vec3(p.x.mul(cs).sub(p.z.mul(sn)), p.y, p.x.mul(sn).add(p.z.mul(cs)));

      const up = p.y.add(hy).div(hy * 2);
      const radial = length(vec3(p.x, 0, p.z));
      const width = mix(float(hx * 1.0), float(hx * 0.16), pow(clamp(up, 0, 1), 0.65));
      const env = smoothstep(width, 0, radial)
        .mul(smoothstep(1.0, 0.28, up))
        .mul(smoothstep(0.0, 0.05, up));

      const n = fbm(TSL, pr.mul(15).add(vec3(0, time.mul(-2.6), 0)), { octaves: 3 })
        .mul(0.5).add(0.5);
      const d = clamp(env.mul(n.mul(1.9)).sub(0.08), 0, 1);
      const temp = d.mul(heat.mul(0.55).add(0.7));

      acc.addAssign(fireRamp(TSL, temp.mul(3.1), { gain: 1.5 }).mul(d).mul(dt).mul(trans).mul(20));
      trans.mulAssign(exp(d.mul(dt).mul(-16)));
      t.addAssign(dt);
    });

    return vec4(acc, float(1).sub(trans).clamp(0, 1));
  })();

  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true, depthWrite: false, side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
  });
  mat.name = 'volumetricFire';
  mat.colorNode = field.xyz;
  mat.opacityNode = field.w;

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), mat);
  mesh.name = 'flame_volume';
  mesh.renderOrder = 10;
  mesh.userData.height = size[1];
  return mesh;
}

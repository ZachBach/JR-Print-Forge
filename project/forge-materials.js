/**
 * forge-materials — TSL node materials for the hero, composed from tsl-lib
 * nodes (fbm, warp, stripes, ramp, fresnel, horizonBand, fireRamp, dissolve).
 * Nodes never own uniforms and never bake time, so the clock and the strike
 * uniforms are created here and handed in.
 *
 * makeForgeMaterials(THREE, TSL) -> { material(name, spec), uniforms }
 */
import { palette } from './jr-palette.js';
import { fbm } from './tsl-lib/src/noise/fbm.js';
import { warp } from './tsl-lib/src/noise/warp.js';
import { stripes } from './tsl-lib/src/pattern/stripes.js';
import { ramp } from './tsl-lib/src/ramp/ramp.js';
import { remap } from './tsl-lib/src/ramp/remap.js';
import { fireRamp } from './tsl-lib/src/ramp/fireRamp.js';
import { dissolve } from './tsl-lib/src/pattern/dissolve.js';
import { fresnel } from './tsl-lib/src/fresnel/fresnel.js';
import { horizonBand } from './tsl-lib/src/fresnel/horizonBand.js';

export function makeForgeMaterials(THREE, TSL) {
  const { forge, metal } = palette(TSL);
  const clock = TSL.time;
  const uStrike = TSL.uniform(1);     // 0 at impact -> 1 fully decayed
  const uHeat = TSL.uniform(0.6);     // billet heat, 0..1
  const uHover = TSL.uniform(0);
  const uShock = TSL.uniform(new THREE.Vector3(0, 0, 0)); // impact, world space

  const Std = THREE.MeshStandardNodeMaterial;

  // shared: expanding shock ring in world space, fired on every hammer blow
  const shock = () => {
    const d = TSL.length(TSL.positionWorld.sub(uShock));
    return TSL.smoothstep(0.05, 0.0, TSL.abs(d.sub(uStrike.mul(1.1))))
      .mul(TSL.oneMinus(uStrike).max(0));
  };

  const build = {
    // volumetric-looking fire on a camera-facing quad: domain-warped fbm
    // rising through a narrowing flame envelope, coloured by the fire ramp
    flame(mat, seed = 0) {
      const p = TSL.uv();
      const x = p.x.sub(0.5), y = p.y;
      const q = TSL.vec3(x.mul(2.7), y.mul(1.45).sub(clock.mul(0.8 + seed * 0.14)), TSL.float(seed * 4.3));
      const n = fbm(TSL, warp(TSL, q, { amp: 0.5, octaves: 3 }), { octaves: 4 }).mul(0.5).add(0.5);
      const width = TSL.mix(TSL.float(0.42), TSL.float(0.06), TSL.pow(y, 0.75));
      const body = TSL.oneMinus(TSL.abs(x).div(width)).sub(y.mul(0.2));
      const dens = TSL.clamp(body.mul(1.5).add(n.sub(0.5).mul(1.35)), 0, 1);
      const shape = TSL.smoothstep(0.06, 0.6, dens)
        .mul(TSL.smoothstep(1.0, 0.45, y))
        .mul(TSL.smoothstep(0.0, 0.07, y));
      const heat = uHeat.mul(0.5).add(0.65);
      mat.colorNode = fireRamp(TSL, shape.mul(4.6).mul(heat), { gain: 2.1 });
      mat.opacityNode = shape.mul(0.9);
      return mat;
    },
    // pattern-welded hammer face — warped domain through folded stripes
    damascus(mat) {
      const billet = warp(TSL, TSL.positionLocal.mul(5), { amp: 0.45, octaves: 3 });
      const layers = stripes(TSL, billet.y, { freq: 6, duty: 0.5, soft: 0.3 });
      const etch = ramp(TSL, layers, [
        [0.0, metal.charcoal], [0.5, metal.steel], [1.0, metal.bright],
      ]);
      mat.colorNode = etch.mul(0.8);
      mat.emissiveNode = TSL.color(0x00BFFF).mul(fresnel(TSL, { power: 4 }).mul(0.22));
      mat.roughnessNode = TSL.float(0.42).sub(layers.mul(0.18));
    },
    // anvil: anisotropic grooves under a sheared horizon band
    brushed(mat, { polish = 0 } = {}) {
      const grooves = fbm(TSL, TSL.positionLocal.mul(TSL.vec3(70, 4.5, 3.2)), { octaves: 3 });
      const band = horizonBand(TSL, {
        freq: 4.2, shear: grooves, shearAmount: 0.9, sharpness: 4 - polish, clock, speed: 0.18,
      });
      mat.colorNode = TSL.mix(metal.graphite, metal.steel, grooves.mul(0.06).add(0.56 + polish * 0.28))
        .add(metal.bright.mul(band.mul(0.28 + polish * 0.45)));
      mat.roughnessNode = TSL.float(0.55 - polish * 0.3).add(grooves.mul(0.08));
      mat.emissiveNode = forge.blue.mul(fresnel(TSL, { power: 3 }).mul(0.22))
        .add(forge.ember.mul(TSL.float(0.06).mul(uHeat)).mul(
          TSL.smoothstep(0.30, 0.19, TSL.positionWorld.y)));
    },
    // hot steel: domain-warped fbm through the fire ramp, crust cooling over
    magma(mat) {
      const p = TSL.positionLocal.mul(6).add(TSL.vec3(0, clock.mul(-0.5), 0));
      const n = fbm(TSL, warp(TSL, p, { amp: 0.7 }), { octaves: 4 }).mul(0.5).add(0.5);
      const melt = fireRamp(TSL, remap(TSL, n, 0, 1, 0.8, 3.6));
      const crust = TSL.smoothstep(0.52, 0.78, n).mul(TSL.oneMinus(uHeat));
      const { edge } = dissolve(TSL, n, 0.5, { edgeWidth: 0.18 });
      mat.colorNode = TSL.mix(melt, metal.graphite, crust);
      mat.emissiveNode = TSL.mix(melt.mul(1.5), forge.ember.mul(0.25), crust)
        .add(forge.hot.mul(edge.mul(0.9)))
        .mul(uHeat.mul(0.5).add(0.25));
      mat.roughnessNode = TSL.float(0.62).sub(uHeat.mul(0.2));
    },
    // the JR wordmark: damascus etch, heat rising from the forge floor,
    // and a vertex-stage displacement that the tessellated mesh can resolve
    wordmark(mat) {
      const heat = TSL.smoothstep(0.34, -0.12, TSL.positionLocal.y);
      const grain = warp(TSL, TSL.positionLocal.mul(1.6), { amp: 0.32, octaves: 3 });
      const layers = stripes(TSL, grain.y, { freq: 2.6, duty: 0.5, soft: 0.42 });
      const etch = ramp(TSL, layers, [
        [0.0, metal.charcoal], [0.5, metal.steel], [1.0, metal.bright],
      ]);
      const n = fbm(TSL, TSL.positionLocal.mul(5).add(TSL.vec3(0, clock.mul(-0.7), 0)), { octaves: 3 })
        .mul(0.5).add(0.5);
      const glow = fireRamp(TSL, remap(TSL, n.mul(heat), 0, 1, 0.2, 4.0));
      const fres = fresnel(TSL, { power: 3 });

      mat.colorNode = etch.mul(0.88);
      mat.emissiveNode = glow.mul(heat.mul(0.62))
        .add(forge.blue.mul(fres.mul(0.75)))
        .add(forge.hot.mul(shock().mul(1.5)))
        .add(forge.blue.mul(uHover.mul(fres).mul(0.35)));
      mat.roughnessNode = TSL.float(0.46).sub(layers.mul(0.2));
      mat.metalnessNode = TSL.float(0.34);

      // vertex stage: molten breathing along the bottom edge + strike ripple
      const swell = fbm(TSL, TSL.positionLocal.mul(7).add(TSL.vec3(0, clock.mul(0.5), 0)), { octaves: 3 });
      const ripple = TSL.sin(TSL.positionLocal.y.mul(28).sub(TSL.oneMinus(uStrike).mul(9)))
        .mul(TSL.oneMinus(uStrike).max(0));
      mat.positionNode = TSL.positionLocal.add(
        TSL.normalLocal.mul(swell.mul(0.004).add(ripple.mul(0.0035)).mul(heat.add(0.25)))
      );
    },
  };

  function material(name, spec = {}) {
    if (name.startsWith('flame')) {
      const f = new THREE.SpriteNodeMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      f.name = name;
      return build.flame(f, Number(name.slice(5)) || 0);
    }
    const mat = new Std({
      color: spec.color ?? 0x808080,
      metalness: spec.metalness ?? 0.3,
      roughness: spec.roughness ?? 0.5,
    });
    mat.name = name;
    if (name === 'hammerHead' || name === 'hammerPeen') build.damascus(mat);
    else if (name === 'anvilFace') build.brushed(mat, { polish: 1 });
    else if (name === 'anvilSteel' || name === 'anvilHorn' || name === 'steelBand') build.brushed(mat);
    else if (name === 'hotBillet') build.magma(mat);
    else if (name === 'wordmark') build.wordmark(mat);
    else if (name === 'oakStump') {
      const rings = fbm(TSL, TSL.positionLocal.mul(TSL.vec3(30, 2, 30)), { octaves: 3 }).mul(0.5).add(0.5);
      mat.colorNode = TSL.mix(metal.oak, TSL.color(0x3C3228), rings);
      mat.roughnessNode = TSL.float(0.9);
      mat.emissiveNode = forge.ember.mul(0.05).mul(uHeat)
        .mul(TSL.smoothstep(-0.2, 0.15, TSL.positionWorld.y));
    }
    return mat;
  }

  return { material, uniforms: { uStrike, uHeat, uHover, uShock }, clock };
}

/**
 * Height field → a CAD model: a stack of extruded bodies.
 *
 * The pipeline's height field is a stepped solid — a plate at one height with a
 * design raised to another, a cutter with a wall and a lip. That is exactly how
 * the part would be modelled in CAD: a pad for the plate, a second pad on top of
 * it for the design. So the levels are recovered from the field and each becomes
 * one body, extruded from the level below it to its own height. The union of the
 * bodies is the same solid the mesher makes, but described as flat faces and
 * straight edges instead of half a million cells.
 *
 * Bodies matter beyond tidiness: keeping the plate and the raised design apart is
 * what lets the slicer assign them different filaments, which is how a two-colour
 * keychain gets printed in one go.
 *
 * A photo relief has a different thickness at almost every pixel — there is no
 * set of flat faces to recover, and pretending otherwise would produce a
 * thousand-body file no CAD tool could open. That case is refused with a reason,
 * and the mesh path stays the right answer for it.
 */
import type { HeightField, Mesh } from '../relief/mesh.ts';
import type { ProductKind } from '../relief/products.ts';
import { contourProfiles } from './contour.ts';
import { simplifyProfile } from './simplify.ts';
import { extrudeProfile, mergeMeshes } from './solid.ts';
import { pointCount, type Profile } from './polygon.ts';

export interface CadOptions {
  /** Outline simplification tolerance, mm. No point moves further than this. */
  tolerance?: number;
  /**
   * Corner rounding applied to the traced outline, mm. Left at 0 the outline
   * follows the mask faithfully; a fraction of a millimetre takes the pixel
   * jitter out of a hand drawing at the cost of its sharpest corners.
   */
  smooth?: number;
  /** Chamfers up to this long are treated as grid artefacts and squared up, mm. */
  sharpen?: number;
  /** Refuse above this many distinct heights — past it the part is not CAD-shaped. */
  maxLevels?: number;
  /**
   * Names for the bodies, bottom up. Given as a function because how many bodies
   * there are only becomes known once the levels have been recovered.
   */
  names?: string[] | ((count: number) => string[]);
}

export interface CadBody {
  name: string;
  /** Bottom and top of this pad, mm. */
  z0: number;
  z1: number;
  profiles: Profile[];
  mesh: Mesh;
}

export interface CadModel {
  bodies: CadBody[];
  /** All bodies as one mesh, for the preview and single-solid export. */
  mesh: Mesh;
  /** The tolerance actually used, mm. */
  tolerance: number;
  /** Distinct flat heights found, ascending, mm. */
  levels: number[];
  /** Straight segments in the whole model — the CAD-side size of the part. */
  segments: number;
}

export type CadResult = { ok: true; model: CadModel } | { ok: false; reason: string };

/** Heights within a micron are the same height; below that is noise. */
const QUANTUM = 1e-3;

/**
 * What to call the bodies, bottom up. A shop opening the file should see the part
 * described the way it would be modelled — a plate with a design on it, a cutter
 * with a lip — rather than "Body 1" and "Body 2".
 */
export function bodyNames(kind: ProductKind, count: number): string[] {
  const known: Record<ProductKind, string[]> = {
    relief: ['Plate', 'Design'],
    cutter: ['Grip lip', 'Cutting wall'],
    lithophane: ['Panel'],
  };
  const names = known[kind] ?? [];
  // Only use the names when the level count is the one they describe; a part
  // with an unexpected number of steps gets neutral labels instead of wrong ones.
  return names.length === count ? names : Array.from({ length: count }, (_, i) => `Level ${i + 1}`);
}

function levelsOf(field: HeightField, maxLevels: number): number[] | null {
  const seen = new Set<number>();
  for (let k = 0; k < field.mask.length; k++) {
    if (!field.mask[k]) continue;
    const z = Math.round(field.height[k] / QUANTUM) * QUANTUM;
    if (z <= 0) continue;
    seen.add(z);
    if (seen.size > maxLevels) return null;
  }
  return [...seen].sort((a, b) => a - b);
}

export function toCad(field: HeightField, opts: CadOptions = {}): CadResult {
  const { cols, rows, cell } = field;
  const maxLevels = opts.maxLevels ?? 8;
  const tolerance = opts.tolerance ?? Math.max(0.06, cell * 0.5);
  const smooth = opts.smooth ?? 0;
  // The grid's own chamfer is half a cell on each leg; anything longer than
  // that with a margin is a real bevel in the drawing and is left alone.
  const sharpen = opts.sharpen ?? cell * 1.2 + smooth * 2;

  const levels = levelsOf(field, maxLevels);
  if (!levels) {
    return {
      ok: false,
      reason:
        'This shape has a different thickness almost everywhere — a photo relief or lithophane. ' +
        'There are no flat faces to turn into CAD geometry, so download the 3MF or STL mesh instead.',
    };
  }
  if (levels.length === 0) return { ok: false, reason: 'Nothing to build yet.' };

  const names = typeof opts.names === 'function' ? opts.names(levels.length) : opts.names;
  const bodies: CadBody[] = [];
  let segments = 0;
  const region = new Uint8Array(cols * rows);
  for (let k = 0; k < levels.length; k++) {
    const z1 = levels[k];
    const z0 = k === 0 ? 0 : levels[k - 1];
    for (let i = 0; i < region.length; i++) {
      region[i] = field.mask[i] && field.height[i] >= z1 - QUANTUM / 2 ? 1 : 0;
    }
    const profiles: Profile[] = [];
    for (const raw of contourProfiles(region, cols, rows, cell, { smooth })) {
      const s = simplifyProfile(raw, tolerance, sharpen);
      if (s) profiles.push(s);
    }
    if (!profiles.length) continue;

    const meshes: Mesh[] = [];
    for (const p of profiles) {
      const m = extrudeProfile(p, z0, z1);
      if (!m) {
        return {
          ok: false,
          reason:
            'The outline crosses itself in a way the solid builder cannot resolve. ' +
            'Simplifying the drawing — or raising Line boost so strokes merge — usually fixes it; ' +
            'the 3MF and STL mesh downloads still work.',
        };
      }
      meshes.push(m);
      segments += pointCount(p.outer);
      for (const h of p.holes) segments += pointCount(h);
    }
    bodies.push({
      name: names?.[k] ?? `Body ${k + 1} (${z0.toFixed(1)}–${z1.toFixed(1)} mm)`,
      z0,
      z1,
      profiles,
      mesh: mergeMeshes(meshes),
    });
  }

  if (!bodies.length) return { ok: false, reason: 'Nothing to build yet.' };
  return {
    ok: true,
    model: { bodies, mesh: mergeMeshes(bodies.map((b) => b.mesh)), tolerance, levels, segments },
  };
}

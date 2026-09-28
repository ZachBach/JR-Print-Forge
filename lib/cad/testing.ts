/**
 * Test-only STEP reader.
 *
 * A STEP file cannot be checked by eye and the failures that matter — a dangling
 * reference, an open shell, a face wound inwards — are exactly the ones that make
 * a CAD tool refuse the import or bring it in as a surface instead of a solid. So
 * the writer's output is parsed back here and held to the conditions the format
 * actually requires, which is as close to "it opens in Fusion" as a test can get
 * without Fusion.
 */
import assert from 'node:assert/strict';

export interface StepRecord {
  id: number;
  /** Entity name, or '' for a complex (multi-supertype) instance. */
  name: string;
  /** Everything inside the outermost parentheses. */
  args: string;
}

/** Split on a delimiter at paren depth 0, ignoring anything inside a string. */
function topLevelSplit(s: string, delim: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === "'") quoted = s[i + 1] === "'" ? (i++, true) : false;
      continue;
    }
    if (c === "'") quoted = true;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === delim && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

export function parseStep(text: string): Map<number, StepRecord> {
  const from = text.indexOf('DATA;');
  const to = text.lastIndexOf('ENDSEC;');
  assert.ok(from >= 0 && to > from, 'no DATA section');
  const body = text.slice(from + 5, to);
  const recs = new Map<number, StepRecord>();
  for (const raw of topLevelSplit(body, ';')) {
    const s = raw.trim();
    if (!s) continue;
    const eq = s.indexOf('=');
    assert.ok(s.startsWith('#') && eq > 0, `not an instance: ${s.slice(0, 60)}`);
    const id = Number(s.slice(1, eq));
    const rest = s.slice(eq + 1).trim();
    const open = rest.indexOf('(');
    assert.ok(open >= 0 && rest.endsWith(')'), `malformed instance #${id}`);
    recs.set(id, { id, name: rest.slice(0, open).trim(), args: rest.slice(open + 1, -1) });
  }
  return recs;
}

export const stepRefs = (args: string): number[] =>
  [...args.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));

export const stepArgs = (args: string): string[] => topLevelSplit(args, ',').map((s) => s.trim());

/** Every record of a given entity name. */
export const stepAll = (recs: Map<number, StepRecord>, name: string): StepRecord[] =>
  [...recs.values()].filter((r) => r.name === name);

function tuple(args: string): number[] {
  const m = args.match(/\(([^()]*)\)/);
  assert.ok(m, `no tuple in ${args}`);
  return m![1].split(',').map((v) => {
    const t = v.trim();
    // A coordinate has to be a REAL. `1` is an INTEGER and the wrong type here;
    // some importers reject the file and others silently read zero.
    assert.match(t, /^[-+]?[0-9]*\.[0-9]*(E[-+]?[0-9]+)?$/i, `coordinate is not a STEP real: ${t}`);
    return Number(t);
  });
}

/**
 * Check the whole B-rep: references resolve, each shell is closed with every edge
 * used twice in opposite directions, each loop is a connected closed circuit, and
 * each face's outer loop winds counter-clockwise about its own plane normal (so
 * the normal points out of the solid).
 */
export function assertStepSolid(text: string): { solids: string[]; faces: number; edges: number } {
  const recs = parseStep(text);
  for (const r of recs.values()) {
    for (const ref of stepRefs(r.args)) {
      assert.ok(recs.has(ref), `#${r.id} (${r.name || 'complex'}) references missing #${ref}`);
    }
  }

  const point = (id: number): number[] => {
    const r = recs.get(id)!;
    if (r.name === 'VERTEX_POINT') return point(stepRefs(r.args)[0]);
    assert.equal(r.name, 'CARTESIAN_POINT', `#${id} is ${r.name}, wanted a point`);
    return tuple(r.args);
  };
  const dir = (id: number): number[] => {
    const r = recs.get(id)!;
    assert.equal(r.name, 'DIRECTION', `#${id} is ${r.name}, wanted a direction`);
    return tuple(r.args);
  };

  const reps = stepAll(recs, 'ADVANCED_BREP_SHAPE_REPRESENTATION');
  assert.equal(reps.length, 1, 'expected exactly one shape representation');
  const breps = stepAll(recs, 'MANIFOLD_SOLID_BREP');
  assert.ok(breps.length > 0, 'no solid in the file');
  const listed = new Set(stepRefs(reps[0].args));
  for (const b of breps) assert.ok(listed.has(b.id), `solid #${b.id} is not in the shape representation`);

  let faceCount = 0;
  let edgeCount = 0;
  for (const brep of breps) {
    const shellId = stepRefs(brep.args).find((id) => recs.get(id)!.name === 'CLOSED_SHELL');
    assert.ok(shellId, `solid #${brep.id} has no CLOSED_SHELL`);
    const shell = recs.get(shellId!)!;
    const faces = stepRefs(shell.args);
    assert.ok(faces.length >= 4, `shell #${shellId} has only ${faces.length} faces`);

    /** edge id → the orientation flags it was used with in this shell */
    const uses = new Map<number, boolean[]>();

    for (const faceId of faces) {
      const face = recs.get(faceId)!;
      assert.equal(face.name, 'ADVANCED_FACE', `#${faceId} is ${face.name}`);
      faceCount++;
      const parts = stepArgs(face.args);
      const bounds = stepRefs(parts[1]);
      const surface = recs.get(stepRefs(parts[2])[0] ?? -1);
      assert.ok(surface, `face #${faceId} has no surface`);
      const plane = recs.get(stepRefs(face.args).find((id) => recs.get(id)!.name === 'PLANE')!)!;
      const axisPlacement = recs.get(stepRefs(plane.args)[0])!;
      assert.equal(axisPlacement.name, 'AXIS2_PLACEMENT_3D');
      const [, axisId, refId] = stepRefs(axisPlacement.args);
      const normal = dir(axisId);
      const refDir = dir(refId);
      // The reference direction has to be perpendicular to the axis, or the
      // placement is degenerate and the surface orientation is undefined.
      const dot = normal[0] * refDir[0] + normal[1] * refDir[1] + normal[2] * refDir[2];
      assert.ok(Math.abs(dot) < 1e-6, `face #${faceId}: ref_direction not perpendicular to axis (${dot})`);

      let outerBounds = 0;
      for (const boundId of bounds) {
        const bound = recs.get(boundId)!;
        assert.ok(
          bound.name === 'FACE_OUTER_BOUND' || bound.name === 'FACE_BOUND',
          `#${boundId} is ${bound.name}, not a face bound`,
        );
        if (bound.name === 'FACE_OUTER_BOUND') outerBounds++;
        const loop = recs.get(stepRefs(bound.args)[0])!;
        assert.equal(loop.name, 'EDGE_LOOP', `#${loop.id} is ${loop.name}`);
        const orientedIds = stepRefs(loop.args);
        assert.ok(orientedIds.length >= 3, `loop #${loop.id} has ${orientedIds.length} edges`);

        const path: number[][] = [];
        let prevEnd: number | null = null;
        let firstStart: number | null = null;
        for (const oId of orientedIds) {
          const o = recs.get(oId)!;
          assert.equal(o.name, 'ORIENTED_EDGE', `#${oId} is ${o.name}`);
          const forward = /\.T\.\s*$/.test(o.args);
          const edgeId = stepRefs(o.args)[0];
          const e = recs.get(edgeId)!;
          assert.equal(e.name, 'EDGE_CURVE', `#${edgeId} is ${e.name}`);
          const [v1, v2] = stepRefs(e.args);
          const start = forward ? v1 : v2;
          const end = forward ? v2 : v1;
          if (prevEnd !== null) {
            assert.equal(start, prevEnd, `loop #${loop.id} is broken at edge #${edgeId}`);
          } else {
            firstStart = start;
          }
          prevEnd = end;
          path.push(point(start));
          const seen = uses.get(edgeId) ?? [];
          seen.push(forward);
          uses.set(edgeId, seen);
        }
        assert.equal(prevEnd, firstStart, `loop #${loop.id} does not close`);

        if (bound.name === 'FACE_OUTER_BOUND') {
          // Newell's normal of the loop must agree with the surface normal,
          // otherwise this face points into the solid.
          let nx = 0;
          let ny = 0;
          let nz = 0;
          for (let i = 0; i < path.length; i++) {
            const a = path[i];
            const b = path[(i + 1) % path.length];
            nx += (a[1] - b[1]) * (a[2] + b[2]);
            ny += (a[2] - b[2]) * (a[0] + b[0]);
            nz += (a[0] - b[0]) * (a[1] + b[1]);
          }
          const len = Math.hypot(nx, ny, nz);
          assert.ok(len > 1e-9, `face #${faceId} outer loop is degenerate`);
          const agree = (nx * normal[0] + ny * normal[1] + nz * normal[2]) / len;
          assert.ok(agree > 0.999, `face #${faceId} is wound against its normal (${agree.toFixed(4)})`);
        }
      }
      assert.equal(outerBounds, 1, `face #${faceId} has ${outerBounds} outer bounds`);
    }

    for (const [edgeId, flags] of uses) {
      assert.equal(flags.length, 2, `edge #${edgeId} is used by ${flags.length} faces — the shell is not closed`);
      assert.notEqual(flags[0], flags[1], `edge #${edgeId} is traversed the same way by both faces`);
      edgeCount++;
    }
  }

  const solids = breps.map((b) => {
    const m = b.args.match(/^'((?:[^']|'')*)'/);
    return m ? m[1].replace(/''/g, "'") : '';
  });
  return { solids, faces: faceCount, edges: edgeCount };
}

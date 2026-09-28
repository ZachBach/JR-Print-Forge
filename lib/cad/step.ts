/**
 * STEP AP214 writer — the file that makes this a CAD handoff rather than a mesh.
 *
 * A mesh is a dead end in CAD: an STL of a keychain opens in Fusion or SolidWorks
 * as forty thousand facets, and there is no edge to fillet and no face to offset.
 * What comes out of here is a boundary representation: the top of the plate is one
 * planar face with the keyring hole as an inner loop, each straight run of the
 * outline is one planar side face, and the edges between them are real lines. That
 * is a solid body a machinist can put a chamfer on.
 *
 * Structure, per body: two cap faces and one side face per outline segment, sewn
 * into a CLOSED_SHELL → MANIFOLD_SOLID_BREP. Every edge is used by exactly two
 * faces, traversed one way in one and the other way in the other, which is the
 * condition for a closed shell; `lib/cad/testing.ts` parses the output back and
 * checks it rather than taking it on trust.
 *
 * Face normals are never inferred from a `same_sense` flag: each face gets its own
 * placement whose Z axis *is* the outward normal, and its loops are wound
 * counter-clockwise about that axis. One rule, every face, nothing to get backwards.
 */
import type { Profile, Ring } from './polygon.ts';

export interface StepBody {
  name: string;
  profiles: Profile[];
  z0: number;
  z1: number;
}

export interface StepMeta {
  title: string;
  description?: string;
  /** ISO timestamp; injected so a test can compare two runs byte for byte. */
  now?: string;
}

/**
 * STEP reals must carry a decimal point — `1` is an integer and the wrong type
 * for a coordinate. Rounded to a micron first, which is also the file's stated
 * accuracy, so the text never carries float noise.
 */
function real(v: number): string {
  const r = Math.round(v * 1e6) / 1e6;
  if (r === 0) return '0.';
  const s = String(r);
  return s.includes('.') ? s : `${s}.`;
}

/** STEP strings are single-quoted with doubled quotes; keep to plain ASCII. */
const str = (s: string) => s.replace(/[^\x20-\x7e]/g, ' ').replace(/'/g, "''");

class Doc {
  private lines: string[] = [];
  private cache = new Map<string, number>();
  private n = 0;

  add(body: string): number {
    const id = ++this.n;
    this.lines.push(`#${id}=${body};`);
    return id;
  }

  /** Emit once per distinct entity text — points and directions repeat heavily. */
  once(body: string): number {
    const hit = this.cache.get(body);
    if (hit !== undefined) return hit;
    const id = this.add(body);
    this.cache.set(body, id);
    return id;
  }

  get data(): string {
    return this.lines.join('\n');
  }
}

const point = (d: Doc, x: number, y: number, z: number) =>
  d.once(`CARTESIAN_POINT('',(${real(x)},${real(y)},${real(z)}))`);

const direction = (d: Doc, x: number, y: number, z: number) => {
  const len = Math.hypot(x, y, z) || 1;
  return d.once(`DIRECTION('',(${real(x / len)},${real(y / len)},${real(z / len)}))`);
};

const placement = (d: Doc, o: number, axis: number, ref: number) =>
  d.once(`AXIS2_PLACEMENT_3D('',#${o},#${axis},#${ref})`);

/** An edge between two vertices, as a bounded straight line. */
function edge(d: Doc, va: number, vb: number, a: [number, number, number], b: [number, number, number]): number {
  const dir = direction(d, b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const vec = d.once(`VECTOR('',#${dir},${real(len)})`);
  const line = d.add(`LINE('',#${point(d, a[0], a[1], a[2])},#${vec})`);
  return d.add(`EDGE_CURVE('',#${va},#${vb},#${line},.T.)`);
}

const loop = (d: Doc, oriented: number[]) => d.add(`EDGE_LOOP('',(${oriented.map((i) => `#${i}`).join(',')}))`);

const oriented = (d: Doc, e: number, forward: boolean) =>
  d.add(`ORIENTED_EDGE('',*,*,#${e},${forward ? '.T.' : '.F.'})`);

/** The rings of a profile in the order their points were flattened. */
const ringsOf = (p: Profile): Ring[] => [p.outer, ...p.holes];

/**
 * One closed shell for one extruded profile. Returns the MANIFOLD_SOLID_BREP id.
 */
function solid(d: Doc, p: Profile, z0: number, z1: number, name: string): number {
  const rings = ringsOf(p);
  const zAxis = direction(d, 0, 0, 1);
  const zDown = direction(d, 0, 0, -1);
  const xAxis = direction(d, 1, 0, 0);

  // Vertices: bottom and top of every outline point.
  const bot: number[][] = [];
  const top: number[][] = [];
  const xy: number[][][] = [];
  for (const r of rings) {
    const b: number[] = [];
    const t: number[] = [];
    const pts: number[][] = [];
    for (let k = 0; k < r.length; k += 2) {
      const x = r[k];
      const y = r[k + 1];
      pts.push([x, y]);
      b.push(d.add(`VERTEX_POINT('',#${point(d, x, y, z0)})`));
      t.push(d.add(`VERTEX_POINT('',#${point(d, x, y, z1)})`));
    }
    bot.push(b);
    top.push(t);
    xy.push(pts);
  }

  // Edges: the verticals, and the bottom and top edge of every segment.
  const vert: number[][] = [];
  const botEdge: number[][] = [];
  const topEdge: number[][] = [];
  for (let ri = 0; ri < rings.length; ri++) {
    const n = xy[ri].length;
    const v: number[] = [];
    const be: number[] = [];
    const te: number[] = [];
    for (let i = 0; i < n; i++) {
      const [x, y] = xy[ri][i];
      v.push(edge(d, bot[ri][i], top[ri][i], [x, y, z0], [x, y, z1]));
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const [x0, y0] = xy[ri][i];
      const [x1, y1] = xy[ri][j];
      be.push(edge(d, bot[ri][i], bot[ri][j], [x0, y0, z0], [x1, y1, z0]));
      te.push(edge(d, top[ri][i], top[ri][j], [x0, y0, z1], [x1, y1, z1]));
    }
    vert.push(v);
    botEdge.push(be);
    topEdge.push(te);
  }

  const faces: number[] = [];

  // Side faces. For a counter-clockwise outer ring and clockwise holes the
  // outward normal of the segment i→j is (dy, −dx) in both cases.
  for (let ri = 0; ri < rings.length; ri++) {
    const n = xy[ri].length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const [x0, y0] = xy[ri][i];
      const [x1, y1] = xy[ri][j];
      const dx = x1 - x0;
      const dy = y1 - y0;
      const normal = direction(d, dy, -dx, 0);
      const along = direction(d, dx, dy, 0);
      const plane = d.add(`PLANE('',#${placement(d, point(d, x0, y0, z0), normal, along)})`);
      const l = loop(d, [
        oriented(d, botEdge[ri][i], true),
        oriented(d, vert[ri][j], true),
        oriented(d, topEdge[ri][i], false),
        oriented(d, vert[ri][i], false),
      ]);
      const bound = d.add(`FACE_OUTER_BOUND('',#${l},.T.)`);
      faces.push(d.add(`ADVANCED_FACE('',(#${bound}),#${plane},.T.)`));
    }
  }

  // Top cap: one face, the outline as its outer bound and each hole as an inner
  // bound. This is the face a CAD tool lets you select and offset.
  {
    const plane = d.add(`PLANE('',#${placement(d, point(d, 0, 0, z1), zAxis, xAxis)})`);
    const bounds: number[] = [];
    for (let ri = 0; ri < rings.length; ri++) {
      const l = loop(d, topEdge[ri].map((e) => oriented(d, e, true)));
      bounds.push(d.add(`${ri === 0 ? 'FACE_OUTER_BOUND' : 'FACE_BOUND'}('',#${l},.T.)`));
    }
    faces.push(d.add(`ADVANCED_FACE('',(${bounds.map((b) => `#${b}`).join(',')}),#${plane},.T.)`));
  }

  // Bottom cap: normal −Z, so every loop runs the other way round.
  {
    const plane = d.add(`PLANE('',#${placement(d, point(d, 0, 0, z0), zDown, xAxis)})`);
    const bounds: number[] = [];
    for (let ri = 0; ri < rings.length; ri++) {
      const es = botEdge[ri];
      const back: number[] = [];
      for (let i = es.length - 1; i >= 0; i--) back.push(oriented(d, es[i], false));
      const l = loop(d, back);
      bounds.push(d.add(`${ri === 0 ? 'FACE_OUTER_BOUND' : 'FACE_BOUND'}('',#${l},.T.)`));
    }
    faces.push(d.add(`ADVANCED_FACE('',(${bounds.map((b) => `#${b}`).join(',')}),#${plane},.T.)`));
  }

  const shell = d.add(`CLOSED_SHELL('',(${faces.map((f) => `#${f}`).join(',')}))`);
  return d.add(`MANIFOLD_SOLID_BREP('${str(name)}',#${shell})`);
}

/**
 * Write the bodies as one STEP part containing one solid per profile. Bodies stay
 * separate solids so the plate and the raised design arrive as two selectable
 * bodies rather than fused into one lump.
 */
export function toStep(bodies: StepBody[], meta: StepMeta): string {
  const d = new Doc();
  const title = str(meta.title);

  const solids: number[] = [];
  for (const b of bodies) {
    for (let k = 0; k < b.profiles.length; k++) {
      const label = b.profiles.length > 1 ? `${b.name} ${k + 1}` : b.name;
      solids.push(solid(d, b.profiles[k], b.z0, b.z1, label));
    }
  }
  if (!solids.length) throw new Error('Nothing to write.');

  // Units and tolerance. The complex-entity syntax is the standard idiom for
  // saying "millimetres, radians, accurate to a micron".
  const mm = d.add(`( NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) LENGTH_UNIT() )`);
  const rad = d.add(`( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) )`);
  const sr = d.add(`( NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT() )`);
  const tol = d.add(
    `UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-06),#${mm},'distance_accuracy_value','confusion accuracy')`,
  );
  const ctx = d.add(
    `( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${tol})) ` +
      `GLOBAL_UNIT_ASSIGNED_CONTEXT((#${mm},#${rad},#${sr})) REPRESENTATION_CONTEXT('','3D') )`,
  );

  const origin = point(d, 0, 0, 0);
  const world = placement(d, origin, direction(d, 0, 0, 1), direction(d, 1, 0, 0));
  const shape = d.add(
    `ADVANCED_BREP_SHAPE_REPRESENTATION('${title}',(#${world},${solids.map((s) => `#${s}`).join(',')}),#${ctx})`,
  );

  const appCtx = d.add(`APPLICATION_CONTEXT('core data for automotive mechanical design processes')`);
  d.add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${appCtx})`);
  const prodCtx = d.add(`PRODUCT_CONTEXT('',#${appCtx},'mechanical')`);
  const product = d.add(`PRODUCT('${title}','${title}','',(#${prodCtx}))`);
  d.add(`PRODUCT_RELATED_PRODUCT_CATEGORY('part','',(#${product}))`);
  const formation = d.add(`PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('','',#${product},.NOT_KNOWN.)`);
  const defCtx = d.add(`PRODUCT_DEFINITION_CONTEXT('part definition',#${appCtx},'design')`);
  const definition = d.add(`PRODUCT_DEFINITION('design','',#${formation},#${defCtx})`);
  const defShape = d.add(`PRODUCT_DEFINITION_SHAPE('','',#${definition})`);
  d.add(`SHAPE_DEFINITION_REPRESENTATION(#${defShape},#${shape})`);

  const stamp = (meta.now ?? new Date().toISOString()).replace(/\.\d+Z$/, '');
  const head = [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION(('${str(meta.description ?? title)}'),'2;1');`,
    `FILE_NAME('${title}','${stamp}',('JR Print Forge'),(''),'JR Print Forge sketch-to-CAD','',' ');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
    'ENDSEC;',
    'DATA;',
  ].join('\n');
  return `${head}\n${d.data}\nENDSEC;\nEND-ISO-10303-21;\n`;
}

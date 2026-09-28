/**
 * DXF R12 writer — the outlines, as a drawing.
 *
 * STEP hands over a finished solid; this hands over the profiles. Importing it
 * into Fusion, Onshape or SolidWorks gives editable sketch geometry on the plane
 * it belongs to, so the shop can extrude it themselves, add a boss, or hand the
 * same outline to a laser or vinyl cutter. It is also the format a customer's own
 * CAD person is most likely to ask for.
 *
 * R12 (AC1009) rather than anything newer, deliberately: POLYLINE/VERTEX/SEQEND is
 * read by everything, including the older cutter software a small shop actually
 * runs, and there is nothing in a closed polyline that needs a later revision.
 *
 * Each body's outlines go on their own layer, at that body's top height, so the
 * layers stack in Z the way the part does.
 */
import { bbox, type Profile, type Ring } from './polygon.ts';
import { asCircle } from './features.ts';

export interface DxfBody {
  name: string;
  profiles: Profile[];
  /** The plane to draw this body's outlines on, mm. */
  z: number;
}

export interface DxfOptions {
  /**
   * Rings that fit a circle this closely are written as a CIRCLE rather than a
   * polygon, so a keyring hole arrives as Ø5 mm that can be resized, not as a
   * thirty-sided approximation of it. 0 disables the substitution.
   */
  circleTolerance?: number;
}

/** R12 layer names are conservative: upper case, no spaces, 31 characters. */
function layerName(s: string, fallback: string): string {
  const clean = s
    .toUpperCase()
    .replace(/[^A-Z0-9_\-.]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 31);
  return clean || fallback;
}

const g = (code: number, value: string | number) => `${code}\n${value}\n`;

/** DXF reals: plain decimals, rounded to a micron. */
const r = (v: number) => (Math.round(v * 1e6) / 1e6).toFixed(6);

/** AutoCAD colour indices, cycled per layer so the levels are told apart. */
const COLOURS = [7, 1, 3, 5, 6, 2, 4, 8];

export function toDxf(bodies: DxfBody[], opts: DxfOptions = {}): string {
  const circleTol = opts.circleTolerance ?? 0;
  const layers = bodies.map((b, i) => ({
    name: layerName(b.name, `LEVEL_${i + 1}`),
    colour: COLOURS[i % COLOURS.length],
    body: b,
  }));

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of bodies) {
    for (const p of b.profiles) {
      for (const ring of [p.outer, ...p.holes]) {
        const [x0, y0, x1, y1] = bbox(ring);
        minX = Math.min(minX, x0);
        minY = Math.min(minY, y0);
        maxX = Math.max(maxX, x1);
        maxY = Math.max(maxY, y1);
      }
    }
  }
  if (!Number.isFinite(minX)) {
    minX = minY = maxX = maxY = 0;
  }

  let out = '';
  out += g(0, 'SECTION') + g(2, 'HEADER');
  out += g(9, '$ACADVER') + g(1, 'AC1009');
  // Metric, millimetres. Ignored by R12-only readers, honoured by everything
  // newer, and the difference between a 60 mm keychain and a 60 inch one.
  out += g(9, '$MEASUREMENT') + g(70, 1);
  out += g(9, '$INSUNITS') + g(70, 4);
  out += g(9, '$EXTMIN') + g(10, r(minX)) + g(20, r(minY)) + g(30, r(0));
  out += g(9, '$EXTMAX') + g(10, r(maxX)) + g(20, r(maxY)) + g(30, r(0));
  out += g(0, 'ENDSEC');

  out += g(0, 'SECTION') + g(2, 'TABLES') + g(0, 'TABLE') + g(2, 'LAYER') + g(70, layers.length);
  for (const l of layers) {
    out += g(0, 'LAYER') + g(2, l.name) + g(70, 0) + g(62, l.colour) + g(6, 'CONTINUOUS');
  }
  out += g(0, 'ENDTAB') + g(0, 'ENDSEC');

  out += g(0, 'SECTION') + g(2, 'ENTITIES');
  const ringEntity = (ring: Ring, layer: string, z: number): string => {
    const round = circleTol > 0 ? asCircle(ring, circleTol) : null;
    if (round) {
      return g(0, 'CIRCLE') + g(8, layer) + g(10, r(round.cx)) + g(20, r(round.cy)) + g(30, r(z)) + g(40, r(round.r));
    }
    // 66 = vertices follow, 70 bit 1 = closed. The polyline's own 10/20/30 are
    // unused by the format but expected to be present.
    let s = g(0, 'POLYLINE') + g(8, layer) + g(66, 1) + g(70, 1) + g(10, r(0)) + g(20, r(0)) + g(30, r(z));
    for (let k = 0; k < ring.length; k += 2) {
      s += g(0, 'VERTEX') + g(8, layer) + g(10, r(ring[k])) + g(20, r(ring[k + 1])) + g(30, r(z));
    }
    return s + g(0, 'SEQEND') + g(8, layer);
  };
  for (const l of layers) {
    for (const p of l.body.profiles) {
      for (const ring of [p.outer, ...p.holes]) out += ringEntity(ring, l.name, l.body.z);
    }
  }
  out += g(0, 'ENDSEC') + g(0, 'EOF');
  return out;
}

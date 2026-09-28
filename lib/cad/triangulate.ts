/**
 * Profile → triangles, for the flat faces of an extruded solid.
 *
 * Ear clipping over a doubly-linked vertex ring, with holes bridged into the
 * outer ring first. It adds no vertices of its own (bridges duplicate existing
 * ones), which is the property the solid builder depends on: the cap and the
 * walls quote the same points, so every edge of the finished solid is shared by
 * exactly two triangles and the mesh is watertight by construction rather than
 * by welding afterwards.
 *
 * The algorithm is the standard one (Meisters' ears, with the hole-bridge and
 * self-intersection recovery passes from earcut). Rather than trust it blindly,
 * `triangulateProfile` measures the area it produced against the area of the
 * profile and returns null if they disagree — a caller that gets null falls back
 * to the height-field mesher instead of shipping a part with a missing face.
 *
 * Sign convention in this file follows the algorithm's own: `turn()` is negative
 * for a left turn, so with the outer ring counter-clockwise a *convex* corner
 * has turn < 0 and a reflex corner turn >= 0.
 */
import { profileArea, type Profile, type Ring } from './polygon.ts';

class Node {
  prev!: Node;
  next!: Node;
  /** Vertex index into the flattened point list; bridge copies share it. */
  i: number;
  x: number;
  y: number;
  constructor(i: number, x: number, y: number) {
    this.i = i;
    this.x = x;
    this.y = y;
  }
}

const turn = (p: Node, q: Node, r: Node) => (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);

const equals = (a: Node, b: Node) => a.x === b.x && a.y === b.y;

function insert(i: number, x: number, y: number, last: Node | null): Node {
  const n = new Node(i, x, y);
  if (!last) {
    n.prev = n;
    n.next = n;
  } else {
    n.next = last.next;
    n.prev = last;
    last.next.prev = n;
    last.next = n;
  }
  return n;
}

function remove(n: Node) {
  n.next.prev = n.prev;
  n.prev.next = n.next;
}

/** Build a cycle from a ring, keeping its given order. */
function cycle(ring: Ring, base: number): Node | null {
  let last: Node | null = null;
  for (let k = 0; k < ring.length; k += 2) last = insert(base + k / 2, ring[k], ring[k + 1], last);
  return last;
}

/** Drop duplicate and collinear vertices; they make zero-area ears. */
function filterPoints(start: Node | null, end?: Node): Node | null {
  if (!start) return start;
  const stop = end ?? start;
  let p = start;
  let again: boolean;
  do {
    again = false;
    if (equals(p, p.next) || turn(p.prev, p, p.next) === 0) {
      remove(p);
      p = p.prev;
      if (p === p.next) return null;
      again = true;
    } else {
      p = p.next;
    }
  } while (again || p !== stop);
  return p;
}

/** Inside the CCW triangle abc, boundary included. */
function inTriangle(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  px: number,
  py: number,
) {
  return (
    (cx - px) * (ay - py) - (ax - px) * (cy - py) >= 0 &&
    (ax - px) * (by - py) - (bx - px) * (ay - py) >= 0 &&
    (bx - px) * (cy - py) - (cx - px) * (by - py) >= 0
  );
}

function isEar(ear: Node): boolean {
  const a = ear.prev;
  const b = ear;
  const c = ear.next;
  if (turn(a, b, c) >= 0) return false; // reflex corner
  let p = c.next;
  while (p !== a) {
    // Only a reflex vertex can block an ear, and it has to be inside it.
    if (inTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) && turn(p.prev, p, p.next) >= 0) return false;
    p = p.next;
  }
  return true;
}

/** Does the segment a→b leave the polygon at a? */
function locallyInside(a: Node, b: Node): boolean {
  return turn(a.prev, a, a.next) < 0
    ? turn(a, b, a.next) >= 0 && turn(a, a.prev, b) >= 0
    : turn(a, b, a.prev) < 0 || turn(a, a.next, b) < 0;
}

const sign = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);

const onSegment = (p: Node, q: Node, r: Node) =>
  q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) && q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y);

function intersects(p1: Node, q1: Node, p2: Node, q2: Node): boolean {
  const o1 = sign(turn(p1, q1, p2));
  const o2 = sign(turn(p1, q1, q2));
  const o3 = sign(turn(p2, q2, p1));
  const o4 = sign(turn(p2, q2, q1));
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;
  return false;
}

function intersectsPolygon(a: Node, b: Node): boolean {
  let p = a;
  do {
    if (p.i !== a.i && p.next.i !== a.i && p.i !== b.i && p.next.i !== b.i && intersects(p, p.next, a, b)) return true;
    p = p.next;
  } while (p !== a);
  return false;
}

/** Is the midpoint of a→b inside the polygon? */
function middleInside(a: Node, b: Node): boolean {
  let p = a;
  let inside = false;
  const px = (a.x + b.x) / 2;
  const py = (a.y + b.y) / 2;
  do {
    if (p.y > py !== p.next.y > py && p.next.y !== p.y && px < ((p.next.x - p.x) * (py - p.y)) / (p.next.y - p.y) + p.x)
      inside = !inside;
    p = p.next;
  } while (p !== a);
  return inside;
}

function isValidDiagonal(a: Node, b: Node): boolean {
  return (
    a.next.i !== b.i &&
    a.prev.i !== b.i &&
    !intersectsPolygon(a, b) &&
    locallyInside(a, b) &&
    locallyInside(b, a) &&
    middleInside(a, b) &&
    (turn(a.prev, a, b.prev) !== 0 || turn(a, b.prev, b) !== 0)
  );
}

/**
 * Cut the cycle in two along a→b, duplicating both vertices. Used to bridge a
 * hole into the outer ring and to split a polygon the ear pass got stuck on.
 */
function splitCycle(a: Node, b: Node): Node {
  const a2 = new Node(a.i, a.x, a.y);
  const b2 = new Node(b.i, b.x, b.y);
  const an = a.next;
  const bp = b.prev;
  a.next = b;
  b.prev = a;
  a2.next = an;
  an.prev = a2;
  b2.next = a2;
  a2.prev = b2;
  bp.next = b2;
  b2.prev = bp;
  return b2;
}

/**
 * The outer-ring vertex a hole can see to its left. Casting a ray in −x from the
 * hole's leftmost point finds the edge to bridge to; the second pass then makes
 * sure no other vertex sits between the two, which would make the bridge cross
 * the boundary.
 */
function findHoleBridge(hole: Node, outer: Node): Node | null {
  let p = outer;
  let qx = -Infinity;
  let m: Node | null = null;
  const hx = hole.x;
  const hy = hole.y;
  do {
    if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
      const x = p.x + ((hy - p.y) * (p.next.x - p.x)) / (p.next.y - p.y);
      if (x <= hx && x > qx) {
        qx = x;
        m = p.x < p.next.x ? p : p.next;
        if (x === hx) return m;
      }
    }
    p = p.next;
  } while (p !== outer);
  if (!m) return null;

  const stop = m;
  const mx = m.x;
  const my = m.y;
  let tanMin = Infinity;
  p = m;
  do {
    if (
      hx >= p.x &&
      p.x >= mx &&
      hx !== p.x &&
      inTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)
    ) {
      const tan = Math.abs(hy - p.y) / (hx - p.x);
      if (locallyInside(p, hole) && (tan < tanMin || (tan === tanMin && p.x > m!.x))) {
        m = p;
        tanMin = tan;
      }
    }
    p = p.next;
  } while (p !== stop);
  return m;
}

function leftmost(start: Node): Node {
  let p = start;
  let best = start;
  do {
    if (p.x < best.x || (p.x === best.x && p.y < best.y)) best = p;
    p = p.next;
  } while (p !== start);
  return best;
}

function earcut(start: Node | null, out: number[], pass = 0) {
  if (!start) return;
  let ear: Node = start;
  let stop: Node = start;
  while (ear.prev !== ear.next) {
    const prev: Node = ear.prev;
    const next: Node = ear.next;
    if (isEar(ear)) {
      out.push(prev.i, ear.i, next.i);
      remove(ear);
      ear = next.next;
      stop = next.next;
      continue;
    }
    ear = next;
    if (ear === stop) {
      // Stuck. Each pass is a stronger repair: drop degenerate vertices, then
      // clip off a self-intersecting spur, then split on any valid diagonal.
      if (pass === 0) {
        earcut(filterPoints(ear), out, 1);
      } else if (pass === 1) {
        const filtered = filterPoints(ear);
        if (filtered) earcut(cureLocalIntersections(filtered, out), out, 2);
      } else {
        splitEarcut(ear, out);
      }
      return;
    }
  }
}

function cureLocalIntersections(start: Node, out: number[]): Node | null {
  let p = start;
  do {
    const a = p.prev;
    const b = p.next.next;
    if (!equals(a, b) && intersects(a, p, p.next, b) && locallyInside(a, b) && locallyInside(b, a)) {
      out.push(a.i, p.i, b.i);
      remove(p);
      remove(p.next);
      p = start = b;
    }
    p = p.next;
  } while (p !== start);
  return filterPoints(p);
}

function splitEarcut(start: Node, out: number[]) {
  let a = start;
  do {
    let b = a.next.next;
    while (b !== a.prev) {
      if (a.i !== b.i && isValidDiagonal(a, b)) {
        let c: Node | null = splitCycle(a, b);
        const a2 = filterPoints(a, a.next);
        c = filterPoints(c, c.next);
        earcut(a2, out);
        earcut(c, out);
        return;
      }
      b = b.next;
    }
    a = a.next;
  } while (a !== start);
}

export interface Triangulation {
  /** Interleaved xy, mm: the outer ring then each hole, in profile order. */
  points: number[];
  /** Triangle vertex indices into `points`, counter-clockwise. */
  indices: number[];
}

/**
 * Triangulate a profile, or return null when the result cannot be trusted.
 *
 * The check is area: a correct triangulation of a simple polygon covers it
 * exactly once, so the summed triangle area has to match the shoelace area of
 * the profile. Overlaps, gaps and dropped ears all show up here.
 */
export function triangulateProfile(p: Profile): Triangulation | null {
  const points: number[] = [...p.outer];
  const holeStarts: number[] = [];
  for (const h of p.holes) {
    holeStarts.push(points.length / 2);
    points.push(...h);
  }
  if (points.length < 6) return null;

  let outer = filterPoints(cycle(p.outer, 0));
  if (!outer) return null;

  if (p.holes.length) {
    const queue: Node[] = [];
    for (let k = 0; k < p.holes.length; k++) {
      const list = filterPoints(cycle(p.holes[k], holeStarts[k]));
      if (!list) continue;
      // A hole whose ring came back as a single point is gone; otherwise take
      // its leftmost vertex, which is the one that can see out to the left.
      if (list === list.next) continue;
      queue.push(leftmost(list));
    }
    queue.sort((a, b) => a.x - b.x || a.y - b.y);
    for (const hole of queue) {
      const bridge = findHoleBridge(hole, outer!);
      if (!bridge) return null; // cannot connect the hole — do not guess
      const back = splitCycle(bridge, hole);
      filterPoints(back, back.next);
      outer = filterPoints(bridge, bridge.next);
      if (!outer) return null;
    }
  }

  const indices: number[] = [];
  earcut(outer, indices);
  if (indices.length < 3) return null;

  let made = 0;
  for (let k = 0; k < indices.length; k += 3) {
    const a = indices[k] * 2;
    const b = indices[k + 1] * 2;
    const c = indices[k + 2] * 2;
    made +=
      ((points[b] - points[a]) * (points[c + 1] - points[a + 1]) -
        (points[c] - points[a]) * (points[b + 1] - points[a + 1])) /
      2;
  }
  const want = profileArea(p);
  if (want <= 0 || Math.abs(made - want) > Math.max(1e-6, want * 1e-4)) return null;
  return { points, indices };
}

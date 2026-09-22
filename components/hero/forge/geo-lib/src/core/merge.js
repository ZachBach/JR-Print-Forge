/**
 * merge — many geometries into one, so that many parts cost one draw call.
 *
 * three ships `BufferGeometryUtils.mergeGeometries`, which does this and more.
 * This exists so the library depends on NOTHING: geo-lib is consumed by a
 * project that inlines three.js into a single HTML file, by one that vendors a
 * minified build behind an import map, and by one that resolves it through
 * Vite. An addon import resolves differently in all three, and in the first it
 * does not resolve at all.
 *
 * Deliberately no `useGroups`. Groups exist to keep a merged geometry
 * multi-material, which reinstates exactly the draw call this function is here
 * to remove. A figure that needs two materials is two calls to merge.
 *
 * Not handled, on purpose: morph targets, interleaved attributes, skinning.
 * A merged mesh cannot be animated per-part anyway.
 */
export function merge(THREE, geometries) {
  const list = (geometries || []).filter(Boolean);
  if (list.length === 0) return null;
  if (list.length === 1) return list[0].clone();

  const names = Object.keys(list[0].attributes).sort();
  for (const g of list) {
    if (g.morphAttributes && Object.keys(g.morphAttributes).length) {
      throw new Error('geo-lib merge: morph targets are not supported');
    }
    const have = Object.keys(g.attributes).sort();
    if (have.length !== names.length || have.some((x, i) => x !== names[i])) {
      // Nearly always a hand-built geometry missing `uv` next to a three
      // primitive that has one. Worth naming both sides — the failure is
      // otherwise a shrug from deep inside a typed-array copy.
      throw new Error(
        `geo-lib merge: attribute sets differ — [${names}] vs [${have}]`,
      );
    }
    for (const name of names) {
      if (g.attributes[name].isInterleavedBufferAttribute) {
        throw new Error(`geo-lib merge: '${name}' is interleaved`);
      }
    }
  }

  let vertexCount = 0, indexCount = 0;
  for (const g of list) {
    const c = g.attributes.position.count;
    vertexCount += c;
    indexCount += g.index ? g.index.count : c;
  }

  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const first = list[0].attributes[name];
    const { itemSize, normalized } = first;
    // Take the array type from the first input rather than assuming Float32:
    // a normalized Uint8 colour attribute copied into a float array would come
    // out 255 times too bright, silently.
    const Ctor = first.array.constructor;
    const array = new Ctor(vertexCount * itemSize);
    let off = 0;
    for (const g of list) {
      const a = g.attributes[name];
      if (a.itemSize !== itemSize) {
        throw new Error(`geo-lib merge: '${name}' itemSize ${a.itemSize} vs ${itemSize}`);
      }
      if (a.array.constructor !== Ctor) {
        throw new Error(`geo-lib merge: '${name}' array types differ`);
      }
      array.set(a.array, off);
      off += a.count * itemSize;
    }
    out.setAttribute(name, new THREE.BufferAttribute(array, itemSize, normalized));
  }

  // Non-indexed inputs get a synthesized index rather than forcing the whole
  // merge non-indexed, which would multiply the vertex count of everything
  // indexed alongside them.
  const Index = vertexCount > 65535 ? Uint32Array : Uint16Array;
  const index = new Index(indexCount);
  let io = 0, vo = 0;
  for (const g of list) {
    const c = g.attributes.position.count;
    if (g.index) {
      const gi = g.index.array;
      for (let i = 0; i < gi.length; i++) index[io + i] = gi[i] + vo;
      io += gi.length;
    } else {
      for (let i = 0; i < c; i++) index[io + i] = vo + i;
      io += c;
    }
    vo += c;
  }
  out.setIndex(new THREE.BufferAttribute(index, 1));
  return out;
}

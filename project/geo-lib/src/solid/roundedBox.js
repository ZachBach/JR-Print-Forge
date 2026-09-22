/**
 * roundedBox — a box whose edges catch a highlight.
 *
 * A hard-edged box is the single most reliable way to make a rendered object
 * look untouched by hand. Real edges are never perfectly sharp: a chamfer of
 * half a millimetre is enough to pick up a specular line, and that line is
 * most of what tells the eye an object has a surface at all.
 *
 * Built by taking a segmented box and pushing every vertex out from the
 * largest inscribed box by `radius` — the standard rounded-box distance field,
 * evaluated on the vertices instead of in a shader.
 *
 * NORMALS ARE SET ANALYTICALLY, not computed. `(v - clamped)` normalised IS
 * the exact gradient of that distance field, so it is both cheaper and more
 * correct than `computeVertexNormals`. It also sidesteps the real problem:
 * BoxGeometry keeps each face's vertices separate, so averaged normals would
 * be faceted along every seam, and welding them first would mean depending on
 * BufferGeometryUtils — which this library will not do.
 */
export function roundedBox(THREE, w, h, d, radius = 0.1, segments = 4) {
  const r = Math.max(1e-4, Math.min(radius, Math.min(w, h, d) / 2 - 1e-4));
  const s = Math.max(1, Math.round(segments));
  const g = new THREE.BoxGeometry(w, h, d, s, s, s);

  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const ix = w / 2 - r, iy = h / 2 - r, iz = d / 2 - r;
  const v = new THREE.Vector3();
  const c = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    c.set(
      Math.max(-ix, Math.min(ix, v.x)),
      Math.max(-iy, Math.min(iy, v.y)),
      Math.max(-iz, Math.min(iz, v.z)),
    );
    v.sub(c);
    // Only true for a degenerate radius, which the clamp above rules out —
    // but a NaN normal is invisible until it is a black mesh, so it is worth
    // the branch.
    if (v.lengthSq() < 1e-20) v.fromBufferAttribute(nor, i);
    v.normalize();
    nor.setXYZ(i, v.x, v.y, v.z);
    pos.setXYZ(i, c.x + v.x * r, c.y + v.y * r, c.z + v.z * r);
  }
  pos.needsUpdate = true;
  nor.needsUpdate = true;
  return g;
}

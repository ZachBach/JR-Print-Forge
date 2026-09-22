/**
 * normalizeModel — put a loaded model where you meant it to go.
 *
 * Every app that accepts a model file writes this, and writes it badly the
 * first time. Exported models arrive at every scale and origin there is: a CAD
 * export in millimetres is a thousand times too big, a scan is centred on
 * whatever the photogrammetry solver liked, a Blender file has its origin
 * wherever the artist left the 3D cursor. Asking whoever supplies the model to
 * get all of that right in the exporter is asking for a support thread.
 *
 * Measuring the bounding box and fitting it costs nothing and removes the
 * whole class of problem. What it CANNOT fix is which way the thing faces —
 * facing is a semantic question about the model, not a measurable one — so
 * `turn` stays the caller's job. It is applied before measuring, because
 * rotating a box changes it.
 *
 * Options:
 *   height    world units, base to top. The model is scaled to match.
 *   fit       'height' (default) or 'box' — 'box' fits the largest dimension
 *             instead, for things that are wider than they are tall.
 *   turn      radians about Y, applied first. 0 means the model already faces
 *             +Z. Blender's glTF export usually needs Math.PI.
 *   target    [x, y, z] — the model is centred on x/z and STOOD ON y, not
 *             centred on it. A plinth top is a floor, not a midpoint.
 *   material  applied to every mesh, replacing whatever came with the file.
 *
 * Returns a Group holding the model. The Group carries `userData.geoFit` with
 * the measured size and the scale applied, which is what you want in the log
 * the first time a model turns up at the wrong scale anyway.
 */
export function normalizeModel(THREE, object, opt = {}) {
  const g = new THREE.Group();
  object.rotation.y = opt.turn || 0;
  g.add(object);
  g.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(g);
  if (box.isEmpty()) throw new Error('geo-lib normalizeModel: model has no geometry');
  const size = box.getSize(new THREE.Vector3());

  const want = opt.height || 1;
  const have = (opt.fit === 'box') ? Math.max(size.x, size.y, size.z) : size.y;
  g.scale.setScalar(want / Math.max(1e-6, have));
  g.updateMatrixWorld(true);

  // Re-measure AFTER scaling. Scaling a group scales the offsets inside it
  // too, so the pre-scale box cannot be reused to place it.
  const fitted = new THREE.Box3().setFromObject(g);
  const t = opt.target || [0, 0, 0];
  g.position.set(
    t[0] - (fitted.min.x + fitted.max.x) / 2,
    t[1] - fitted.min.y,
    t[2] - (fitted.min.z + fitted.max.z) / 2,
  );

  if (opt.material) {
    g.traverse((o) => { if (o.isMesh) o.material = opt.material; });
  }

  g.userData.geoFit = {
    measured: size.toArray(),
    scale: g.scale.x,
    fit: opt.fit || 'height',
  };
  return g;
}

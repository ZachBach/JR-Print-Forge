import { merge } from './merge.js';

/**
 * assembly — place many pieces, then collapse them into one mesh.
 *
 * The pattern this captures: a carved figure is forty-odd primitives, each
 * needing a position, usually a rotation, sometimes a scale. Written out
 * longhand that is forty `new Mesh` / `mesh.position.set` / `group.add`
 * triples, forty draw calls, and a wall of noise that hides the actual shape
 * decisions. Written through an assembly it is forty one-liners and one call.
 *
 *   const a = assembly(THREE);
 *   a.part(box(1, 2, 1), 0, 1, 0);
 *   a.part(ball(0.4), 0, 2.4, 0, null, [1, 0.9, 1]);
 *   const mesh = a.build(material);      // one Mesh, one draw call
 *
 * `along` and `inFrame` are the two that are not obvious and that turn out to
 * matter most; see their notes below.
 */
export function assembly(THREE) {
  const queue = [];
  const o = new THREE.Object3D();
  const X = new THREE.Vector3(1, 0, 0);
  const dir = new THREE.Vector3();
  let xf = null;

  const push = (geo) => {
    o.updateMatrix();
    queue.push(geo.clone().applyMatrix4(xf ? xf.clone().multiply(o.matrix) : o.matrix));
  };

  return {
    /** Place a geometry. rot and scl are optional [x,y,z] triples. */
    part(geo, x, y, z, rot, scl) {
      o.position.set(x || 0, y || 0, z || 0);
      o.rotation.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0);
      o.scale.set(scl ? scl[0] : 1, scl ? scl[1] : 1, scl ? scl[2] : 1);
      push(geo);
      return this;
    },

    /**
     * Place a geometry authored along +X so that its +X runs along `dir`.
     *
     * The rotation used is the MINIMAL one from +X, which means the piece's
     * other two axes end up wherever that rotation puts them. For anything
     * with a flat face — a feather, a leaf, a blade, a fin — that is a trap:
     * pass a direction lying in the XY plane and the rotation is about Z
     * alone, so a piece built flat in XY stays flat in XY. Feed it an
     * arbitrary 3D direction and the flat face tilts out of plane, which is
     * how a wing of carefully shaped feathers renders as a handful of threads.
     *
     * `roll` then spins the piece about its own length.
     */
    along(geo, at, d, roll) {
      dir.set(d[0], d[1], d[2] || 0).normalize();
      o.position.set(at[0], at[1], at[2]);
      o.quaternion.setFromUnitVectors(X, dir);
      o.scale.set(1, 1, 1);
      if (roll) o.rotateX(roll);
      push(geo);
      return this;
    },

    /**
     * Run `fn` with an extra transform stacked on every placement inside it.
     *
     * Lets a subassembly be authored in whatever axes make it simple and set
     * into the figure afterwards — the case that motivated this was a wing,
     * which is a SURFACE and so has to be built flat in its own plane, then
     * swept back as one piece. Nests; composes with the frame already active.
     *
     * Rotations and translations only. A mirror matrix has negative
     * determinant, which flips triangle winding and turns the piece inside
     * out. Build both sides from a `side` factor instead.
     */
    inFrame(matrix, fn) {
      const prev = xf;
      xf = prev ? prev.clone().multiply(matrix) : matrix;
      fn();
      xf = prev;
      return this;
    },

    /** How many pieces are queued. */
    count() {
      return queue.length;
    },

    /** The merged geometry, leaving the queue empty. */
    geometry() {
      if (queue.length === 0) throw new Error('geo-lib assembly: nothing to build');
      const parts = queue.splice(0);
      const g = merge(THREE, parts);
      for (const p of parts) p.dispose();
      return g;
    },

    /** The merged geometry as one Mesh, leaving the queue empty. */
    build(material) {
      return new THREE.Mesh(this.geometry(), material);
    },
  };
}

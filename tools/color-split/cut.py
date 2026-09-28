"""Cut the original solid into single-colour pieces."""
from __future__ import annotations

import numpy as np
import manifold3d as m3d
from scipy import ndimage
from skimage import measure

from labels import inside_mask


# Face id carried by cut faces, so every output triangle can be traced to the
# original triangle it came from (and so to its paint) — or known to be a new cut face.
# Not 0xFFFFFFFF: manifold reads that as -1 ("no id") and renumbers those faces,
# which collides with real triangle indices.
CUT_FACE = np.uint32(0x7FFFFFF0)


def to_manifold(V: np.ndarray, F: np.ndarray, face_id: np.ndarray | None = None) -> m3d.Manifold:
    kw = {} if face_id is None else {'face_id': np.ascontiguousarray(face_id, dtype=np.uint32)}
    mesh = m3d.Mesh(
        vert_properties=np.ascontiguousarray(V, dtype=np.float32),
        tri_verts=np.ascontiguousarray(F, dtype=np.uint32),
        **kw,
    )
    mf = m3d.Manifold(mesh)
    if mf.status() != m3d.Error.NoError:
        mesh.merge()
        mf = m3d.Manifold(mesh)
    return mf


def region_solid(labels: np.ndarray, zone: np.ndarray, colour: int, origin: np.ndarray, p: float, gap: float) -> m3d.Manifold:
    """
    The space a colour owns, as a closed surface, pulled back from every
    neighbouring colour by `gap` mm. Built from a smoothed signed distance
    field so cut faces are gentle curves rather than voxel steps, and so the
    gap is sub-voxel accurate. The region reaches ~1 mm past the model's
    outside, so intersecting it with the original keeps the original surface.
    """
    mask_full = (labels == colour) & zone
    sl = ndimage.find_objects(mask_full.astype(np.uint8))[0]
    m = 4
    sl = tuple(slice(max(s.start - m, 0), min(s.stop + m, n)) for s, n in zip(sl, labels.shape))
    mask = np.pad(mask_full[sl], m)  # an empty border so the surface always closes
    d_in = ndimage.distance_transform_edt(mask)
    d_out = ndimage.distance_transform_edt(~mask)
    sdf = np.where(mask, -(d_in - 0.5), d_out - 0.5) * p
    sdf = ndimage.gaussian_filter(sdf, sigma=0.7)
    verts, faces, _n, _v = measure.marching_cubes(
        sdf, level=-gap, spacing=(p, p, p), gradient_direction='ascent', allow_degenerate=False
    )
    offset = origin + (np.array([s.start for s in sl]) - m + 0.5) * p
    tag = np.full(len(faces), CUT_FACE, dtype=np.uint32)
    region = to_manifold(verts + offset, faces, tag)
    if region.volume() < 0:
        region = to_manifold(verts + offset, faces[:, ::-1], tag)
    return region


def _voxel_box(bbox, origin, p, shape, grow=1):
    lo = np.floor((np.array(bbox[:3]) - origin) / p).astype(int) - grow
    hi = np.ceil((np.array(bbox[3:]) - origin) / p).astype(int) + grow
    lo = np.maximum(lo, 0)
    hi = np.minimum(hi, shape)
    return tuple(slice(a, b) for a, b in zip(lo, hi))


def cut_pieces(orig, labels, occupied, origin, p, gap, min_piece, log=print, max_rounds=4):
    """
    Intersect the original with every colour's region, then fix what does not
    survive as a printable piece and re-cut only the colours that changed:
      - a piece under `min_piece` mm³ is relabelled to the colour around it;
      - an inner shell (a pocket sealed inside another piece) is filled with
        the enclosing colour, since that piece could never be assembled.
    Returns (pieces, folded) where pieces are dicts with slot, manifold, volume.
    """
    zone = ndimage.binary_dilation(occupied, structure=np.ones((3, 3, 3), bool), iterations=2)
    labels = labels.copy()
    folded: list[dict] = []
    by_slot: dict[int, list] = {}
    todo = {int(v) for v in np.unique(labels[occupied]) if v}
    for rnd in range(max_rounds):
        for c in sorted(todo):
            if not ((labels == c) & zone).any():
                by_slot.pop(c, None)
                continue
            region = region_solid(labels, zone, c, origin, p, gap)
            by_slot[c] = (orig ^ region).decompose()
        todo = set()
        for c, parts in by_slot.items():
            for piece in parts:
                v = piece.volume()
                box = _voxel_box(piece.bounding_box(), origin, p, labels.shape)
                sub = labels[box]
                if v < 0:
                    # Inner shell: whatever sits inside it becomes colour c.
                    others = (sub != c) & occupied[box]
                    changed = {int(x) for x in np.unique(sub[others])}
                    sub[others] = c
                    todo |= changed | {c}
                    folded.append({'colour_slot': sorted(changed), 'into_slot': c, 'volume_mm3': round(-v, 1), 'sealed': True,
                                   'at_mm': [round(float(x), 1) for x in (np.array(piece.bounding_box()[:3]) + piece.bounding_box()[3:]) / 2]})
                elif v < min_piece:
                    mine = sub == c
                    ring = ndimage.binary_dilation(mine, iterations=2) & ~mine & occupied[box]
                    neigh = sub[ring]
                    neigh = neigh[(neigh != 0) & (neigh != c)]
                    if len(neigh) == 0:
                        continue
                    target = int(np.bincount(neigh).argmax())
                    sub[mine] = target
                    todo |= {c, target}
                    folded.append({'colour_slot': c, 'into_slot': target, 'volume_mm3': round(v, 1), 'sealed': False,
                                   'at_mm': [round(float(x), 1) for x in (np.array(piece.bounding_box()[:3]) + piece.bounding_box()[3:]) / 2]})
        if not todo:
            break
        log(f'  round {rnd + 1}: re-cutting slots {sorted(todo)}')
    pieces = []
    for c, parts in sorted(by_slot.items()):
        pos = [m for m in parts if m.volume() > 0]
        neg = [m for m in parts if m.volume() <= 0]
        for n in neg:  # any shell still left goes back into the piece that holds it
            nb = n.bounding_box()
            host = max(pos, key=lambda m: _contains(m.bounding_box(), nb) * m.volume())
            pos[pos.index(host)] = m3d.Manifold.compose([host, n])
        for mf in pos:
            pieces.append({'slot': c, 'manifold': mf, 'volume': mf.volume()})
    return pieces, folded


def cut_by_id(orig, ids, slot_of, occupied, origin, p, gap, min_piece, log=print, max_rounds=3):
    """
    Like cut_pieces, but on piece ids (so two pieces of one colour stay apart).
    `ids` must already be extended past the surface (nearest occupied id).
    Crumbs under `min_piece` mm³ that the smooth cut leaves behind are given to
    the neighbouring piece and both are re-cut; inner shells (a crumb sealed
    inside a piece) are filled with the enclosing piece.
    """
    zone = ndimage.binary_dilation(occupied, structure=np.ones((3, 3, 3), bool), iterations=2)
    ids = ids.copy()
    by_id: dict[int, list] = {}
    todo = {int(v) for v in np.unique(ids[occupied]) if v}
    folded: list[dict] = []
    for rnd in range(max_rounds):
        for i in sorted(todo):
            if not ((ids == i) & zone).any():
                by_id.pop(i, None)
                continue
            by_id[i] = (orig ^ region_solid(ids, zone, i, origin, p, gap)).decompose()
        todo = set()
        for i, parts in by_id.items():
            for piece in parts:
                v = piece.volume()
                if v >= min_piece:
                    continue
                box = _voxel_box(piece.bounding_box(), origin, p, ids.shape)
                sub = ids[box]
                bb = piece.bounding_box()
                at = [round(float(x), 1) for x in (np.array(bb[:3]) + bb[3:]) / 2]
                if v < 0:
                    others = (sub != i) & occupied[box]
                    changed = {int(x) for x in np.unique(sub[others])}
                    sub[others] = i
                    todo |= changed | {i}
                    folded.append({'colour_slot': sorted(slot_of[c] for c in changed if c in slot_of), 'into_slot': slot_of[i],
                                   'volume_mm3': round(-v, 1), 'sealed': True, 'at_mm': at})
                else:
                    mine = sub == i
                    ring = ndimage.binary_dilation(mine, iterations=2) & ~mine & occupied[box]
                    neigh = sub[ring]
                    neigh = neigh[(neigh != 0) & (neigh != i)]
                    if len(neigh) == 0 or v < 1.0:
                        continue
                    target = int(np.bincount(neigh).argmax())
                    # Move only the crumb's own voxels, not the main piece sitting next to it.
                    mesh = piece.to_mesh()
                    box_origin = origin + np.array([s.start for s in box]) * p
                    crumb = inside_mask(np.array(mesh.vert_properties[:, :3], dtype=np.float64), np.array(mesh.tri_verts, dtype=np.int64),
                                        box_origin, p, sub.shape)
                    crumb = ndimage.binary_dilation(crumb) & mine
                    sub[crumb] = target
                    todo |= {i, target}
                    folded.append({'colour_slot': slot_of[i], 'into_slot': slot_of[target], 'volume_mm3': round(v, 1),
                                   'sealed': False, 'at_mm': at})
        if not todo:
            break
        log(f'  crumb round {rnd + 1}: re-cutting pieces {sorted(todo)}')
    pieces = []
    for i, parts in sorted(by_id.items()):
        pos = [m for m in parts if m.volume() > 0]
        neg = [m for m in parts if m.volume() <= 0]
        for n in neg:
            nb = n.bounding_box()
            host = max(pos, key=lambda m: _contains(m.bounding_box(), nb) * m.volume())
            pos[pos.index(host)] = m3d.Manifold.compose([host, n])
        for mf in pos:
            if mf.volume() >= 1.0:
                pieces.append({'id': i, 'slot': slot_of[i], 'manifold': mf, 'volume': mf.volume()})
    return pieces, folded, ids


def _contains(a, b) -> bool:
    return all(a[i] <= b[i] for i in range(3)) and all(a[i + 3] >= b[i + 3] for i in range(3))

"""Volumetric colour labels: which colour owns each voxel of the solid."""
from __future__ import annotations

import numpy as np
from scipy import ndimage


def inside_mask(V: np.ndarray, F: np.ndarray, origin: np.ndarray, p: float, shape: tuple[int, int, int]) -> np.ndarray:
    """
    Solid voxels by vertical ray casting with the non-zero winding rule: for
    every voxel column, find where it crosses the surface, keep a running
    winding count, and fill the spans where it is positive. Column centres are
    nudged by a tiny irrational offset so no ray runs exactly through an edge.
    """
    nx, ny, nz = shape
    A, B, C = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    gx0 = origin[0] + 0.5 * p + 1.37e-4 * p
    gy0 = origin[1] + 0.5 * p + 2.91e-4 * p
    gz0 = origin[2] + 0.5 * p
    xmin = np.minimum(np.minimum(A[:, 0], B[:, 0]), C[:, 0])
    xmax = np.maximum(np.maximum(A[:, 0], B[:, 0]), C[:, 0])
    ymin = np.minimum(np.minimum(A[:, 1], B[:, 1]), C[:, 1])
    ymax = np.maximum(np.maximum(A[:, 1], B[:, 1]), C[:, 1])
    i0 = np.ceil((xmin - gx0) / p).astype(np.int64)
    i1 = np.floor((xmax - gx0) / p).astype(np.int64)
    j0 = np.ceil((ymin - gy0) / p).astype(np.int64)
    j1 = np.floor((ymax - gy0) / p).astype(np.int64)
    ni = np.maximum(i1 - i0 + 1, 0)
    nj = np.maximum(j1 - j0 + 1, 0)
    cnt = ni * nj
    ids = np.nonzero(cnt)[0]
    c = cnt[ids]
    tri = np.repeat(ids, c)
    off = np.arange(len(tri)) - np.repeat(np.cumsum(c) - c, c)
    ii = i0[tri] + off // nj[tri]
    jj = j0[tri] + off % nj[tri]
    px = gx0 + ii * p
    py = gy0 + jj * p
    a, b, cc = A[tri], B[tri], C[tri]
    v0x, v0y = b[:, 0] - a[:, 0], b[:, 1] - a[:, 1]
    v1x, v1y = cc[:, 0] - a[:, 0], cc[:, 1] - a[:, 1]
    d = v0x * v1y - v0y * v1x
    wx, wy = px - a[:, 0], py - a[:, 1]
    with np.errstate(divide='ignore', invalid='ignore'):
        s = (wx * v1y - wy * v1x) / d
        t = (v0x * wy - v0y * wx) / d
        hit = (d != 0) & (s >= 0) & (t >= 0) & (s + t <= 1)
    s, t, d = s[hit], t[hit], d[hit]
    a, b, cc = a[hit], b[hit], cc[hit]
    z = a[:, 2] + s * (b[:, 2] - a[:, 2]) + t * (cc[:, 2] - a[:, 2])
    col = ii[hit] * ny + jj[hit]
    wind = np.where(d > 0, -1, 1).astype(np.int32)  # normal up = leaving the solid going up

    order = np.lexsort((z, col))
    col, z, wind = col[order], z[order], wind[order]
    cs = np.cumsum(wind)
    start = np.r_[True, col[1:] != col[:-1]]
    base = np.maximum.accumulate(np.where(start, np.arange(len(col)), 0))
    before = np.where(base > 0, cs[base - 1], 0)
    wn = cs - before  # winding number just above each crossing
    nxt_same = np.r_[col[1:] == col[:-1], False]
    k = np.nonzero((wn > 0) & nxt_same)[0]
    kz0 = np.ceil((z[k] - gz0) / p).astype(np.int64)
    kz1 = np.floor((z[k + 1] - gz0) / p).astype(np.int64)
    ok = kz0 <= kz1
    k, kz0, kz1 = k[ok], np.clip(kz0[ok], 0, nz), np.clip(kz1[ok] + 1, 0, nz)
    diff = np.zeros((nx * ny, nz + 1), dtype=np.int16)
    np.add.at(diff, (col[k], kz0), 1)
    np.add.at(diff, (col[k], kz1), -1)
    return (np.cumsum(diff, axis=1, dtype=np.int16)[:, :nz] > 0).reshape(nx, ny, nz)


def surface_seeds(V, F, E, origin, p, shape) -> np.ndarray:
    """Label each voxel a triangle's centroid falls in with the area-weighted majority colour."""
    A, B, C = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    area = 0.5 * np.linalg.norm(np.cross(B - A, C - A), axis=1)
    idx = np.floor(((A + B + C) / 3 - origin) / p).astype(np.int64)
    for k in range(3):
        idx[:, k] = np.clip(idx[:, k], 0, shape[k] - 1)
    lin = np.ravel_multi_index(idx.T, shape)
    K = int(E.max()) + 1
    key = lin * K + E.astype(np.int64)
    uk, inv = np.unique(key, return_inverse=True)
    wsum = np.bincount(inv, weights=area)
    vox, lab = uk // K, uk % K
    order = np.lexsort((-wsum, vox))
    vox, lab = vox[order], lab[order]
    first = np.r_[True, vox[1:] != vox[:-1]]
    seeds = np.zeros(int(np.prod(shape)), dtype=np.uint8)
    seeds[vox[first]] = lab[first]
    return seeds.reshape(shape)


def nearest_labels(known: np.ndarray, labels: np.ndarray) -> np.ndarray:
    """Every voxel takes the label of the nearest `known` voxel (exact Euclidean)."""
    ind = np.empty((3,) + known.shape, dtype=np.int32)
    ndimage.distance_transform_edt(~known, return_distances=False, return_indices=True, indices=ind)
    return labels[ind[0], ind[1], ind[2]]


def mode_filter(labels: np.ndarray, region: np.ndarray, passes: int = 2) -> np.ndarray:
    """3×3×3 majority vote among region voxels, to smooth ragged colour boundaries."""
    out = labels.copy()
    present = [int(v) for v in np.unique(out[region]) if v]
    for _ in range(passes):
        best = np.zeros(out.shape, dtype=np.float32)
        winner = out.copy()
        for c in present:
            f = ndimage.uniform_filter(((out == c) & region).astype(np.float32), size=3, mode='constant')
            better = f > best + 1e-6
            best[better] = f[better]
            winner[better] = c
        out = np.where(region, winner, 0).astype(np.uint8)
    return out


def merge_small(labels: np.ndarray, region: np.ndarray, p: float, min_volume: float, min_thickness: float, origin=None):
    """
    Fold colour islands into the neighbouring colour they share the most
    boundary with when they are too small or thin to print as their own piece,
    or when they never reach the outside (a pocket sealed inside another colour
    could never be assembled). Islands are face-connected, matching what
    survives as one physical piece. Returns the new labels and a list of what
    was folded, so those details can be painted instead.
    """
    out = labels.copy()
    folded: list[dict] = []
    s26 = np.ones((3, 3, 3), dtype=bool)
    s6 = ndimage.generate_binary_structure(3, 1)
    vox_vol = p ** 3
    for _round in range(3):
        changed = False
        comps = []
        for c in [int(v) for v in np.unique(out[region]) if v]:
            lab, n = ndimage.label((out == c) & region, structure=s6)
            if n == 0:
                continue
            sizes = np.bincount(lab.ravel())[1:]
            slices = ndimage.find_objects(lab)
            for k in range(n):
                comps.append((sizes[k], c, k + 1, slices[k], lab))
        comps.sort(key=lambda x: x[0])
        for size, c, k, sl, lab in comps:
            vol = size * vox_vol
            pad = tuple(slice(max(s.start - 2, 0), s.stop + 2) for s in sl)
            m = (lab[pad] == k) & (out[pad] == c)
            if not m.any():
                continue
            sealed = not (ndimage.binary_dilation(m, structure=s6) & ~region[pad]).any()
            if not sealed:
                if vol >= min_volume * 8:
                    continue  # clearly big enough; skip the thickness test
                thick = 2 * ndimage.distance_transform_edt(np.pad(m, 1)).max() * p
                if vol >= min_volume and thick >= min_thickness:
                    continue
            else:
                thick = 0.0
            ring = ndimage.binary_dilation(m, structure=s26) & ~m & region[pad]
            neigh = out[pad][ring]
            neigh = neigh[(neigh != 0) & (neigh != c)]
            if len(neigh) == 0:
                continue  # a separate body with nothing to merge into — keep it
            target = int(np.bincount(neigh).argmax())
            sub = out[pad]
            sub[m] = target
            out[pad] = sub
            at = (np.argwhere(m).mean(0) + [s.start for s in pad] + 0.5) * p + (0 if origin is None else origin)
            folded.append({'colour_slot': c, 'into_slot': target, 'volume_mm3': round(vol, 1), 'thickness_mm': round(thick, 2),
                           'sealed': sealed, 'at_mm': [round(float(x), 1) for x in at]})
            changed = True
        if not changed:
            break
    return out, folded

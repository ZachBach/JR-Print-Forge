"""
Make the colour partition assemblable.

A piece can slide out along direction d only if nothing still in place lies
ahead of it along d. The planner takes pieces out one at a time, preferring
the top of the figure, and for each looks for a direction where every voxel
ahead of it is empty or hidden interior of another piece. Those interior
voxels are handed to the moving piece so it slides out cleanly; painted
surface voxels never change hands.

When nothing can come out, the layers genuinely interleave (a coat front over
trousers, a collar behind a coat collar). Then, like a model kit, the largest
stuck piece is cut in two along the plane that frees one half. Only small
stuck pieces are merged into a neighbour instead (a quick paint job).

Works on piece ids, not colours: two halves of a coat are separate pieces
of the same colour.
"""
from __future__ import annotations

import itertools

import numpy as np
from scipy import ndimage

DIRS = sorted(
    [d for d in itertools.product((-1, 0, 1), repeat=3) if any(d)],
    key=lambda d: (d[2] < 0, sum(map(abs, d)), -d[2]),
)


def _shift(a: np.ndarray, d, k: int) -> np.ndarray:
    out = np.zeros_like(a)
    src, dst = [], []
    for ax, s in enumerate(d):
        n = a.shape[ax]
        o = s * k
        if abs(o) >= n:
            return out
        if o >= 0:
            src.append(slice(0, n - o)); dst.append(slice(o, n))
        else:
            src.append(slice(-o, n)); dst.append(slice(0, n + o))
    out[tuple(dst)] = a[tuple(src)]
    return out


def ahead_of(P: np.ndarray, d) -> np.ndarray:
    """Every voxel on or ahead of P along d (lattice lines), by doubling."""
    A = P.copy()
    k = 1
    n = max(P.shape)
    while k < n:
        A |= _shift(A, d, k)
        k *= 2
    return A


def _crop(mask: np.ndarray, d, shape):
    sl = ndimage.find_objects(mask.astype(np.uint8))[0]
    out = []
    for ax, s in enumerate(d):
        lo, hi = sl[ax].start, sl[ax].stop
        if s > 0: hi = shape[ax]
        if s < 0: lo = 0
        out.append(slice(lo, hi))
    return tuple(out)


def best_direction(P, pid, S, fixed, ids, shape):
    """Cheapest conflict-free direction for piece P: (stolen voxels, d, box, extra) or None."""
    best = None
    for d in DIRS:
        box = _crop(P, d, shape)
        Pc = P[box]
        A = ahead_of(Pc, d) & S[box]
        extra = A & ~Pc
        if (extra & fixed[box] & (ids[box] != pid)).any():
            continue
        stolen = int(extra.sum())
        if best is None or stolen < best[0]:
            best = (stolen, d, box, extra)
            if stolen == 0:
                break
    return best


def _neighbours(ids, S, i):
    """Remaining pieces touching piece i, with the number of touching voxels."""
    m = (ids == i) & S
    ring = ndimage.binary_dilation(m) & ~m & S
    touch = ids[ring]
    touch = touch[(touch != 0) & (touch != i)]
    if len(touch) == 0:
        return {}, int((m & ~ndimage.binary_erosion(m)).sum())
    u, c = np.unique(touch, return_counts=True)
    return dict(zip(u.tolist(), c.tolist())), int((m & ~ndimage.binary_erosion(m)).sum())


def plan(ids: np.ndarray, slot_of: dict, occupied: np.ndarray, fixed: np.ndarray, p: float,
         max_steal: float = 0.25, merge_below_mm3: float = 3000.0, max_splits: int = 12,
         max_colours: int = 1, log=print):
    """
    ids: int16 piece id per voxel (0 = empty); slot_of: piece id -> filament slot.
    max_colours: filaments one piece may use. 2 = one per nozzle on a dual-nozzle
    printer (Bambu H2D, Prusa XL, IDEX): neighbouring pieces are merged into one
    two-colour piece when that frees an interlock or simply makes a sturdier
    part, so far fewer cuts are needed.
    Returns (ids, slot_of, colours, steps, merged, splits); colours maps piece id
    -> set of slots, slot_of the piece's main slot. steps are in removal order.
    """
    ids = ids.copy()
    slot_of = dict(slot_of)
    S = occupied.copy()
    remaining = set(slot_of)
    colvol = {i: {slot_of[i]: int((ids == i).sum())} for i in slot_of}
    steps, merged, splits = [], [], []
    shape = ids.shape
    vox = p ** 3
    coords = None

    def colours(i):
        return set(colvol[i])

    def absorb(i, j):
        """Merge piece j into piece i."""
        ids[ids == j] = i
        for c, v in colvol.pop(j).items():
            colvol[i][c] = colvol[i].get(c, 0) + v
        slot_of[i] = max(colvol[i], key=colvol[i].get)
        remaining.discard(j)

    def try_union(i, j):
        """Best removal of i and j together, or None."""
        trial = ids.copy()
        trial[trial == j] = i
        U = (trial == i) & S
        b = best_direction(U, i, S, fixed, trial, shape)
        if b is None or b[0] > max_steal * int(U.sum()):
            return None
        return b

    while remaining:
        vols = {i: int(((ids == i) & S).sum()) for i in remaining}
        for i in [i for i, v in vols.items() if v == 0]:
            remaining.discard(i)
        if not remaining:
            break
        zmax = {i: np.nonzero(((ids == i) & S).any(axis=(0, 1)))[0].max() for i in remaining}
        choice, fallback = None, None
        for i in sorted(remaining, key=lambda i: -zmax[i]):
            P = (ids == i) & S
            best = best_direction(P, i, S, fixed, ids, shape)
            if best is None:
                continue
            if best[0] <= max_steal * vols[i]:
                choice = (i, best)
                break
            if fallback is None or best[0] / vols[i] < fallback[1][0] / vols[fallback[0]]:
                fallback = (i, best)
        if choice is None:
            choice = fallback
        if choice is not None and max_colours > 1:
            # Grow the piece into firmly attached neighbours while it stays within
            # the nozzle budget and can still slide out: fewer, sturdier pieces.
            i = choice[0]
            while True:
                neigh, edge = _neighbours(ids, S, i)
                grown = False
                for j, n in sorted(neigh.items(), key=lambda kv: -kv[1]):
                    if j not in remaining or len(colours(i) | colours(j)) > max_colours:
                        continue
                    _, edge_j = _neighbours(ids, S, j)
                    if n < 0.08 * min(edge, edge_j):
                        continue  # barely touching; keep them separate
                    b = try_union(i, j)
                    if b is None:
                        continue
                    log(f'    joined piece {j} (slots {sorted(colours(j))}) onto piece {i} (slots {sorted(colours(i))})')
                    absorb(i, j)
                    choice = (i, b)
                    grown = True
                    break
                if not grown:
                    break
        if choice is not None:
            i, (stolen, d, box, extra) = choice
            sub = ids[box]
            sub[extra] = i
            ids[box] = sub
            P = (ids == i) & S
            S &= ~P
            remaining.discard(i)
            steps.append({'piece': i, 'slot': slot_of[i], 'colours': sorted(colours(i)), 'out_direction': list(d),
                          'centroid_vox': np.argwhere(P).mean(0).tolist(),
                          'volume_mm3': round(P.sum() * vox, 1), 'stolen_mm3': round(stolen * vox, 1)})
            log(f'    out: piece {i:3d} slot {slot_of[i]:2d} ({P.sum() * vox:8.0f} mm³) along {d}, took {stolen * vox:.0f} mm³ of hidden interior')
            continue

        # Stuck. First choice with a spare nozzle: print two interlocked pieces as
        # one two-colour piece. Pick the pair that comes out with least disturbance.
        if max_colours > 1:
            best_pair = None
            for i in remaining:
                neigh, _ = _neighbours(ids, S, i)
                for j in neigh:
                    if j not in remaining or j < i or len(colours(i) | colours(j)) > max_colours:
                        continue
                    b = try_union(i, j)
                    if b is not None:
                        score = b[0] / max(vols[i] + vols[j], 1)
                        if best_pair is None or score < best_pair[0]:
                            best_pair = (score, i, j)
            if best_pair is not None:
                _, i, j = best_pair
                log(f'    stuck: printing pieces {i} and {j} as one piece (slots {sorted(colours(i) | colours(j))})')
                absorb(i, j)
                continue

        # Merge a small piece, or split the biggest one like a kit part.
        smallest = min(remaining, key=lambda j: vols[j])
        if vols[smallest] * vox <= merge_below_mm3 or len(splits) >= max_splits:
            i = smallest
            P = (ids == i) & S
            ring = ndimage.binary_dilation(P) & ~P & S
            neigh = ids[ring]
            neigh = neigh[(neigh != 0) & (neigh != i)]
            if len(neigh) == 0:
                log(f'    piece {i} is stuck and isolated; leaving it in place')
                remaining.discard(i)
                continue
            target = int(np.bincount(neigh).argmax())
            ids[P] = target
            remaining.discard(i)
            colvol.pop(i, None)  # painted by hand: not one of the target's filaments
            merged.append({'piece': i, 'slot': slot_of[i], 'into_piece': target, 'into_slot': slot_of[target],
                           'volume_mm3': round(P.sum() * vox, 1), 'centroid_vox': np.argwhere(P).mean(0).tolist()})
            log(f'    stuck: merged piece {i} (slot {slot_of[i]}, {P.sum() * vox:.0f} mm³) into slot {slot_of[target]} — paint it')
            continue

        if coords is None:
            coords = np.indices(shape, dtype=np.int16)
        # Resolve the smallest interlock first: splitting a small piece that
        # locks a big one (hair around a head) frees far more than slicing the
        # big one (a coat) again and again around it.
        best_split = None
        for i in sorted(remaining, key=lambda j: vols[j]):
            P = (ids == i) & S
            ctr = np.argwhere(P).mean(0)
            for axis in (0, 1, 2):
                lo_half = P & (coords[axis] < ctr[axis])
                hi_half = P & ~lo_half
                if lo_half.sum() < 0.1 * P.sum() or hi_half.sum() < 0.1 * P.sum():
                    continue
                trial = ids.copy()
                new_id = max(slot_of) + 1
                trial[hi_half] = new_id
                for half, hid in ((lo_half, i), (hi_half, new_id)):
                    b = best_direction(half, hid, S, fixed, trial, shape)
                    if b is not None and (best_split is None or b[0] < best_split[0]):
                        best_split = (b[0], i, axis, ctr[axis], hi_half)
            if best_split is not None:
                break
        if best_split is None:
            # No single cut frees anything: split the biggest piece left/right anyway and keep going.
            i = max(remaining, key=lambda j: vols[j])
            P = (ids == i) & S
            ctr = np.argwhere(P).mean(0)
            best_split = (None, i, 0, ctr[0], P & (coords[0] >= ctr[0]))
        _, i, axis, at, hi_half = best_split
        new_id = max(slot_of) + 1
        ids[hi_half] = new_id
        slot_of[new_id] = slot_of[i]
        colvol[new_id] = dict(colvol[i])
        remaining.add(new_id)
        splits.append({'piece': i, 'slot': slot_of[i], 'axis': 'xyz'[axis], 'at_vox': float(at), 'new_piece': new_id})
        log(f'    stuck: split piece {i} (slot {slot_of[i]}) across the {"xyz"[axis]} axis into pieces {i} and {new_id}')
    present = {int(v) for v in np.unique(ids[occupied]) if v}
    return ids, slot_of, {i: sorted(colvol[i]) for i in present if i in colvol}, steps, merged, splits

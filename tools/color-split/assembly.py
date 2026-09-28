"""Check the planned assembly on the finished meshes."""
from __future__ import annotations

import numpy as np
from scipy import ndimage

from labels import inside_mask


def direction_name(d) -> str:
    """Where a piece comes from, facing the figure. It faces -Y; +X is your right."""
    parts = []
    if d[2] > 0: parts.append('above')
    if d[2] < 0: parts.append('below')
    if d[1] < 0: parts.append('the front')
    if d[1] > 0: parts.append('the back')
    if d[0] > 0: parts.append('your right')
    if d[0] < 0: parts.append('your left')
    return 'from ' + ' and '.join(parts)


def verify(pieces, steps, p=0.3, tolerance_vox=1, log=print):
    """
    pieces: [{'id', 'name', 'V', 'F'}]; steps: removal order [{'piece', 'out_direction'}].
    Voxelise every finished piece at `p`, then take them out in order: each
    piece, shrunk by `tolerance_vox` voxels (the play a glue gap and FDM
    tolerance give you), must slide along its direction until it is clear
    without touching any piece still in place. Returns a list of results.
    """
    allV = np.concatenate([pc['V'] for pc in pieces])
    origin = allV.min(0) - 4 * p
    shape = tuple(int(np.ceil(x)) for x in (allV.max(0) - origin) / p + 4)
    grid = np.zeros(shape, np.int16)
    for pc in pieces:
        m = inside_mask(pc['V'], pc['F'], origin, p, shape)
        grid[m & (grid == 0)] = pc['id']
    names = {}
    for pc in pieces:
        names.setdefault(pc['id'], pc['name'])
    lim = np.array(shape)
    results = []
    for st in steps:
        pid, d = st['piece'], np.array(st['out_direction'])
        m = grid == pid
        if not m.any():
            results.append({'piece': pid, 'ok': True, 'note': 'no voxels'})
            continue
        core = ndimage.binary_erosion(m, iterations=tolerance_vox) if tolerance_vox else m
        if not core.any():
            core = m
        pts = np.argwhere(core & ~ndimage.binary_erosion(core))
        blocked = None
        for k in range(1, int(lim.max()) + 1):
            q = pts + k * d
            ok = np.all((q >= 0) & (q < lim), axis=1)
            if not ok.any():
                break
            hit = grid[q[ok, 0], q[ok, 1], q[ok, 2]]
            bad = (hit != 0) & (hit != pid)
            if bad.any():
                u, c = np.unique(hit[bad], return_counts=True)
                blocked = {'at_step_mm': round(k * p * float(np.linalg.norm(d)), 1),
                           'by': {names.get(int(a), str(a)): int(b) for a, b in zip(u, c)}}
                break
        grid[m] = 0
        results.append({'piece': pid, 'name': names.get(pid, str(pid)), 'ok': blocked is None, 'blocked': blocked})
        log(f"    {'ok     ' if blocked is None else 'BLOCKED'} {names.get(pid, pid)} out {direction_name(d)}" +
            ('' if blocked is None else f" — hits {blocked['by']} after {blocked['at_step_mm']} mm"))
    return results

#!/usr/bin/env python3
"""
Split a painted multi-colour 3MF (Bambu Studio / PrusaSlicer) into pieces that
each print with one filament — or two, one per nozzle, on a dual-nozzle printer
(Bambu H2D, Prusa XL, IDEX) — and glue back together. No filament changes
inside a print means no purge and no colour bleed. (One-filament plates need no
prime tower either; two-nozzle plates still get one for the nozzle switch.)

    python split_by_color.py model.3mf out/ --colours-per-piece 2 --drop-slot 10

How it works
  1. Read the mesh and each triangle's painted filament slot. --drop-slot
     recolours a stray slot to whatever surrounds it.
  2. Voxelise the solid and give every inside voxel the colour of the nearest
     painted surface, so the interior is divided the way the outside looks.
  3. Tidy: smooth ragged boundaries; fold islands too small to handle into
     their neighbour.
  4. Plan the assembly: pieces come out one at a time along a straight line.
     With two colours per piece, pieces that are firmly joined or locked
     together are printed as one two-colour piece; only where that is not
     enough is a piece cut in two like a kit part, and only small leftovers
     are merged and listed for paint.
  5. Cut each piece from the original with a `gap` mm glue clearance. The
     outside keeps the original triangles, and each keeps its painted colour.
  6. Check: every piece is a closed solid, nothing overlaps, and the glue-up
     order is re-checked on the finished pieces.

Outputs in out_dir: plates/*.3mf (everything that prints with the same one or
two filaments), <name>-assembly.3mf (every piece in place), PRINT-SHEET.md,
pieces.json, preview.glb.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time

import numpy as np
import manifold3d as m3d
from scipy import ndimage

from load3mf import load
from labels import inside_mask, surface_seeds, nearest_labels, mode_filter, merge_small
from cut import CUT_FACE, to_manifold, cut_by_id
from plan import plan
from assembly import verify, direction_name
from write3mf import write_3mf

NAMES = {
    'black': '#000000', 'white': '#FFFFFF', 'grey': '#8E8E8E', 'red': '#C0282D', 'orange': '#F07F1A',
    'yellow': '#F4D03F', 'gold': '#D9B45A', 'green': '#1FA34A', 'blue': '#1F5FBF', 'purple': '#5B1FB0',
    'pink': '#E890B0', 'skin': '#EFC9B6', 'beige': '#D2C2A0', 'tan': '#C98E50', 'brown': '#8C6440',
    'dark-brown': '#5A3E2B',
}


def colour_name(hex_: str) -> str:
    rgb = np.array([int(hex_[i:i + 2], 16) for i in (1, 3, 5)], float)
    return min(NAMES, key=lambda n: np.sum((rgb - [int(NAMES[n][i:i + 2], 16) for i in (1, 3, 5)]) ** 2))


def recolour_dropped(F: np.ndarray, E: np.ndarray, drop: list[int]) -> np.ndarray:
    """Give triangles of dropped slots the majority colour of their neighbours, growing inward."""
    E = E.copy()
    if not np.isin(E, drop).any():
        return E
    e = np.sort(np.stack([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]], 1).reshape(-1, 2), axis=1).astype(np.int64)
    tri = np.repeat(np.arange(len(F)), 3)
    key = e[:, 0] * (int(F.max()) + 1) + e[:, 1]
    order = np.argsort(key, kind='stable')
    key, tri = key[order], tri[order]
    same = key[1:] == key[:-1]
    a, b = tri[:-1][same], tri[1:][same]
    for _ in range(200):
        bad = np.isin(E, drop)
        if not bad.any():
            break
        m1, m2 = bad[a] & ~bad[b], bad[b] & ~bad[a]
        tgt = np.concatenate([a[m1], b[m2]])
        col = np.concatenate([E[b[m1]], E[a[m2]]]).astype(np.int64)
        if len(tgt) == 0:
            break
        u, c = np.unique(tgt.astype(np.int64) * 256 + col, return_counts=True)
        t, cc = u // 256, u % 256
        o = np.lexsort((-c, t))
        t, cc = t[o], cc[o]
        first = np.r_[True, t[1:] != t[:-1]]
        E[t[first]] = cc[first]
    return E


def foreign_spots(built, names, min_area=2.0, min_width=0.8):
    """
    Exact paint list: on each piece, the connected patches of outside surface
    whose original colour that piece cannot print. Slivers along seams (where a
    colour boundary moved by a fraction of a millimetre) are left out: a patch
    must cover `min_area` mm² and be at least `min_width` mm wide on average.
    """
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components

    spots = []
    for b in built:
        f = np.nonzero(b['foreign'])[0]
        if len(f) == 0:
            continue
        F, V = b['F'][f], b['V']
        cols = b['orig_col'][f]
        area = 0.5 * np.linalg.norm(np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]), axis=1)
        k = len(f)
        rows = np.repeat(np.arange(k), 3)
        g = coo_matrix((np.ones(3 * k), (rows, k + F.ravel())), shape=(k + len(V), k + len(V)))
        _, comp = connected_components(g, directed=False)
        comp = comp[:k]
        for c in np.unique(comp):
            for col in np.unique(cols[comp == c]):
                m = (comp == c) & (cols == col)
                a = float(area[m].sum())
                pts = V[F[m]].reshape(-1, 3)
                extent = float((pts.max(0) - pts.min(0)).max()) or 1.0
                if a < min_area or a / extent < min_width:
                    continue
                ctr = (V[F[m]].mean(1) * area[m, None]).sum(0) / max(area[m].sum(), 1e-9)
                spots.append({'paint_slot': int(col), 'on_piece': names[id(b)], 'area_mm2': round(a, 1),
                              'size_mm': round(2 * np.sqrt(a / np.pi), 1), 'at_mm': [round(float(x), 1) for x in ctr]})
    return spots


def group_plates(built, per_plate: int) -> dict[tuple, list]:
    """
    Group pieces onto as few plates as possible, each plate using at most
    `per_plate` filaments: two-colour pieces anchor plates, one-colour pieces
    ride along on a plate that already loads their filament, and leftover
    one-colour groups pair up (one filament per nozzle).
    """
    groups: dict[tuple, list] = {}
    for b in built:
        groups.setdefault(tuple(b['used']), []).append(b)
    if per_plate < 2:
        return groups
    plates = {k: v for k, v in groups.items() if len(k) >= 2}
    singles = sorted(((k, v) for k, v in groups.items() if len(k) == 1),
                     key=lambda kv: -sum(b['pc']['volume'] for b in kv[1]))
    left, riders = [], []
    for k, v in singles:
        hosts = [p for p in plates if k[0] in p]
        if hosts:
            host = min(hosts, key=lambda p: sum(b['pc']['volume'] for b in plates[p]))
            plates[host] += v
            riders.append((k, v, host))
        else:
            left.append((k, v))
    # A lone one-colour plate has a free nozzle: give it the rider from the
    # heaviest plate instead, so plate count stays the same and loads even out.
    vol = lambda items: sum(b['pc']['volume'] for b in items)
    for idx, (k, v) in enumerate(list(left)):
        cands = [r for r in riders if r[0] != k]
        if not cands:
            continue
        rk, rv, host = max(cands, key=lambda r: vol(plates[r[2]]))
        plates[host] = [b for b in plates[host] if b not in rv]
        riders.remove((rk, rv, host))
        plates[tuple(sorted(k + rk))] = v + rv
        left[idx] = None
    left = [x for x in left if x is not None]
    while left:
        k, v = left.pop(0)
        if left:
            k2, v2 = left.pop(0)
            plates[tuple(sorted(k + k2))] = v + v2
        else:
            plates[k] = v
    return plates


def slot_label(slot, colours):
    hex_ = colours[slot - 1] if slot - 1 < len(colours) else '#808080'
    return f'{hex_} {colour_name(hex_)} (slot {slot})'


def print_sheet(s, colours) -> str:
    per = s['settings']['colours_per_piece']
    lines = [
        f"# {s['source']} — print sheet",
        '',
        f"{len(s['pieces'])} pieces that glue back into the {s['size_mm'][0]} × {s['size_mm'][1]} × {s['size_mm'][2]} mm figure, "
        f"in {len(s['slots'])} colours. "
        + ('Each file in `plates/` prints with at most two filaments, one per nozzle, so no filament is ever swapped '
           'or purged mid-print. The slicer still adds a prime tower when a plate switches nozzles; see Printing.' if per > 1 else
           'Each file in `plates/` prints with a single filament: no colour changes, no purge, no prime tower.'),
        '',
        f"Checks: every piece is a closed solid; pieces overlap by {s['checks']['overlap_mm3']} mm³; "
        f"{s['checks']['pieces_cm3']} of {s['checks']['original_cm3']} cm³ kept (the rest is the "
        f"{s['settings']['gap_per_side_mm']} mm-per-side glue gap).",
        '',
        '## Plates',
        '',
        '| File | Filaments | Pieces | Volume |',
        '| --- | --- | --- | --- |',
    ]
    plates = {}
    for r in s['pieces']:
        plates.setdefault(r['plate'], []).append(r)
    for plate, rs in plates.items():
        fil = ' + '.join(slot_label(c, colours) for c in rs[0]['plate_filaments'])
        lines.append(f"| `plates/{plate}.3mf` | {fil} | {len(rs)} | {sum(r['volume_cm3'] for r in rs):.1f} cm³ |")
    lines += ['', '## Pieces', '', '| Piece | Filaments | Size (mm) | Height in figure (mm) | Volume |', '| --- | --- | --- | --- | --- |']
    for r in sorted(s['pieces'], key=lambda r: (r['z_range_mm'][0], -r['volume_cm3'])):
        lines.append(f"| {r['name']} | {' + '.join(colour_name(colours[c - 1]) for c in r['filaments'])} | "
                     f"{' × '.join(str(x) for x in r['size_mm'])} | {r['z_range_mm'][0]}–{r['z_range_mm'][1]} | {r['volume_cm3']} cm³ |")

    order = s.get('assembly_order', [])
    if order:
        ok = all(o['verified'] for o in order)
        lines += ['', '## Glue-up order', '',
                  ('Checked on the finished pieces: in this order every piece slides straight into place — no twisting, '
                   'nothing to force — with 0.3 mm of play.' if ok else
                   'Checked on the finished pieces. Steps marked ⚠ bind slightly; dry-fit those and sand the hidden '
                   'join face until they seat.'),
                  'Directions are as you face him: "from your right" means it comes in from your right-hand side.', '']
        for n, o in enumerate(order, 1):
            what = ' + '.join(f'**{x}**' for x in o['pieces'])
            how = 'the starting piece' if n == 1 else f"goes on {o['from']}"
            lines.append(f"{n}. {what} — {how}{'' if o['verified'] else ' ⚠'}")
    if s.get('kit_splits'):
        lines += ['', f"{len(s['kit_splits'])} piece(s) were cut in two like a model kit where layers interleave. "
                  'Those halves glue together along a seam you can fill and sand.']

    lines += ['', '## Details to paint', '']
    if s['paint']:
        lines += ['Merged into the piece around them — too small to print on their own, or a third colour the piece '
                  'cannot take. Paint them in the original colour.', '']
        for p in sorted(s['paint'], key=lambda p: (not p.get('whole_part'), -p['at_mm'][2])):
            size = f"a whole part, ~{p['size_mm']} mm" if p.get('whole_part') else f"~{p['size_mm']} mm across"
            lines.append(f"- {slot_label(p['paint_slot'], colours)} on **{p['on_piece']}**, {size}, {p['at_mm'][2]} mm up from the base")
    else:
        lines.append('None.')

    lines += ['', '## Printing', '',
              '- The pieces keep the original filament slot numbers, and two-colour pieces carry their colour painting in '
              'the file. Easiest: open your original project (so slots 1–9 are already the right filaments), delete '
              'the model, then import one plate file at a time. Glance at it in the colour-paint view before slicing.',
              *(['- Two-filament plates get a prime tower for the nozzle switches (Bambu Studio default). '
                 'Turning it off (Others → Prime tower) saves most of the waste; if the first lines after a '
                 'switch come out thin or blobby, turn it back on.'] if per > 1 else []),
              '- Pieces come in the pose they sit in the figure, so on a plate they overlap: press *Arrange* first. '
              'Use *Lay on face* on a flat join face for small '
              'pieces; the base prints flat side down; tall pieces print upright with tree supports.',
              f"- Dry-fit before gluing. Every join has {s['settings']['gap_per_side_mm']} mm of clearance per side for glue — "
              'gel CA or 5-minute epoxy. The join faces are hidden inside the figure.',
              '', f"Settings: {per} colour(s) per piece, voxel {s['settings']['voxel_mm']} mm, gap {s['settings']['gap_per_side_mm']} mm "
              f"per side, smallest separate piece {s['settings']['min_piece_mm3']} mm³"
              + (f", dropped slot(s) {s['settings']['dropped_slots']}" if s['settings']['dropped_slots'] else '') + '.', '']
    return '\n'.join(lines)


def main() -> None:
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('model')
    ap.add_argument('out')
    ap.add_argument('--colours-per-piece', type=int, default=1, choices=(1, 2),
                    help='filaments one piece may use: 1, or 2 for a dual-nozzle printer (default 1)')
    ap.add_argument('--drop-slot', type=int, action='append', default=[],
                    help='filament slot to remove; its triangles take the surrounding colour (repeatable)')
    ap.add_argument('--voxel', type=float, default=0.5, help='interior grid pitch, mm (default 0.5)')
    ap.add_argument('--gap', type=float, default=0.1, help='clearance per side between pieces, mm (default 0.1)')
    ap.add_argument('--min-piece', type=float, default=120.0, help='smallest separate piece, mm³ (default 120)')
    args = ap.parse_args()

    t0 = time.time()
    log = lambda *a: print(f'[{time.time() - t0:6.1f}s]', *a, flush=True)
    base = re.sub(r'\.3mf$', '', os.path.basename(args.model), flags=re.I)
    os.makedirs(os.path.join(args.out, 'plates'), exist_ok=True)

    model = load(args.model)
    V, F, E, colours = model.vertices, model.faces, model.extruder, model.colours
    if args.drop_slot:
        n = int(np.isin(E, args.drop_slot).sum())
        E = recolour_dropped(F, E, args.drop_slot)
        log(f'dropped slot(s) {args.drop_slot}: {n} triangles took their surrounding colour')
    slots = sorted(int(s) for s in np.unique(E))
    size = V.max(0) - V.min(0)
    log(f'{base}: {len(F):,} triangles, {size[0]:.1f} × {size[1]:.1f} × {size[2]:.1f} mm, {len(slots)} colours')
    orig = to_manifold(V, F, np.arange(len(F), dtype=np.uint32))
    if orig.status() != m3d.Error.NoError:
        raise SystemExit(f'The model is not a closed solid ({orig.status()}); repair it in the slicer first.')

    p = args.voxel
    pad = 4
    lo = V.min(0) - pad * p
    shape = tuple(int(np.ceil(x)) for x in (V.max(0) - lo) / p + pad)
    inside = inside_mask(V, F, lo, p, shape)
    log(f'voxels {shape}: solid {inside.sum() * p ** 3 / 1000:.1f} cm³ vs mesh {orig.volume() / 1000:.1f} cm³')
    seeds = surface_seeds(V, F, E, lo, p, shape)
    occupied = inside | (seeds > 0)
    lab = np.where(occupied, nearest_labels(seeds > 0, seeds), 0).astype(np.uint8)
    lab = mode_filter(lab, occupied, passes=2)
    lab, folded = merge_small(lab, occupied, p, min_volume=args.min_piece, min_thickness=1.2, origin=lo)
    log(f'interior labelled; {len(folded)} small islands folded')

    ids = np.zeros(shape, np.int16)
    slot_of: dict[int, int] = {}
    for c in [int(v) for v in np.unique(lab[occupied]) if v]:
        cl, k = ndimage.label((lab == c) & occupied)
        for j in range(1, k + 1):
            n = len(slot_of) + 1
            ids[cl == j] = n
            slot_of[n] = c
    fixed = occupied & ~ndimage.binary_erosion(occupied)  # the painted outside
    log(f'planning assembly for {len(slot_of)} colour regions, up to {args.colours_per_piece} colour(s) per piece')
    ids, slot_of, piece_cols, steps, merged, splits = plan(
        ids, slot_of, occupied, fixed, p, max_colours=args.colours_per_piece, log=log)
    log(f'plan: {len(steps)} pieces, {len(splits)} kit splits, {len(merged)} merged for paint')

    pieces, folded2, _ = cut_by_id(orig, nearest_labels(occupied, ids), slot_of, occupied, lo, p, args.gap, args.min_piece, log=log)
    folded += folded2
    for pc in pieces:
        assert pc['manifold'].status() == m3d.Error.NoError
    total = sum(pc['volume'] for pc in pieces)
    union = m3d.Manifold.batch_boolean([pc['manifold'] for pc in pieces], m3d.OpType.Add).volume()
    overlap = total - union
    log(f'cut into {len(pieces)} pieces: {total / 1000:.2f} cm³, overlap {overlap:.2f} mm³, '
        f'glue gaps {(orig.volume() - total) / orig.volume() * 100:.2f}%')

    # Colour every triangle: its original paint where the piece prints that
    # filament, otherwise (and on the hidden cut faces) the piece's main filament.
    built = []
    for pc in pieces:
        mesh = pc['manifold'].to_mesh()
        Vp, Fp = np.array(mesh.vert_properties[:, :3]), np.array(mesh.tri_verts)
        fid = np.array(mesh.face_id)
        allowed = piece_cols.get(pc['id'], [pc['slot']])
        main_slot = slot_of[pc['id']] if slot_of[pc['id']] in allowed else allowed[0]
        states = np.full(len(Fp), main_slot, dtype=np.int16)
        src = fid != CUT_FACE
        orig_col = np.full(len(Fp), -1, dtype=np.int16)
        orig_col[src] = E[fid[src]]
        good = src & np.isin(orig_col, allowed)
        states[good] = orig_col[good]
        foreign = src & ~good  # outside surface in a colour this piece cannot print
        if good.any() and (~good).any():
            # Everything else — hidden join faces and foreign-coloured patches —
            # takes the colour of the nearest surface the piece does print, so a
            # seam never shows a stripe of the other filament and a patch blends
            # into what surrounds it (then it goes on the paint list).
            from scipy.spatial import cKDTree
            cen = Vp[Fp].mean(1)
            _, nn = cKDTree(cen[good]).query(cen[~good])
            states[~good] = states[good][nn]
        used = sorted(int(s) for s in np.unique(states))
        built.append({'pc': pc, 'V': Vp, 'F': Fp, 'states': states, 'used': used, 'main': main_slot,
                      'foreign': foreign, 'orig_col': orig_col})

    plates = group_plates(sorted(built, key=lambda b: (b['used'], -b['pc']['volume'])), args.colours_per_piece)
    records, assembly = [], []
    names_by_built: dict[int, str] = {}
    for used, group in plates.items():
        cname = '-'.join(colour_name(colours[c - 1]) for c in used)
        plate = f"plate-slot{'+'.join(map(str, used))}-{cname}"
        objs = []
        counts: dict[tuple, int] = {}
        for b in group:
            counts[tuple(b['used'])] = counts.get(tuple(b['used']), 0) + 1
        seen: dict[tuple, int] = {}
        for b in sorted(group, key=lambda b: (b['used'], -b['pc']['volume'])):
            bb = b['pc']['manifold'].bounding_box()
            key = tuple(b['used'])
            seen[key] = seen.get(key, 0) + 1
            pname = f"slot{'+'.join(map(str, key))}-{'-'.join(colour_name(colours[c - 1]) for c in key)}"
            name = pname + (f'-{seen[key]}' if counts[key] > 1 else '')
            names_by_built[id(b)] = name
            o = {'name': name, 'colour': colours[b['main'] - 1], 'V': b['V'], 'F': b['F'],
                 'states': b['states'], 'id': b['pc']['id'], 'mf': b['pc']['manifold']}
            objs.append(o)
            assembly.append(o)
            records.append({
                'name': name, 'plate': plate, 'piece_id': b['pc']['id'], 'filaments': list(key), 'plate_filaments': list(used),
                'volume_cm3': round(b['pc']['volume'] / 1000, 2), 'triangles': int(len(b['F'])),
                'size_mm': [round(bb[i + 3] - bb[i], 1) for i in range(3)],
                'z_range_mm': [round(bb[2], 1), round(bb[5], 1)], 'bbox': [round(float(x), 2) for x in bb],
            })
        write_3mf(os.path.join(args.out, 'plates', f'{plate}.3mf'), objs, f'{base} — {plate}')
    write_3mf(os.path.join(args.out, f'{base}-assembly.3mf'), assembly, f'{base} — assembly')
    log(f'{len(plates)} plate files written')

    log('verifying the glue-up order on the finished pieces (0.3 mm grid)')
    results = verify([{'id': o['id'], 'name': o['name'], 'V': o['V'].astype(np.float64), 'F': o['F'].astype(np.int64)}
                      for o in assembly], steps, p=0.3, tolerance_vox=1, log=log)
    names_of: dict[int, list] = {}
    for r in records:
        names_of.setdefault(r['piece_id'], []).append(r['name'])
    order = [{'pieces': names_of.get(st['piece'], [str(st['piece'])]), 'from': direction_name(st['out_direction']),
              'verified': res['ok'], 'blocked': res.get('blocked')}
             for st, res in zip(reversed(steps), reversed(results))]
    to_mm = lambda c: [round(float(x), 1) for x in lo + (np.array(c) + 0.5) * p]
    painted = [{'paint_slot': m['slot'], 'on_piece': ', '.join(names_of.get(m['into_piece'], [f"slot{m['into_slot']}"])),
                'at_mm': to_mm(m['centroid_vox']), 'size_mm': round(m['volume_mm3'] ** (1 / 3), 1), 'whole_part': True}
               for m in merged]

    summary = {
        'source': os.path.basename(args.model), 'size_mm': [round(float(x), 1) for x in size], 'slots': slots,
        'settings': {'colours_per_piece': args.colours_per_piece, 'voxel_mm': p, 'gap_per_side_mm': args.gap,
                     'min_piece_mm3': args.min_piece, 'dropped_slots': args.drop_slot},
        'checks': {'original_cm3': round(orig.volume() / 1000, 2), 'pieces_cm3': round(total / 1000, 2),
                   'overlap_mm3': round(overlap, 2), 'all_closed_solids': True,
                   'assembly_verified': all(o['verified'] for o in order)},
        'pieces': records, 'assembly_order': order, 'kit_splits': splits, 'folded': folded,
    }
    summary['paint'] = painted + foreign_spots(built, names_by_built)
    with open(os.path.join(args.out, 'pieces.json'), 'w', encoding='utf-8') as fh:
        json.dump(summary, fh, indent=1)
    with open(os.path.join(args.out, 'PRINT-SHEET.md'), 'w', encoding='utf-8') as fh:
        fh.write(print_sheet(summary, colours))
    log(f"print sheet written; {len(summary['paint'])} details to paint")

    try:
        import trimesh
        from scipy.spatial import cKDTree
        scene = trimesh.Scene()
        for o in assembly:
            # A lighter copy for viewing; each simplified face takes the colour of
            # the nearest full-resolution triangle. Simplify an untagged copy:
            # manifold only merges triangles that share a face id, and every
            # triangle here carries its own.
            simple = to_manifold(o['V'], o['F']).simplify(0.15).to_mesh()
            Vs, Fs = np.array(simple.vert_properties[:, :3]), np.array(simple.tri_verts)
            _, near = cKDTree(o['V'][o['F']].mean(1)).query(Vs[Fs].mean(1))
            st = o['states'][near]
            for c in np.unique(st):
                sel = st == c
                sub = trimesh.Trimesh(Vs, Fs[sel], process=False)
                sub.remove_unreferenced_vertices()
                rgb = [int(colours[c - 1][i:i + 2], 16) / 255 for i in (1, 3, 5)]
                sub.visual = trimesh.visual.TextureVisuals(material=trimesh.visual.material.PBRMaterial(
                    baseColorFactor=rgb + [1.0], roughnessFactor=0.7, metallicFactor=0.0))
                scene.add_geometry(sub, node_name=f"{o['name']}__{c}", geom_name=f"{o['name']}__{c}")
        scene.export(os.path.join(args.out, 'preview.glb'))
        log('preview.glb written')
    except ImportError:
        pass
    log('done')


if __name__ == '__main__':
    main()

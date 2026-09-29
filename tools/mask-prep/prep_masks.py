#!/usr/bin/env python3
"""
Get the numbered mask files ready to print as one piece each.

    python prep_masks.py ../../project/uploads ../../project/uploads/masks-ready [--slice]

For every number 01-99 that has 3D files in the uploads folder (named like
`01-ichigo-hollow-mask.stl`, several files per number allowed — horns, teeth).
A letter after the number keeps two masks from one photo apart: `12a-…` and
`12b-…` are prepared as two objects, both counting as photo 12.

  1. Load every part (STL, OBJ or 3MF, Bambu project files included) and put
     them together as one object.
  2. Make it one solid where possible: closed parts are unioned, so overlapping
     parts don't leave internal walls; open parts get a repair attempt and are
     flagged if it fails (Bambu Studio will still offer to fix them on import).
  3. Check the size against a face and against the H2D's build volume. Full-face
     masks run about 180-240 mm tall; anything well outside gets the scale that
     would bring it to the target.
  4. Write NN-name.3mf: one object, one colour, original orientation and scale,
     sitting on the middle of the H2D plate.
  5. With --slice, slice it in Bambu Studio (H2D, 0.2 mm, one PLA filament, tree
     supports) for grams and print time.

Writes SUMMARY.md in the output folder. The source files are never modified.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import trimesh
import manifold3d as m3d

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'color-split'))
from write3mf import write_3mf  # noqa: E402

EXTS = {'.stl', '.obj', '.3mf'}
PHOTOS = {'.jpg', '.jpeg', '.png', '.webp'}
BAMBU = Path(r'C:\Program Files\Bambu Studio\bambu-studio.exe')
PROFILES = Path(r'C:\Program Files\Bambu Studio\resources\profiles\BBL')
PRESETS = {
    'machine': 'Bambu Lab H2D 0.4 nozzle',
    'process': '0.20mm Standard @BBL H2D',
    'filament': 'Bambu PLA Basic @BBL H2D',
}
# What one H2D nozzle can reach (x, y, z), mm. The plate is 350 × 320, but each nozzle
# covers only 325 of the width (left 0-325, right 25-350; `extruder_printable_area`), and
# the left one 320 of the height. A one-filament mask prints from a single nozzle.
BED = (325.0, 320.0, 320.0)
CENTRE = (175.0, 160.0)  # plate centre: inside both nozzles' reach


def to_manifold(mesh: trimesh.Trimesh) -> m3d.Manifold:
    return m3d.Manifold(m3d.Mesh(
        vert_properties=np.ascontiguousarray(mesh.vertices, dtype=np.float32),
        tri_verts=np.ascontiguousarray(mesh.faces, dtype=np.uint32),
    ))


def load_parts(files: list[Path]) -> list[trimesh.Trimesh]:
    parts = []
    for f in files:
        loaded = trimesh.load(f, force='mesh', process=True)
        if isinstance(loaded, trimesh.Trimesh) and len(loaded.faces):
            parts.append(loaded)
    return parts


def solidify(parts: list[trimesh.Trimesh]) -> tuple[trimesh.Trimesh, dict]:
    """One object from all the parts; one solid wherever the geometry allows it."""
    combined = trimesh.util.concatenate(parts)
    combined.merge_vertices()
    combined.update_faces(combined.nondegenerate_faces())
    combined.update_faces(combined.unique_faces())
    bodies = combined.split(only_watertight=False)

    closed, still_open, repaired = [], [], 0
    for b in bodies:
        if not b.is_watertight:
            trimesh.repair.fix_normals(b)
            trimesh.repair.fill_holes(b)
            if b.is_watertight:
                repaired += 1
        if b.is_watertight:
            mf = to_manifold(b)
            if mf.status() == m3d.Error.NoError and mf.volume() > 0:
                closed.append(mf)
                continue
        still_open.append(b)

    info = {'parts': len(parts), 'bodies_in': len(bodies), 'repaired': repaired, 'open_bodies': len(still_open)}
    pieces = []
    if closed:
        union = m3d.Manifold.batch_boolean(closed, m3d.OpType.Add)
        out = union.to_mesh()
        solid = trimesh.Trimesh(np.array(out.vert_properties[:, :3]), np.array(out.tri_verts), process=False)
        info['solid_bodies'] = len(union.decompose())
        info['volume_cm3'] = round(union.volume() / 1000, 1)
        pieces.append(solid)
    else:
        info['solid_bodies'] = 0
        info['volume_cm3'] = None
    pieces.extend(still_open)
    mesh = trimesh.util.concatenate(pieces) if len(pieces) > 1 else pieces[0]
    info['watertight'] = not still_open and info['solid_bodies'] == 1
    return mesh, info


def place(mesh: trimesh.Trimesh) -> None:
    """On the plate: bottom at z 0, footprint centred. Orientation is left alone."""
    lo, hi = mesh.bounds
    mesh.apply_translation([CENTRE[0] - (lo[0] + hi[0]) / 2, CENTRE[1] - (lo[1] + hi[1]) / 2, -lo[2]])


def fits_bed(w: float, d: float, h: float) -> bool:
    """Whether the footprint fits the plate as is or turned 90°, and the height fits under the gantry."""
    return h <= BED[2] and ((w <= BED[0] and d <= BED[1]) or (d <= BED[0] and w <= BED[1]))


def bambu_presets(workdir: Path) -> dict[str, Path]:
    """
    The H2D system presets, flattened, with tree supports switched on.

    Bambu's system presets are partial — each names a parent in `inherits` — and the
    CLI does not resolve the chain when given one with --load-settings: it slices an
    empty plate (-50). So the chain is merged here, parent first. Supports go in the
    process preset rather than on the command line, where --enable_support makes
    the CLI exit without writing result.json.
    """
    index: dict[tuple[str, str], Path] = {}
    for kind in PRESETS:
        for f in (PROFILES / kind).rglob('*.json'):
            try:
                d = json.loads(f.read_text(encoding='utf-8'))
            except (OSError, ValueError):
                continue
            if isinstance(d, dict) and 'name' in d:
                index[(kind, d['name'])] = f

    def resolve(kind: str, name: str) -> dict:
        d = json.loads(index[(kind, name)].read_text(encoding='utf-8'))
        parent = d.pop('inherits', None)
        return {**resolve(kind, parent), **d} if parent else d

    paths = {}
    for kind, name in PRESETS.items():
        d = resolve(kind, name)
        if kind == 'process':
            d.update({'enable_support': '1', 'support_type': 'tree(auto)', 'from': 'user'})
        paths[kind] = workdir / f'{kind}.json'
        paths[kind].write_text(json.dumps(d, indent=1), encoding='utf-8')
    return paths


def slice_one(path: Path, presets: dict[str, Path], workdir: Path) -> dict | None:
    """Grams and time from Bambu Studio's CLI, or None if it can't run."""
    out = workdir / f'slice-{path.stem}'
    out.mkdir(parents=True, exist_ok=True)
    cmd = [str(BAMBU), '--load-settings', f"{presets['machine']};{presets['process']}",
           '--load-filaments', str(presets['filament']), '--slice', '0', '--outputdir', str(out), str(path.resolve())]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=str(out))
    rj = out / 'result.json'
    if not rj.exists():
        return None
    r = json.loads(rj.read_text(encoding='utf-8'))
    if r.get('return_code') != 0 or not r.get('sliced_plates'):
        return {'error': r.get('error_string', 'slicing failed').strip()}
    sp = r['sliced_plates'][0]
    return {
        'grams': round(sum(f['total_used_g'] for f in sp.get('filaments', [])), 1),
        'hours': round(sp.get('total_predication', 0) / 3600, 1),
        'support_hours': round(sp.get('feature_type_times', {}).get('Support', 0) / 3600, 1),
        'warning': sp.get('warning_message', ''),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('uploads')
    ap.add_argument('out')
    ap.add_argument('--face', type=float, default=210.0, help='target mask height when suggesting a scale, mm')
    ap.add_argument('--slice', action='store_true', help='slice each mask in Bambu Studio for grams and time')
    args = ap.parse_args()

    uploads, out = Path(args.uploads), Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    groups: dict[str, list[Path]] = {}
    photos: set[str] = set()
    for f in sorted(uploads.iterdir()):
        m = re.match(r'^(\d{2}[a-z]?)-', f.name, re.IGNORECASE)
        if not (m and f.is_file()):
            continue
        key = m.group(1).lower()
        if f.suffix.lower() in EXTS:
            groups.setdefault(key, []).append(f)
        elif f.suffix.lower() in PHOTOS:
            photos.add(key[:2])
    # A photo is covered by its own number or by any lettered mask under it (12a, 12b).
    waiting = {p for p in photos if not any(k[:2] == p for k in groups)}

    tmp = tempfile.TemporaryDirectory()
    presets = None
    if args.slice:
        if BAMBU.exists():
            presets = bambu_presets(Path(tmp.name))
        else:
            print(f'Bambu Studio not found at {BAMBU}; skipping --slice')

    rows = []
    for num in sorted(waiting | set(groups)):
        files = groups.get(num)
        if not files:
            rows.append({'num': num, 'status': 'waiting for the STL'})
            print(f'{num}: waiting for the STL')
            continue
        mesh, info = solidify(load_parts(files))
        place(mesh)
        name = files[0].stem
        w, d, h = (float(x) for x in mesh.extents)  # x, y, z as modelled
        tall = max(w, d, h)
        scale = None if 150 <= tall <= 260 else round(args.face / tall * 100)
        target = out / f'{name}.3mf'
        write_3mf(str(target), [{'name': name, 'colour': '#D9D9D9', 'V': mesh.vertices, 'F': mesh.faces}], name)
        row = {'num': num, 'status': 'ready', 'file': target.name, 'sources': [f.name for f in files],
               'size_mm': [round(w, 1), round(d, 1), round(h, 1)], 'fits_bed': fits_bed(w, d, h),
               'triangles': int(len(mesh.faces)), 'scale_pct': scale, **info}
        if presets and row['fits_bed']:
            row['slice'] = slice_one(target, presets, Path(tmp.name))
        rows.append(row)
        s = row.get('slice')
        sliced = '' if not s else '  | ' + (s.get('error') or f"{s['grams']} g, {s['hours']} h")
        print(f"{num}: {target.name}  {w:.0f} x {d:.0f} x {h:.0f} mm  {info['bodies_in']} bodies in -> "
              f"{info['solid_bodies']} solid, {info['open_bodies']} open"
              + (f"  scale to {scale}%" if scale else '')
              + ('' if row['fits_bed'] else '  TOO BIG FOR THE H2D')
              + sliced)
    tmp.cleanup()

    lines = ['# Masks — one piece each', '',
             'One object per mask, one colour, original orientation, centred on the H2D plate. '
             'Sizes are as modelled (x × y × z). Filament and time: Bambu Studio, 0.2 mm, PLA, tree supports.', '',
             '| # | File | Size (mm) | Solid? | Scale | Filament · time |', '| --- | --- | --- | --- | --- | --- |']
    for r in rows:
        if r['status'] != 'ready':
            lines.append(f"| {r['num']} | — | — | — | — | {r['status']} |")
            continue
        solid = 'yes' if r['watertight'] else f"{r['open_bodies']} open part(s) — let Bambu repair on import"
        scale = f"{r['scale_pct']}% to reach ~{args.face:.0f} mm" if r['scale_pct'] else 'as is'
        if not r['fits_bed']:
            scale += ' — too big for the H2D at this size'
        s = r.get('slice')
        sl = '—' if not s else (s.get('error') or f"{s['grams']} g · {s['hours']} h ({s['support_hours']} h of it supports)")
        lines.append(f"| {r['num']} | `{r['file']}` | {' × '.join(str(v) for v in r['size_mm'])} | {solid} | {scale} | {sl} |")
    (out / 'SUMMARY.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    (out / 'summary.json').write_text(json.dumps(rows, indent=1), encoding='utf-8')
    print(f'summary -> {out / "SUMMARY.md"}')


if __name__ == '__main__':
    main()

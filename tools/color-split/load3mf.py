"""Read a painted Bambu Studio / PrusaSlicer 3MF: geometry in print coordinates plus a colour per triangle."""
from __future__ import annotations

import re
import zipfile
from dataclasses import dataclass

import numpy as np

ATTR = re.compile(r'([\w:]+)="([^"]*)"')
VERT = re.compile(rb'<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"')
TRI = re.compile(rb'<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"([^/>]*)/?>')
PAINT = re.compile(rb'(?:paint_color|slic3rpe:mmu_segmentation)="([0-9A-Fa-f]*)"')


@dataclass
class Painted:
    vertices: np.ndarray  # (n, 3) float64, mm, Z up, XY centred, min z = 0
    faces: np.ndarray  # (m, 3) int64
    extruder: np.ndarray  # (m,) int16, 1-based filament slot per triangle
    colours: list[str]  # filament colour per slot, index 0 = slot 1
    filament_types: list[str]


def decode_paint(code: str) -> dict[int, float]:
    """
    PrusaSlicer/Bambu TriangleSelector serialisation. Nibbles are read from the
    end of the hex string, bits LSB first. Per node: low 2 bits = number of
    split sides (0 = leaf). A leaf's state is the high 2 bits, or, when those
    are 0b11, 3 + the next nibble. A split node has split_sides + 1 children,
    treated here as equal shares of the parent's area.
    Returns {state: area fraction}. State 0 = unpainted (object's default).
    """
    nibbles = [int(c, 16) for c in reversed(code)]
    pos = 0
    out: dict[int, float] = {}

    def node(w: float) -> None:
        nonlocal pos
        c = nibbles[pos]
        pos += 1
        split = c & 3
        if split == 0:
            state = c >> 2
            if state == 3:
                state = 3 + nibbles[pos]
                pos += 1
            out[state] = out.get(state, 0.0) + w
        else:
            n = split + 1
            for _ in range(n):
                node(w / n)

    try:
        node(1.0)
    except IndexError:
        pass
    return out


def _transform(attr: str | None) -> tuple[np.ndarray, np.ndarray]:
    if not attr:
        return np.eye(3), np.zeros(3)
    m = np.array([float(x) for x in attr.split()])
    return m[:9].reshape(3, 3), m[9:12]


def _parse_mesh(stream) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    verts: list[np.ndarray] = []
    tris: list[np.ndarray] = []
    rests: list[np.ndarray] = []
    buf = b''
    while True:
        chunk = stream.read(1 << 23)
        if chunk:
            buf += chunk
            cut = buf.rfind(b'>')
            if cut < 0:
                continue
            work, buf = buf[: cut + 1], buf[cut + 1 :]
        else:
            work, buf = buf, b''
        v = VERT.findall(work)
        if v:
            verts.append(np.array(v, dtype='S24').astype(np.float64))
        t = TRI.findall(work)
        if t:
            a = np.array(t, dtype=object)
            tris.append(a[:, :3].astype('S12').astype(np.int64))
            rests.append(a[:, 3].astype('S64'))
        if not chunk:
            break
    return np.concatenate(verts), np.concatenate(tris), np.concatenate(rests)


def load(path: str) -> Painted:
    z = zipfile.ZipFile(path)
    root = z.read('3D/3dmodel.model').decode('utf-8', 'replace')

    item = dict(ATTR.findall(re.search(r'<item\b[^>]*>', root).group(0)))
    Ri, ti = _transform(item.get('transform'))

    comp = re.search(r'<component\b[^>]*>', root)
    if comp:
        c = dict(ATTR.findall(comp.group(0)))
        Rc, tc = _transform(c.get('transform'))
        entry = c.get('p:path', '').lstrip('/')
        with z.open(entry) as f:
            V, F, rest = _parse_mesh(f)
    else:
        Rc, tc = np.eye(3), np.zeros(3)
        with z.open('3D/3dmodel.model') as f:
            V, F, rest = _parse_mesh(f)

    V = (V @ Rc + tc) @ Ri + ti
    lo, hi = V.min(0), V.max(0)
    V -= np.array([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]])

    # Default extruder for unpainted triangles.
    default = 1
    if 'Metadata/model_settings.config' in z.namelist():
        ms = z.read('Metadata/model_settings.config').decode('utf-8', 'replace')
        m = re.search(r'<object id="\d+">\s*(?:<metadata[^>]*/>\s*)*?<metadata key="extruder" value="(\d+)"', ms)
        if m:
            default = int(m.group(1))

    colours: list[str] = []
    types: list[str] = []
    if 'Metadata/project_settings.config' in z.namelist():
        import json

        ps = json.loads(z.read('Metadata/project_settings.config'))
        colours = list(ps.get('filament_colour', []))
        types = list(ps.get('filament_type', []))

    extruder = np.full(len(F), default, dtype=np.int16)
    uniq, inv = np.unique(rest, return_inverse=True)
    lut = np.full(len(uniq), default, dtype=np.int16)
    for i, r in enumerate(uniq):
        m = PAINT.search(bytes(r))
        if not m or not m.group(1):
            continue
        w = decode_paint(m.group(1).decode())
        if not w:
            continue
        state = max(w, key=w.get)
        lut[i] = default if state == 0 else state
    extruder = lut[inv]
    return Painted(V, F, extruder, colours, types)

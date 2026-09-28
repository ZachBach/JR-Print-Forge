"""Minimal 3MF writer: named objects, one colour each, in place."""
from __future__ import annotations

import io
import zipfile
from xml.sax.saxutils import escape

import numpy as np

CONTENT_TYPES = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>'
    '</Types>'
)
RELS = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>'
    '</Relationships>'
)


def paint_code(state: int) -> str:
    """Filament slot -> TriangleSelector leaf code (the inverse of load3mf.decode_paint)."""
    if state <= 0:
        return ''
    if state < 3:
        return '4' if state == 1 else '8'
    return format(state - 3, 'X') + 'C'


def write_3mf(path: str, objects: list[dict], title: str) -> None:
    """
    objects: [{'name', 'colour' ('#RRGGBB'), 'V' (n,3), 'F' (m,3), optional 'states' (m,)}]
    in millimetres. With 'states', every triangle is painted with its filament slot.
    """
    buf = io.StringIO()
    buf.write('<?xml version="1.0" encoding="UTF-8"?>\n')
    buf.write('<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n')
    buf.write(f'<metadata name="Title">{escape(title)}</metadata>\n<metadata name="Application">JR Print Forge colour split</metadata>\n')
    buf.write('<resources>\n<basematerials id="1">\n')
    for o in objects:
        buf.write(f'<base name="{escape(o["name"])}" displaycolor="{o["colour"].upper()}FF"/>\n')
    buf.write('</basematerials>\n')
    for i, o in enumerate(objects):
        buf.write(f'<object id="{i + 2}" type="model" name="{escape(o["name"])}" pid="1" pindex="{i}">\n<mesh>\n<vertices>\n')
        np.savetxt(buf, o['V'], fmt='<vertex x="%.4f" y="%.4f" z="%.4f"/>')
        buf.write('</vertices>\n<triangles>\n')
        if o.get('states') is None:
            np.savetxt(buf, o['F'], fmt='<triangle v1="%d" v2="%d" v3="%d"/>')
        else:
            # Bambu Studio / Orca paint: each triangle's filament slot, in the
            # same TriangleSelector encoding the source file used.
            code = {int(s): paint_code(int(s)) for s in np.unique(o['states'])}
            F = o['F']
            buf.write(''.join(
                f'<triangle v1="{F[k, 0]}" v2="{F[k, 1]}" v3="{F[k, 2]}" paint_color="{code[int(st)]}"/>\n'
                for k, st in enumerate(o['states'])))
        buf.write('</triangles>\n</mesh>\n</object>\n')
    buf.write('</resources>\n<build>\n')
    for i in range(len(objects)):
        buf.write(f'<item objectid="{i + 2}"/>\n')
    buf.write('</build>\n</model>\n')
    with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        z.writestr('[Content_Types].xml', CONTENT_TYPES)
        z.writestr('_rels/.rels', RELS)
        z.writestr('3D/3dmodel.model', buf.getvalue())

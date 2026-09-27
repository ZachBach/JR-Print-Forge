/**
 * Mesh → print files. Both writers take the mesher's indexed arrays directly
 * (millimetres, Z up), so what downloads is exactly what was checked.
 *
 * 3MF is the one to send: it carries units, zips to a fraction of the STL, and
 * every current slicer (Bambu Studio, PrusaSlicer, Orca, Cura) opens it. STL
 * stays for older tools.
 */
import { Zip, ZipDeflate, strToU8 } from 'three/addons/libs/fflate.module.js';
import type { Mesh } from './mesh.ts';

/** Binary STL. 84-byte header + 50 bytes per triangle. */
export function toStl(mesh: Mesh, label = 'JR Print Forge'): ArrayBuffer {
  const { positions: p, indices: ix } = mesh;
  const n = ix.length / 3;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  const head = `${label} - units: millimetres`.slice(0, 80);
  for (let i = 0; i < 80; i++) dv.setUint8(i, i < head.length ? head.charCodeAt(i) & 0x7f : 32);
  dv.setUint32(80, n, true);
  let o = 84;
  for (let t = 0; t < n; t++) {
    const a = ix[t * 3] * 3;
    const b = ix[t * 3 + 1] * 3;
    const c = ix[t * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    dv.setFloat32(o, nx, true);
    dv.setFloat32(o + 4, ny, true);
    dv.setFloat32(o + 8, nz, true);
    dv.setFloat32(o + 12, p[a], true);
    dv.setFloat32(o + 16, p[a + 1], true);
    dv.setFloat32(o + 20, p[a + 2], true);
    dv.setFloat32(o + 24, p[b], true);
    dv.setFloat32(o + 28, p[b + 1], true);
    dv.setFloat32(o + 32, p[b + 2], true);
    dv.setFloat32(o + 36, p[c], true);
    dv.setFloat32(o + 40, p[c + 1], true);
    dv.setFloat32(o + 44, p[c + 2], true);
    dv.setUint16(o + 48, 0, true);
    o += 50;
  }
  return buf;
}

const escapeXml = (s: string) =>
  s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);

/** Micrometre precision, no trailing zeros. */
const num = (v: number) => String(Math.round(v * 1000) / 1000);

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>' +
  '</Types>';

const RELS =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>' +
  '</Relationships>';

/**
 * Deflate level 1. Measured on a 770k-triangle lithophane: level 6 took 2.5×
 * as long for a file under 2% smaller — mesh XML is mostly digits, and the
 * fast matcher already finds the repetition.
 */
const LEVEL = 1;

export interface ThreeMfMeta {
  title: string;
  /** Free-text description stored in the file — the spec summary. */
  description?: string;
}

/**
 * 3MF core-spec package. The model XML is streamed into the zip in chunks so
 * a lithophane's tens of megabytes of XML never exist as one string.
 */
export function to3mf(mesh: Mesh, meta: ThreeMfMeta): Uint8Array {
  const parts: Uint8Array[] = [];
  let failure: Error | null = null;
  const zip = new Zip((err, chunk) => {
    if (err) failure = err;
    else parts.push(chunk);
  });

  const add = (name: string, text: string) => {
    const f = new ZipDeflate(name, { level: LEVEL });
    zip.add(f);
    f.push(strToU8(text), true);
  };
  add('[Content_Types].xml', CONTENT_TYPES);
  add('_rels/.rels', RELS);

  const model = new ZipDeflate('3D/3dmodel.model', { level: LEVEL });
  zip.add(model);
  let buf: string[] = [];
  let size = 0;
  const write = (s: string) => {
    buf.push(s);
    size += s.length;
    if (size > 1 << 22) {
      model.push(strToU8(buf.join('')), false);
      buf = [];
      size = 0;
    }
  };

  const title = escapeXml(meta.title);
  write('<?xml version="1.0" encoding="UTF-8"?>\n');
  write(
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n',
  );
  write(`<metadata name="Title">${title}</metadata>\n`);
  write('<metadata name="Application">JR Print Forge</metadata>\n');
  if (meta.description) write(`<metadata name="Description">${escapeXml(meta.description)}</metadata>\n`);
  write(`<resources>\n<object id="1" type="model" name="${title}">\n<mesh>\n<vertices>\n`);
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    write(`<vertex x="${num(p[i])}" y="${num(p[i + 1])}" z="${num(p[i + 2])}"/>\n`);
  }
  write('</vertices>\n<triangles>\n');
  const ix = mesh.indices;
  for (let i = 0; i < ix.length; i += 3) {
    write(`<triangle v1="${ix[i]}" v2="${ix[i + 1]}" v3="${ix[i + 2]}"/>\n`);
  }
  write('</triangles>\n</mesh>\n</object>\n</resources>\n<build>\n<item objectid="1"/>\n</build>\n</model>\n');
  model.push(strToU8(buf.join('')), true);
  zip.end();

  if (failure) throw failure;
  let total = 0;
  for (const c of parts) total += c.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of parts) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

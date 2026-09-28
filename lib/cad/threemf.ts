/**
 * Multi-body 3MF — the print-ready side of the CAD model.
 *
 * `lib/relief/export.ts` writes the whole part as one object, which is right for a
 * single-colour print. This writes one object per body, which is what turns a
 * keychain into a two-colour keychain: the plate and the raised design arrive in
 * the slicer as separate objects at the same coordinates, each carrying its own
 * base material and colour, so they can be assigned to different filaments and
 * printed in one pass on an AMS or H2D machine.
 *
 * Base materials are core 3MF (`<basematerials>` with `pid`/`pindex` on the
 * object), so the colours survive into Bambu Studio, Orca, PrusaSlicer and Cura
 * alike. `Metadata/model_settings.config` additionally carries Bambu's own
 * per-object extruder key; slicers that do not know that part ignore it, and the
 * colours still get the assignment across.
 */
import { Zip, ZipDeflate, strToU8 } from 'three/addons/libs/fflate.module.js';
import type { Mesh } from '../relief/mesh.ts';

export interface MultiBody {
  name: string;
  mesh: Mesh;
  /** `#RRGGBB`. Shown in the slicer and used to pick the filament. */
  colour: string;
  /** 1-based tool index for machines with more than one. */
  extruder: number;
}

export interface MultiMeta {
  title: string;
  description?: string;
}

const escapeXml = (s: string) =>
  s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);

const num = (v: number) => String(Math.round(v * 1000) / 1000);

/** 3MF wants 8 hex digits, RGBA. */
function rgba(colour: string): string {
  const hex = colour.replace('#', '').trim();
  const six = hex.length >= 6 ? hex.slice(0, 6) : hex.padEnd(6, '0');
  return `#${six.toUpperCase()}FF`;
}

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>' +
  '<Override PartName="/Metadata/model_settings.config" ContentType="text/xml"/>' +
  '</Types>';

const RELS =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>' +
  '</Relationships>';

/** Level 1: mesh XML is mostly digits and the fast matcher already gets it. */
const LEVEL = 1;

export function toMulti3mf(bodies: MultiBody[], meta: MultiMeta): Uint8Array {
  if (!bodies.length) throw new Error('Nothing to write.');
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

  // Resource ids share one namespace: the material group takes 1, the objects
  // follow it.
  const MATERIALS = 1;
  const objectId = (i: number) => MATERIALS + 1 + i;

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
  write('<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n');
  write(`<metadata name="Title">${title}</metadata>\n`);
  write('<metadata name="Application">JR Print Forge</metadata>\n');
  if (meta.description) write(`<metadata name="Description">${escapeXml(meta.description)}</metadata>\n`);
  write('<resources>\n');
  write(`<basematerials id="${MATERIALS}">\n`);
  for (const b of bodies) {
    write(`<base name="${escapeXml(b.name)}" displaycolor="${rgba(b.colour)}"/>\n`);
  }
  write('</basematerials>\n');

  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    write(
      `<object id="${objectId(i)}" type="model" name="${escapeXml(b.name)}" pid="${MATERIALS}" pindex="${i}">\n<mesh>\n<vertices>\n`,
    );
    const p = b.mesh.positions;
    for (let k = 0; k < p.length; k += 3) {
      write(`<vertex x="${num(p[k])}" y="${num(p[k + 1])}" z="${num(p[k + 2])}"/>\n`);
    }
    write('</vertices>\n<triangles>\n');
    const ix = b.mesh.indices;
    for (let k = 0; k < ix.length; k += 3) {
      write(`<triangle v1="${ix[k]}" v2="${ix[k + 1]}" v3="${ix[k + 2]}"/>\n`);
    }
    write('</triangles>\n</mesh>\n</object>\n');
  }
  write('</resources>\n<build>\n');
  for (let i = 0; i < bodies.length; i++) write(`<item objectid="${objectId(i)}"/>\n`);
  write('</build>\n</model>\n');
  model.push(strToU8(buf.join('')), true);

  let config = '<?xml version="1.0" encoding="UTF-8"?>\n<config>\n';
  for (let i = 0; i < bodies.length; i++) {
    config += `  <object id="${objectId(i)}">\n`;
    config += `    <metadata key="name" value="${escapeXml(bodies[i].name)}"/>\n`;
    config += `    <metadata key="extruder" value="${bodies[i].extruder}"/>\n`;
    config += '  </object>\n';
  }
  config += '</config>\n';
  add('Metadata/model_settings.config', config);
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

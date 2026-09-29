# Colour split

Turns a painted multi-colour 3MF (Bambu Studio or PrusaSlicer) into pieces that print with one
filament each — or two, one per nozzle, on a dual-nozzle printer — and glue back together. No
filament changes inside a print: no purge, no colour bleed. One-filament plates need no prime tower
either; two-nozzle plates still get one for the nozzle switch.

```bash
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt   # once
.venv/Scripts/python split_by_color.py model.3mf out/ --colours-per-piece 2
```

| Option | Default | What it does |
| --- | --- | --- |
| `--colours-per-piece` | 1 | `2` for a dual-nozzle printer (Bambu H2D, Prusa XL, IDEX). Far fewer, sturdier pieces. |
| `--drop-slot N` | — | Remove a stray filament slot; its triangles take the surrounding colour. Repeatable. |
| `--gap` | 0.1 | Clearance per side between pieces, mm. 0.15 if the printer runs tight. |
| `--min-piece` | 120 | Smallest separate piece, mm³. Smaller details are merged and listed to paint. |
| `--voxel` | 0.5 | Interior grid pitch, mm. |

## What comes out

| File | What it is |
| --- | --- |
| `plates/*.3mf` | Everything that prints with the same one or two filaments. One plate each; press *Arrange*. |
| `<name>-assembly.3mf` | All pieces in place — for checking the fit in the slicer. |
| `PRINT-SHEET.md` | Plates and filaments, pieces, the glue-up order, and the details to paint. |
| `pieces.json` | The same, machine-readable, plus every check result. |
| `preview.glb` | A light, coloured copy for viewing. |

Pieces keep the source file's filament slot numbers, and two-colour pieces carry their painting
(`paint_color`, the same encoding Bambu Studio writes). Import them into the original project so
the slots line up.

## How it works

1. **Read** the mesh and each triangle's painted filament slot (Bambu `paint_color` /
   Prusa `mmu_segmentation`).
2. **Voxelise** the solid and give each inside voxel the colour of the nearest painted surface.
3. **Tidy**: smooth ragged boundaries; fold islands too small to handle into their neighbour.
4. **Plan the assembly.** Pieces come out one at a time along a straight line; hidden interior in
   the way is handed to the moving piece, and painted surface never changes colour. With two
   colours per piece, firmly joined or interlocked neighbours are printed as one two-colour
   piece. Only where that is not enough is a piece cut in two like a kit part; only small stuck
   pieces are merged and listed to paint.
5. **Cut** each piece: a smooth solid for its region, pulled back `gap` mm from its neighbours,
   intersected with the original. The outside keeps the original triangles and their paint;
   hidden join faces take the colour of the nearest outside surface.
6. **Check**: every piece is a closed solid, no two overlap, and the glue-up order is re-checked
   on the finished meshes at 0.3 mm — each piece must slide into place without touching another.

Needs the model to be a closed solid; repair it in the slicer first if the script says it isn't.

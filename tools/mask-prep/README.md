# mask-prep

Turns the numbered mask files in `project/uploads/` into print-ready files, **one piece each, one
colour**. They get spray-painted after printing, so nothing is split by colour here (that's
`tools/color-split/`).

```bash
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt
.venv/Scripts/python prep_masks.py ../../project/uploads ../../project/uploads/masks-ready --slice
```

## Naming

The number prefix ties a model to its photo: `01-…jpg` is the reference photo, and `01-ichigo-hollow-mask.stl`
is the model for it. One mask can have several files (horns, teeth, a strap clip). Every file with the same
number is combined into one object. STL, OBJ and 3MF are all read, including Bambu project 3MFs.

When one photo shows two masks, add a letter: `12a-obito-war-mask.stl` and `12b-tobi-mask.stl` are prepared as
two objects. Files that don't start with a two-digit number and a dash are ignored, such as a display stand saved as
`stand-01.stl`.

## What it does to each mask

- **Combines** all of that number's parts. Closed parts are unioned, so overlaps leave no internal walls.
  Open parts get a repair attempt; any that stay open are reported, and Bambu Studio offers to fix them on
  import.
- **Checks the size.** Full-face masks are about 180–240 mm tall. Anything outside 150–260 mm gets a
  suggested scale to reach `--face` (default 210 mm). Anything too big for one H2D nozzle is flagged:
  325 × 320 × 320 mm, because the plate is 350 wide but each nozzle reaches 325 of it. The model's
  scale and orientation are never changed: they're the seller's, and the suggestion is yours to apply.
- **Writes** `NN-name.3mf`: one object, one colour, sitting on the middle of the H2D plate.
- **With `--slice`**, slices it headless in Bambu Studio (H2D, 0.2 mm Standard, Bambu PLA Basic, tree
  supports) and records grams and hours, including how much of that time is supports. Masks too big for
  the bed are not sliced.

Output: the 3MFs, `SUMMARY.md` (a table ready for `zna-tasks.md`) and `summary.json`.
A number that has a photo but no model shows as *waiting for the STL*.

## Bambu Studio CLI notes

- The system presets under `resources/profiles/BBL` are partial: each one `inherits` a parent. Passed
  straight to `--load-settings`, the CLI slices an empty plate and fails with `-50 One of the plate is
  empty`. The tool merges each inheritance chain into a full preset first.
- Set supports inside the process preset. `--enable_support` on the command line makes the CLI exit
  without writing `result.json`.
- The time is Bambu's estimate for the orientation as modelled. Face-down or standing on the chin can
  change support time a lot, so try both in Studio before quoting a big mask.

Uploads and outputs live under `project/uploads/`, which is gitignored. The models were bought and the
repo is public.

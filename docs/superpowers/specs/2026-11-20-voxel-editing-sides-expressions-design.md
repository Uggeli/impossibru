# Voxel-grid editing, left/right views, part swaps, and the shell fix

Date: 2026-11-20

## Intent

Impossibru's outputs are the **YAML project** and the **spritesheet** (PNG atlas + JSON).
Voxels are the stage in between: you build shapes in them so you can pose and animate.
The core idea of Impossibru is **tiny asset files that can express a lot**. Every
feature should add as little to the project file as possible for what it lets a
character do. Prefer compact forms (the run-length `voxels` string, a few step keys for
part swaps) over verbose ones.

The work here makes that stage richer without changing what comes out of it:

- Every project the CLI builder accepts must open, edit, and save in the web editor.
  That includes voxel-grid parts (`size` + `voxels`).
- Richer characters: voxel-grid parts are edited slice by slice, left and right sides of
  drawn parts can differ, and expressions or blinks work by swapping parts per frame.

This came from building Qio, the PayiQ mascot (`examples/qio.yaml`, made by
`scripts/gen_qio.py`). Qio builds from the CLI, but the editor crashes when it opens Qio
(`a.doc.parts[a.part][e] is undefined`). Qio is the reference project for this work.

## Goals

1. **The editor supports voxel-grid parts** (this fixes the crash). It can load, validate,
   preview, rig, animate, export, and save projects that contain them.
2. **Slice-by-slice painting** of voxel-grid parts in the editor.
3. **Separate `left` and `right` views** for front/back/side parts, as an alternative to
   the single `side` view.
4. **Part swaps per frame.** An animation can key which part a bone shows, which allows
   expressions and blinking.
5. **Fix the `export.shell: true` gaps.**
6. **Update Qio** to use part swaps: a blink in `idle` and a wink in `thumbs_up`.

## Non-goals

- No new file format. YAML stays the project format, with an optional naming convention
  such as `name.ib.yaml` and no other change.
- No change to how voxel-grid data is stored. The run-length `voxels` string stays as it is:
  it's an in-between form edited in the editor, not something people read.
- No change to the atlas PNG/JSON format or the JavaScript player. Part swaps are baked
  into the rendered frames.
- Left/right views don't allow different outlines (see below).

- No porting of the Python renderer to TypeScript (lighting, `trim`, `shell`, surface
  normals). Long-term direction (user): the editor should always render through the
  Python builder, as a Flask-style server app. That's a separate future project.

## Anti-goals (a failure even if it "works")

- The editor and the CLI disagree on **data**. A project saved by the editor must load in
  the CLI with the same parts, rig, and animations, and the reverse.
- The export from `spritebuilder edit` doesn't match a CLI build. In local-editor mode the
  spritesheet export must go through the Python renderer, so it's identical to
  `spritebuilder build`.
- Existing projects break or change. `side`-only parts, the Mundus examples,
  `examples/humanoid.yaml`, `procedural_humanoid.yaml`, `test_orc.yaml`: all must load
  and render exactly as before.
- Opening a project in the editor and saving it without edits loses or changes data:
  unknown keys, `voxels` strings, `part` tracks. "Same data", not the same text: the
  editor already reformats the YAML and drops comments, which is acceptable.

## Constraints

- There are two engines that must agree: Python (`spritebuilder/project.py`,
  `animation.py`, `render.py`) and TypeScript (`web/src/engine.ts`, `web/src/app.ts`,
  `web/src/types.ts`). Each feature lands in both, with the same validation messages
  where they already match.
- The editor is a browser app that keeps projects on the user's device. The Python
  `edit` command serves the same build (`scripts/sync_web.py` copies it into
  `spritebuilder/editor_static`).
- Existing test suites: Python `tests/`, web `vitest` + Playwright under `web/`. New
  behaviour needs tests in both where it touches both engines.

## Decided design

### 1. Voxel-grid parts in the editor

Format (already supported by the CLI, see `_voxel_grid` in `spritebuilder/project.py`):

- `size: [w, h, d]`
- `voxels`: run-length palette characters (optional count before each character,
  `.` = empty), in x-fastest, then z, then y (bottom-up) order
- `pivot` defaults to `[(w-1)/2, 0, (d-1)/2]`
- Normals are radial ellipsoid normals unless `export.normals: surface`

The editor must:

- Treat a part as voxel-grid when it has `voxels`. `PartSpec` in `types.ts` becomes a
  union of the two kinds of part.
- Validate the same way the CLI does: size, palette characters, and cell count.
- Decode it for previews and the posed-character render (`voxels()` in `engine.ts`).
  `examples/javascript/decode-voxels.js` is an existing decoder that may be reused.
- Save the `voxels` string back re-encoded, in the same run-length form.

### 2. Slice painter

- When a voxel-grid part is selected, a single **slice painter** replaces the three view
  painters. It uses the same paint tools and palette.
- Slices are **horizontal, by height (Y), bottom to top**. Each slice is a top-down
  X/Z grid.
- Step through slices with a slider or slider-plus-keys (up/down).
- The slice below shows faintly underneath (onion skin).
- The 3D part preview updates live and highlights the current slice.
- Resize the grid (w/h/d), the same way existing views can be resized.
- The existing "Duplicate part" button (`duplicatePart` in `app.ts`) must work for
  voxel-grid parts.

### 3. Left/right views

- A front/back/side part may give **either** `side` **or** both `left` and `right`.
  Giving `side` together with `left`/`right`, or only one of `left`/`right`, is a
  validation error.
- `left` and `right` must have **identical outlines** (the same occupied cells) and may
  only differ in colour, just as front and back already work. Each must have the same
  height as front.
- Both are drawn in the **same orientation as `side`** (each column is Z, the
  character's front faces right), so `side` can be copied into both unchanged.
- Colouring: where the side surface is dominant, voxels with x on the +X side (the
  character's left) take their colour from `left`, and the −X side takes it from `right`.
  This replaces the current rule where one `side` view paints both.
- `side`-only parts render exactly as before.
- Editor: a part toggle switches between "Single side view" and "Separate left/right".
  Turning it on copies `side` into both. Turning it off keeps `left` as `side` and
  discards `right`, with a confirmation, since paint is lost.

### 4. Part swaps per frame

- A bone's animation tracks can include `part`, a list of keys
  `{frame: int, value: <part name>}`.
- Part keys are always **step**: the part appears on its frame and holds until the next
  key. An `interpolation` field on a part key is ignored or rejected (builder's call).
- Before the first key, the bone shows its rig `part`. In looping clips, the frames
  before the first key show the last key's part (wraps like the other tracks).
- A key value may be `null`, which **hides** the bone's part from that frame on
  (Claude's call: cheap, and lets overlay parts like eyelids appear only when needed). The
  timeline dropdown offers "none".
- A swapped part still uses the bone's `attachment` translation and rotation.
- Validation: every non-null key `value` must name an existing part. Frames follow the same rules
  as other tracks (integers within the clip, increasing).
- Works for both kinds of part. Swapped parts are rendered with their own pivot. A size
  mismatch with the rig part is **not** an error (variant parts are expected to share
  size, but nothing enforces it).
- Editor: the timeline gets a `part` track row for the selected bone. Setting a key
  picks a part from a dropdown on the current frame. The preview and export show the
  swapped part.
- The atlas and player are unchanged.

### 5. Shell gaps

- Symptom: with `export.shell: true`, large round voxel-grid parts (Qio's head) show
  see-through slivers at diagonal camera angles, so interior or far-side colours (Qio's
  white face) show through the back of the head. With `shell: false` the render is clean.
- Likely cause (unverified): `_surface` keeps only voxels with an empty
  **face** neighbour. That leaves a one-voxel shell, and its splatted squares don't fully
  cover the screen at 45° yaw, so the gaps that interior voxels used to fill now show.
- Why shell exists: fewer voxels for dense creatures (Mundus), which makes rendering
  faster. The fix must keep a real reduction, so it can't become a no-op.
- Fix requirement (Claude's call): for every exported direction and frame on Qio and the
  Mundus examples, the shell render must cover **exactly the same opaque pixels** as the
  full render, with colour differences on **at most 2%** of opaque pixels. There must be a
  test that compares them, plus a test that shell still removes a substantial share of
  voxels on a dense part.

### 6. Export parity (user decision: option c)

- When the editor runs under `spritebuilder edit` (authenticated local server,
  `spritebuilder/editor_server.py`), **Export** sends the current, unsaved project to a
  new server endpoint. The endpoint builds the atlas with the Python exporter and returns
  it: the same PNG + JSON (+ optional player files) as today's ZIP.
- The standalone browser build (GitHub Pages) keeps its current TypeScript export. It
  stays approximate (no lighting, trim, shell, or surface normals) and the export dialog
  says so in one line.
- The TypeScript engine does not implement `shell`. The shell fix is Python-only.

### 7. Qio

- After the work above, `scripts/gen_qio.py` adds `head_blink` (closed eyes as arcs)
  and `head_wink`, and keys them: a short blink in `idle` and a wink in `thumbs_up`.
- `export.shell` goes back to `true` once the fix is in, if it renders identically.
- Qio must open in the editor, and be editable and saveable, with a CLI build after the
  save that matches the original.

## Left to the builder

- The exact UI layout of the slice painter and the left/right toggle, within the existing
  editor style.
- The internal representation of decoded voxel grids in TypeScript.
- How the shell fix is made: for example, keeping voxels with any empty neighbour among
  all 26, or a thicker shell. Only the pixel-match requirement is fixed.
- Whether `interpolation` on part keys is ignored or rejected.
- Order of work. Suggested order: 1 → 5 → 6 → 4 → 3 → 2 → 7. Item 1 unblocks opening
  Qio, and the slice painter is the largest UI piece.

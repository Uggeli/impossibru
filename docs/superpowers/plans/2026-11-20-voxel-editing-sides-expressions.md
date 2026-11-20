# Voxel-grid editing, left/right views, part swaps, shell fix: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The web editor opens, slice-paints, and saves voxel-grid parts (fixing the Qio crash).
Parts can have separate `left`/`right` views. Animations can swap a bone's part per frame.
`export.shell` stops leaking pixels. In `spritebuilder edit` mode the editor exports through
the Python renderer.

**Architecture:** Each feature lands in both engines: Python (`spritebuilder/`) and
TypeScript (`web/src/engine.ts`), with matching validation messages. Voxel-grid
decode/encode/slicing gets a new focused TS module (`web/src/voxelgrid.ts`), so `app.ts`
only wires UI. The slice painter reuses the existing canvas painter: `rows('slice')` and
`setRows('slice')` read and write the current slice. Part swaps are a `part` track sampled
with step semantics, resolved by a new `active_parts` / `activeParts` function that the
renderers consult instead of `bone.part`.

**Tech Stack:** Python 3 + numpy + Pillow + PyYAML (pytest/unittest); TypeScript + Vite +
vitest + Playwright; js-yaml in the browser.

**Spec:** `docs/superpowers/specs/2026-11-20-voxel-editing-sides-expressions-design.md`

## Global Constraints

- Voxel-grid format: `size: [w, h, d]`, `voxels` = run-length palette chars (optional
  decimal count before each char, `.` = empty), cell order **x fastest, then z, then y
  bottom-up**. Default pivot `[(w-1)/2, 0, (d-1)/2]`.
- The encoded `voxels` form is canonical. The count is written only when > 1, and runs
  continue across row and slice boundaries (the same as `Grid.encode` in
  `scripts/gen_qio.py`).
- A part may give `side` **or** both `left` and `right`, never both forms and never only
  one of `left`/`right`.
- `left` and `right` have identical outlines and the same height as `front`. They are
  drawn like `side` (column = Z, front to the right). The +X surface (the character's
  left) is coloured from `left` and the −X surface from `right`.
- Part keys: `{frame, value: <part name> | null}`, always step. Before the first key the
  rig part is used. Looping clips wrap. `null` hides the part. The swapped part uses the
  bone's `attachment`. `interpolation` on a part key is **rejected** with
  `"<label>[<frame>].interpolation is not allowed on part keys"`. That's the plan's
  decision on the call the spec left open.
- Shell parity: same opaque pixels as the full render, colour differences on ≤ 2% of
  opaque pixels, and shell must still remove voxels.
- Existing projects (`examples/humanoid.yaml`, `procedural_humanoid.yaml`,
  `test_orc.yaml`, `examples/mundus/*.json`) must render byte-identically to before
  (except where they set `shell: true`).
- Editor save keeps the same **data**, not the same text.
- No TypeScript port of lighting, trim, shell, or surface normals.

## Review Focus

1. **A voxel-grid part with a palette char that is later renamed or deleted.**
   `renameColor`/`deleteColor` in `app.ts` iterate `front/back/side` text only, so they
   must also update `voxels` and `left/right`, or block deleting a char in use. Test in
   Task 2.
2. **Duplicate, rename, and resize of a voxel-grid part.** Resize must keep voxels
   anchored at the bottom and centred in X/Z. Test in Task 2.
3. **A part key naming a part that is later renamed or deleted.** `renamePart` must
   rewrite part keys, and `deletePart` must block or strip them. Test in Task 6.
4. **Toggling left/right on a part whose `side` uses colours.** Turning it on copies
   `side` to both, turning it off keeps `left`, and undo restores. Test in Task 8.
5. **Exporting in edit mode with unsaved edits.** The server must build from the posted
   document, not the file on disk. Test in Task 4.

---

### Task 1: TypeScript voxel-grid core + engine support

**Files:**
- Create: `web/src/voxelgrid.ts`
- Create: `web/src/voxelgrid.test.ts`
- Modify: `web/src/types.ts` (`PartSpec`)
- Modify: `web/src/engine.ts:476-570` (part validation), `web/src/engine.ts:1079-1116` (`voxels`)
- Also commit the untracked `examples/qio.yaml` and `scripts/gen_qio.py` (the fixture
  for these tests).

**Interfaces:**
- Produces (`voxelgrid.ts`):
  - `interface VoxelGrid { w: number; h: number; d: number; cells: string[] }`. Index is
    `x + z*w + y*w*d`, `'.'` = empty.
  - `isGridPart(p: PartSpec): p is GridPartSpec`, which is true when `'voxels' in p`.
  - `decodeGrid(p: GridPartSpec, label: string, palette: Record<string, unknown>): VoxelGrid`
    throws `ProjectError` with the Python messages: `parts.X.size must be three positive
    integers`, `parts.X.voxels must be a string`, `parts.X.voxels uses unknown palette
    character 'c'`, `parts.X.voxels has N cells, size needs M`, `parts.X produces no
    voxels`.
  - `encodeGrid(g: VoxelGrid): string` (canonical form)
  - `getSlice(g: VoxelGrid, y: number): string[]` returns `d` rows of `w` chars. Row
    index = z (row 0 = back, last row = front).
  - `setSlice(g: VoxelGrid, y: number, rows: string[]): VoxelGrid` (new grid)
  - `resizeGrid3(g: VoxelGrid, w: number, h: number, d: number): VoxelGrid` keeps cells
    centred in X/Z (offset `floor((new-old)/2)`) and anchored at y = 0.
- Produces (`types.ts`): `type PartSpec = DrawnPartSpec | GridPartSpec`, where
  `DrawnPartSpec = {front, back, side?, left?, right?, pivot?}` and
  `GridPartSpec = {size: Vec3, voxels: string, pivot?}`.
- Produces (`engine.ts`): `validateProject` accepts grid parts, and `voxels(d, part)`
  returns `{p, c, n}` for grid parts with `n` = radial ellipsoid normal (as Python
  `_voxel_grid`).

- [ ] **Step 1: Write failing tests in `web/src/voxelgrid.test.ts`**

```ts
import qio from '../../examples/qio.yaml?raw';
// encodeGrid(decodeGrid(spec)) === spec.voxels for every part of yaml.load(qio)
test('round-trips every qio part', ...)
test('decode order is x, then z, then y', () => {
  const g = decodeGrid({size: [2, 2, 2], voxels: 'ab6.'}, 'p', {a: '#000', b: '#fff'});
  expect(g.cells[0]).toBe('a'); expect(g.cells[1]).toBe('b');
  expect(getSlice(g, 0)).toEqual(['ab', '..']); expect(getSlice(g, 1)).toEqual(['..', '..']);
});
test('cell count mismatch', () => expect(() => decodeGrid({size: [2, 2, 2], voxels: '7a'}, 'p', {a: '#000'}))
  .toThrow('parts.p.voxels has 7 cells, size needs 8'));
test('encode writes count only when > 1', () => expect(encodeGrid({w: 3, h: 1, d: 1, cells: ['a', 'a', 'b']})).toBe('2ab'));
test('resizeGrid3 centres x/z, anchors y', ...) // 1x1x1 'a' -> 3x2x3: cell at x=1, z=1, y=0; y=1 empty
test('setSlice replaces only that slice', ...)
```

Add to `engine.test.ts`: `validateProject(yaml.load(qio))` does not throw, and
`render(qioDoc, 'idle', 0, 0)` returns a canvas with non-zero alpha pixels. Use the
existing canvas test helpers in `test-helpers.ts`.

- [ ] **Step 2:** Run `cd web && npx vitest run src/voxelgrid.test.ts src/engine.test.ts`.
  Expected: FAIL (module missing / `rows` of undefined).
- [ ] **Step 3:** Implement `voxelgrid.ts`, the `types.ts` union, and the grid branch in
  `validateProject` (before the front/back/side checks, `continue` after validating grid
  plus pivot) and in `voxels()`.
- [ ] **Step 4:** Run `cd web && npx vitest run && npx tsc -b`. Expected: all pass, no type
  errors. Fix `app.ts` type errors with the narrowest cast; real UI handling is Task 2.
- [ ] **Step 5: Commit**

```bash
git add web/src/voxelgrid.ts web/src/voxelgrid.test.ts web/src/types.ts web/src/engine.ts web/src/engine.test.ts examples/qio.yaml scripts/gen_qio.py
git commit -m "feat(web): voxel-grid parts in the TS engine"
```

### Task 2: Slice painter in the editor

**Files:**
- Modify: `web/index.html:50-54` (add `<article data-kind="grid">` with `sliceCanvas`,
  slice slider `#sliceIndex`, label `#sliceLabel`, and a ghost toggle `#sliceGhost`)
- Modify: `web/src/app.ts`: `rows`/`setRows` (76-81), `renderDimensions` (388),
  `renderCanvases` (395), `drawCanvas` (399, onion skin), `bindCanvas` loop (2980),
  `resizePart` (970), `renameColor`/`deleteColor` (1002-1040), `syncSilhouette`
  (hidden for grid parts), `updatePreview`
- Modify: `web/src/style.css` (ghost cells, slider)
- Test: `web/tests/slice_painter.spec.ts` (Playwright), `web/src/voxelgrid.test.ts`

**Interfaces:**
- Consumes: Task 1 `decodeGrid`, `encodeGrid`, `getSlice`, `setSlice`, `resizeGrid3`,
  `isGridPart`.
- Produces: `state.slice: number` (current Y, clamped on part switch), plus `rows('slice')`
  and `setRows('slice', rows)`. The latter re-encodes into `spec.voxels`.
- Produces in `voxelgrid.ts`: `replaceChar(g: VoxelGrid, from: string, to: string): VoxelGrid`
  and `usesChar(spec: PartSpec, ch: string): boolean`. `usesChar` covers drawn views
  (front/back/side/left/right) and grid cells. `app.ts` palette rename/delete use these.

- [ ] **Step 1: Write failing tests**
  - vitest: `replaceChar` swaps all cells; `usesChar` is true for a grid cell and for a
    `left` view char.
  - Playwright `slice_painter.spec.ts` loads Qio through the existing project-load path
    used by `editor_workflow.spec.ts`:
    - (a) No error banner. The `head` part shows `#sliceCanvas` and hides the
      front/side/back articles.
    - (b) Painting one cell on slice 0 and saving yields YAML whose `head.voxels` decodes
      with that cell changed.
    - (c) Up/down arrow keys change `#sliceLabel` (`Slice 1 / 21`).
    - (d) Renaming palette char `r` to `Z` updates `head.voxels`.
    - (e) "Duplicate part" on `head` creates a grid part.
    - (f) Resizing to depth 26 keeps the voxel count.
- [ ] **Step 2:** Run `cd web && npx vitest run src/voxelgrid.test.ts && npx playwright test tests/slice_painter.spec.ts`.
  Expected: FAIL.
- [ ] **Step 3:** Implement.
  - For grid parts, `renderCanvases` hides the `front/side/back` articles, shows the grid
    article and draws `slice`.
  - `drawCanvas('slice')` first paints `getSlice(g, state.slice - 1)` cells at 25% alpha
    when `#sliceGhost` is checked.
  - `renderDimensions` shows `size` for grid parts. `resizePart` calls `resizeGrid3`.
  - The 3D part preview (the existing `updatePreview` part mode) passes the current slice.
    Highlighting is a one-voxel-tall outline drawn in the preview overlay at
    `y = state.slice`. Skip it in Python-rendered previews if the overlay is not
    available there, and note that in the commit.
- [ ] **Step 4:** Run `cd web && npx vitest run && npx playwright test && npx tsc -b`.
  Expected: all pass.
- [ ] **Step 5:** Commit: `feat(web): slice painter for voxel-grid parts`.

### Task 3: Fix `export.shell` gaps (Python)

**Files:**
- Modify: `spritebuilder/project.py:220-246` (`_surface`)
- Test: `tests/test_shell.py` (create)

**Interfaces:** none new. `_surface(part, shell, surface_normals)` keeps its signature.

- [ ] **Step 1: Write failing tests in `tests/test_shell.py`**

```python
def _frames(project):  # render every selected clip x direction x frame via render_pose/evaluate_pose
def test_shell_matches_full_render_on_qio():
    # load examples/qio.yaml twice with export.shell False / True (edit the raw dict)
    # for each frame pair: identical alpha>0 masks; differing RGB pixels <= 2% of opaque pixels
def test_shell_matches_on_mundus_orc():  # examples/mundus/orc-male-adult.json, same checks
def test_shell_still_removes_voxels():
    # dense 9x9x9 voxel-grid cube: shell part has fewer than 60% of the full part's voxels
```

- [ ] **Step 2:** Run `python3 -m pytest tests/test_shell.py -v`. Expected: the Qio test
  FAILS with an alpha-mask mismatch.
- [ ] **Step 3:** Change the keep rule to "any of the 26 neighbours is empty". If the
  parity test still fails, keep voxels within Chebyshev distance 2 of an empty cell.
  Record which rule passed in the commit message.
- [ ] **Step 4:** Run `python3 -m pytest tests -q`. Expected: all pass.
- [ ] **Step 5:** Commit: `fix: shell keeps enough voxels to avoid see-through gaps`.

### Task 4: Export through Python in `spritebuilder edit` mode

**Files:**
- Modify: `spritebuilder/editor_server.py` (new route in `_api_mutation`)
- Modify: `web/src/runtime.ts:654-705` (split packaging out of `exportProjectZip`)
- Modify: `web/src/app.ts:3024` (export handler), `web/index.html` (one-line note in the
  export dialog, shown only when there is no `token`)
- Test: `tests/test_editor.py` (extend), `web/tests/export_player.spec.ts` (extend)

**Interfaces:**
- Produces (server): `POST /api/export` with body `{document: <project>}`. The
  document's `export` block already holds the user's chosen animations and directions.
  Response 200 is `{name: str, png: <base64>, json: <metadata dict>}`. Implementation:
  `compile_project(document, session path)` then `build_project` into a
  `tempfile.TemporaryDirectory`. Errors: 422, as for other routes.
- Produces (runtime): `packageExportZip(d: ProjectDocument, png: Uint8Array, meta: object, includePlayer: boolean): void`.
  This is the zip/download half of `exportProjectZip`, which now calls it.
- Browser note text (exact): `Browser export is a quick preview: no lighting, trim, or
  shell. Use "impossibru edit" for final spritesheets.`

- [ ] **Step 1: Write failing tests**
  - `tests/test_editor.py`: post Qio's document with one voxel changed. The response PNG
    equals `build_project` run on that edited document, not the on-disk file. A broken
    document returns 422.
  - Playwright: in token mode, Export produces a zip whose PNG size equals the server's
    PNG size. In browser mode the note is visible.
- [ ] **Step 2:** Run `python3 -m pytest tests/test_editor.py -q`. Expected: FAIL (404).
- [ ] **Step 3:** Implement the route. In `app.ts`, when `token` is set, call
  `request('/api/export', {method: 'POST', body: JSON.stringify({document: clone(state.doc)})})`
  and pass the decoded PNG and metadata to `packageExportZip`. Without a token, keep
  `exportProjectZip`.
- [ ] **Step 4:** Run `python3 -m pytest tests -q && cd web && npx playwright test tests/export_player.spec.ts`.
  Expected: pass.
- [ ] **Step 5:** Commit: `feat: editor exports through the Python builder in edit mode`.

### Task 5: Part swaps (Python)

**Files:**
- Modify: `spritebuilder/project.py:486-492` (bone-track validation)
- Modify: `spritebuilder/animation.py` (new function)
- Modify: `spritebuilder/render.py:37-49` (`render_pose`)
- Modify: `spritebuilder/exporter.py:36,65-68`, `spritebuilder/editor_server.py:171,194-203`
- Test: `tests/test_part_swaps.py` (create)

**Interfaces:**
- Produces: `active_parts(project: Project, clip: Optional[Clip], frame: int) -> Dict[str, Optional[str]]`
  in `animation.py`. It maps each bone to the part to draw. Without a clip, or without a
  `part` track, the result is `bone.part`. Otherwise it uses step sampling via
  `_track_segment`, with loop wrap.
- Produces: `render_pose(project, pose, direction, size=None, origin=None, parts: Optional[Dict[str, Optional[str]]] = None)`.
  When `parts` is given, it's used instead of `bone.part`. Attachment still comes from
  the bone.
- Validation messages:
  - `"{label}.bones.{bone}.part[{frame}].value must be a part name or null"`
  - `"{label}.bones.{bone}.part references missing part {name!r}"`
  - The interpolation message from Global Constraints.
  - Frame rules reuse `_keys` logic. Refactor `_keys` to take `width=0` meaning "no value
    check", then validate values separately.

- [ ] **Step 1: Write failing tests in `tests/test_part_swaps.py`**

```python
# fixture: humanoid example + parts.head_alt = copy of head recoloured; clip 'idle' bones.head.part keys
def test_before_first_key_uses_rig_part()      # keys at frame 2 -> frame 0,1 'head'
def test_step_hold_until_next_key()             # frame 2,3 -> 'head_alt'
def test_loop_wraps_last_key()                  # loop clip, keys [1:'head_alt',3:'head'] -> frame 0 == 'head'
def test_null_hides_part()                      # render with null: head-coloured pixels absent
def test_missing_part_rejected()                # ProjectError "references missing part 'nope'"
def test_interpolation_rejected()
def test_export_uses_swapped_part()             # build_project frame pixels differ between frames 1 and 2
def test_unswapped_projects_unchanged()         # humanoid walk: render_pose(..., parts=active_parts(...)) bytes == render_pose(...) without parts
```

- [ ] **Step 2:** Run `python3 -m pytest tests/test_part_swaps.py -v`. Expected: FAIL.
- [ ] **Step 3:** Implement. Pass `active_parts(...)` at every `render_pose` call site
  that has a clip: exporter (both paths) and the server's `/api/preview` and
  `/api/rig/preview` in animate mode.
- [ ] **Step 4:** Run `python3 -m pytest tests -q`. Expected: all pass.
- [ ] **Step 5:** Commit: `feat: per-frame part swap tracks`.

### Task 6: Part swaps (TypeScript engine + timeline)

**Files:**
- Modify: `web/src/types.ts` (`ClipSpec.bones[...].part?: Key<string | null>[]`)
- Modify: `web/src/engine.ts:795-805` (validation), `engine.ts` `render` (1118+)
- Modify: `web/src/app.ts`: `renderTimeline` (2223 track list), `renderKeyInspector`
  (1460, a dropdown for part keys with "none"), `putKey` (1340), `renamePart` (922,
  rewrite keys), `deletePart` (940, refuse while referenced:
  `Part 'X' is used by animation 'Y'`)
- Test: `web/src/engine.test.ts`, `web/tests/animation_timeline.spec.ts`

**Interfaces:**
- Produces: `activeParts(d: ProjectDocument, clip: string | undefined, frame: number): Record<string, string | null>`
  in `engine.ts`, with the same semantics as Python `active_parts`. `render()` uses it.
  The validation messages are identical to Task 5's.

- [ ] **Step 1:** Write failing vitest cases mirroring Task 5's first six tests, using
  `activeParts` and `validateProject`. Add Playwright cases:
  - Select bone `head`, then the `part` row, then frame 2, pick `head_alt`: the YAML has
    the key.
  - Renaming `head_alt` rewrites the key.
  - Deleting `head_alt` is refused with the message above.
- [ ] **Step 2:** Run `cd web && npx vitest run src/engine.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. The `part` row appears only for bones (not IK chains). Its
  key diamonds use the existing track-row markup.
- [ ] **Step 4:** Run `cd web && npx vitest run && npx playwright test && npx tsc -b`.
  Expected: pass.
- [ ] **Step 5:** Commit: `feat(web): part swap track in engine and timeline`.

### Task 7: Left/right views (Python)

**Files:**
- Modify: `spritebuilder/project.py:174-218` (`_voxelize`)
- Test: `tests/test_side_views.py` (create)

**Interfaces:** none new.
- Messages:
  - `parts.X: use either side or left/right, not both`
  - `parts.X: left and right must both be given`
  - `parts.X: left/right silhouettes differ at row R, column C`
  - The existing height message now reads "front, back, and side views", with `side`
    standing for left/right too.

- [ ] **Step 1: Write failing tests**

```python
def test_side_only_unchanged()        # humanoid with every part's side copied into left=right (side removed) renders identical bytes
def test_left_colours_plus_x()        # part 3x3x3, left all 'a', right all 'b': voxel at x=2 side-dominant -> colour a; x=0 -> b
def test_side_and_left_rejected()
def test_only_left_rejected()
def test_left_right_outline_mismatch_rejected()
```

- [ ] **Step 2:** Run `python3 -m pytest tests/test_side_views.py -v`. Expected: FAIL.
- [ ] **Step 3:** Implement. Outline = `left`. In the colour branch use
  `left[row][z] if radial[0] >= 0 else right[row][z]`.
- [ ] **Step 4:** Run `python3 -m pytest tests -q`. Expected: all pass.
- [ ] **Step 5:** Commit: `feat: separate left and right side views`.

### Task 8: Left/right views (TypeScript engine + editor toggle)

**Files:**
- Modify: `web/src/engine.ts` (validation and `voxels()` colour branch, same rules and
  messages as Task 7)
- Modify: `web/index.html` (add `leftCanvas` and `rightCanvas` articles labelled
  `Left +X` and `Right −X`, plus a checkbox `#separateSides` "Separate left/right" in the
  part toolbar)
- Modify: `web/src/app.ts`:
  - `renderCanvases`, `bindCanvas` loop, `renderDimensions`, `resizePart` (resize both).
  - `writeCell`: painting empty or filled on `left` mirrors the outline into `right`, the
    way front and back already sync.
  - Toggle handler: on copies `side` to both and deletes `side`. Off asks
    `modalConfirm("Keep the left view as the single side view? Right-side paint will be lost.")`,
    then sets `side = left` and deletes both. Both directions call `checkpoint()` first.
- Test: `web/src/engine.test.ts`, `web/tests/painting_palette.spec.ts`

**Interfaces:** Consumes Task 2's `usesChar` (it already covers left/right).

- [ ] **Step 1:** Write failing tests:
  - vitest mirrors of Task 7's tests (colours compared via `voxels()`).
  - Playwright:
    - The toggle shows four views.
    - Painting `left` changes only `left` colours.
    - Erasing a `left` cell also empties `right`.
    - Toggling off keeps `left` as `side`.
    - Undo restores `left`/`right`.
- [ ] **Step 2:** Run `cd web && npx vitest run src/engine.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `cd web && npx vitest run && npx playwright test && npx tsc -b`.
  Expected: pass.
- [ ] **Step 5:** Commit: `feat(web): separate left/right side views`.

### Task 9: Qio expressions, shell on, round-trip, docs

**Files:**
- Modify: `scripts/gen_qio.py`, regenerate `examples/qio.yaml`
- Modify: `README.md` (document `left`/`right`, voxel-grid parts + slice painter, `part`
  tracks, edit-mode export)
- Run `python scripts/sync_web.py` after `cd web && npm run build`
- Test: `tests/test_qio.py` (create)

**Interfaces:** Consumes everything above.

- [ ] **Step 1: Write failing tests in `tests/test_qio.py`**

```python
def test_qio_has_expression_parts()   # parts head_blink, head_wink exist; same size as head
def test_idle_blinks()                # active_parts(idle, f) has 'head_blink' for exactly the blink frames, 'head' otherwise
def test_thumbs_up_winks()            # some frame of thumbs_up uses 'head_wink'
def test_qio_shell_enabled()          # export.shell is True and test_shell parity holds (reuse helper)
```

- [ ] **Step 2:** Run `python3 -m pytest tests/test_qio.py -v`. Expected: FAIL.
- [ ] **Step 3:** In `gen_qio.py`, factor the head into `head(expression: str)` with
  three variants:
  - `open`: as now.
  - `blink`: both eyes replaced by 3-wide `k` arcs, i.e. row `cy` at `|dx-ex| ≤ 1` plus
    row `cy+1` at `|dx-ex| = 1` flipped into a downward "∩" (a closed happy eye).
  - `wink`: the left eye (+X) is a blink arc and the right eye is open.

  Then:
  - `idle`: `head.part` keys `[{frame: 5, value: head_blink}, {frame: 6, value: head}]`.
  - `thumbs_up`: `[{frame: 2, value: head_wink}, {frame: 6, value: head}]`.
  - `export.shell: True`. Set the default of `QIO_SHELL` to `"1"`.

  Regenerate with `python3 scripts/gen_qio.py`.
- [ ] **Step 4:** Run `python3 -m pytest tests -q && cd web && npx vitest run && npx playwright test`.
  Then rebuild Qio with `python3 -m spritebuilder build examples/qio.yaml --output /tmp/qio-check`
  and look at the PNG. Expected: all pass, with a blink frame visible in `idle`.
- [ ] **Step 5:** Run the manual check: `python3 -m spritebuilder edit examples/qio.yaml`.
  It should open with no error, let you paint a slice, save, and export. The exported PNG
  should equal the CLI build of the saved file (compare bytes).
- [ ] **Step 6:** Commit: `feat: Qio blink and wink expressions; docs for new part features`.

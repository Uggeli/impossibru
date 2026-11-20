# Qio expressions and action vocabulary: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Qio gets sticker faces, pop-in effect props, about 15 named clips for the AI
assistant, front + 3/4 export, and a JS player controller that sequences clips.

**Architecture:** All character work stays in `scripts/gen_qio.py`, which regenerates
`examples/qio.yaml`. No engine changes: faces are one-voxel-deep parts on a new `face`
bone (child of `head`) swapped by the existing `part` track, and props are bones whose rig
part is `null` until a part key shows them. The player gains `createController()` in
`examples/javascript/sprite-player.js`, pure timing logic over the existing
`loadSprite()` object, so it's unit-testable with a fake sprite.

**Tech Stack:** Python 3.9+ with numpy, Pillow and PyYAML (pytest / unittest);
browser ES module; vitest in `web/`.

**Spec:** `docs/superpowers/specs/2026-11-20-qio-expressions-vocabulary-design.md`
(reference art: `docs/superpowers/specs/qio-reference/*.png`)

## Global Constraints

- `examples/qio.yaml` is always generated: `python3 scripts/gen_qio.py`. Never hand-edit it.
  Every task that changes `gen_qio.py` regenerates and commits the YAML too.
- No changes to `spritebuilder/` (Python engine) or `web/src/engine.ts`. No atlas format change.
- `export.directions: [0, 45, 315]`. Yaw 45 shows Qio turned to face **screen-right**,
  315 **screen-left** (from `camera_yaw`: forward +Z maps to +X screen at 45). Task 4's test
  confirms this.
- Character's left = +X = bones named `left_*` (existing convention, `sx = 1`).
- Face part names: `face_happy` (rig default), `face_blink`, `face_wink`, `face_excited`,
  `face_thinking`, `face_surprised`, `face_content`, `face_worried`.
- Prop part/bone names: `fx_question`, `fx_exclaim`, `fx_stars`, `fx_note` (bones parented
  to `head`); `fx_swirl` (bone parented to `root`). Bone name = part name. Rig part is `null`.
- Palette: keep existing keys; at most one new key.
- `head_blink` and `head_wink` are removed.
- Clip table (name → loop): `idle` yes, `float` yes, `listen` yes, `think` yes,
  `point_{left,right}_{up,level,down}` no, `present` no, `confused` no, `celebrate` no,
  `wave` no, `surprised` no, `content` yes, `thumbs_up` no, `walk` yes.
- No root yaw in any clip; torso yaw at most ±10°.
- Python tests: `python3 -m pytest -q tests/` from repo root. Web tests: `cd web && npm test`.

## Review Focus

1. **The face sticker must stay on the face, including in the 3/4 views.** Expect the
   sticker to be visible at 0/45/315 and invisible from behind (Task 1 render test).
2. **Clips must not get cropped.** Jumps, raised arms and props must stay inside the export
   frame (Task 3 border test covers all clips × directions).
3. **Props must not leak into clips that don't use them.** Expect `fx_*` to be hidden on
   every frame of `idle` and `walk` (Task 2/3 test).
4. **Calls that interrupt each other in the player.** Expect `play('wave')` during a
   one-shot to restart cleanly, and `loop()` after `hold()` to release the hold (Task 5 tests).
5. **Missing clip in an older atlas.** `pointAt` on an atlas without point clips throws
   `Unknown clip: point_left_up` instead of drawing nothing (Task 5 test).

---

### Task 1: Sticker faces and front/3-4 export

**Files:**
- Modify: `scripts/gen_qio.py` (`head()`, new `face()`, `build()`)
- Modify: `examples/qio.yaml` (regenerated)
- Test: `tests/test_qio.py` (replace `test_qio_has_expression_parts`, `test_idle_blinks`, `test_thumbs_up_winks`)

**Interfaces:**
- Produces: `head()` returns the blank head (no expression argument); `face(name: str)`
  returns a part dict for the eight names above; `build()` rig has bone
  `face: {parent: "head", part: "face_happy", translation: [...]}`; a module-level
  `FACES` tuple with the eight names in Global Constraints order; helper
  `render_without(project, pose, direction, bones)` lives in the test file.

- [ ] **Step 1: Write the failing tests** in `tests/test_qio.py`:

```python
FACES = ("happy", "blink", "wink", "excited", "thinking", "surprised", "content", "worried")

def test_faces_are_thin_stickers(self):
    raw, _ = load()
    sizes = {tuple(raw["parts"][f"face_{n}"]["size"]) for n in FACES}
    self.assertEqual(len(sizes), 1)                      # all faces same grid
    (w, h, d), = sizes
    self.assertEqual(d, 1)
    self.assertLessEqual(max(w, h), 17)
    total = sum(len(raw["parts"][f"face_{n}"]["voxels"]) for n in FACES)
    self.assertLess(total, len(raw["parts"]["head"]["voxels"]))   # all 8 < one head
    self.assertNotIn("head_blink", raw["parts"])
    self.assertNotIn("head_wink", raw["parts"])
    self.assertEqual(raw["rig"]["bones"]["face"]["parent"], "head")
    self.assertEqual(raw["rig"]["bones"]["face"]["part"], "face_happy")

def test_face_sticker_visible_front_and_three_quarter_only(self):
    _, project = load()
    pose = evaluate_pose(project, project.clips["idle"], 0)
    for yaw in (0, 45, 315):
        self.assertGreater(face_pixels(project, pose, yaw), 20, yaw)
    self.assertEqual(face_pixels(project, pose, 180), 0)

def test_export_directions_front_and_three_quarter(self):
    raw, _ = load()
    self.assertEqual(raw["export"]["directions"], [0, 45, 315])

def test_idle_blinks(self):        # same as today but on the face bone
    ...  # face == "face_blink" exactly on frame [5], "face_happy" elsewhere

def test_thumbs_up_winks(self):
    ...  # face_wink and face_happy both appear on the face bone
```

`face_pixels(project, pose, yaw)` = number of pixels that differ between
`render_pose(project, pose, yaw)` and the same render with `parts={**active, "face": None}`.

- [ ] **Step 2: Run** `python3 -m pytest -q tests/test_qio.py`. Expected: the new tests FAIL
  (`face_happy` KeyError / directions mismatch).

- [ ] **Step 3: Implement in `scripts/gen_qio.py`.**
  - `head()`: drop the `expression` parameter and the `front_paint(face)` call. Keep the white
    disc at `face_z`.
  - `face(name)`: a `Grid(15, 15, 1)` centred on the disc. Reuse the current eye, closed-eye,
    cheek and smile shapes for `happy`, `blink` and `wink`. Draw the other five to match the
    expression row on the mascot concept sheet: star eyes in `y` for `excited`, one raised
    brow for `thinking`, round eyes and an "o" mouth for `surprised`, closed arcs for
    `content`, slanted brows and a wavy mouth for `worried`. Pivot it so that with the bone at
    `[0, cy - 1, face_z + 1 - cz]` (head space, relative to the head pivot `[cx, 1, cz]`) the
    sticker sits one voxel in front of the disc. If the 0/45/315 renders show gaps at the disc
    rim, try a half-voxel offset (spec leaves this to the builder).
  - `build()`: add the eight `face_*` parts, remove the `head_blink`/`head_wink` entries, add
    the `face` bone, move the idle blink and the thumbs_up wink part keys from `head` to
    `face`, and set `directions: [0, 45, 315]`.

- [ ] **Step 4: Regenerate and test.** `python3 scripts/gen_qio.py && python3 -m pytest -q tests/`.
  Expected: all pass, including `test_qio_shell_enabled`.

- [ ] **Step 5: Eyeball.** `python3 -m spritebuilder build examples/qio.yaml` (output in
  `dist/`). Open `dist/qio.png` and check the faces at all three angles against
  `qio-reference/mascot-concept.png`.

- [ ] **Step 6: Commit.** First commit the spec, reference art and this plan on their own:
  `docs/superpowers/specs/2026-11-20-qio-expressions-vocabulary-design.md`,
  `docs/superpowers/specs/qio-reference/` and `docs/superpowers/plans/2026-11-20-qio-expressions-vocabulary.md`,
  with `docs: Qio expressions and vocabulary design and plan`. Then commit
  `scripts/gen_qio.py examples/qio.yaml tests/test_qio.py` with
  `feat: Qio sticker faces and front/3-4 export`.
  (Tests import `evaluate_pose` from `spritebuilder.animation` and `render_pose`,
  `camera_yaw` from `spritebuilder.render`.)

### Task 2: Effect props

**Files:**
- Modify: `scripts/gen_qio.py` (new `fx_question()`, `fx_exclaim()`, `fx_stars()`, `fx_note()`, `fx_swirl()`; `build()`)
- Modify: `examples/qio.yaml`
- Test: `tests/test_qio.py`

**Interfaces:**
- Consumes: Task 1 rig.
- Produces: bones `fx_question`, `fx_exclaim`, `fx_stars`, `fx_note` (parent `head`,
  placed above or beside the head the way the sheet shows them) and `fx_swirl` (parent
  `root`, under the feet), each with rig `part: null` and a part of the same name. A
  module-level `FX` tuple with the five names.

- [ ] **Step 1: Write the failing test** `test_props_hidden_by_default`. For each name in
  `FX`, the bone exists, `raw["rig"]["bones"][n]["part"] is None`, the part `n` exists, and
  `active_parts(project, project.clips[c], f)[n] is None` for every frame of `idle` and
  `walk`.
- [ ] **Step 2: Run** it. Expected: FAIL (missing bone).
- [ ] **Step 3: Implement** the five part builders (small grids; red `?` and `!!` glyphs,
  yellow sparkles, a charcoal or red note, a white swirl ring) and the bones.
- [ ] **Step 4: Regenerate and run** `python3 scripts/gen_qio.py && python3 -m pytest -q tests/`. Expected: all pass.
- [ ] **Step 5: Commit** with `feat: Qio effect props (hidden by default)`.

### Task 3: Clip vocabulary (everything except pointing)

**Files:**
- Modify: `scripts/gen_qio.py` (`build()` animations; split into helper functions per clip if `build()` grows past ~150 lines)
- Modify: `examples/qio.yaml`
- Test: `tests/test_qio.py`

**Interfaces:**
- Consumes: `FACES`, `FX`, `key()`, `part_key()`.
- Produces: clips `idle float listen think present confused celebrate wave surprised content
  thumbs_up walk`, with loop flags from Global Constraints.

- [ ] **Step 1: Write the failing tests.**

```python
CLIPS = {  # name: (loop, faces that must appear, props that must appear)
    "idle": (True, {"face_happy", "face_blink"}, set()),
    "float": (True, set(), {"fx_swirl"}),
    "listen": (True, set(), set()),
    "think": (True, {"face_thinking"}, {"fx_question"}),
    "present": (False, {"face_excited"}, {"fx_stars"}),
    "confused": (False, {"face_worried"}, {"fx_question"}),
    "celebrate": (False, {"face_excited"}, {"fx_stars"}),
    "wave": (False, {"face_wink"}, set()),
    "surprised": (False, {"face_surprised"}, {"fx_exclaim"}),
    "content": (True, {"face_content"}, {"fx_note"}),
    "thumbs_up": (False, {"face_wink"}, set()),
    "walk": (True, set(), set()),
}

def test_clip_vocabulary(self):
    # for each clip: exists; clip.loop == loop; faces ⊆ {face part on any frame};
    # each prop is shown on ≥1 frame; props not listed are hidden on every frame
    # (exception: "listen" may use any face, "float" any face)

def test_no_clip_touches_frame_border(self):
    # every exported clip × every frame × directions [0,45,315]:
    # img = np.asarray(render_pose(project, evaluate_pose(...), yaw)); alpha = img[:,:,3]
    # assert alpha[0].max() == alpha[-1].max() == alpha[:,0].max() == alpha[:,-1].max() == 0

def test_no_root_yaw(self):
    # no clip has a rotation track on "root"; torso rotation Y component |≤ 10| in every key
```

  `test_no_clip_touches_frame_border` covers the point clips too once Task 4 adds them.
- [ ] **Step 2: Run.** Expected: FAIL (missing clips).
- [ ] **Step 3: Implement the clips** per the spec table (8–12 frames, 8–12 fps; one-shots
  end on a pose that cuts cleanly back to `idle` frame 0). Content cues:
  - `float`: legs tucked (`left_leg`/`right_leg` X about −40), bob of about 1 voxel, `fx_swirl` shown.
  - `listen`: head tilt about 10°, one hand raised to its headphone cup.
  - `think`: right hand at the chin, head tilt, `fx_question` popping in from frame 2.
  - `present`: tablet raised toward the viewer with both hands near it.
  - `confused`: both arms out in a shrug, `face_worried`.
  - `celebrate`: crouch then jump (root Y up about 3), arms up.
  - `wave`: right arm up waving, wink mid-clip.
  - `surprised`: small hop back, `fx_exclaim`.
  - `content`: slow sway, closed eyes, `fx_note`.
  - `thumbs_up`: rework to `loop: false` with the wink on the `face` bone.
  - Keep `idle` and `walk` motion as it is now.

  If the border test fails, grow `export.size` and move `origin` to suit, keeping the frame
  as tight as the clips allow.
- [ ] **Step 4: Regenerate and run** the full Python suite. Expected: all pass.
- [ ] **Step 5: Eyeball** the build in `examples/javascript/` (see Task 5) or in
  `python3 -m spritebuilder edit examples/qio.yaml`.
- [ ] **Step 6: Commit** with `feat: Qio assistant clip vocabulary`.

### Task 4: Point clips

**Files:**
- Modify: `scripts/gen_qio.py`, `examples/qio.yaml`
- Test: `tests/test_qio.py`

**Interfaces:**
- Produces: six clips `point_{left,right}_{up,level,down}`, `loop: false`, final frame held.
  `point_right_*` use `left_arm` (+X, screen-right at yaw 45); `point_left_*` use
  `right_arm`. The intended yaw is `{left: 315, right: 45}`. Task 5 hard-codes the same map.

- [ ] **Step 1: Write the failing test** `test_point_clips_reach_target_side_and_height`:

```python
YAW = {"left": 315, "right": 45}
for side in ("left", "right"):
    for height in ("up", "level", "down"):
        clip = project.clips[f"point_{side}_{height}"]
        self.assertFalse(clip.loop)
        pose = evaluate_pose(project, clip, clip.frames - 1)
        cam = camera_yaw(YAW[side])
        hand = cam @ pose[f"{'left' if side == 'right' else 'right'}_hand"][:3, 3]
        head = cam @ pose["head"][:3, 3]
        shoulder_y = (cam @ pose["left_arm"][:3, 3])[1]
        dx = hand[0] - head[0]
        self.assertGreater(dx if side == "right" else -dx, 4)       # hand out toward target side
        dy = hand[1] - shoulder_y
        {"up": lambda: self.assertGreater(dy, 3),
         "level": lambda: self.assertLess(abs(dy), 3),
         "down": lambda: self.assertLess(dy, -3)}[height]()
```

  Pose matrices are world-space 4×4 (`evaluate_pose` returns a bone → matrix dict).
- [ ] **Step 2: Run.** Expected: FAIL (missing clip).
- [ ] **Step 3: Implement** the six clips: a short wind-up into a held point (about 8 frames),
  head turned slightly toward the hand, torso twist ≤ 10°, `face_happy`. Tune the arm keys
  by eye in the intended 3/4 view.
- [ ] **Step 4: Regenerate and run** the full Python suite, including the Task 3 border test. Expected: all pass.
- [ ] **Step 5: Commit** with `feat: Qio point clips`.

### Task 5: Player controller and Qio demo page

**Files:**
- Modify: `examples/javascript/sprite-player.js` (add an exported `createController`)
- Create: `examples/javascript/qio.html` (vocabulary demo against `../../dist/qio.json`)
- Create: `web/src/sprite-player.test.ts`
- Modify: `spritebuilder/editor_static/**` (rebuilt, because `web/src/runtime.ts` bundles the player into ZIP exports)

**Interfaces:**
- Consumes: the `loadSprite()` result `{animations, draw(ctx, {clip, angle, elapsedMs, x, y, scale})}`, unchanged.
- Produces:

```js
export function createController(sprite, {
  idle = 'idle', angle = 0, pointYaw = { left: 315, right: 45 },
} = {}) → {
  play(clip, { then = idle } = {}),  // one-shot; on its last frame switches to `then` (looping)
  loop(clip),                        // loops until the next call
  hold(clip),                        // one-shot that stays on its last frame until the next call
  setAngle(deg),
  pointAt(fromX, fromY, toX, toY),   // screen coords, y down; side = sign(dx) (left if dx < 0),
                                     // height by angle a = atan2(fromY - toY, |dx|):
                                     // up if a > 25°, down if a < -25°, else level;
                                     // setAngle(pointYaw[side]); hold(`point_${side}_${height}`)
  draw(ctx, { x, y, scale = 1, now }),  // now = ms clock; returns current clip name
  get clip(),                        // current clip name
}
```

  Every call that switches clips throws `Error('Unknown clip: <name>')` if the clip is
  not in `sprite.animations`. A clip's start time is the `now` of the first `draw` after
  the switch. A one-shot is finished when `now - start >= frames.length * frame_duration_ms`
  (frames of the first direction).

- [ ] **Step 1: Write the failing tests** in `web/src/sprite-player.test.ts`, importing
  `createController` from `'../../examples/javascript/sprite-player.js'` (add `// @ts-ignore`
  if `tsc -b` objects to the JS import). Use a fake sprite whose `draw` records the
  `{clip, angle, elapsedMs}` it gets, with clips `idle` (loop, 4 frames, 100 ms),
  `wave` (one-shot, 3 frames, 100 ms), `think` (loop), and the six `point_*` (one-shot, 2 frames).
  - `play('wave')`: draws `wave` at now 0 and 250; at now 300 the clip is `idle` with elapsedMs 0.
  - `play('wave', {then: 'think'})` ends in `think`.
  - `hold('point_left_up')`: still `point_left_up` at now 10 000.
  - `play('wave')` at now 150 during another `wave`: restarts, so elapsedMs is 0 at the next draw.
  - `hold(...)` then `loop('think')`: the clip becomes `think`.
  - `pointAt(100, 100, 20, 100)` → `point_left_level`, angle 315; `pointAt(100,100,200,0)` →
    `point_right_up`, angle 45; `pointAt(100,100,120,300)` → `point_right_down`.
  - `play('nope')` throws `Unknown clip: nope`. `pointAt` on a sprite without point clips
    throws `Unknown clip: point_left_up` (or whichever it picked).
- [ ] **Step 2: Run** `cd web && npm test -- sprite-player`. Expected: FAIL (no export `createController`).
- [ ] **Step 3: Implement `createController`** in `sprite-player.js`. `loadSprite` stays unchanged.
- [ ] **Step 4: Run** `cd web && npm test`. Expected: all pass.
- [ ] **Step 5: Write `examples/javascript/qio.html`**, modelled on `index.html`: one button per
  clip (one-shots call `play`, loops call `loop`, point clips are skipped), an angle selector
  (0/45/315), and a canvas click that calls `pointAt` from Qio's position to the click. It
  loads `../../dist/qio.json`.
- [ ] **Step 6: Rebuild the editor bundle.** `cd web && npm run build && cd .. && python3 scripts/sync_web.py`.
  Expected: new hashed asset under `spritebuilder/editor_static/assets/`, `index.html` updated.
- [ ] **Step 7: Manual check.** `python3 -m spritebuilder build examples/qio.yaml`, then
  `python3 -m http.server` from the repo root. Open `/examples/javascript/qio.html` and
  click through every button and a few point targets. Confirm 45 faces screen-right.
- [ ] **Step 8: Commit** with `feat: sprite player controller and Qio demo page`.

### Task 6: Docs

**Files:**
- Modify: `README.md` (after the player section, near line 132)

- [ ] **Step 1: Document**
  - the Qio clip vocabulary table, with loop flags;
  - the recommended mapping from tiny-command results, copied from the spec;
  - the sticker-face pattern: a thin face part on a child bone, swapped with part keys, and
    props hidden with a `null` rig part;
  - the controller API with a five-line example (`play`, `loop`, `pointAt`);
  - how to open `examples/javascript/qio.html`.
- [ ] **Step 2: Verify** the README's code example runs: paste it into `qio.html`'s console
  against a built `dist/qio.json`. Also run `python3 -m pytest -q tests/ && (cd web && npm test)`;
  expect everything to pass.
- [ ] **Step 3: Commit** with `docs: Qio vocabulary, sticker faces, player controller`.

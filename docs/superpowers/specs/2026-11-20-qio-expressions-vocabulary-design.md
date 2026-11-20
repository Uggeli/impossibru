# Qio: expressions and an action vocabulary for the AI assistant avatar

## Intent

Qio, the PayiQ mascot (`scripts/gen_qio.py` → `examples/qio.yaml`), will become the
on-screen avatar of an AI assistant in the ticketing app and its demo. The user asks
something; Qio reacts with animations while the app carries it out. The driver is the
travel command model in `~/omat/tiny-command` (see `lab/COMMAND_PLAN.md`): it turns user
text into one of `route`, `ticket`, `departures`, `open_voucher`, `my_tickets`,
`unsupported`, and the app opens the matching view with fields prefilled.

Today Qio has three clips (`idle`, `walk`, `thumbs_up`) and three faces (open, blink,
wink), each face being a full copy of the head grid. The gap is **expressiveness and
vocabulary**, not the model's look.

Reference art: the PayiQ "Mascot concept art" sheet (expressions row: happy, wink,
excited, thinking, surprised, content; pose ideas: laptop, running, waving with phone)
and the "Product concept" sheet (floating with a small whirlwind, greet / buy / route /
done panels). Copies: `docs/superpowers/specs/qio-reference/mascot-concept.png` and
`product-concept.png`. Faces, props and poses should read like those sheets at sprite
size.

*(Design call)* Qio's existing tablet stands in for the sheet's phone in `present` and
`wave`; no separate phone or laptop part this round.

## Goals

1. **Ready-made named clips** the app plays by name. Mixing (face × body action) happens
   at authoring time in the YAML; the build bakes each combination into a clip.
2. **Cheap expressions.** A face is a thin sticker part swapped per frame, not a whole
   head. One blank head plus N small face parts.
3. **Effect props** (`?`, `!!`, stars, sparkle, music note) as small parts that pop in and
   out with part-swap keys (`none` hides a bone).
4. **Views:** front and the two 3/4 views only: `export.directions: [0, 45, 315]`.
5. **Player sequencing** in the JS player: play a clip once then return to idle; loop a
   clip until told otherwise; pick a point clip toward a screen position.

## Non-goals

- No runtime face/body compositing in the player and no change to the atlas PNG/JSON
  format.
- No squash-and-stretch / bone scale track. Deferred to a later engine round.
- No redesign of Qio's proportions or silhouette (headphones, Q-head, hood strings stay
  as they are, apart from the blank face the sticker needs).
- No integration code inside tiny-command or the ticketing app. The clip names are the
  interface; the intent → clip table below is a recommendation for whoever wires it up.
- Side and back views are no longer exported for Qio.

## Anti-goals

- The YAML growing by a full head grid (or anything similar) for every new expression.
- Faces that drift off the face disc, z-fight with it, or show through from the side in
  the 3/4 views.
- Clips that only make sense together with app-side tricks beyond moving the sprite and
  choosing a clip and angle.

## Design (decided)

### Faces as stickers

- `head` becomes a **blank head**: same shape, white face disc, no eyes, cheeks or mouth.
- A new `face` bone, child of `head`, carries a face part. Each face part is a grid one
  voxel deep covering the face disc (about 15×15), transparent except for the features.
  It sits just in front of the disc (`face_z + 1` in head space, or a half voxel if that
  renders cleanly). The renderer depth-sorts points, so the sticker draws over the disc.
- Expressions are swapped with the existing `part` track on the `face` bone.
- Faces (part names `face_<name>`):
  `happy` (current open smile, the default rig part), `blink`, `wink`, `excited`
  (star eyes), `thinking` (one brow up, flat mouth), `surprised` (round eyes, "o" mouth),
  `content` (closed happy arcs, small smile), `worried` (slanted brows, wobbly mouth).
- Cheek blush stays on the stickers, not on the head, so faces can drop it.
- `head_blink` and `head_wink` are removed; `tests/test_qio.py` is updated to pin the new
  structure (same-size faces, idle blink frame, wink in `thumbs_up`/`wave`).

### Effect props

Small parts on bones parented to `head` (or `root` for the whirlwind), hidden by default
(rig part set and the clip keys them in/out with part keys, `none` = hidden):
`fx_question` (red `?`), `fx_exclaim` (red `!!`), `fx_stars` (yellow sparkles),
`fx_note` (music note), `fx_swirl` (white whirlwind under the feet for `float`).
Colours come from the existing palette (`r`, `y`, `w`); add at most one more key if a
prop needs it.

### Clip vocabulary

| Clip | Loop | Used for | Content |
|---|---|---|---|
| `idle` | yes | waiting | breathing bob, antenna sway, blink |
| `float` | yes | app is moving the sprite | feet tucked, gentle bob, `fx_swirl` |
| `listen` | yes | user typing | head tilt, hand to headphone, `content`/`happy` |
| `think` | yes | model running | hand on chin, `thinking` face, `fx_question` |
| `point_{left,right}_{up,level,down}` | no (holds last frame) | route / departures / any UI element | turn toward side, arm points at height, `happy` |
| `present` | no | ticket / voucher found | holds the tablet up toward the viewer, `excited`, `fx_stars` |
| `confused` | no | `unsupported`, empty required field | shrug, `worried`, `fx_question` |
| `celebrate` | no | purchase done | jump, arms up, `excited`, `fx_stars` |
| `wave` | no | greeting | wave with a wink |
| `surprised` | no | extra | small hop back, `surprised`, `fx_exclaim` |
| `content` | yes | extra / quiet idle | eyes closed, sway, `fx_note` |
| `thumbs_up` | no | extra (existing, reworked onto the face bone) | |
| `walk` | yes | kept as is | |

"Loop: no" clips are exported with `loop: false`; the player returns to `idle` after
them (point clips hold until the app releases them).

Pointing: six clips, one per side × height, pointing with the arm nearer the target.
Each is meant to be shown at the 3/4 angle that turns Qio toward the target (left
target → the angle where he faces screen-left). The builder confirms which yaw (45 or
315) reads as facing left and records it in the docs and the player helper.

*(Design call)* The 3/4 export angle supplies the turn. Point clips move the arm, hand
and head, with at most a small torso twist (≤ 10°) for life; no root yaw, so Qio never
approaches profile and the face sticker only needs checking at 0/45/315. "Up / level /
down" are screen terms: where the hand ends up in the 3/4 image at its intended angle.
The arm keys are tuned by eye in that view.

### Recommended mapping from tiny-command results

| Result | Clip sequence |
|---|---|
| user starts typing | `listen` |
| model running | `think` |
| `route`, `departures` | `point_*` toward the opened view, then `idle` |
| `ticket`, `open_voucher`, `my_tickets` | `present` |
| `unsupported`, or a required field left empty | `confused` |
| user completes a purchase | `celebrate` |
| assistant opens | `wave` |

### Player

Extend `examples/javascript/sprite-player.js` without breaking `loadSprite().draw()`:

- a small controller over a loaded sprite: `play(clip, {then: 'idle'})` (one-shot, returns
  to `then` on its last frame), `loop(clip)`, `hold(clip)` (one-shot that stays on its last
  frame until the next call), `setAngle(deg)`, and `draw(ctx, {x, y, scale, now})`;
- `pointAt(fromX, fromY, toX, toY)`: picks side and height (up / level / down by angle
  to the target) and the matching yaw, then `hold`s the point clip;
- update `examples/javascript/index.html` to demo the vocabulary (buttons per clip and a
  click-to-point target).

### Docs

README section for Qio's clip vocabulary, the sticker-face pattern (as a technique other
characters can reuse), and the player controller API.

## Constraints

- Generation stays in `scripts/gen_qio.py`; `examples/qio.yaml` is its output and stays
  loadable in the web editor and in `spritebuilder edit`.
- Rendering parity checks used today (`assert_shell_parity` in `tests/test_qio.py`) keep
  passing.
- Export size/scale/origin may change if a clip (jump, raised arms, props) needs more
  room; keep the frame as tight as the clips allow.

## Left to the builder

- Exact keyframes, timings and frame counts per clip (aim for 8–12 frames at 8–12 fps).
- Exact voxel art of faces and props, matching the concept sheet's style.
- Sticker offset (whole vs. half voxel) — whichever renders without gaps or z-fighting
  in all three views.
- Whether the tablet is visible in every clip or only when used (`present`, `idle`).
- Player internals.

## Later (not this round)

- Bone scale track for squash and stretch (springier `celebrate`, `surprised`, `float`).

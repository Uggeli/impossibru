# Impossibru!

Build directional voxel spritesheets from text-drawn body parts and skeletal
animation keyframes. A project supplies front, back, and side ASCII views, a
generic bone hierarchy, optional two-bone IK chains, animation clips, and export
settings.

```bash
python3 -m spritebuilder validate examples/humanoid.yaml
python3 -m spritebuilder build examples/humanoid.yaml --output dist
# Installed packages also provide the preferred `impossibru` command.
```

The build writes one transparent PNG atlas and a JSON metadata file containing
animation names, camera directions, timings, frame rectangles, and pivots.

## Project format

YAML is used so the ASCII views remain readable. `.` is always empty; every
other character must exist in `palette`. A part occupies a voxel wherever its
front/back X-Y silhouette intersects its side Z-Y silhouette. Front and back
must have identical occupancy, but may use different colors. The side view
paints both left and right surfaces.

Rigs are generic parented bone trees. Coordinates are `+X` right, `+Y` up, and
`+Z` forward. Bone and attachment rotations are XYZ Euler degrees. Parts have
a voxel-space pivot; their positions and rotations are local to their bone.

Animation keyframes use integer frame numbers. Translation tracks interpolate
linearly, rotation tracks use shortest-path quaternion interpolation, and a key
may select `linear`, `smooth`, or `step` interpolation for the segment after it.
Looping clips interpolate across the last-to-first boundary.

IK chains name three directly parented bones (`root`, `mid`, `end`). Animation
tracks can keyframe their world-space `target`, world-direction `pole`, and
`weight`. Weight zero preserves FK, weight one applies the solved IK pose, and
intermediate values blend the two.

`export.animations` optionally selects the clips written to the atlas; when it
is omitted, all clips are exported for backward compatibility.
`export.directions` selects the yaw angles rendered for every chosen clip.

See [examples/humanoid.yaml](examples/humanoid.yaml) for the complete supported
schema and a project mixing FK arm tracks with IK leg tracks.

## Visual editor

The Impossibru! editor also runs entirely in your browser from GitHub Pages.
Projects stay on your device: open and save YAML directly where supported, or
use the download fallback. The same web build is served by the local Python
editor, whose authenticated file endpoints remain available for compatibility.

For development, run `npm install && npm run dev` in [`web`](web). Production
assets use relative URLs, so the build works both at a repository Pages path and
when copied into the Python package with `python scripts/sync_web.py`.

Launch the local editor for an existing project:

```bash
python3 -m spritebuilder edit examples/humanoid.yaml
```

Create a valid starter YAML, optionally opening it immediately:

```bash
python3 -m spritebuilder new my-character.yaml --edit
```

You can also use **New project** in the editor. Browser-created projects are
placed beside the currently open YAML and never overwrite an existing file.

The command opens a browser workspace for painting all three ASCII views,
managing parts and palette colors, resizing grids, previewing isolated parts or
the animated character, and saving the project. The editor binds only to
localhost. Changes stay in memory until Save is pressed, and saving is refused
if the YAML file changed externally or the edited project is invalid.

## Use an exported sprite in JavaScript

In the editor, choose **Export ZIP**, select your clips and directions, and check
**Include JavaScript player and decoder**. Extract the ZIP, run
`python3 -m http.server 8000` in the extracted directory, and open
`http://localhost:8000/player/`. The sample plays the exported PNG and JSON
in Canvas 2D with clip and direction selectors. Keep the YAML for future edits.

For a game, copy the player module, atlas PNG, and atlas JSON into your project.
This example assumes a canvas and a browser module script. Replace the filename
and clip with ones from your export.

```js
import { loadSprite } from './player/sprite-player.js';

const sprite = await loadSprite('./humanoid.json');
const ctx = document.querySelector('canvas').getContext('2d');
ctx.imageSmoothingEnabled = false;
const start = performance.now();
function frame(now) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  sprite.draw(ctx, { clip: 'walk', angle: 45, elapsedMs: now - start,
    x: ctx.canvas.width / 2, y: ctx.canvas.height * 0.8, scale: 2 });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

The player selects the closest exported yaw, follows the clip timing and loop
flag, and draws each frame at its pivot. To run the [repository demo](examples/javascript/index.html),
build `examples/humanoid.yaml` into `dist`, serve the repository root, and open
`/examples/javascript/`.

For original 3D sources that contain packed `size` and `voxels` fields, the
[voxel decoder](examples/javascript/decode-voxels.js) yields occupied cells in
part-local grid coordinates. Subtract the part pivot when positioning cells
relative to a bone. The editor's [Mundus examples](examples/mundus) use editable
front, side, and back views and can be played through the atlas export above.

```js
import { decodeVoxels } from './player/decode-voxels.js';

for (const { x, y, z, color } of decodeVoxels(project.parts.head, project.palette)) {
  // Add a cell at (x, y, z) using your renderer and the source palette color.
}
```

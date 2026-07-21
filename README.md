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

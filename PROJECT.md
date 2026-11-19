# Project: Impossibru Voxel Sprite Web Editor Overhaul

## Architecture
Impossibru is a voxel sprite authoring suite with a dual runtime architecture:
1. **Python Core / Server Mode (`spritebuilder/`)**:
   - `project.py`: Project document parser, compiler, schema validator, YAML serializer.
   - `rigging.py`: 3D bone hierarchy, rest pose evaluator, joint/IK transformations, reparenting math.
   - `animation.py`: Two-bone analytical IK solver, keyframe track evaluation, loop interpolation (`linear`, `smooth`, `step`).
   - `autorig.py`: Automated bone and IK chain placement from 3D voxel density.
   - `spring_bones.py`: Secondary motion and spring physics simulation.
   - `procedural.py`: Procedural animation generators (walk, breathe, attack).
   - `render.py`: Pixel-exact 3D software voxel rasterizer with shadow casting and outline effects.
   - `editor_server.py`: Local HTTP API (`/api/project`, `/api/validate`, `/api/preview`, `/api/rig`, `/api/rig/autorig`).
2. **Web Frontend / Browser Runtime (`web/`)**:
   - `src/app.ts`: Main application controller, UI event dispatching, inspector forms, undo/redo state stack.
   - `src/engine.ts`: Client-side math library, voxelizer, 2-bone IK solver, pose evaluator, renderer, document validator.
   - `src/runtime.ts`: Unified abstraction layer bridging Python backend API and offline IndexedDB/browser fallback.
   - `src/canvas.ts`: HiDPI canvas rendering, Bresenham line painting, fast flood fill, mirror symmetry.
   - `src/modal.ts`: Non-blocking in-DOM accessible modal dialog system.
   - `src/style.css`: Dark-theme CSS variables, responsive grid/flex layouts, modals, HUD overlays.
   - `index.html`: Semantic DOM for Parts (ASCII painting), Rig (3D bones & IK), and Animate (timeline & inspectors) workspaces.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | IK Pole Vector Math | Accurate root-relative pole vector projection in Python & TS | M1 | R2 / Survey |
| 2 | TS IK Solver & Overlays | Client-side 2-bone IK evaluation and chain overlay lines in `engine.ts` | M1 | R2 / Survey |
| 3 | Joint Drag Local Transform | Inverse parent transform computation in `runtime.ts` rest joint drag | M1 | R2 / Survey |
| 4 | Backend Autorig API Route | `POST /api/rig/autorig` endpoint in `editor_server.py` and `runtime.ts` | M1 | R2 / Survey |
| 5 | Strict TS Schema Parity | Align `engine.ts:validateProject` with Python `compile_project` | M1 | R2 / Survey |
| 6 | HiDPI & Interpolated Painting | `devicePixelRatio` scaling + Bresenham line interpolation in `drawCanvas` | M2 | R1, R2 / Survey |
| 7 | Painting Tools & Ergo | Mirror mode (`M`), Line (`L`), Rect (`R`), Replace (`C`), HUD, brush cursor | M2 | R1 / Survey |
| 8 | Silhouette Parity Inline HUD | Match error path and render red error box + one-click sync button | M2 | R1, R2 / Survey |
| 9 | Advanced Palette Manager | Hex input validation (`#RRGGBB`/`#RRGGBBAA`), replace color action, reordering | M2 | R1, R2 / Survey |
| 10 | Dark-Themed Modal Dialogs | Replace `prompt`/`alert`/`confirm` with non-blocking styled modals | M2 | R1 / Survey |
| 11 | Autorig UI Integration | Wire `#autoRigButton` click handler with preview updates | M3 | R1, R2 / Survey |
| 12 | Rig & Physics Inspectors | Implement UI & bindings for procedural, spring bones, constraints | M3 | R1, R2 / Survey |
| 13 | Rig Tree & Viewport Gizmos | Bone reparenting, IK target/pole drag manipulators, limits validation | M3 | R1, R2 / Survey |
| 14 | Timeline Keyframe Deletion | Clean up empty track keys on last keyframe deletion | M4 | R2 / Survey |
| 15 | Drag-to-Retime Keyframes | Interactive keyframe dragging on timeline track canvas | M4 | R1, R2 / Survey |
| 16 | Animation Playback Controls | `Space` toggle, `[`/`]` step, track toggles, looping interpolation | M4 | R1, R2 / Survey |
| 17 | Vitest Web Unit Test Suite | Comprehensive unit tests for engine math, IK, canvas, palette, runtime | M5 / Test Track | R3 / Survey |
| 18 | Playwright E2E Test Suite | End-to-end journey tests for all workspaces, tools, and error paths | M5 / Test Track | R3 / Survey |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Core Math, Engine Parity & Backend API | IK pole math, TS IK solver, joint drag inverse transforms, autorig API, schema validation | None | DONE |
| M2 | Painting Canvas, Tools & Palette Workspace | HiDPI canvas, Bresenham drawing, painting tools, silhouette highlight, palette manager, modals | M1 | DONE |
| M3 | Rigging, Autorig, Spring Physics & Inspectors | Autorig button wiring, procedural & spring inspectors, bone tree & IK viewport interactions | M1 | DONE |
| M4 | Animation Timeline, Keyframing & Playback | Keyframe cleanup, drag-to-retime, interpolation modes, playback shortcuts & controls | M1, M3 | DONE |
| M5 | Final Integration, E2E Test Pass & Hardening | Opaque-box E2E test pass (Tiers 1-4), adversarial test hardening (Tier 5), 100% verification | M1, M2, M3, M4 | DONE |

## Interface Contracts

### Python Backend ↔ Web Frontend API
- `POST /api/rig/autorig`:
  - Request: `{ "project": ProjectDict }`
  - Response: `{ "project": ProjectDict, "rig": RigDict }`
  - Error: `422 Unprocessable Entity` with `{ "error": string }`
- `POST /api/rig/drag`:
  - Request: `{ "project": ProjectDict, "kind": "joint"|"target"|"pole", "name": string, "world": [x, y, z], "mode": "rest"|"animate", "clip"?: string, "frame"?: number }`
  - Response: `{ "project": ProjectDict, "preview"?: string, "overlay"?: OverlayData }`
- `POST /api/validate`:
  - Request: `{ "yaml": string }` or `{ "project": ProjectDict }`
  - Response: `{ "valid": true }` or `{ "valid": false, "error": string, "path"?: string, "row"?: number, "column"?: number }`

### Client Engine Contract (`web/src/engine.ts`)
- `pose(d: ProjectDocument, clipName?: string, frame?: number): Record<string, Mat>`
  - Solves two-bone IK for all active chains in document after FK evaluation with root-relative pole projection and SLERP blending.
- `overlay(d: ProjectDocument, clip: string|undefined, frame: number, yaw: number): OverlayData`
  - Returns `bones: BoneOverlay[]` and `chains: ChainOverlay[]` with projected 2D coordinates and active solver flags.
- `solveTwoBoneIK(root: Vec3, mid: Vec3, end: Vec3, target: Vec3, pole: Vec3, limits?: AngleLimits): [Vec3, Vec3]`
  - Calculates relative pole vector `v_pole = pole - root` and returns joint rotations without gimbal lock or NaN.

## Code Layout
- `spritebuilder/`
  - `animation.py`: Python IK solver and track sampling
  - `editor_server.py`: REST endpoints including `/api/rig/autorig`
  - `rigging.py`: Bone hierarchy and rest pose transforms
  - `project.py`: Schema validation and compilation
- `web/`
  - `src/app.ts`: UI event bindings, inspectors, tools, modal manager
  - `src/engine.ts`: Math, IK, silhouette validation, local renderer
  - `src/runtime.ts`: Backend API client and offline draft persistence
  - `src/canvas.ts`: HiDPI canvas rendering, Bresenham line painting, fast flood fill, mirror symmetry
  - `src/modal.ts`: Non-blocking in-DOM accessible modal dialog system
  - `src/style.css`: Theme styles, modal overlays, canvas HUD
  - `index.html`: DOM structure for all editor workspaces
  - `tests/`: Vitest unit tests and Playwright E2E tests

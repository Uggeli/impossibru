# E2E Test Infra: Impossibru Voxel Sprite Web Editor

## Test Philosophy
- **Opaque-Box & Requirement-Driven**: Tests are designed strictly against the functional specification and acceptance criteria in `ORIGINAL_REQUEST.md`, independent of internal implementation artifacts.
- **Methodology**: 4-Tier Test Architecture combining:
  1. **Tier 1 (Feature Coverage)**: Equivalence class happy-path tests verifying isolated features across UI, Engine, and Backend.
  2. **Tier 2 (Boundary & Corner Cases)**: Boundary Value Analysis (BVA) for limits, empty/full grids, extreme angles, hex boundaries, malformed inputs, and rapid interactions.
  3. **Tier 3 (Cross-Feature Combinations)**: Pairwise combinatorial testing across interdependent systems (e.g., Palette edit + Canvas paint, Bone reparenting + IK pole vector, Autorig + Keyframe retiming).
  4. **Tier 4 (Real-World Application Scenarios)**: Full end-to-end user journeys and complex workflows validating complete production pipelines.

---

## Feature Inventory & Test Mapping

| # | Feature Area | Key Requirements & Capabilities | Tier 1 (Min 5) | Tier 2 (Min 5) | Tier 3 | Tier 4 |
|---|--------------|----------------------------------|:--------------:|:--------------:|:------:|:------:|
| 1 | **ASCII Painting Grid & Tools** | Front/back/side grids, pencil, eraser, fill, line, rect, replace, mirror mode, Bresenham interpolation, HiDPI scaling | 5 | 5 | ✓ | ✓ |
| 2 | **Silhouette Parity & Validation** | Real-time front/back silhouette mismatch detection, inline HUD red warning box, one-click silhouette sync | 5 | 5 | ✓ | ✓ |
| 3 | **Palette Operations & Schema** | Add/delete/reorder colors, hex validation (`#RRGGBB`/`#RRGGBBAA`), bulk color replacement across active model without dangling references | 5 | 5 | ✓ | ✓ |
| 4 | **Rigging & Inverse Kinematics** | Bone hierarchy, joint transforms, bone reparenting, root-relative pole vector projection, analytical 2-bone IK solver, angle limits, 2D overlays | 5 | 5 | ✓ | ✓ |
| 5 | **Autorig & Physics Inspectors** | Automated 3D voxel bone placement via API/UI button, procedural animators (walk, breathe, attack), spring bones secondary motion & damping | 5 | 5 | ✓ | ✓ |
| 6 | **Animation Timeline & Playback** | Keyframe creation/deletion/cleanup, drag-to-retime, interpolation modes (`linear`, `smooth`, `step`), loop boundary wrapping, spacebar playback, frame stepping | 5 | 5 | ✓ | ✓ |
| 7 | **File Operations, Persistence & Modals** | Direct file open/save, API sync (`/api/project`, `/api/validate`, `/api/preview`, `/api/rig`), download fallback, local storage caching, non-blocking modal dialogs, malformed YAML recovery | 5 | 5 | ✓ | ✓ |

---

## Test Architecture & Runners

### 1. Web Unit Test Suite (Vitest)
- **Location**: `web/src/**/*.test.ts`
- **Execution Command**: `npm test` (inside `web/`)
- **Scope**:
  - Vector & Matrix math operations (`Vec3`, `Mat`, quaternion/rotation transformations, determinant, inverse)
  - 2-Bone Analytical IK solver (`solveTwoBoneIK` with relative pole vectors, pole alignment, angle limits, singular degenerate cases)
  - Voxelizer & ASCII grid parsers (multi-view reconstruction, empty/full voxel slices, dimension boundaries)
  - Palette manager (hex parser, alpha support, color replacement, index remapping)
  - Schema validator & YAML parser (`validateProject`, backward compatibility, migration of missing clips/bones)
  - Runtime API client & Local storage persistence layer

### 2. Browser End-to-End Test Suite (Playwright)
- **Location**: `web/tests/**/*.spec.ts`
- **Execution Command**: `npx playwright test` (inside `web/`)
- **Configuration**: `web/playwright.config.ts` (starts Vite preview server at `http://127.0.0.1:4173`)
- **Scope**:
  - `web/tests/editor.spec.ts`: Welcome flow, project creation, workspace transitions.
  - `web/tests/procedural_editor.spec.ts`: Autorig button interaction, bone selection, procedural animation inspectors, screenshot artifact output to dynamic/safe directory.
  - `web/tests/painting_palette.spec.ts`: Painting tools, mirror drawing, line/rect tools, silhouette parity HUD, palette color addition/replacement/deletion, hex validation.
  - `web/tests/rigging_ik.spec.ts`: Bone tree reparenting, joint manipulator dragging, IK pole & target dragging, joint angle limit enforcement.
  - `web/tests/animation_timeline.spec.ts`: Keyframe insertion, deletion cleanup, drag-to-retime, interpolation toggling, timeline playback controls & shortcuts.
  - `web/tests/persistence_modals.spec.ts`: Modal dialog interactions, download fallback, corrupt YAML error handling, project export roundtrip.

### 3. Backend Test Suite (Python Unittest)
- **Location**: `tests/test_*.py`
- **Execution Command**: `python3 -m unittest discover tests`
- **Scope**: Core project parser, rigging math, autorig solver, spring physics, procedural generators, software voxel renderer, and REST API server.

---

## Real-World Application Scenarios (Tier 4)

| # | Scenario | Features Exercised | Description |
|---|----------|--------------------|-------------|
| 1 | **Greenfield Voxel Character Pipeline** | 1, 2, 3, 5, 6, 7 | From a blank project, customize palette, paint front/back/side with mirror tool, verify silhouette parity, run autorig, preview procedural walk cycle, and export YAML. |
| 2 | **Custom Humanoid Rigging & IK Setup** | 4, 5, 6, 7 | Load humanoid template, reparent arm/leg bones, position IK targets and pole vectors, adjust joint limits, keyframe a custom jump-attack animation, retime keyframes. |
| 3 | **Secondary Motion Spring Simulation** | 4, 5, 6 | Add hair/cape spring bones to a rigged character, configure stiffness and damping, run walk animation, verify physics-driven secondary motion. |
| 4 | **Silhouette Parity Mismatch & Repair Flow** | 1, 2, 7 | Deliberately create front/back voxel disparity, observe inline red error HUD, test automatic silhouette sync button, verify clean validation. |
| 5 | **Error Resilience & Malformed Input Recovery** | 7 | Import malformed and invalid YAML files, verify non-blocking dark-themed error modal dialogs, verify application state remains clean and responsive without crashes. |

---

## Coverage Thresholds & Pass Criteria
- **Tier 1 (Feature Coverage)**: ≥ 35 test cases (≥ 5 per feature area).
- **Tier 2 (Boundary & Corner Cases)**: ≥ 35 test cases (≥ 5 per feature area).
- **Tier 3 (Cross-Feature Combinations)**: ≥ 10 comprehensive pairwise test cases.
- **Tier 4 (Real-World Application Scenarios)**: ≥ 5 end-to-end journey tests.
- **Execution**: 100% passing across Vitest (`npm test`), Playwright (`npx playwright test`), and Python (`python3 -m unittest discover tests`) with exit code 0.

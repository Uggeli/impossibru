"""Generate fuzz and edge-case project documents to test schema parity between Python and TS."""
import json
import unittest
from pathlib import Path

from spritebuilder.project import compile_project, ProjectError


VALID_BASE = {
    "palette": {"x": "#66D9A3", "y": "#FF5555", "z": "#5555FF"},
    "parts": {
        "torso": {
            "pivot": [1.5, 0, 1.5],
            "front": "....\n.xx.\n.xx.\n....",
            "back": "....\n.xx.\n.xx.\n....",
            "side": "....\n.xx.\n.xx.\n....",
        },
        "head": {
            "pivot": [1.5, 0, 1.5],
            "front": "....\n.yy.\n.yy.\n....",
            "back": "....\n.yy.\n.yy.\n....",
            "side": "....\n.yy.\n.yy.\n....",
        },
        "leg_upper": {
            "pivot": [0.5, 0, 0.5],
            "front": ".z\n.z",
            "back": ".z\n.z",
            "side": ".z\n.z",
        },
        "leg_lower": {
            "pivot": [0.5, 0, 0.5],
            "front": ".z\n.z",
            "back": ".z\n.z",
            "side": ".z\n.z",
        },
        "foot": {
            "pivot": [0.5, 0, 0.5],
            "front": ".z\n.z",
            "back": ".z\n.z",
            "side": ".z\n.z",
        }
    },
    "rig": {
        "bones": {
            "root": {"part": "torso", "translation": [0, 0, 0], "rotation": [0, 0, 0]},
            "head": {"parent": "root", "part": "head", "translation": [0, 4, 0], "rotation": [0, 0, 0]},
            "leg_upper": {"parent": "root", "part": "leg_upper", "translation": [1, 0, 0], "rotation": [0, 0, 0]},
            "leg_lower": {"parent": "leg_upper", "part": "leg_lower", "translation": [0, -2, 0], "rotation": [0, 0, 0]},
            "foot": {"parent": "leg_lower", "part": "foot", "translation": [0, -2, 0], "rotation": [0, 0, 0]},
        },
        "ik_chains": {
            "leg": {"root": "leg_upper", "mid": "leg_lower", "end": "foot"}
        },
    },
    "animations": {
        "idle": {
            "frames": 4,
            "fps": 10,
            "bones": {
                "root": {
                    "translation": [
                        {"frame": 0, "value": [0, 0, 0], "interpolation": "linear"},
                        {"frame": 2, "value": [0, 1, 0], "interpolation": "smooth"}
                    ]
                }
            },
            "ik": {
                "leg": {
                    "target": [{"frame": 0, "value": [1, -4, 0]}],
                    "weight": [{"frame": 0, "value": 1.0}]
                }
            },
        }
    },
    "export": {
        "name": "char",
        "size": [64, 64],
        "scale": 2,
        "origin": [32, 48],
        "directions": [0, 90, 180, 270],
        "animations": ["idle"],
        "background": [0, 0, 0, 0],
    },
}


def make_cases():
    cases = []

    def add_case(name: str, doc_fn):
        doc = json.loads(json.dumps(VALID_BASE))
        doc_fn(doc)
        try:
            compile_project(doc)
            py_valid = True
            py_err = None
        except Exception as exc:
            py_valid = False
            py_err = str(exc)
        cases.append({
            "name": name,
            "doc": doc,
            "python_valid": py_valid,
            "python_error": py_err
        })

    # Case 0: Baseline valid
    add_case("valid_baseline", lambda d: None)

    # Case 1: Valid spring bones & constraints
    def add_spring_and_constraints(d):
        d["rig"]["spring_bones"] = {
            "head": {
                "stiffness": 80.0,
                "damping": 12.0,
                "mass": 1.5,
                "drag": 0.2,
                "gravity": [0, -9.81, 0],
                "limit_angle": 30.0
            }
        }
        d["rig"]["constraints"] = [
            {"type": "spline_spine", "bones": ["leg_upper", "leg_lower"], "driver": "root"},
            {"type": "mirror", "source": "leg_upper", "target": "leg_lower", "plane": "yz"},
            {"type": "copy_rotation", "source": "head", "target": "root", "influence": 0.5}
        ]
    add_case("valid_springs_and_constraints", add_spring_and_constraints)

    # 1. Root & Palette edge cases
    add_case("invalid_palette_empty", lambda d: d.update({"palette": {}}))
    add_case("invalid_palette_dot_key", lambda d: d["palette"].update({".": "#123456"}))
    add_case("invalid_palette_multi_char_key", lambda d: d["palette"].update({"xy": "#123456"}))
    add_case("invalid_palette_bad_hex", lambda d: d["palette"].update({"a": "#ZZZZZZ"}))
    add_case("invalid_palette_bad_hex_length", lambda d: d["palette"].update({"a": "#12345"}))
    add_case("invalid_palette_color_out_of_range", lambda d: d["palette"].update({"a": [256, 0, 0]}))
    add_case("invalid_palette_color_negative", lambda d: d["palette"].update({"a": [-1, 0, 0]}))
    add_case("invalid_palette_color_float", lambda d: d["palette"].update({"a": [1.5, 0, 0]}))

    # 2. Parts edge cases
    add_case("invalid_parts_empty", lambda d: d.update({"parts": {}}))
    add_case("invalid_parts_unknown_palette_char", lambda d: d["parts"]["torso"].update({"front": "....\n.xA.\n.xx.\n...."}))
    add_case("invalid_parts_ragged_rows", lambda d: d["parts"]["torso"].update({"front": "....\n.xx\n.xx.\n...."}))
    add_case("invalid_parts_front_back_dim_mismatch", lambda d: d["parts"]["torso"].update({"back": "...\n.x.\n.x.\n..."}))
    add_case("invalid_parts_front_side_height_mismatch", lambda d: d["parts"]["torso"].update({"side": "....\n.xx.\n...."}))
    add_case("invalid_parts_silhouette_mismatch", lambda d: d["parts"]["torso"].update({"front": "....\n.xx.\n.xx.\n....", "back": "....\n.xx.\n..x.\n...."}))
    add_case("invalid_parts_zero_voxels", lambda d: d["parts"]["torso"].update({"front": "....\n....\n....\n....", "back": "....\n....\n....\n...."}))
    add_case("invalid_parts_bad_pivot_dim", lambda d: d["parts"]["torso"].update({"pivot": [1.5, 0]}))

    # 3. Bones edge cases
    add_case("invalid_bones_empty", lambda d: d["rig"].update({"bones": {}}))
    add_case("invalid_bones_parent_not_string", lambda d: d["rig"]["bones"]["head"].update({"parent": 123}))
    add_case("invalid_bones_missing_parent", lambda d: d["rig"]["bones"]["head"].update({"parent": "ghost_bone"}))
    add_case("invalid_bones_self_cycle", lambda d: d["rig"]["bones"]["root"].update({"parent": "root"}))
    add_case("invalid_bones_two_bone_cycle", lambda d: (d["rig"]["bones"]["root"].update({"parent": "head"}), d["rig"]["bones"]["head"].update({"parent": "root"})))
    add_case("invalid_bones_missing_part_ref", lambda d: d["rig"]["bones"]["head"].update({"part": "nonexistent_part"}))
    add_case("invalid_bones_translation_bad_length", lambda d: d["rig"]["bones"]["head"].update({"translation": [1, 2]}))
    add_case("invalid_bones_rotation_non_numbers", lambda d: d["rig"]["bones"]["head"].update({"rotation": ["a", "b", "c"]}))
    add_case("invalid_bones_attachment_not_mapping", lambda d: d["rig"]["bones"]["head"].update({"attachment": "bad"}))

    # 4. IK Chains edge cases
    add_case("invalid_ik_missing_bone", lambda d: d["rig"]["ik_chains"]["leg"].update({"end": "ghost_bone"}))
    add_case("invalid_ik_broken_hierarchy", lambda d: d["rig"]["ik_chains"]["leg"].update({"root": "foot", "mid": "leg_lower", "end": "leg_upper"}))
    add_case("invalid_ik_not_mapping", lambda d: d["rig"].update({"ik_chains": {"leg": ["not", "a", "map"]}}))

    # 5. Spring Bones edge cases
    add_case("invalid_spring_missing_bone", lambda d: d["rig"].update({"spring_bones": {"ghost": {"stiffness": 100}}}))
    add_case("invalid_spring_negative_stiffness", lambda d: d["rig"].update({"spring_bones": {"head": {"stiffness": -5}}}))
    add_case("invalid_spring_negative_damping", lambda d: d["rig"].update({"spring_bones": {"head": {"damping": -1}}}))
    add_case("invalid_spring_zero_mass", lambda d: d["rig"].update({"spring_bones": {"head": {"mass": 0}}}))
    add_case("invalid_spring_negative_mass", lambda d: d["rig"].update({"spring_bones": {"head": {"mass": -2.0}}}))
    add_case("invalid_spring_negative_drag", lambda d: d["rig"].update({"spring_bones": {"head": {"drag": -0.5}}}))
    add_case("invalid_spring_negative_limit_angle", lambda d: d["rig"].update({"spring_bones": {"head": {"limit_angle": -10}}}))

    # 6. Constraints edge cases
    add_case("invalid_constraint_unknown_type", lambda d: d["rig"].update({"constraints": [{"type": "magic_constraint"}]}))
    add_case("invalid_constraint_spline_empty_bones", lambda d: d["rig"].update({"constraints": [{"type": "spline_spine", "bones": []}]}))
    add_case("invalid_constraint_spline_missing_bone", lambda d: d["rig"].update({"constraints": [{"type": "spline_spine", "bones": ["ghost"]}]}))
    add_case("invalid_constraint_mirror_missing_bone", lambda d: d["rig"].update({"constraints": [{"type": "mirror", "source": "head", "target": "ghost"}]}))
    add_case("invalid_constraint_mirror_bad_plane", lambda d: d["rig"].update({"constraints": [{"type": "mirror", "source": "head", "target": "root", "plane": "invalid_plane"}]}))
    add_case("invalid_constraint_copy_rot_missing_bone", lambda d: d["rig"].update({"constraints": [{"type": "copy_rotation", "source": "ghost", "target": "head"}]}))

    # 7. Animations edge cases
    add_case("invalid_anim_empty", lambda d: d.update({"animations": {}}))
    add_case("invalid_anim_frames_zero", lambda d: d["animations"]["idle"].update({"frames": 0}))
    add_case("invalid_anim_frames_negative", lambda d: d["animations"]["idle"].update({"frames": -5}))
    add_case("invalid_anim_fps_zero", lambda d: d["animations"]["idle"].update({"fps": 0}))
    add_case("invalid_anim_fps_negative", lambda d: d["animations"]["idle"].update({"fps": -10}))
    add_case("invalid_anim_bone_unknown_bone", lambda d: d["animations"]["idle"]["bones"].update({"ghost": {"translation": [{"frame": 0, "value": [0, 0, 0]}]}}))
    add_case("invalid_anim_bone_unknown_track", lambda d: d["animations"]["idle"]["bones"]["root"].update({"scaling": [{"frame": 0, "value": [1, 1, 1]}]}))
    add_case("invalid_anim_ik_unknown_chain", lambda d: d["animations"]["idle"]["ik"].update({"ghost_chain": {"target": [{"frame": 0, "value": [0, 0, 0]}]}}))
    add_case("invalid_anim_ik_unknown_track", lambda d: d["animations"]["idle"]["ik"]["leg"].update({"twist": [{"frame": 0, "value": [0, 0, 0]}]}))
    add_case("invalid_anim_keys_not_list", lambda d: d["animations"]["idle"]["bones"]["root"].update({"translation": "not_a_list"}))
    add_case("invalid_anim_keys_empty_list", lambda d: d["animations"]["idle"]["bones"]["root"].update({"translation": []}))
    add_case("invalid_anim_key_missing_frame", lambda d: d["animations"]["idle"]["bones"]["root"].update({"translation": [{"value": [0, 0, 0]}]}))
    add_case("invalid_anim_key_missing_value", lambda d: d["animations"]["idle"]["bones"]["root"].update({"translation": [{"frame": 0}]}))
    add_case("invalid_anim_key_out_of_order", lambda d: d["animations"]["idle"]["bones"]["root"].update({"translation": [{"frame": 2, "value": [0, 0, 0]}, {"frame": 1, "value": [0, 1, 0]}]}))
    add_case("invalid_anim_key_duplicate_frame", lambda d: d["animations"]["idle"]["bones"]["root"].update({"translation": [{"frame": 1, "value": [0, 0, 0]}, {"frame": 1, "value": [0, 1, 0]}]}))
    add_case("invalid_anim_key_frame_negative", lambda d: d["animations"]["idle"]["bones"]["root"].update({"translation": [{"frame": -1, "value": [0, 0, 0]}]}))
    add_case("invalid_anim_key_frame_out_of_bounds", lambda d: d["animations"]["idle"]["bones"]["root"].update({"translation": [{"frame": 4, "value": [0, 0, 0]}]}))
    add_case("invalid_anim_key_bad_vec_dim", lambda d: d["animations"]["idle"]["bones"]["root"].update({"translation": [{"frame": 0, "value": [0, 0]}]}))
    add_case("invalid_anim_key_bad_interpolation", lambda d: d["animations"]["idle"]["bones"]["root"].update({"translation": [{"frame": 0, "value": [0, 0, 0], "interpolation": "bezier"}]}))
    add_case("invalid_anim_ik_weight_negative", lambda d: d["animations"]["idle"]["ik"]["leg"].update({"weight": [{"frame": 0, "value": -0.1}]}))
    add_case("invalid_anim_ik_weight_greater_than_one", lambda d: d["animations"]["idle"]["ik"]["leg"].update({"weight": [{"frame": 0, "value": 1.1}]}))

    # 8. Export edge cases
    add_case("invalid_export_size_not_2_ints", lambda d: d["export"].update({"size": [64]}))
    add_case("invalid_export_size_zero", lambda d: d["export"].update({"size": [0, 64]}))
    add_case("invalid_export_scale_zero", lambda d: d["export"].update({"scale": 0}))
    add_case("invalid_export_scale_negative", lambda d: d["export"].update({"scale": -1}))
    add_case("invalid_export_empty_directions", lambda d: d["export"].update({"directions": []}))
    add_case("invalid_export_duplicate_animations", lambda d: d["export"].update({"animations": ["idle", "idle"]}))
    add_case("invalid_export_missing_animation_ref", lambda d: d["export"].update({"animations": ["idle", "nonexistent_anim"]}))

    return cases


class Challenger2ParityGeneratorTest(unittest.TestCase):
    def test_generate_and_save_parity_cases(self):
        cases = make_cases()
        print(f"Generated {len(cases)} schema test cases.")
        valid_count = sum(1 for c in cases if c["python_valid"])
        invalid_count = sum(1 for c in cases if not c["python_valid"])
        print(f"Python valid: {valid_count}, Python invalid: {invalid_count}")
        self.assertEqual(valid_count, 2)
        self.assertGreater(invalid_count, 50)

        out_path = Path(__file__).parent / "parity_cases.json"
        out_path.write_text(json.dumps(cases, indent=2), encoding="utf-8")
        self.assertTrue(out_path.exists())


if __name__ == "__main__":
    unittest.main()

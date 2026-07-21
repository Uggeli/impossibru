from __future__ import annotations

from dataclasses import dataclass
import hashlib
import os
from pathlib import Path
import re
import tempfile
from typing import Any, Dict, Optional

import yaml

from .project import Project, ProjectError, compile_project


class SaveConflict(ProjectError):
    """The source file changed after the editor opened it."""


@dataclass
class EditableDocument:
    path: Path
    data: Dict[str, Any]
    source_hash: str

    def compile(self) -> Project:
        return compile_project(self.data, self.path)


class _BlockDumper(yaml.SafeDumper):
    pass


def _string_representer(dumper: yaml.Dumper, value: str):
    style = "|" if "\n" in value else None
    return dumper.represent_scalar("tag:yaml.org,2002:str", value, style=style)


_BlockDumper.add_representer(str, _string_representer)


def source_hash(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def parse_document(content: str, path: Any = "<memory>") -> EditableDocument:
    try:
        data = yaml.safe_load(content)
    except yaml.YAMLError as exc:
        raise ProjectError(f"invalid YAML in {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise ProjectError("project root must be a mapping")
    return EditableDocument(Path(path), data, source_hash(content.encode("utf-8")))


def load_document(path: Any) -> EditableDocument:
    source = Path(path)
    try:
        content = source.read_bytes()
    except OSError as exc:
        raise ProjectError(f"cannot read {source}: {exc}") from exc
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ProjectError(f"{source} is not UTF-8 text") from exc
    result = parse_document(text, source)
    result.source_hash = source_hash(content)
    return result


def dump_document(data: Dict[str, Any]) -> str:
    return yaml.dump(data, Dumper=_BlockDumper, sort_keys=False,
                     allow_unicode=True, default_flow_style=False, width=1000)


def starter_document(name: str = "sprite") -> Dict[str, Any]:
    """Return the smallest useful, fully valid editor project."""
    safe_name = re.sub(r"[^A-Za-z0-9_-]+", "_", name).strip("_") or "sprite"
    return {
        "palette": {"x": "#66D9A3"},
        "parts": {"part": {
            "pivot": [1.5, 0, 1.5],
            "front": "....\n....\n.xx.\n.xx.",
            "back": "....\n....\n.xx.\n.xx.",
            "side": "....\n....\n.xx.\n.xx.",
        }},
        "rig": {"bones": {"root": {"part": "part"}}, "ik_chains": {}},
        "animations": {"idle": {"frames": 8, "fps": 10, "loop": True,
                                    "bones": {}, "ik": {}}},
        "export": {"name": safe_name, "size": [96, 96], "scale": 3,
                   "origin": [48, 88], "directions": [0, 45, 90, 135, 180, 225, 270, 315],
                   "animations": ["idle"],
                   "background": [0, 0, 0, 0]},
    }


def create_document(path: Any) -> EditableDocument:
    """Create a starter project without ever overwriting an existing file."""
    destination = Path(path)
    if destination.suffix.lower() not in (".yaml", ".yml"):
        raise ProjectError("new project filename must end in .yaml or .yml")
    data = starter_document(destination.stem)
    compile_project(data, destination)
    encoded = dump_document(data).encode("utf-8")
    try:
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open("xb") as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
    except FileExistsError as exc:
        raise ProjectError(f"project already exists: {destination}") from exc
    except OSError as exc:
        raise ProjectError(f"cannot create {destination}: {exc}") from exc
    return EditableDocument(destination, data, source_hash(encoded))


def save_document(path: Any, data: Dict[str, Any], expected_hash: str) -> str:
    destination = Path(path)
    try:
        current = destination.read_bytes()
    except OSError as exc:
        raise ProjectError(f"cannot read {destination} before saving: {exc}") from exc
    actual_hash = source_hash(current)
    if actual_hash != expected_hash:
        raise SaveConflict("project changed on disk; reload before saving")
    compile_project(data, destination)
    encoded = dump_document(data).encode("utf-8")
    mode = destination.stat().st_mode
    temporary: Optional[str] = None
    try:
        with tempfile.NamedTemporaryFile("wb", dir=str(destination.parent),
                                         prefix=f".{destination.name}.", delete=False) as handle:
            temporary = handle.name
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, destination)
    except OSError as exc:
        if temporary:
            try:
                os.unlink(temporary)
            except OSError:
                pass
        raise ProjectError(f"cannot save {destination}: {exc}") from exc
    return source_hash(encoded)


def structured_error(error: Exception) -> Dict[str, Any]:
    message = str(error)
    path_match = re.search(r"((?:palette|parts|rig|animations|export)(?:\.[A-Za-z0-9_-]+)*)", message)
    row_match = re.search(r"row (\d+)", message)
    column_match = re.search(r"column (\d+)", message)
    result: Dict[str, Any] = {"message": message}
    if path_match:
        result["path"] = path_match.group(1).rstrip(":")
    if row_match:
        result["row"] = int(row_match.group(1))
    if column_match:
        result["column"] = int(column_match.group(1))
    return result

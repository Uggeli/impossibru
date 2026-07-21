from __future__ import annotations

import argparse
from pathlib import Path
import sys

from .exporter import build_project
from .project import ProjectError, load_project
from .document import create_document


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(prog="impossibru", description="Impossibru! Build voxel spritesheets from ASCII parts")
    commands = result.add_subparsers(dest="command", required=True)
    validate = commands.add_parser("validate", help="validate a project without rendering it")
    validate.add_argument("project", type=Path)
    build = commands.add_parser("build", help="validate and export a project")
    build.add_argument("project", type=Path)
    build.add_argument("--output", "-o", type=Path, default=Path("dist"))
    edit = commands.add_parser("edit", help="open a project in the local browser editor")
    edit.add_argument("project", type=Path)
    edit.add_argument("--port", type=int, default=0, help="local port (default: choose automatically)")
    edit.add_argument("--no-browser", action="store_true", help="do not open the browser automatically")
    new = commands.add_parser("new", help="create a new starter project")
    new.add_argument("project", type=Path)
    new.add_argument("--edit", action="store_true", help="open the new project in the editor")
    new.add_argument("--port", type=int, default=0, help="local editor port")
    new.add_argument("--no-browser", action="store_true", help="do not open the browser automatically")
    return result


def main(argv=None) -> int:
    args = parser().parse_args(argv)
    try:
        if args.command == "new":
            document = create_document(args.project)
            print(f"created {document.path}")
            if args.edit:
                from .editor_server import run_editor
                run_editor(args.project, args.port, not args.no_browser)
            return 0
        project = load_project(args.project)
        if args.command == "edit":
            from .editor_server import run_editor
            run_editor(args.project, args.port, not args.no_browser)
        elif args.command == "validate":
            print(f"valid: {args.project} ({len(project.parts)} parts, {len(project.bones)} bones, {len(project.clips)} animations)")
        else:
            png_path, json_path = build_project(project, args.output)
            print(f"wrote {png_path}")
            print(f"wrote {json_path}")
        return 0
    except ProjectError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

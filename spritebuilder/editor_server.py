from __future__ import annotations

from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import base64
import json
import mimetypes
from pathlib import Path
import secrets
import threading
from typing import Any, Dict
from urllib.parse import urlparse
import webbrowser

from .animation import evaluate_pose, evaluate_rest_pose
from .document import (EditableDocument, SaveConflict, create_document, load_document,
                       save_document, structured_error)
from .project import ProjectError, compile_project
from .render import render_part, render_pose
from .rigging import drag_document, overlay_geometry, reparent_document


_WEB_DIST = Path(__file__).resolve().parent.parent / "web" / "dist"
STATIC = _WEB_DIST if (_WEB_DIST / "index.html").is_file() else Path(__file__).with_name("editor_static")
MAX_BODY = 8 * 1024 * 1024


@dataclass
class EditorSession:
    document: EditableDocument
    token: str

    @property
    def summary(self) -> Dict[str, Any]:
        project = self.document.compile()
        return {
            "path": str(self.document.path),
            "parts": list(project.parts),
            "clips": {name: {"frames": clip.frames, "fps": clip.fps, "loop": clip.loop}
                      for name, clip in project.clips.items()},
            "directions": project.export.directions,
            "export_animations": project.export.animations,
        }


def _handler(session: EditorSession):
    class Handler(BaseHTTPRequestHandler):
        server_version = "ImpossibruEditor/0.1"

        def log_message(self, format, *args):
            print(f"editor: {format % args}")

        def _local_host(self) -> bool:
            host = self.headers.get("Host", "").split(":", 1)[0].lower()
            return host in ("127.0.0.1", "localhost", "[::1]")

        def _json(self, status: int, payload: Any):
            encoded = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(encoded)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(encoded)

        def _read_json(self):
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                raise ProjectError("invalid Content-Length")
            if length < 1 or length > MAX_BODY:
                raise ProjectError("request body is empty or too large")
            try:
                value = json.loads(self.rfile.read(length))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ProjectError("request body must be valid JSON") from exc
            if not isinstance(value, dict):
                raise ProjectError("request body must be an object")
            return value

        def _authorized(self) -> bool:
            return self._local_host() and secrets.compare_digest(
                self.headers.get("X-SpriteBuilder-Token", ""), session.token)

        def do_GET(self):
            if not self._local_host():
                self._json(403, {"error": {"message": "non-local Host rejected"}})
                return
            route = urlparse(self.path).path
            if route == "/api/project":
                if not self._authorized():
                    self._json(403, {"error": {"message": "invalid editor token"}})
                    return
                self._json(200, {"document": session.document.data,
                                 "source_hash": session.document.source_hash,
                                 "summary": session.summary})
                return
            name = "index.html" if route in ("", "/") else route.lstrip("/")
            target = (STATIC / name).resolve()
            if STATIC.resolve() not in target.parents or not target.is_file():
                # Vite emits hashed files below assets; unknown navigation paths
                # are handled by the single-page application.
                target = STATIC / "index.html"
            content = target.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", mimetypes.guess_type(target.name)[0] or "application/octet-stream")
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(content)

        def do_POST(self):
            self._api_mutation("POST")

        def do_PUT(self):
            self._api_mutation("PUT")

        def _api_mutation(self, method: str):
            if not self._authorized():
                self._json(403, {"error": {"message": "invalid editor token or host"}})
                return
            route = urlparse(self.path).path
            try:
                payload = self._read_json()
                if route == "/api/project/new" and method == "POST":
                    filename = payload.get("filename")
                    if not isinstance(filename, str) or not filename.strip():
                        raise ProjectError("filename must be a non-empty string")
                    filename = filename.strip()
                    if Path(filename).name != filename:
                        raise ProjectError("new projects must be created beside the current project")
                    destination = session.document.path.parent / filename
                    session.document = create_document(destination)
                    self._json(201, {"document": session.document.data,
                                     "source_hash": session.document.source_hash,
                                     "summary": session.summary})
                    return
                data = payload.get("document")
                if not isinstance(data, dict):
                    raise ProjectError("document must be an object")
                project = compile_project(data, session.document.path)
                if route == "/api/validate" and method == "POST":
                    self._json(200, {"valid": True, "summary": {
                        "parts": list(project.parts), "bones": list(project.bones),
                        "clips": list(project.clips)}})
                elif route == "/api/preview" and method == "POST":
                    direction = float(payload.get("direction", 0))
                    if payload.get("mode") == "part":
                        image = render_part(project, str(payload.get("part", "")), direction)
                    else:
                        clip_name = str(payload.get("clip", next(iter(project.clips))))
                        if clip_name not in project.clips:
                            raise ProjectError(f"unknown animation {clip_name!r}")
                        clip = project.clips[clip_name]
                        frame = int(payload.get("frame", 0))
                        if frame < 0 or frame >= clip.frames:
                            raise ProjectError(f"frame must be in 0..{clip.frames - 1}")
                        image = render_pose(project, evaluate_pose(project, clip, frame), direction)
                    output = BytesIO()
                    image.save(output, format="PNG")
                    content = output.getvalue()
                    self.send_response(200)
                    self.send_header("Content-Type", "image/png")
                    self.send_header("Content-Length", str(len(content)))
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    self.wfile.write(content)
                elif route == "/api/rig/preview" and method == "POST":
                    direction = float(payload.get("direction", 0))
                    mode = payload.get("mode", "rest")
                    clip = None
                    frame = int(payload.get("frame", 0))
                    if mode == "animate":
                        clip_name = str(payload.get("clip", ""))
                        if clip_name not in project.clips:
                            raise ProjectError(f"unknown animation {clip_name!r}")
                        clip = project.clips[clip_name]
                        if frame < 0 or frame >= clip.frames:
                            raise ProjectError(f"frame must be in 0..{clip.frames - 1}")
                        pose = evaluate_pose(project, clip, frame)
                    elif mode == "rest":
                        pose = evaluate_rest_pose(project)
                    else:
                        raise ProjectError("mode must be rest or animate")
                    viewport_size = (project.export.width * 2, project.export.height * 2)
                    viewport_offset = (project.export.width / 2, project.export.height / 2)
                    viewport_origin = (project.export.origin[0] + viewport_offset[0],
                                       project.export.origin[1] + viewport_offset[1])
                    image = render_pose(project, pose, direction, viewport_size, viewport_origin)
                    output = BytesIO()
                    image.save(output, format="PNG")
                    self._json(200, {
                        "png": base64.b64encode(output.getvalue()).decode("ascii"),
                        "overlay": overlay_geometry(project, pose, direction, clip, frame,
                                                    viewport_offset, viewport_size),
                    })
                elif route == "/api/rig/drag" and method == "POST":
                    screen = payload.get("screen")
                    if not isinstance(screen, list) or len(screen) != 2:
                        raise ProjectError("screen must be a two-number list")
                    updated = drag_document(
                        data, str(payload.get("kind", "")), str(payload.get("name", "")),
                        screen, float(payload.get("direction", 0)), float(payload.get("depth", 0)),
                        str(payload.get("mode", "rest")), payload.get("clip"),
                        int(payload.get("frame", 0)), session.document.path)
                    self._json(200, {"document": updated})
                elif route == "/api/rig/reparent" and method == "POST":
                    bone = payload.get("bone")
                    parent = payload.get("parent")
                    if not isinstance(bone, str) or (parent is not None and not isinstance(parent, str)):
                        raise ProjectError("bone and parent must be bone names")
                    updated = reparent_document(data, bone, parent, session.document.path)
                    self._json(200, {"document": updated})
                elif route == "/api/project" and method == "PUT":
                    expected = payload.get("source_hash")
                    if not isinstance(expected, str):
                        raise ProjectError("source_hash must be a string")
                    new_hash = save_document(session.document.path, data, expected)
                    session.document.data = data
                    session.document.source_hash = new_hash
                    self._json(200, {"saved": True, "source_hash": new_hash})
                else:
                    self._json(404, {"error": {"message": "unknown API endpoint"}})
            except SaveConflict as exc:
                self._json(409, {"error": structured_error(exc)})
            except (ProjectError, ValueError, TypeError) as exc:
                self._json(422, {"valid": False, "error": structured_error(exc)})

    return Handler


def create_server(project_path: Path, port: int = 0):
    document = load_document(project_path)
    document.compile()
    session = EditorSession(document, secrets.token_urlsafe(24))
    server = ThreadingHTTPServer(("127.0.0.1", port), _handler(session))
    return server, session


def run_editor(project_path: Path, port: int = 0, open_browser: bool = True) -> None:
    server, session = create_server(project_path, port)
    address = f"http://127.0.0.1:{server.server_port}/?token={session.token}"
    print(f"Impossibru! editor serving {project_path} at {address}")
    print("press Ctrl+C to stop")
    if open_browser:
        threading.Timer(.2, lambda: webbrowser.open(address)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\neditor stopped")
    finally:
        server.server_close()

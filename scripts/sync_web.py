"""Synchronize the Vite artifact into the Python wheel's static directory."""
from pathlib import Path
import shutil

root = Path(__file__).resolve().parents[1]
source = root / "web" / "dist"
target = root / "spritebuilder" / "editor_static"
if not (source / "index.html").is_file():
    raise SystemExit("web/dist is missing; run npm run build first")
shutil.rmtree(target)
shutil.copytree(source, target)

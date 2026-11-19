"""Import editable three-view examples from the Mundus Viewer/sprites directory."""
import argparse
import json
import re
from pathlib import Path


def project_part(part):
    width, height, depth = part.pop("size")
    runs = re.findall(r"(\d*)(\D)", part.pop("voxels"))
    cells = "".join(char * int(count or 1) for count, char in runs)
    if len(cells) != width * height * depth:
        raise ValueError("Voxel count does not match part dimensions")
    front, back, side = [], [], []
    for y in reversed(range(height)):
        layer = cells[y * width * depth:(y + 1) * width * depth]
        columns = [layer[x::width] for x in range(width)]
        front.append("".join(next((c for c in reversed(col) if c != "."), ".") for col in columns))
        back.append("".join(next((c for c in col if c != "."), ".") for col in columns))
        side.append("".join(next((c for c in reversed(layer[z:z + width]) if c != "."), ".")
                            for z in range(0, len(layer), width)))
    part.update(front="\n".join(front), back="\n".join(back), side="\n".join(side))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("magnum_opus", type=Path)
    source = parser.parse_args().magnum_opus / "Viewer" / "sprites"
    destination = Path(__file__).resolve().parents[1] / "examples" / "mundus"
    destination.mkdir(parents=True, exist_ok=True)
    filenames = [
        f"{species}-{sex}.json"
        for species in ("deer", "wolf", "rabbit", "mus")
        for sex in ("female", "male")
    ]
    filenames.extend(path.name for path in sorted(source.glob("orc-*.json")))
    for filename in filenames:
        project = json.loads((source / filename).read_text())
        for part in project["parts"].values():
            project_part(part)
        (destination / filename).write_text(json.dumps(project, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    main()

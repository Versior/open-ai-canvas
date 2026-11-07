#!/usr/bin/env python3
"""Prepare inner pet bundles for the admin folder importer; never upload assets."""
import argparse
import io
import json
from pathlib import Path, PurePosixPath
import zipfile


def prepare(source: Path, destination: Path) -> None:
    if destination.exists():
        raise ValueError("目标目录已存在，请使用新的目录以免覆盖")
    entries = []
    seen = set()
    with zipfile.ZipFile(source) as outer:
        bundles = [entry for entry in outer.infolist() if entry.filename.lower().endswith(".zip") and not entry.filename.startswith("__MACOSX/")]
        if not bundles or len(bundles) > 300 or sum(entry.file_size for entry in bundles) > 512 * 1024 * 1024:
            raise ValueError("合集须包含 1–300 个形象包，合计不超过 512 MiB")
        # Validate every bundle before creating the output directory.
        for entry in bundles:
            name = PurePosixPath(entry.filename).name
            if name in seen or entry.file_size > 32 * 1024 * 1024:
                raise ValueError("存在同名包或超过 32 MiB 的包")
            seen.add(name)
            data = outer.read(entry)
            with zipfile.ZipFile(io.BytesIO(data)) as inner:
                files = inner.infolist()
                if sum(item.file_size for item in files) > 128 * 1024 * 1024:
                    raise ValueError(f"{name}: 解压体积超过限制")
                for item in files:
                    path = PurePosixPath(item.filename)
                    if path.is_absolute() or ".." in path.parts or "\\" in item.filename:
                        raise ValueError(f"{name}: 包含不安全路径")
                metadata = [item for item in files if PurePosixPath(item.filename).name == "pet.json"]
                if len(metadata) != 1 or metadata[0].file_size > 64 * 1024:
                    raise ValueError(f"{name}: pet.json 不唯一或过大")
                pet = json.loads(inner.read(metadata[0]))
                if not isinstance(pet, dict) or not pet.get("id") or not pet.get("spritesheetPath"):
                    raise ValueError(f"{name}: 缺少形象标识或图集路径")
                sprite = PurePosixPath(metadata[0].filename).parent / pet["spritesheetPath"]
                if str(sprite) not in inner.namelist():
                    raise ValueError(f"{name}: 图集不存在")
                if inner.testzip() is not None:
                    raise ValueError(f"{name}: 压缩包校验失败")
                entries.append({"file": name, "id": pet["id"], "name": pet.get("displayName", ""), "bytes": entry.file_size})
        destination.mkdir(parents=True)
        for entry in bundles:
            target = destination / PurePosixPath(entry.filename).name
            with target.open("xb") as output:
                output.write(outer.read(entry))
    (destination / "manifest.json").write_text(json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"已准备 {len(entries)} 个形象包，保留原包；未上传或上架。")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    prepare(args.source, args.destination)

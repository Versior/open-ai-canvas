#!/usr/bin/env python3
"""Download the pinned ai-pose-gallery-zh subsets and write a studio model library manifest.

Usage:
    python3 scripts/import-pose-gallery.py OUTPUT_DIR [--jobs 8]

Then import into a backend data directory (stop the server first, back up the database):
    cd backend && CANVAS_BACKEND_DATA_DIR=... go run ./cmd/studio-models-import \
        -manifest OUTPUT_DIR/manifest.json -admin ADMIN_ID [-face-consent-attested]

Source: https://github.com/anhao/ai-pose-gallery-zh (pinned below). Its LICENSE covers code only; the images and
data in img/, thumbs/ and data/ belong to the original author (ギア, @giaaibusi) and are marked non-commercial.
Run this only with the rights holder's authorization for your use.

Selection keeps the general-audience parts and drops every 18+ group:
    pose  (姿势)     全身单人・标准系 (all) + 上半身单人 / 可爱系
    face  (模特人脸)  人像库 / 正脸参考
    style (模特样式)  服装库 without 内衣・睡衣 and 性感穿搭
"""
import argparse
import concurrent.futures
import json
import sys
import time
import urllib.request
from collections import Counter
from pathlib import Path

REVISION = "488939139c69acfe078372b39d4bd0c457dc060e"
RAW = f"https://raw.githubusercontent.com/anhao/ai-pose-gallery-zh/{REVISION}/"
TREE = f"https://api.github.com/repos/anhao/ai-pose-gallery-zh/git/trees/{REVISION}?recursive=1"
SOURCE = f"ai-pose-gallery-zh@{REVISION[:7]}（图片著作权归原作者ギア，非商用；导入方须取得授权）"
POSE_ANGLES = ["正面", "斜侧", "侧面", "俯视", "仰视"]
HAIR_LENGTHS = ["短发", "中发", "中长发", "长发"]
COSTUME_EXCLUDED = {"内衣・睡衣", "性感穿搭"}


def fetch(url, attempts=4):
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(url, timeout=120) as response:
                return response.read()
        except Exception:
            if attempt == attempts - 1:
                raise
            time.sleep(2 ** attempt)


def load_json(name):
    return json.loads(fetch(RAW + "data/" + name))


def number_duplicates(items, label):
    """Same display text appears many times (portrait titles, a few costume names): suffix 01, 02 ..."""
    total = Counter(label(item) for item in items)
    seen = Counter()
    names = []
    for item in items:
        text = label(item)
        seen[text] += 1
        names.append(f"{text} {seen[text]:02d}" if total[text] > 1 else text)
    return names


def select(poses, portraits, costumes):
    entries = []
    standard = [p for p in poses if p["体系"] == "全身单人・标准系"]
    upper = [p for p in poses if p["体系"] == "上半身单人" and p["分类"] == "可爱系"]
    categories = list(dict.fromkeys(p["分类"] for p in standard))
    ordered = sorted(standard, key=lambda p: (categories.index(p["分类"]), p["姿势编号"], POSE_ANGLES.index(p["角度"])))
    ordered += sorted(upper, key=lambda p: (p["姿势编号"], POSE_ANGLES.index(p["角度"])))
    for index, pose in enumerate(ordered):
        whole = pose["体系"] == "全身单人・标准系"
        entries.append({
            "kind": "pose",
            "name": f"{pose['姿势名称']} · {pose['角度']}",
            "category": pose["分类"] if whole else "半身・可爱",
            "gender": "",
            "tags": ["全身" if whole else "半身", pose["角度"]],
            "prompt": f"{'全身' if whole else '上半身'}姿势：{pose['姿势名称']}，{pose['角度']}视角",
            "path": pose["原图"],
            "enabled": True,
            "sortOrder": 1000 + index,
        })
    front = [p for p in portraits if p["分区"] == "正脸参考"]
    front.sort(key=lambda p: (not (p["精选"] or p["热门"]), HAIR_LENGTHS.index(p["发长"])))
    for index, (face, name) in enumerate(zip(front, number_duplicates(front, lambda p: p["标题"]))):
        tags = [face["发长"], "正脸"] + (["精选"] if face["精选"] else []) + (["热门"] if face["热门"] else [])
        if len(face["发型名称"]) <= 16:
            tags.append(face["发型名称"])
        entries.append({
            "kind": "face",
            "name": name,
            "category": face["发长"],
            "gender": "female",
            "tags": tags,
            "prompt": f"{face['发长']}，发型：{face['发型名称']}",
            "path": face["原图"],
            "enabled": True,
            "sortOrder": 1000 + index,
        })
    wearable = [c for c in costumes if c["分类"] not in COSTUME_EXCLUDED]
    for index, (costume, name) in enumerate(zip(wearable, number_duplicates(wearable, lambda c: c["服装名称"]))):
        entries.append({
            "kind": "style",
            "name": name,
            "category": costume["分类"],
            "gender": "female",
            "tags": costume["标签"][:12],
            "prompt": f"穿搭：{costume['服装名称'].replace('・', '、')}。英文关键词：{costume['关键词']}",
            "path": costume["原图"],
            "enabled": True,
            "sortOrder": 1000 + index,
        })
    return entries


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("output", type=Path)
    parser.add_argument("--jobs", type=int, default=8)
    args = parser.parse_args()
    output = args.output.resolve()
    entries = select(load_json("pose-zh.json"), load_json("portrait-zh.json"), load_json("costume-zh.json"))
    sizes = {item["path"]: item.get("size") for item in json.loads(fetch(TREE))["tree"] if item["type"] == "blob"}
    missing = [entry["path"] for entry in entries if entry["path"] not in sizes]
    if missing:
        raise SystemExit(f"{len(missing)} files are not in {REVISION}, e.g. {missing[0]}")

    def download(entry):
        target = output / entry["path"]
        if target.exists() and target.stat().st_size == sizes[entry["path"]]:
            return False
        target.parent.mkdir(parents=True, exist_ok=True)
        data = fetch(RAW + entry["path"])
        if len(data) != sizes[entry["path"]]:
            raise RuntimeError(f"size mismatch for {entry['path']}")
        target.write_bytes(data)
        return True

    fetched = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.jobs)) as pool:
        for done, changed in enumerate(pool.map(download, entries), start=1):
            fetched += changed
            if done % 200 == 0:
                print(f"{done}/{len(entries)}", file=sys.stderr)
    items = [{**{key: value for key, value in entry.items() if key != "path"}, "file": entry["path"]} for entry in entries]
    (output / "manifest.json").write_text(json.dumps({"source": SOURCE, "items": items}, ensure_ascii=False, indent=1))
    counts = Counter(entry["kind"] for entry in entries)
    print(json.dumps({"revision": REVISION, "downloaded": fetched, "kinds": counts, "manifest": str(output / "manifest.json")}, ensure_ascii=False))


if __name__ == "__main__":
    main()

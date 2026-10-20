#!/usr/bin/env python3
"""Rebuild the embedded suite archive from the pinned upstream checkout."""
import gzip
import json
from pathlib import Path
import subprocess
import sys

REVISION = "f8e6e7b52c1ff74a614052728ccb24c2b4c5e7b6"
if len(sys.argv) != 2:
    raise SystemExit("Usage: python3 scripts/import-ecomgen-catalog.py /path/to/EcomGen")
upstream = Path(sys.argv[1]).resolve()
if subprocess.check_output(["git", "-C", str(upstream), "rev-parse", "HEAD"], text=True).strip() != REVISION:
    raise SystemExit("Upstream checkout must match " + REVISION)
source = upstream / "packages/ecom-suite/src/suites"
if subprocess.check_output(["git", "-C", str(upstream), "status", "--porcelain", "--", "packages/ecom-suite", "LICENSE"], text=True).strip():
    raise SystemExit("Upstream suite sources or license have local changes")
documents = [json.loads(path.read_text()) for path in sorted(source.glob("*.json"))]
if len(documents) != 1173 or len({doc["id"] for doc in documents}) != 1173:
    raise SystemExit("Unexpected suite count or duplicate identifiers")
target = Path(__file__).resolve().parents[1] / "backend/internal/app/ecommerce-catalog"
target.mkdir(exist_ok=True)
payload = json.dumps(documents, ensure_ascii=False, separators=(",", ":")).encode()
(target / "suites.json.gz").write_bytes(gzip.compress(payload, mtime=0))
(target / "LICENSE.txt").write_bytes((upstream / "LICENSE").read_bytes())
print(f"Imported {len(documents)} suites from {REVISION}")

#!/usr/bin/env python3
"""Small CSV backup helper for LPC-528 deployments."""
from __future__ import annotations

import argparse
import os
import shutil
from datetime import datetime
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Backup the latest LPC CSV file")
    parser.add_argument("--source", default=os.environ.get("BACKUP_LATEST_CSV", ""), help="CSV file to copy")
    parser.add_argument("--output-dir", default=os.environ.get("BACKUP_OUTPUT_DIR", "backups"), help="Destination directory")
    parser.add_argument("--report", default=os.environ.get("BACKUP_REPORT", "Chan Last 100"), help="Report label for the output filename")
    args = parser.parse_args()
    source = Path(args.source)
    if not source.is_file():
        raise SystemExit(f"ERROR: CSV source does not exist: {source}")
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    safe_report = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "_" for ch in args.report).strip("_") or "report"
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    destination = output_dir / f"lpc_{safe_report}_{timestamp}.csv"
    shutil.copy2(source, destination)
    print(f"OK: backup saved to {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

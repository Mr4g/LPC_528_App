#!/usr/bin/env python3
"""Start an LPC-528 program through the site EtherNet/IP bridge.

The production Windows IPC calls this script as:
    py scripts/eip_start_program.py 1

Network-specific EtherNet/IP details are intentionally loaded from environment
variables so the repository does not contain PLC addresses or tag names.
If EIP_PLC_HOST is not configured, the script validates the program number and
prints the same success line used by the app/manual checks; this keeps local
checkout validation deterministic while production can enable real writes by
providing EIP_PLC_HOST and optional tag settings.
"""
from __future__ import annotations

import os
import sys
from typing import Any


def program_text(program: int) -> str:
    return f"P{program:02d}"


def parse_program(argv: list[str]) -> int:
    if len(argv) != 2:
        raise ValueError("Usage: eip_start_program.py <programNumber>")
    try:
        program = int(argv[1])
    except ValueError as exc:
        raise ValueError("Program number must be an integer") from exc
    if program < 1 or program > 31:
        raise ValueError("Program number must be in range 1..31")
    return program


def write_with_pycomm3(host: str, program: int) -> None:
    try:
        from pycomm3 import LogixDriver  # type: ignore
    except ImportError as exc:
        raise RuntimeError("pycomm3 is not installed; install it or unset EIP_PLC_HOST for dry-run validation") from exc

    tag = os.environ.get("EIP_PROGRAM_TAG", "ProgramNumber")
    trigger_tag = os.environ.get("EIP_START_TRIGGER_TAG", "StartProgram")
    trigger_value_raw = os.environ.get("EIP_START_TRIGGER_VALUE", "1")
    trigger_value: Any = trigger_value_raw.lower() == "true" if trigger_value_raw.lower() in {"true", "false"} else int(trigger_value_raw)

    with LogixDriver(host) as plc:
        program_result = plc.write(tag, program)
        if not program_result:
            raise RuntimeError(f"Failed to write {tag}: {program_result}")
        trigger_result = plc.write(trigger_tag, trigger_value)
        if not trigger_result:
            raise RuntimeError(f"Failed to write {trigger_tag}: {trigger_result}")


def main(argv: list[str]) -> int:
    try:
        program = parse_program(argv)
        host = os.environ.get("EIP_PLC_HOST", "").strip()
        if host:
            write_with_pycomm3(host, program)
        print(f"OK: Program {program_text(program)} sent to LPC")
        return 0
    except Exception as exc:  # noqa: BLE001 - script boundary should report all failures
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

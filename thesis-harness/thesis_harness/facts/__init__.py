"""Facts about the codebase, each traceable to ``file:line``.

A collector is a function ``(repo: Path, options: dict) -> dict`` registered with
:func:`collector`. Its result lands under its name in ``facts.json``. A collector
that raises does not stop the others; the error is recorded in ``_errors`` so a
parser that went stale after a refactor is visible instead of silently empty.

Facts are the ground truth handed to both the deterministic checks and Claude's
semantic review. They describe the code as it is — nothing here is a rule.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path
from typing import Callable

COLLECTORS: dict[str, Callable[[Path, dict], dict]] = {}


def collector(name: str):
    def wrap(fn):
        COLLECTORS[name] = fn
        return fn

    return wrap


def rel(repo: Path, path: Path) -> str:
    return path.resolve().relative_to(repo.resolve()).as_posix()


def line_of(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def src(repo: Path, path: Path, text: str, offset: int) -> str:
    return f"{rel(repo, path)}:{line_of(text, offset)}"


def find_line(repo: Path, path: Path, pattern: str) -> str:
    text = path.read_text(encoding="utf-8")
    m = re.search(pattern, text, re.MULTILINE)
    return src(repo, path, text, m.start()) if m else rel(repo, path)


def run_command_facts(repo: Path, commands: list[dict]) -> dict:
    """Facts produced by running a command and reading a number/string from its
    output, e.g. the real test count. Configured under ``facts.commands``."""
    out: dict = {}
    for spec in commands or []:
        key = spec["key"]
        try:
            proc = subprocess.run(
                spec["run"], cwd=repo, shell=True, capture_output=True, text=True,
                timeout=int(spec.get("timeout", 600)), encoding="utf-8", errors="replace",
            )
            output = proc.stdout + "\n" + proc.stderr
            m = re.search(spec["regex"], output, re.MULTILINE)
            out[key] = {
                "value": (m.group(1) if m and m.groups() else (m.group(0) if m else None)),
                "source": f"`{spec['run']}` (exit {proc.returncode})",
                "matched": bool(m),
            }
        except Exception as e:  # noqa: BLE001 - reported, not raised
            out[key] = {"value": None, "source": f"`{spec['run']}`", "error": str(e)}
    return out


def collect_all(repo: Path, config_data: dict) -> dict:
    from . import collectors  # noqa: F401 - registers the built-in collectors

    facts: dict = {"_errors": []}
    for name, fn in COLLECTORS.items():
        try:
            facts[name] = fn(repo, {})
        except Exception as e:  # noqa: BLE001
            facts["_errors"].append(f"{name}: {type(e).__name__}: {e}")
    commands = (config_data.get("facts") or {}).get("commands") or []
    if commands:
        facts["commands"] = run_command_facts(repo, commands)
    return facts

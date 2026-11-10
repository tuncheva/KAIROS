"""Harness configuration: ``harness.yaml`` merged over built-in defaults."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

HARNESS_DIR = Path(__file__).resolve().parent.parent

DEFAULTS: dict[str, Any] = {
    "repo_root": "..",
    "workspace": "work",
    "output": {"dir": None, "suffix": ".revised"},
    "chunking": {"max_chars": 30000},
    "checks": {"disabled": [], "plugin_dirs": ["plugins"], "options": {}},
    "facts": {"commands": []},
    "prompts_dir": "prompts",
    "requirements": {"dir": "requirements"},
}


def _merge(base: dict, over: dict) -> dict:
    out = dict(base)
    for k, v in (over or {}).items():
        out[k] = _merge(base[k], v) if isinstance(v, dict) and isinstance(base.get(k), dict) else v
    return out


@dataclass
class Config:
    data: dict
    harness_dir: Path
    profile: str | None = None  # requirement set: requirements/<profile>

    def path(self, rel: str | None) -> Path | None:
        if rel is None:
            return None
        p = Path(rel)
        return p if p.is_absolute() else (self.harness_dir / p).resolve()

    @property
    def repo_root(self) -> Path:
        return self.path(self.data["repo_root"])

    @property
    def workspace_root(self) -> Path:
        override = os.environ.get("THESIS_HARNESS_WORKSPACE")
        return Path(override).resolve() if override else self.path(self.data["workspace"])

    @property
    def prompts_dir(self) -> Path:
        return self.path(self.data["prompts_dir"])

    @property
    def requirements_dir(self) -> Path:
        override = os.environ.get("THESIS_HARNESS_REQUIREMENTS")
        base = Path(override).resolve() if override else self.path(self.data["requirements"]["dir"])
        return base / self.profile if self.profile else base

    def check_options(self, check_id: str) -> dict:
        return dict((self.data["checks"].get("options") or {}).get(check_id) or {})


def load_config(harness_dir: Path = HARNESS_DIR) -> Config:
    path = Path(os.environ.get("THESIS_HARNESS_CONFIG", harness_dir / "harness.yaml"))
    user = {}
    if path.exists():
        user = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    data = _merge(DEFAULTS, user)
    if os.environ.get("THESIS_HARNESS_REPO"):
        data["repo_root"] = os.environ["THESIS_HARNESS_REPO"]
    return Config(data=data, harness_dir=path.parent.resolve())

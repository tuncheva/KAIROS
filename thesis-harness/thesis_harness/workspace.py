"""Per-document working directory: extracted text, facts, findings, proposals.

Layout of ``work/<slug>/``::

    state.json          source path + sha256, version counter, repo commit
    doc.json            every paragraph (key, style, section, text, hash)
    doc.md              the same, readable, with ¶ markers
    chunks/NN-*.md      the document split for parallel review
    facts.json          facts collected from the code, each with file:line
    findings.json       last output of the deterministic checks
    proposals.yaml      every proposed change and its status (you may edit it)
    review.md           rendered review sheet
    tasks.json          semantic review tasks for Claude
    review/             raw proposal files written by the reviewers
    requirements-results.yaml   verdicts per requirement rule
    apply-log.json      what the last apply did
"""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

from .config import Config
from .docmodel import DocModel, Para


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 16), b""):
            h.update(block)
    return h.hexdigest()


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def slugify(name: str) -> str:
    s = re.sub(r"[^\w.-]+", "-", name, flags=re.UNICODE).strip("-.")
    return s or "document"


def read_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def read_yaml(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    return yaml.safe_load(path.read_text(encoding="utf-8"))


class _NoNumbersLoader(yaml.SafeLoader):
    """SafeLoader that keeps numbers as text.

    Paragraph keys are 8 hex digits. Unquoted, ``00000225`` is an octal int (149)
    to YAML 1.1 and ``00000149`` a string, so a key written by hand silently
    turns into a different number. Reviewer files are read with this loader.
    """


_NoNumbersLoader.yaml_implicit_resolvers = {
    ch: [(tag, rx) for tag, rx in resolvers if tag not in ("tag:yaml.org,2002:int", "tag:yaml.org,2002:float")]
    for ch, resolvers in yaml.SafeLoader.yaml_implicit_resolvers.items()
}


def read_yaml_text(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    return yaml.load(path.read_text(encoding="utf-8"), Loader=_NoNumbersLoader)


class _Dumper(yaml.SafeDumper):
    pass


def _str_presenter(dumper, data: str):
    style = "|" if "\n" in data else None
    return dumper.represent_scalar("tag:yaml.org,2002:str", data, style=style)


_Dumper.add_representer(str, _str_presenter)


def write_yaml(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = yaml.dump(data, Dumper=_Dumper, allow_unicode=True, sort_keys=False, width=100)
    path.write_text(text, encoding="utf-8")


def git_head(repo: Path) -> dict:
    def run(*args: str) -> str:
        try:
            return subprocess.run(
                ["git", *args], cwd=repo, capture_output=True, text=True, timeout=10, check=True
            ).stdout.strip()
        except Exception:
            return ""

    return {
        "commit": run("rev-parse", "--short", "HEAD"),
        "branch": run("rev-parse", "--abbrev-ref", "HEAD"),
        "date": run("log", "-1", "--format=%cI"),
        "dirty": bool(run("status", "--porcelain")),
    }


@dataclass
class Workspace:
    root: Path
    config: Config

    # -- paths
    @property
    def state_path(self) -> Path:
        return self.root / "state.json"

    def p(self, name: str) -> Path:
        return self.root / name

    # -- state
    def state(self) -> dict:
        return read_json(self.state_path, {}) or {}

    def save_state(self, state: dict) -> None:
        write_json(self.state_path, state)

    # -- document
    def doc(self) -> DocModel:
        data = read_json(self.p("doc.json"))
        if data is None:
            raise SystemExit("Няма извлечен документ. Пуснете първо: ingest <файл.docx>")
        return DocModel(paras=[Para.from_dict(d) for d in data["paras"]], warnings=data.get("warnings", []))

    def facts(self) -> dict:
        data = read_json(self.p("facts.json"))
        if data is None:
            raise SystemExit("Няма събрани факти от кода. Пуснете: facts")
        return data


def open_workspace(config: Config, slug: str | None = None) -> Workspace:
    root = config.workspace_root
    if slug is None:
        current = root / "current"
        if not current.exists():
            raise SystemExit("Няма активен документ. Пуснете: ingest <път до .docx>")
        slug = current.read_text(encoding="utf-8").strip()
    ws_root = root / slug
    if not ws_root.exists():
        raise SystemExit(f"Няма работна папка за '{slug}' в {root}")
    return Workspace(root=ws_root, config=config)


def create_or_open_for_source(config: Config, source: Path) -> Workspace:
    root = config.workspace_root
    slug = slugify(source.stem.removesuffix(config.data["output"]["suffix"]))
    ws_root = root / slug
    ws_root.mkdir(parents=True, exist_ok=True)
    (root / "current").write_text(slug, encoding="utf-8")
    return Workspace(root=ws_root, config=config)

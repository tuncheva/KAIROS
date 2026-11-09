"""Diagrams of the thesis: Mermaid sources in the repo, checked like the text.

The diagram repository (``diagrams.dir`` in harness.yaml) holds::

    diagrams.yaml   manifest: id, figure number(s), caption, source file, checks
    mermaid.json    shared Mermaid theme, so every figure looks the same
    src/*.mmd       the sources — edit these (VS Code, mermaid.live)
    out/*.svg|png   rendered by `diagrams render`

The harness treats the diagram set as a document whose "paragraphs" are the
diagrams: key = diagram id, text = Mermaid source. That is what lets the same
proposal machinery (validate, approve, edit, preview, sync) work unchanged; only
applying differs — it writes the .mmd files and re-renders.

Into the thesis, a rendered diagram goes as a ``replace_image`` proposal on the
figure's caption paragraph, approved like any other change.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

import yaml

from .config import Config
from .docmodel import DocModel, Para, text_hash

PNG_SCALE = 2


@dataclass
class Diagram:
    id: str
    figures: list[int]
    caption: str
    file: Path
    kind: str
    checks: list[str]
    meta: dict

    @property
    def source(self) -> str:
        return self.file.read_text(encoding="utf-8")

    def out(self, ext: str, root: Path) -> Path:
        return root / "out" / f"{self.file.stem}.{ext}"


def repo_dir(cfg: Config) -> Path:
    return (cfg.repo_root / (cfg.data.get("diagrams") or {}).get("dir", "docs/diploma/diagrams")).resolve()


def load(cfg: Config) -> tuple[Path, list[Diagram]]:
    root = repo_dir(cfg)
    manifest = yaml.safe_load((root / "diagrams.yaml").read_text(encoding="utf-8")) or {}
    out = []
    for d in manifest.get("diagrams") or []:
        figs = d.get("figure")
        figs = figs if isinstance(figs, list) else [figs]
        out.append(Diagram(
            id=d["id"], figures=[int(f) for f in figs if f is not None], caption=d["caption"],
            file=root / d["file"], kind=d.get("kind", "flowchart"), checks=list(d.get("checks") or []),
            meta={k: v for k, v in d.items() if k not in ("id", "figure", "caption", "file", "kind", "checks")},
        ))
    return root, out


def sources_sha(diagrams: list[Diagram]) -> str:
    h = hashlib.sha256()
    for d in diagrams:
        h.update(d.id.encode())
        h.update(d.file.read_bytes() if d.file.exists() else b"")
    return h.hexdigest()


def as_doc(diagrams: list[Diagram]) -> DocModel:
    paras = []
    for i, d in enumerate(diagrams):
        text = d.source if d.file.exists() else ""
        figs = ", ".join(str(f) for f in d.figures)
        paras.append(Para(
            key=d.id, index=i, style="mermaid", kind="diagram", level=0, number=None,
            section=f"Фигура {figs}. {d.caption}", text=text, hash=text_hash(text),
        ))
    return DocModel(paras=paras)


# ------------------------------------------------------------------ labels

_COMMENT = re.compile(r"^\s*%%.*$", re.MULTILINE)
_FRONT = re.compile(r"\A---\n.*?\n---\n", re.DOTALL)


def visible_text(source: str) -> str:
    """What a reader sees in the rendered diagram, approximately: node and edge
    labels, subgraph titles, messages, notes, attributes. Ids are dropped."""
    s = _FRONT.sub("", _COMMENT.sub("", source))
    s = s.replace("<br>", " ").replace("<br/>", " ").replace("<br />", " ")
    s = re.sub(r"</?[bi]>|</?small>|</?code>", "", s)
    parts: list[str] = []
    parts += re.findall(r'"([^"]*)"', s)
    parts += re.findall(r"\[\[?\(?/?([^\[\]\"]+?)\)?\]?\]", s)
    parts += re.findall(r"\(\(?\[?([^()\[\]\"]+?)\]?\)?\)", s)
    parts += re.findall(r"\{\{?([^{}\"]+?)\}?\}", s)
    parts += re.findall(r"\|([^|\"]+)\|", s)
    parts += re.findall(r":\s*([^:\n]+)$", s, re.MULTILINE)
    parts += re.findall(r"^\s*(?:title|x-axis|y-axis)\s+(.+)$", s, re.MULTILINE)
    return "\n".join(p.strip() for p in parts if p.strip())


def er_model(source: str) -> dict[str, list[str]]:
    """Entities and attribute names of a Mermaid erDiagram."""
    ents: dict[str, list[str]] = {}
    for m in re.finditer(r'^\s*"?([A-Za-z0-9_]+)"?\s*\{(.*?)\}', source, re.MULTILINE | re.DOTALL):
        attrs = []
        for line in m.group(2).splitlines():
            parts = line.split()
            if len(parts) >= 2 and not line.strip().startswith("%%"):
                attrs.append(parts[1])
        ents[m.group(1)] = attrs
    for m in re.finditer(r'^\s*"?([A-Za-z0-9_]+)"?\s*[|}o][|o]?--[|o]?[|{o]\s*"?([A-Za-z0-9_]+)"?', source, re.MULTILINE):
        ents.setdefault(m.group(1), [])
        ents.setdefault(m.group(2), [])
    return ents


# ------------------------------------------------------------------ rendering


def _chrome() -> str | None:
    for c in (os.environ.get("THESIS_CHROME"), os.environ.get("PUPPETEER_EXECUTABLE_PATH"), "/opt/pw-browsers/chromium"):
        if c and Path(c).exists():
            return c
    return None


def mmdc_command(cfg: Config) -> list[str]:
    custom = (cfg.data.get("diagrams") or {}).get("mmdc")
    if custom:
        return custom.split()
    npx = shutil.which("npx") or shutil.which("npx.cmd")
    if not npx:
        raise SystemExit("Няма npx (Node.js). Инсталирайте Node 20+ или задайте diagrams.mmdc в harness.yaml.")
    return [npx, "-y", "@mermaid-js/mermaid-cli@11.4.2"]


def render(cfg: Config, diagrams: list[Diagram], only: set[str] | None = None) -> dict[str, str | None]:
    """Render each diagram to SVG and PNG. Returns id → error (None when fine)."""
    root = repo_dir(cfg)
    (root / "out").mkdir(exist_ok=True)
    base = mmdc_command(cfg)
    conf = root / "mermaid.json"
    errors: dict[str, str | None] = {}
    with tempfile.TemporaryDirectory() as tmp:
        pp = Path(tmp) / "puppeteer.json"
        chrome = _chrome()
        pp.write_text(json.dumps({"args": ["--no-sandbox"], **({"executablePath": chrome} if chrome else {})}), encoding="utf-8")
        env = dict(os.environ, PUPPETEER_SKIP_DOWNLOAD=os.environ.get("PUPPETEER_SKIP_DOWNLOAD", "1" if chrome else ""))
        for d in diagrams:
            if only and d.id not in only:
                continue
            err = None
            for ext, extra in (("svg", []), ("png", ["-s", str(PNG_SCALE), "-b", "white"])):
                width = str(d.meta.get("width", 1200))
                cmd = base + ["-q", "-i", str(d.file), "-o", str(d.out(ext, root)), "-p", str(pp), "-w", width]
                if conf.exists():
                    cmd += ["-c", str(conf)]
                proc = subprocess.run(cmd + extra, capture_output=True, text=True, env=env,
                                      encoding="utf-8", errors="replace", timeout=300)
                if proc.returncode != 0 or not d.out(ext, root).exists():
                    lines = [x for x in (proc.stderr or proc.stdout).splitlines() if x.strip()]
                    err = next((x for x in lines if "Error" in x or "error" in x), lines[-1] if lines else "неуспешно рендериране")
                    break
            errors[d.id] = err
    return errors


def png_size(path: Path) -> tuple[int, int]:
    with open(path, "rb") as f:
        head = f.read(24)
    return int.from_bytes(head[16:20], "big"), int.from_bytes(head[20:24], "big")

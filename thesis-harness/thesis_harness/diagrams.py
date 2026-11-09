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


# ------------------------------------------------------------------ html

_HTML_STYLE = """
:root { --bg:#f6f7f9; --sheet:#fff; --ink:#1d2430; --soft:#5a6474; --rule:#dde1e8; --accent:#2c4f8f; }
@media (prefers-color-scheme: dark) { :root { --bg:#12151b; --sheet:#1a1f27; --ink:#e6e9ef; --soft:#9aa4b4; --rule:#2c333f; --accent:#8fb0ec; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.5 "Segoe UI", Arial, sans-serif; }
.wrap { max-width:1100px; margin:0 auto; padding:24px max(16px, env(safe-area-inset-left)); }
h1 { font:600 1.5rem/1.25 Georgia, "Times New Roman", serif; margin:0 0 4px; }
h2 { font:600 1.1rem/1.3 Georgia, "Times New Roman", serif; margin:0; }
.meta, .src { color:var(--soft); font-size:.85rem; }
nav { display:flex; flex-wrap:wrap; gap:6px; margin:16px 0 8px; }
nav a { font-size:.82rem; color:var(--accent); text-decoration:none; border:1px solid var(--rule); border-radius:999px; padding:2px 10px; background:var(--sheet); }
figure { margin:20px 0; background:var(--sheet); border:1px solid var(--rule); border-radius:6px; padding:16px; }
figure img { display:block; max-width:100%; height:auto; margin:12px auto; background:#fff; border-radius:4px; }
figcaption { display:flex; flex-wrap:wrap; gap:6px 14px; align-items:baseline; }
.pair { display:grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap:14px; margin-top:12px; align-items:start; }
@media (max-width: 800px) { .pair { grid-template-columns: minmax(0, 1fr); } }
.pane { min-width:0; }
.label { font:600 .72rem Arial, sans-serif; text-transform:uppercase; letter-spacing:.06em; color:var(--soft); margin-bottom:4px; }
.pane img { margin:0; }
pre { margin:0; overflow:auto; max-height:640px; background:var(--bg); padding:10px; border-radius:4px; font:.78rem/1.45 Consolas, monospace; }
"""


def _figure_html(d: Diagram, root: Path, link: bool) -> str:
    import base64
    import html

    svg = d.out("svg", root)
    src = ("data:image/svg+xml;base64," + base64.b64encode(svg.read_bytes()).decode()) if svg.exists() else ""
    figs = ", ".join(str(f) for f in d.figures)
    title = html.escape(f"Фигура {figs}. {d.caption}")
    name = html.escape(d.file.stem)
    head = f'<a href="{name}.html">{title}</a>' if link else title
    return (
        f'<figure id="{html.escape(d.id)}"><figcaption><h2>{head}</h2>'
        f'<span class="src">{html.escape(d.file.relative_to(root).as_posix())}</span></figcaption>'
        + '<div class="pair"><div class="pane"><div class="label">Диаграма</div>'
        + (f'<img src="{src}" alt="{title}">' if src else '<p class="meta">Още не е рендерирана – пуснете `diagrams render`.</p>')
        + f'</div><div class="pane"><div class="label">Mermaid код ({html.escape(d.file.name)})</div>'
        + f'<pre>{html.escape(d.source)}</pre></div></div></figure>'
    )


def _page(title: str, body: str) -> str:
    import html
    return (f'<!doctype html><html lang="bg"><head><meta charset="utf-8">'
            f'<meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<title>{html.escape(title)}</title><style>{_HTML_STYLE}</style></head>'
            f'<body><div class="wrap">{body}</div></body></html>\n')


def write_html(cfg: Config, diagrams: list[Diagram]) -> list[Path]:
    """One self-contained page per diagram (out/<name>.html), a gallery of all
    of them (out/index.html), and GALLERY.md, which GitHub renders natively."""
    import html
    from datetime import date

    root = repo_dir(cfg)
    (root / "out").mkdir(exist_ok=True)
    written = []
    for d in diagrams:
        p = d.out("html", root)
        p.write_text(_page(f"Фигура {', '.join(map(str, d.figures))}. {d.caption}",
                           '<p class="meta"><a href="index.html">← Всички диаграми</a></p>' + _figure_html(d, root, link=False)),
                     encoding="utf-8")
        written.append(p)
    nav = "".join(f'<a href="#{html.escape(d.id)}">Фиг. {", ".join(map(str, d.figures))}</a>' for d in diagrams)
    gallery = (f"<h1>Диаграми на дипломната</h1><p class='meta'>{len(diagrams)} диаграми · генерирано {date.today():%d.%m.%Y} "
               f"от src/*.mmd – редактирайте изходните файлове, не тази страница.</p><nav>{nav}</nav>"
               + "".join(_figure_html(d, root, link=True) for d in diagrams))
    idx = root / "out" / "index.html"
    idx.write_text(_page("Диаграми на дипломната", gallery), encoding="utf-8")
    written.append(idx)
    md = ["# Диаграми на дипломната", "", "GitHub показва диаграмите по-долу директно. Генерирано от `src/*.mmd` – редактирайте изходните файлове.", ""]
    for d in diagrams:
        md += [f"## Фигура {', '.join(map(str, d.figures))}. {d.caption}", "",
               f"Изходен файл: [`{d.file.relative_to(root).as_posix()}`]({d.file.relative_to(root).as_posix()}) · "
               f"[PNG](out/{d.file.stem}.png) · [SVG](out/{d.file.stem}.svg) · [HTML](out/{d.file.stem}.html)", "",
               "```mermaid", d.source.rstrip(), "```", ""]
    gm = root / "GALLERY.md"
    gm.write_text("\n".join(md), encoding="utf-8")
    written.append(gm)
    return written

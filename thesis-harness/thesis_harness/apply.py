"""Write approved proposals into a clean copy of the document.

The output is built from the ingested source every time, with every proposal
that is ``approved`` or already ``applied`` in this version. So approving a
second batch and applying again gives one document with both batches — never a
revision stacked on a revision. The source file is never modified.
"""

from __future__ import annotations

from pathlib import Path

from . import proposals as props
from .docmodel import (
    ApplyError, delete_paragraph, element_index, extract, insert_paragraph_after, paragraph_text,
    replace_all_in_paragraph, replace_figure_image, replace_in_paragraph, set_paragraph_text,
)
from .workspace import Workspace, now_iso, sha256_file, write_json

_ORDER = {"replace": 0, "replace_paragraph": 1, "insert_after": 2, "replace_image": 2.7, "delete_paragraph": 3}


def default_output(ws: Workspace, source: Path) -> Path:
    cfg = ws.config.data["output"]
    out_dir = ws.config.path(cfg["dir"]) if cfg.get("dir") else source.parent
    stem = source.stem.removesuffix(cfg["suffix"])
    out = out_dir / f"{stem}{cfg['suffix']}{source.suffix}"
    if out.resolve() == source.resolve():  # this round started from an earlier revision
        out = out_dir / f"{stem}{cfg['suffix']}-v{ws.state().get('version', 2)}{source.suffix}"
    return out


def apply(ws: Workspace, out: Path | None = None, dry_run: bool = False) -> dict:
    state = ws.state()
    source = Path(state["source_path"])
    if not source.exists():
        raise SystemExit(f"Изходният файл липсва: {source}")
    if sha256_file(source) != state["source_sha256"]:
        raise SystemExit(
            "Файлът е променян след последния ingest. Пуснете отново `ingest` със същия път,"
            " за да се пренесат предложенията върху новата версия."
        )
    out = (out or default_output(ws, source)).resolve()
    if out == source.resolve():
        raise SystemExit("Изходният път съвпада с оригинала – оригиналът никога не се презаписва.")

    doc = ws.doc()
    items = props.load(ws)
    todo = [p for p in items if p["status"] in ("approved", "applied") and p["kind"] != "note"]
    manual = [p for p in items if p["status"] == "approved" and p["kind"] == "note"]
    # Terminology replaces (all: true) run after every other text edit, so the
    # other proposals still find their original wording and the new wording they
    # bring in is covered too.
    todo.sort(key=lambda p: (2.5 if p["kind"] == "replace" and p.get("all") else _ORDER[p["kind"]], p["id"]))

    document, index, existing_ids = element_index(source)
    # Several proposals may insert after the same paragraph (bibliography entries
    # 37, 38, 39…). Each continues after the last one inserted there, in id order.
    last_inserted: dict[str, object] = {}
    results = []
    for p in todo:
        errs = props.validate(p, doc)
        if errs:
            results.append({"id": p["id"], "ok": False, "error": "; ".join(errs)})
            continue
        el = index.get(p["para"])
        try:
            if el is None:
                raise ApplyError("абзацът не е намерен в документа")
            if p["kind"] == "replace" and p.get("all"):
                replace_all_in_paragraph(el, p["old"], p["new"])
            elif p["kind"] == "replace":
                replace_in_paragraph(el, p["old"], p["new"])
            elif p["kind"] == "replace_paragraph":
                set_paragraph_text(el, p["new"])
            elif p["kind"] == "insert_after":
                style_el = index.get(p.get("style_from") or p["para"])
                anchor = last_inserted.get(p["para"], el)
                for chunk in [c.strip(" \r\n") for c in str(p["new"]).split("\n\n") if c.strip()]:
                    anchor = insert_paragraph_after(anchor, chunk, style_el, existing_ids, code=bool(p.get("code")))
                last_inserted[p["para"]] = anchor
            elif p["kind"] == "replace_image":
                from .proposals import _image_path
                sec = document.sections[0]
                usable = sec.page_width - sec.left_margin - sec.right_margin if sec.page_width else None
                replace_figure_image(document, el, _image_path(p["image"]), int(usable) if usable else None)
            elif p["kind"] == "delete_paragraph":
                delete_paragraph(el)
            results.append({"id": p["id"], "ok": True})
        except ApplyError as e:
            results.append({"id": p["id"], "ok": False, "error": str(e)})

    verification = []
    if not dry_run:
        out.parent.mkdir(parents=True, exist_ok=True)
        document.save(str(out))
        verification = verify(out, todo, results)

    by_id = {p["id"]: p for p in items}
    if not dry_run:
        for r in results:
            p = by_id[r["id"]]
            if r["ok"] and p["status"] != "applied":
                p["status"] = "applied"
                props._log(p, "applied", out.name)  # noqa: SLF001
            elif not r["ok"]:
                p["status"] = "failed"
                props._log(p, "failed", r["error"])  # noqa: SLF001
        props.save(ws, items)

    log = {
        "at": now_iso(), "source": str(source), "output": None if dry_run else str(out), "dry_run": dry_run,
        "applied": [r["id"] for r in results if r["ok"]],
        "failed": [r for r in results if not r["ok"]],
        "manual": [{"id": p["id"], "rationale": p.get("rationale")} for p in manual],
        "verification": verification,
    }
    write_json(ws.p("apply-log.json"), log)
    return log


def verify(out: Path, todo: list[dict], results: list[dict]) -> list[str]:
    """Re-read the written file and confirm each applied edit is really there."""
    ok_ids = {r["id"] for r in results if r["ok"]}
    problems = []
    written = extract(out)
    by_key = written.by_key()
    texts = [p.text for p in written.paras]
    for p in todo:
        if p["id"] not in ok_ids:
            continue
        target = by_key.get(p["para"])
        if p["kind"] == "replace" and p.get("all"):
            if target is None or (p["old"] in target.text and p["old"] not in p["new"]):
                problems.append(f"{p['id']}: „{p['old']}“ още се среща в абзаца след запис")
        elif p["kind"] == "replace":
            if target is None or (p["new"] and p["new"] not in target.text):
                problems.append(f"{p['id']}: новият текст не се вижда в абзаца след запис")
        elif p["kind"] == "replace_paragraph":
            if target is None or target.text != p["new"]:
                problems.append(f"{p['id']}: абзацът не съдържа новия текст след запис")
        elif p["kind"] == "insert_after":
            first = str(p["new"]).split("\n\n")[0].strip(" \r\n")
            if first not in texts and first.replace("\n", "") not in [t.replace("\n", "") for t in texts]:
                problems.append(f"{p['id']}: вмъкнатият абзац липсва след запис")
        elif p["kind"] == "replace_image":
            if not _figure_shows(out, p):
                problems.append(f"{p['id']}: над надписа на Фигура {p.get('figure')} не стои новото изображение")
        elif p["kind"] == "delete_paragraph":
            if target is not None:
                problems.append(f"{p['id']}: абзацът още е в документа")
    return problems


def _figure_shows(path: Path, p: dict) -> bool:
    """The image right above the figure's caption is the proposed one, and no
    Word drawing is left there to cover it."""
    import hashlib
    import re

    import docx
    from docx.oxml.ns import qn

    from .proposals import _image_path
    want = hashlib.sha1(_image_path(p["image"]).read_bytes()).hexdigest()
    d = docx.Document(str(path))
    body = list(d.element.body)
    cap_rx = re.compile(r"^\s*Фигура\s+%s\." % re.escape(str(p["figure"])))
    for i, el in enumerate(body):
        if el.tag == qn("w:p") and cap_rx.match("".join(t.text or "" for t in el.iter(qn("w:t")))):
            for prev in body[max(0, i - 3):i][::-1]:
                if prev.find(".//{http://schemas.openxmlformats.org/markup-compatibility/2006}AlternateContent") is not None:
                    return False
                blip = prev.find(".//{http://schemas.openxmlformats.org/drawingml/2006/main}blip")
                if blip is not None:
                    part = d.part.rels[blip.get(qn("r:embed"))].target_part
                    return hashlib.sha1(part.blob).hexdigest() == want
    return False


__all__ = ["apply", "default_output", "paragraph_text"]

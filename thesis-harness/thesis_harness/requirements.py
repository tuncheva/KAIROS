"""Official thesis requirements: source text, rules, verdicts.

The harness never contains requirements of its own. The flow is:

1. ``requirements import <file> [<file> ...]`` extracts the official documents'
   text into ``requirements/source.txt`` with ``=== D1 · стр. N ===`` markers.
2. Claude drafts ``requirements/rules.yaml`` from that text, with you. Every
   rule carries a verbatim ``quote`` and its ``page``.
3. ``requirements validate`` rejects any rule whose quote is not in the source.
   That is the guard against invented requirements.
4. Rules with ``check: <id>`` run a deterministic instrument with ``params``;
   rules with ``check: semantic`` are judged by Claude, who records verdicts
   with ``requirements record``.

``rules.yaml``::

    sources: [{id: D1, file: Указания....docx, sha256: ...}]
    rules:
      - id: R01
        title: Задължителни структурни части
        quote: "Дипломният проект съдържа: увод, ..."
        doc: D1
        page: 3
        check: req.required-headings
        params: {headings: ["^У\\s*В\\s*О\\s*Д", "ЗАКЛЮЧЕНИЕ|З А К Л Ю Ч Е Н И Е"]}
      - id: R02
        title: Целта и задачите са формулирани в увода
        quote: "..."
        page: 4
        check: semantic
"""

from __future__ import annotations

import re
import unicodedata
from pathlib import Path

from .workspace import read_yaml, sha256_file, write_yaml

VERDICTS = ("pass", "fail", "partial", "n/a", "unknown")


def source_path(req_dir: Path) -> Path:
    return req_dir / "source.txt"


def rules_path(req_dir: Path) -> Path:
    return req_dir / "rules.yaml"


def _docx_text(path: Path) -> tuple[str, str | None]:
    """Body text in reading order, tables inline as ``a | b`` rows. Returns
    (text, title) where title is the first non-empty paragraph."""
    import docx
    from docx.oxml.ns import qn

    d = docx.Document(str(path))
    lines: list[str] = []
    for el in d.element.body:
        if el.tag == qn("w:p"):
            t = "".join(x.text or "" for x in el.iter(qn("w:t")))
            if t.strip():
                lines.append(t)
        elif el.tag == qn("w:tbl"):
            for tr in el.iter(qn("w:tr")):
                cells = []
                for tc in tr.iter(qn("w:tc")):
                    paras = ["".join(x.text or "" for x in p.iter(qn("w:t"))) for p in tc.iter(qn("w:p"))]
                    cells.append(" ".join(x for x in paras if x.strip()))
                lines.append(" | ".join(cells))
    title = next((x.strip() for x in lines if x.strip()), None)
    return "\n".join(lines), title


def _read_pages(file: Path) -> tuple[list[str], str | None]:
    suffix = file.suffix.lower()
    if suffix == ".pdf":
        from pypdf import PdfReader

        return [(pg.extract_text() or "") for pg in PdfReader(str(file)).pages], None
    if suffix == ".docx":
        text, title = _docx_text(file)
        return [text], title
    if suffix in (".txt", ".md"):
        return [file.read_text(encoding="utf-8")], None
    raise SystemExit(f"Неподдържан формат {suffix}: подайте .pdf, .docx, .txt или .md")


def import_source(files: list[Path], req_dir: Path) -> list[dict]:
    """Extract every official document into one ``source.txt``. Documents get
    ids D1, D2… in the order given; a rule names its document with ``doc``.
    Re-importing replaces the whole source, so pass all documents each time."""
    blocks, metas = [], []
    for n, file in enumerate(files, 1):
        pages, title = _read_pages(file)
        doc_id = f"D{n}"
        # Uploaded files sometimes lose a Cyrillic name ("____1.docx"); the
        # document's own heading names it better.
        label = title if title and re.fullmatch(r"[\w-]*?_{4,}[\w-]*", file.stem) else file.name
        for i, t in enumerate(pages, 1):
            blocks.append(f"=== {doc_id} · стр. {i} ===\n{t.strip()}\n")
        metas.append({
            "id": doc_id, "file": file.name, "title": label if label != file.name else title,
            "sha256": sha256_file(file), "pages": len(pages),
            "empty_pages": [i for i, t in enumerate(pages, 1) if len(t.strip()) < 20],
        })
    header = "".join(f"# {m['id']}: {m['title'] or m['file']} ({m['file']})\n" for m in metas)
    req_dir.mkdir(parents=True, exist_ok=True)
    source_path(req_dir).write_text(header + "\n" + "\n".join(blocks), encoding="utf-8")
    rp = rules_path(req_dir)
    rules = read_yaml(rp, None) or {"rules": []}
    rules.pop("source", None)
    rules["sources"] = [{k: v for k, v in m.items() if k != "empty_pages"} for m in metas]
    rules.setdefault("rules", [])
    write_yaml(rp, {"sources": rules["sources"], "rules": rules["rules"], **{k: v for k, v in rules.items() if k not in ("sources", "rules")}})
    return metas


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s)
    s = s.replace("­", "")  # soft hyphen
    s = re.sub(r"-\s*\n\s*", "", s)  # words hyphenated across lines
    s = re.sub(r"[„“”\"«»]", '"', s)
    s = re.sub(r"[‘’']", "'", s)
    s = re.sub(r"[–—]", "-", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip().lower()


def _page_texts(source: str) -> dict[tuple[str, int], str]:
    out = {}
    rx = r"=== (D\d+) · стр\. (\d+) ===\n(.*?)(?=\n=== D\d+ · стр\. \d+ ===|\Z)"
    for m in re.finditer(rx, source, re.DOTALL):
        out[(m.group(1), int(m.group(2)))] = m.group(3)
    return out


def load_rules(req_dir: Path) -> dict:
    return read_yaml(rules_path(req_dir), None) or {"rules": []}


def validate_rules(req_dir: Path, check_ids: set[str]) -> list[str]:
    """Errors for rules that are not traceable to the official text."""
    sp = source_path(req_dir)
    if not sp.exists():
        return ["Няма requirements/source.txt – пуснете `requirements import <файл>`"]
    source = sp.read_text(encoding="utf-8")
    pages = _page_texts(source)
    data = load_rules(req_dir)
    errs = []
    seen = set()
    for r in data.get("rules") or []:
        rid = r.get("id")
        if not rid or not re.match(r"R\d+$", str(rid)):
            errs.append(f"{rid}: id трябва да е R<номер>")
        if rid in seen:
            errs.append(f"{rid}: повторен id")
        seen.add(rid)
        quote = str(r.get("quote") or "")
        if len(quote.strip()) < 10:
            errs.append(f"{rid}: липсва дословен цитат (quote)")
            continue
        q = _norm(quote)
        docs = sorted({d for d, _ in pages})
        doc = r.get("doc") or (docs[0] if len(docs) == 1 else None)
        if doc is None:
            errs.append(f"{rid}: има няколко документа – посочете doc ({', '.join(docs)})")
            continue
        if doc not in docs:
            errs.append(f"{rid}: няма документ {doc} в source.txt")
            continue
        page = int(r.get("page") or 1)
        if (doc, page) not in pages:
            errs.append(f"{rid}: {doc} няма стр. {page}")
        elif q not in _norm(pages[(doc, page)]):
            where = [f"{d} стр. {n}" for (d, n), t in pages.items() if q in _norm(t)]
            errs.append(f"{rid}: цитатът не е в {doc} стр. {page}"
                        + (f" (намерен в {', '.join(where)})" if where else " и не е намерен дословно никъде в източника"))
        check = r.get("check")
        if check != "semantic" and check not in check_ids:
            errs.append(f"{rid}: check трябва да е 'semantic' или една от: {', '.join(sorted(check_ids))}")
    return errs if errs else ([] if data.get("sources") else ["rules.yaml няма sources – пуснете `requirements import`"])


# When parts of the document disagree, the worst verdict wins: one chapter
# failing a rule fails it, and "n/a" from chapters the rule is not about is ignored.
_PRIORITY = {"fail": 4, "partial": 3, "unknown": 2, "pass": 1, "n/a": 0}


def record_results(ws_path: Path, req_dir: Path, results: list[dict], origin: str = "manual") -> list[str]:
    """Store verdicts from one reviewer (``origin``: a task id). Re-recording the
    same origin replaces its earlier verdicts."""
    rules = {r["id"]: r for r in load_rules(req_dir).get("rules") or []}
    errs = []
    clean = []
    for r in results:
        rid = r.get("rule")
        if rid not in rules:
            errs.append(f"{rid}: няма такова правило в rules.yaml")
            continue
        if r.get("verdict") not in VERDICTS:
            errs.append(f"{rid}: verdict трябва да е {', '.join(VERDICTS)}")
            continue
        if not str(r.get("explanation") or "").strip():
            errs.append(f"{rid}: липсва explanation")
            continue
        clean.append(r)
    if errs:
        return errs
    store = {x["rule"]: x for x in (read_yaml(ws_path, []) or [])}
    for r in clean:
        entry = store.setdefault(r["rule"], {"rule": r["rule"], "title": rules[r["rule"]].get("title", ""), "by_part": []})
        entry["by_part"] = [b for b in entry["by_part"] if b.get("origin") != origin]
        entry["by_part"].append({"origin": origin, **{k: v for k, v in r.items() if k != "rule"}})
    for entry in store.values():
        parts = entry["by_part"]
        entry["verdict"] = max((b["verdict"] for b in parts), key=lambda v: _PRIORITY[v], default="unknown")
        relevant = [b for b in parts if b["verdict"] != "n/a"] or parts
        entry["explanation"] = " | ".join(b["explanation"] for b in relevant)
    order = list(rules)
    write_yaml(ws_path, sorted(store.values(), key=lambda x: order.index(x["rule"]) if x["rule"] in order else 999))
    return []

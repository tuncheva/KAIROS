"""Official thesis requirements: source text, rules, verdicts.

The harness never contains requirements of its own. The flow is:

1. ``requirements import <file>`` extracts the official document's text into
   ``requirements/source.txt`` with ``=== стр. N ===`` page markers.
2. Claude drafts ``requirements/rules.yaml`` from that text, with you. Every
   rule carries a verbatim ``quote`` and its ``page``.
3. ``requirements validate`` rejects any rule whose quote is not in the source.
   That is the guard against invented requirements.
4. Rules with ``check: <id>`` run a deterministic instrument with ``params``;
   rules with ``check: semantic`` are judged by Claude, who records verdicts
   with ``requirements record``.

``rules.yaml``::

    source: {file: Наредба-....pdf, sha256: ...}
    rules:
      - id: R01
        title: Задължителни структурни части
        quote: "Дипломният проект съдържа: увод, ..."
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


def import_source(file: Path, req_dir: Path) -> dict:
    suffix = file.suffix.lower()
    pages: list[str] = []
    if suffix == ".pdf":
        from pypdf import PdfReader

        reader = PdfReader(str(file))
        pages = [(pg.extract_text() or "") for pg in reader.pages]
    elif suffix == ".docx":
        import docx

        d = docx.Document(str(file))
        parts = [p.text for p in d.paragraphs]
        for t in d.tables:
            for row in t.rows:
                parts.append(" | ".join(c.text for c in row.cells))
        pages = ["\n".join(parts)]
    elif suffix in (".txt", ".md"):
        pages = [file.read_text(encoding="utf-8")]
    else:
        raise SystemExit(f"Неподдържан формат {suffix}: подайте .pdf, .docx, .txt или .md")

    text = "\n".join(f"=== стр. {i} ===\n{t.strip()}\n" for i, t in enumerate(pages, 1))
    req_dir.mkdir(parents=True, exist_ok=True)
    source_path(req_dir).write_text(text, encoding="utf-8")
    meta = {"file": file.name, "sha256": sha256_file(file), "pages": len(pages), "chars": len(text)}
    rp = rules_path(req_dir)
    rules = read_yaml(rp, None) or {"rules": []}
    rules["source"] = meta
    rules.setdefault("rules", [])
    write_yaml(rp, rules)
    empty_pages = [i for i, t in enumerate(pages, 1) if len(t.strip()) < 20]
    meta["empty_pages"] = empty_pages
    return meta


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s)
    s = s.replace("­", "")  # soft hyphen
    s = re.sub(r"-\s*\n\s*", "", s)  # words hyphenated across lines
    s = re.sub(r"[„“”\"«»]", '"', s)
    s = re.sub(r"[‘’']", "'", s)
    s = re.sub(r"[–—]", "-", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip().lower()


def _page_texts(source: str) -> dict[int, str]:
    out = {}
    for m in re.finditer(r"=== стр\. (\d+) ===\n(.*?)(?=\n=== стр\. \d+ ===|\Z)", source, re.DOTALL):
        out[int(m.group(1))] = m.group(2)
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
    whole = _norm(source)
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
        page = r.get("page")
        if page is not None and int(page) in pages:
            if q not in _norm(pages[int(page)]):
                where = [n for n, t in pages.items() if q in _norm(t)]
                errs.append(
                    f"{rid}: цитатът не е на стр. {page}" + (f" (намерен на стр. {', '.join(map(str, where))})" if where else " и не е намерен в източника")
                )
        elif q not in whole:
            errs.append(f"{rid}: цитатът не е намерен дословно в източника")
        check = r.get("check")
        if check != "semantic" and check not in check_ids:
            errs.append(f"{rid}: check трябва да е 'semantic' или една от: {', '.join(sorted(check_ids))}")
    src_meta = data.get("source") or {}
    return errs if errs else ([] if src_meta else ["rules.yaml няма source – пуснете `requirements import`"])


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

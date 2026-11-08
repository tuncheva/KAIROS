"""Proposed changes: validation, storage, decisions, review sheet.

A proposal is the unit you approve. Shape (``proposals.yaml``)::

    - id: P007
      status: proposed      # proposed | approved | rejected | applied | merged | stale | failed
      source: check:code.stack-versions   # or review:<prompt-id>, requirement:R03, user
      severity: error       # error | warning | info
      para: 3f2a1b0c        # paragraph key from doc.json (null only for kind: note)
      section: 2.1.2. Next.js и React
      kind: replace         # replace | replace_paragraph | insert_after | delete_paragraph | note
      old: Next.js 15       # replace: exact text, must occur once in the paragraph
      new: Next.js 16
      rationale: ...
      evidence: [package.json:56 — "next": "16.1.1"]
      user_note: ...        # your comments; Claude reads them when revising
      history: [...]

Editing the file by hand is supported: change ``status`` to ``approved`` /
``rejected``, write in ``user_note``, or rewrite ``new``. The next command
re-validates everything.
"""

from __future__ import annotations

import re
from difflib import SequenceMatcher

from .docmodel import DocModel, Para
from .workspace import Workspace, now_iso, read_json, read_yaml, write_yaml

KINDS = ("replace", "replace_paragraph", "insert_after", "delete_paragraph", "note")
STATUSES = ("proposed", "approved", "rejected", "applied", "merged", "stale", "failed")
SEVERITIES = ("error", "warning", "info")
OPEN = ("proposed", "approved", "applied", "failed")
_STATUS_BG = {
    "proposed": "предложено", "approved": "одобрено", "rejected": "отхвърлено", "applied": "приложено",
    "merged": "влязло в документа", "stale": "остаряло", "failed": "неуспешно",
}
_SEV_BG = {"error": "грешка", "warning": "внимание", "info": "инфо"}


class ProposalError(ValueError):
    pass


# --------------------------------------------------------------------- storage


def load(ws: Workspace) -> list[dict]:
    return read_yaml(ws.p("proposals.yaml"), []) or []


def save(ws: Workspace, items: list[dict]) -> None:
    write_yaml(ws.p("proposals.yaml"), items)


def _next_id(items: list[dict]) -> str:
    n = max((int(m.group(1)) for p in items if (m := re.match(r"P(\d+)$", str(p.get("id", ""))))), default=0)
    return f"P{n + 1:03d}"


def _log(p: dict, event: str, note: str | None = None) -> None:
    entry = {"at": now_iso(), "event": event}
    if note:
        entry["note"] = note
    p.setdefault("history", []).append(entry)


# ------------------------------------------------------------------ validation


def validate(p: dict, doc: DocModel) -> list[str]:
    """Problems that make a proposal unusable as written. Empty list = valid."""
    errs = []
    kind = p.get("kind")
    if kind not in KINDS:
        errs.append(f"kind трябва да е едно от {', '.join(KINDS)}")
        return errs
    if p.get("severity", "warning") not in SEVERITIES:
        errs.append(f"severity трябва да е едно от {', '.join(SEVERITIES)}")
    if not str(p.get("rationale") or "").strip():
        errs.append("липсва rationale (защо е нужна промяната)")
    source = str(p.get("source") or "")
    if not source:
        errs.append("липсва source")
    if source != "user" and not (p.get("evidence") or []):
        errs.append("липсва evidence – всяко предложение трябва да сочи доказателство (файл:ред, цитат от изискванията)")
    if source.startswith("requirement:") and not re.match(r"requirement:R\d+", source):
        errs.append("source за изискване е requirement:R<номер>")

    para = p.get("para")
    if kind == "note" and not para:
        return errs
    target = doc.by_key().get(str(para)) if para else None
    if target is None:
        errs.append(f"абзац '{para}' не съществува в текущата версия на документа")
        return errs
    old, new = p.get("old"), p.get("new")
    if kind == "replace":
        if not old:
            errs.append("replace изисква old")
        elif (c := target.text.count(old)) != 1:
            errs.append(
                "old не се среща в абзаца (копирайте го точно от doc.md)" if c == 0
                else f"old се среща {c} пъти в абзаца – удължете откъса, за да е еднозначен"
            )
        if new is None:
            errs.append("replace изисква new (празен низ = изтриване на откъса)")
        elif "\n" in str(new) or "\t" in str(new):
            errs.append("new в replace не може да съдържа нов ред/табулация – използвайте insert_after")
        if old is not None and new is not None and old == new:
            errs.append("old и new са еднакви")
    elif kind == "replace_paragraph":
        if not new:
            errs.append("replace_paragraph изисква new")
        if old is not None and old != target.text:
            errs.append("old е зададен, но не съвпада с текущия текст на абзаца")
        if not target.text:
            errs.append("абзацът е празен – използвайте insert_after")
    elif kind == "insert_after":
        if not str(new or "").strip():
            errs.append("insert_after изисква new")
        sf = p.get("style_from")
        if sf and sf not in doc.by_key():
            errs.append(f"style_from '{sf}' не съществува")
    elif kind == "delete_paragraph":
        if target.has_drawing:
            errs.append("абзацът съдържа изображение – трие се само ръчно")
    return errs


def _fingerprint(p: dict) -> tuple:
    return (p.get("para"), p.get("kind"), p.get("old"), p.get("new"))


def add(ws: Workspace, incoming: list[dict], doc: DocModel) -> tuple[list[dict], list[tuple[dict, list[str]]], int]:
    """Validate and append proposals. Returns (added, rejected_with_errors, duplicates)."""
    items = load(ws)
    known = {_fingerprint(p) for p in items}
    by_key = doc.by_key()
    added, invalid, dupes = [], [], 0
    for raw in incoming:
        p = {k: v for k, v in raw.items() if k not in ("id", "status", "history")}
        p.setdefault("severity", "warning")
        if isinstance(p.get("evidence"), str):
            p["evidence"] = [p["evidence"]]
        errs = validate(p, doc)
        if errs:
            invalid.append((raw, errs))
            continue
        if _fingerprint(p) in known:
            dupes += 1
            continue
        target = by_key.get(str(p.get("para"))) if p.get("para") else None
        out = {"id": _next_id(items), "status": "proposed", "source": p.pop("source"), "severity": p.pop("severity")}
        out["para"] = p.pop("para", None)
        out["section"] = p.pop("section", None) or (target.section if target else None)
        out["kind"] = p.pop("kind")
        for k in ("old", "new", "style_from", "rationale", "evidence"):
            if k in p:
                out[k] = p.pop(k)
        out.update(p)  # keep any extra fields a plugin adds
        out["para_hash"] = target.hash if target else None
        _log(out, "proposed")
        items.append(out)
        known.add(_fingerprint(out))
        added.append(out)
    save(ws, items)
    return added, invalid, dupes


# -------------------------------------------------------------------- decisions


def parse_ids(specs: list[str], items: list[dict]) -> list[dict]:
    """``P3``, ``3``, ``P3-P7``, ``3-7``, ``P3,P5``, ``all`` (every proposed one)."""
    by_num = {}
    for p in items:
        m = re.match(r"P(\d+)$", p["id"])
        if m:
            by_num[int(m.group(1))] = p
    chosen: list[dict] = []
    for spec in specs:
        for part in re.split(r"[,\s]+", spec.strip()):
            if not part:
                continue
            if part.lower() in ("all", "всички"):
                chosen += [p for p in items if p["status"] == "proposed"]
                continue
            m = re.match(r"^P?(\d+)(?:\s*[-–]\s*P?(\d+))?$", part, re.IGNORECASE)
            if not m:
                raise ProposalError(f"не разбирам '{part}' (очаквам P3, P3-P7 или all)")
            lo = int(m.group(1))
            hi = int(m.group(2) or lo)
            for n in range(lo, hi + 1):
                if n not in by_num:
                    raise ProposalError(f"няма предложение P{n:03d}")
                chosen.append(by_num[n])
    seen, out = set(), []
    for p in chosen:
        if p["id"] not in seen:
            seen.add(p["id"])
            out.append(p)
    return out


def decide(ws: Workspace, specs: list[str], decision: str, note: str | None, doc: DocModel) -> list[dict]:
    status = {"approve": "approved", "reject": "rejected", "reopen": "proposed"}[decision]
    items = load(ws)
    chosen = parse_ids(specs, items)
    if decision == "approve":
        bad = [(p["id"], validate(p, doc)) for p in chosen if p["kind"] != "note"]
        bad = [(i, e) for i, e in bad if e]
        if bad:
            raise ProposalError(
                "не мога да одобря невалидни предложения:\n"
                + "\n".join(f"  {i}: {'; '.join(e)}" for i, e in bad)
            )
    for p in chosen:
        if p["status"] in ("merged",):
            continue
        p["status"] = status
        if note:
            p["user_note"] = (p.get("user_note", "") + ("\n" if p.get("user_note") else "") + note).strip()
        _log(p, decision, note)
    save(ws, items)
    return chosen


def edit(ws: Workspace, pid: str, changes: dict, note: str | None, doc: DocModel) -> dict:
    items = load(ws)
    [p] = parse_ids([pid], items)
    before = {k: p.get(k) for k in changes}
    p.update({k: v for k, v in changes.items() if v is not None})
    errs = validate(p, doc)
    if errs:
        p.update(before)
        raise ProposalError("; ".join(errs))
    if p["status"] in ("approved", "applied", "failed"):
        p["status"] = "proposed"  # content changed: it needs a fresh approval
    if note:
        p["user_note"] = (p.get("user_note", "") + ("\n" if p.get("user_note") else "") + note).strip()
    _log(p, "edited", f"{', '.join(changes)}" + (f" — {note}" if note else ""))
    save(ws, items)
    return p


# ----------------------------------------------------------------- re-anchoring


def reanchor(ws: Workspace, old_doc: DocModel | None, new_doc: DocModel) -> dict:
    """After a new version of the document is ingested, carry proposals over.

    * applied proposals whose ``new`` text is now in the paragraph → ``merged``
    * keys that disappeared are re-found by the paragraph's old text hash
    * anything that no longer validates → ``stale`` (kept for the record)
    """
    items = load(ws)
    new_by_key = new_doc.by_key()
    new_by_hash: dict[str, list[Para]] = {}
    for para in new_doc.paras:
        new_by_hash.setdefault(para.hash, []).append(para)
    counts = {"merged": 0, "rekeyed": 0, "stale": 0, "kept": 0}
    for p in items:
        if p["status"] in ("rejected", "merged", "stale") or not p.get("para"):
            continue
        key = p["para"]
        if key not in new_by_key and p.get("para_hash") in new_by_hash and len(new_by_hash[p["para_hash"]]) == 1:
            p["para"] = new_by_hash[p["para_hash"]][0].key
            _log(p, "rekeyed", f"{key} → {p['para']}")
            counts["rekeyed"] += 1
        target = new_by_key.get(p["para"])
        if p["kind"] == "delete_paragraph" and p["status"] in ("applied", "approved") and target is None \
                and p.get("para_hash") not in new_by_hash:
            p["status"] = "merged"
            _log(p, "merged", "абзацът вече го няма в новата версия")
            counts["merged"] += 1
            continue
        if p["status"] in ("applied", "approved") and target is not None and _is_merged(p, new_doc, target):
            p["status"] = "merged"
            _log(p, "merged", "текстът вече е в новата версия")
            counts["merged"] += 1
            continue
        if p["status"] == "applied":
            p["status"] = "approved"  # the new base does not contain it yet: apply again
        errs = validate(p, new_doc) if p["kind"] != "note" else []
        if errs:
            p["status"] = "stale"
            _log(p, "stale", "; ".join(errs))
            counts["stale"] += 1
        else:
            if target is not None:
                p["para_hash"] = target.hash
            counts["kept"] += 1
    save(ws, items)
    return counts


def _is_merged(p: dict, doc: DocModel, target: Para) -> bool:
    kind, old, new = p["kind"], p.get("old") or "", p.get("new") or ""
    if kind == "replace":
        if new:
            return new in target.text and (old not in target.text or old in new)
        return old not in target.text
    if kind == "replace_paragraph":
        return target.text == new
    if kind == "insert_after":
        return _following_has(doc, target, new)
    return False


def _following_has(doc: DocModel, anchor: Para, text: str) -> bool:
    first = text.split("\n\n")[0].strip()
    for para in doc.paras[anchor.index + 1: anchor.index + 6]:
        if para.text.strip() == first:
            return True
    return False


# ---------------------------------------------------------------------- review


def _context(text: str, old: str, new: str, width: int = 80) -> str:
    i = text.find(old)
    if i < 0:
        return ""
    a, b = max(0, i - width), min(len(text), i + len(old) + width)
    pre = ("…" if a else "") + text[a:i]
    post = text[i + len(old): b] + ("…" if b < len(text) else "")
    return f"{pre}~~{old}~~ **{new}**{post}" if old else f"{pre}**{new}**{post}"


def _ratio(a: str, b: str) -> str:
    return f"{SequenceMatcher(None, a, b).ratio():.0%}"


def render_review(ws: Workspace, doc: DocModel, requirements_results: list | None = None) -> str:
    items = load(ws)
    state = ws.state()
    by_key = doc.by_key()
    counts = {s: sum(1 for p in items if p["status"] == s) for s in STATUSES}
    lines = [
        f"# Преглед на предложенията — {state.get('source_name', '')}",
        "",
        f"Версия на документа: {state.get('version', '?')} · извлечен {state.get('ingested_at', '?')}"
        f" · код: {state.get('repo', {}).get('commit', '?')} ({state.get('repo', {}).get('branch', '?')})",
        "",
        "Обобщение: " + " · ".join(f"{_STATUS_BG[s]}: {n}" for s, n in counts.items() if n) if items else "Няма предложения.",
        "",
        "Как да решите: в чата („одобри P1-P5, отхвърли P6, P7 – по-кратко“) или тук в proposals.yaml",
        "(status: approved / rejected, user_note: …).",
        "",
    ]
    if requirements_results:
        lines += ["## Съответствие с изискванията", ""]
        icon = {"pass": "✅", "fail": "❌", "partial": "⚠️", "n/a": "➖", "unknown": "❔"}
        for r in requirements_results:
            lines.append(f"- {icon.get(r.get('verdict'), '❔')} **{r.get('rule')}** {r.get('title', '')} — {r.get('explanation', '')}")
        lines.append("")

    def order(p: dict) -> tuple:
        para = by_key.get(str(p.get("para")))
        return (para.index if para else 10**6, p["id"])

    visible = [p for p in items if p["status"] not in ("merged",)]
    current_section = object()
    for p in sorted(visible, key=order):
        section = p.get("section") or "Общи бележки"
        if section != current_section:
            lines += [f"## {section}", ""]
            current_section = section
        para = by_key.get(str(p.get("para")))
        head = f"### {p['id']} · {_SEV_BG.get(p.get('severity'), p.get('severity'))} · {_STATUS_BG.get(p['status'], p['status'])} · `{p.get('source')}`"
        lines += [head, ""]
        if para is not None:
            lines.append(f"¶{para.index} (`{para.key}`)")
        kind = p["kind"]
        if kind == "replace" and para is not None:
            lines.append(f"> {_context(para.text, p.get('old', ''), p.get('new', ''))}")
        elif kind == "replace_paragraph":
            lines += [f"**Сега:** {para.text if para else p.get('old', '')}", "", f"**Ново** (сходство {_ratio(para.text if para else '', p.get('new', ''))}): {p.get('new', '')}"]
        elif kind == "insert_after":
            lines += [f"**Нов абзац след:** „{(para.text[:90] + '…') if para and len(para.text) > 90 else (para.text if para else '')}“", "", f"> {p.get('new', '')}"]
        elif kind == "delete_paragraph":
            lines.append(f"**Изтриване на абзаца:** ~~{para.text if para else ''}~~")
        else:
            lines.append("**Ръчно действие** (не се прилага автоматично).")
        lines += ["", f"**Защо:** {p.get('rationale', '')}"]
        ev = p.get("evidence") or []
        if ev:
            lines.append("**Доказателство:** " + "; ".join(f"`{e}`" for e in ev))
        if p.get("user_note"):
            lines.append(f"**Ваша бележка:** {p['user_note']}")
        if p["status"] in ("failed", "stale") and p.get("history"):
            lines.append(f"**Причина:** {p['history'][-1].get('note', '')}")
        lines.append("")

    unverified = read_json(ws.p("unverified.json"), {}) or {}
    flat = [u for part in unverified.values() for u in (part or [])]
    if flat:
        lines += ["## Непроверени твърдения", "",
                  "Твърдения, за които прегледът не намери потвърждение в кода. Не са промени –"
                  " решете дали да ги уточните, махнете или оставите.", ""]
        for u in flat:
            para = by_key.get(str(u.get("para")))
            where = f"¶{para.index}" if para else str(u.get("para", ""))
            lines.append(f"- {where}: „{u.get('claim', '')}“ — {u.get('reason', '')}")
        lines.append("")
    text = "\n".join(lines).rstrip() + "\n"
    ws.p("review.md").write_text(text, encoding="utf-8")
    return text

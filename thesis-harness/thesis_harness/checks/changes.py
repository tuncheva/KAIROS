"""What the code changed since the last sync, as leads on the sections it makes stale.

Input: ``facts.json → changes`` (see ``thesis_harness/changes.py``), built from the
``## Documentation impact`` block of every PR merged since ``sync.yaml``.

Both checks produce leads only, anchored on the section's heading. A lead goes
to the review task of the chunk that holds the heading, where Claude decides
whether the section already says it and, if not, proposes the text with
``file:line`` evidence from the code. The PR text itself is never evidence.
"""

from __future__ import annotations

from ..changes import anchor_for
from . import Check, Finding, register


def _ledger(ctx) -> dict | None:
    data = (ctx.facts or {}).get("changes")
    return data if isinstance(data, dict) and "sections" in data else None


def _sections(ctx, ledger: dict) -> list[dict]:
    from ..changes import load_sections

    return ctx.shared("changes.sections", lambda: load_sections(ledger["sections_file"]))


def _where(sid: str, matched: str | None) -> str:
    if matched == sid:
        return f"раздел {sid}"
    if matched is None:
        return f"раздел {sid} (в документа няма такова заглавие)"
    return f"раздел {sid} (в документа няма такова заглавие – насоката е при {matched})"


@register
class DeclaredChanges(Check):
    id = "changes.declared"
    title = "Промени, декларирани в PR"
    description = "Всеки ред от „Documentation impact“ на слят PR след последната синхронизация става насока към раздела си."

    def run(self, ctx):
        ledger = _ledger(ctx)
        if not ledger:
            return
        sections = _sections(ctx, ledger)
        heads = ctx.doc.headings()
        outside = {x["id"] for x in sections if x.get("in_document") is False}
        for s in ledger["sections"]:
            if s["id"] in outside:
                continue  # README and other targets outside the thesis
            # No heading at all (an id the document lost): the lead goes to the first part.
            head, matched = anchor_for(s["id"], sections, heads)
            for item in s["items"]:
                yield Finding(
                    self.id, "warning",
                    f"{item['ref']} „{item['title']}“ (слят {item['merged_at'][:10]}) за {_where(s['id'], matched)}: "
                    f"„{item['text']}“. Ако разделът още не го казва, предложи текст; доказателството е в кода, не в PR.",
                    para=head.key if head else None,
                    evidence=[f"{item['ref']} {item.get('url', '')}".strip()],
                    lead=True,
                )


@register
class UndeclaredChanges(Check):
    id = "changes.undeclared"
    title = "Промени без декларация"
    description = "PR без „Documentation impact“, commit-и без PR и раздели, които PR е пипнал, без да ги назове."

    def run(self, ctx):
        ledger = _ledger(ctx)
        if not ledger:
            return
        sections = _sections(ctx, ledger)
        heads = ctx.doc.headings()
        cap = int(ctx.options.get("max_sections_per_change", 4))

        # One lead per section, listing every change that points at it: a backlog of
        # undeclared commits reads as one question per section, not thirty.
        per_section: dict[str, list[str]] = {}
        refs: dict[str, list[str]] = {}

        def add(sid: str, item: dict, why: str) -> None:
            files = ", ".join((item.get("files") or {}).get(sid) or [])
            per_section.setdefault(sid, []).append(
                f"{item['ref']} „{item['title']}“ ({item['merged_at'][:10]}, {why}{': ' + files if files else ''})")
            refs.setdefault(sid, []).append(f"{item['ref']} {item.get('url', '')}".strip())

        for item in ledger["needs_review"]:
            # A change spread over many sections is a refactor or an import: listed
            # in the ledger (`H changes`), but leads on all of them would be noise.
            if 0 < len(item["suggested"]) <= cap:
                for sid in item["suggested"]:
                    add(sid, item, "без декларация")
        for item in ledger["possibly_missed"]:
            for sid in item["sections"]:
                add(sid, item, "не е назовал раздела")

        for sid, lines in per_section.items():
            head, matched = anchor_for(sid, sections, heads)
            if head is None:
                continue
            shown = lines[:10] + ([f"и още {len(lines) - 10}"] if len(lines) > 10 else [])
            yield Finding(
                self.id, "info",
                f"{_where(sid, matched).capitalize()}: {len(lines)} промени пипат кода му без ред в "
                f"„Documentation impact“ – {'; '.join(shown)}. Провери в кода какво се е променило и дали "
                "разделът е остарял.",
                para=head.key,
                evidence=refs[sid][:10],
                lead=True,
            )

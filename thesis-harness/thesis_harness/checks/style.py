"""House style the author chose for the thesis. Each check here is off until
``harness.yaml`` configures it, because a style is a decision, not a fact."""

from __future__ import annotations

import re

from . import Check, Finding, register

_CODE = r"[AА](\d{1,2})"  # Latin A or Cyrillic А


def _names(facts: dict, script: str) -> dict[str, str]:
    """A<n> → persona name, from the code (registry + agentNames + bg.json)."""
    agents = facts.get("agents") or {}
    by_id = {a["id"]: a for a in agents.get("items") or []}
    key = "persona_bg" if script == "cyrillic" else "persona"
    out = {}
    for code, agent_id in (agents.get("code_to_id") or {}).items():
        name = (by_id.get(agent_id) or {}).get(key)
        if name:
            out[code] = name
    return out


def _join(names: list[str]) -> str:
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " и " + names[-1]


@register
class AgentNames(Check):
    id = "style.agent-names"
    title = "Агентите се назовават с имената си"
    description = (
        "Кодове като A1, A2–A5 се заменят с името на агента (Mentor, Odysseus…)."
        " Имената са от кода. Настройва се с checks.options.style.agent-names.script: latin | cyrillic."
    )

    def run(self, ctx):
        script = ctx.options.get("script")
        if script not in ("latin", "cyrillic"):
            return
        names = _names(ctx.facts, script)
        if not names:
            return
        name_rx = "|".join(re.escape(n) for n in sorted(names.values(), key=len, reverse=True))
        evidence = "src/lib/agentNames.ts" if script == "latin" else "src/i18n/messages/bg.json → agents.names"
        # Most specific first. Proposals apply in id order, so "Mentor (A1)" is
        # rewritten before the bare "A1" inside it would be.
        patterns = [
            # "A2–A5" / "A2-A5" → "Odysseus, Mnemosyne, Iris и Solon"
            (re.compile(r"(?<![\w/.-])" + _CODE + r"\s*[–-]\s*[AА]?(\d{1,2})(?![\w])"), "range"),
            # "A1 · Mentor" → "Mentor" (catalogue rows)
            (re.compile(r"(?<![\w/.-])" + _CODE + r"\s*[·:–-]\s*(?=(?:" + name_rx + r")\b)"), "prefix"),
            # "Mentor (A1)" → "Mentor"
            (re.compile(r"(?<=\b)(" + name_rx + r")\s*\(\s*" + _CODE + r"\s*\)"), "paren"),
            # "A1" → "Mentor"
            (re.compile(r"(?<![\w/.-])" + _CODE + r"(?![\w])"), "bare"),
        ]
        for p in ctx.prose:
            if p.kind == "toc":
                continue
            seen: set[str] = set()
            text = p.text
            for rx, kind in patterns:
                for m in rx.finditer(text):
                    old = m.group(0)
                    if old in seen:
                        continue
                    if kind == "range":
                        lo, hi = int(m.group(1)), int(m.group(2))
                        span = [names.get(f"A{i}") for i in range(lo, hi + 1)]
                        if lo >= hi or None in span:
                            continue
                        new = _join(span)
                    elif kind == "prefix":
                        new = ""
                    elif kind == "paren":
                        new = m.group(1)
                    else:
                        new = names.get(f"A{int(m.group(1))}")
                        if new is None:
                            continue
                    seen.add(old)
                    yield Finding(
                        self.id, "warning", f"„{old}“ → „{new or '(премахва се)'}“: агентите се назовават с имената си.",
                        para=p.key, excerpt=old, evidence=[evidence],
                        # Always "all": a terminology replace runs after every other edit (see
                        # apply.py), so it also covers wording another proposal brings in.
                        fix={"kind": "replace", "old": old, "new": new, "all": True},
                    )
                # Later patterns must not see what an earlier one already covers.
                text = rx.sub(lambda m: "\0" * len(m.group(0)), text)

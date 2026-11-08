"""Text-level checks that need no knowledge of the code."""

from __future__ import annotations

import re

from . import Check, Finding, register

# Letters that look the same in both alphabets.
_CYR_TO_LAT = dict(zip("АВЕКМНОРСТХаеорсухіјѕ", "ABEKMHOPCTXaeopcyxijs"))
_LAT_TO_CYR = {v: k for k, v in _CYR_TO_LAT.items()}
_WORD = re.compile(r"[A-Za-zА-Яа-яЁёЀ-ӿ]+")
_CYR = re.compile(r"[Ѐ-ӿ]")
_LAT = re.compile(r"[A-Za-z]")


@register
class MixedScript(Check):
    id = "text.mixed-script"
    title = "Смесени кирилица и латиница в една дума"
    description = (
        "Думи с букви и от двете азбуки – обикновено следа от автоматична замяна"
        " (напр. „AI“→„ИИ“ вътре в английска дума) или от сгрешена клавиатурна подредба."
    )

    def run(self, ctx):
        for p in ctx.prose:
            seen = set()
            for m in _WORD.finditer(p.text):
                w = m.group(0)
                if w in seen or not (_CYR.search(w) and _LAT.search(w)):
                    continue
                seen.add(w)
                cyr = len(_CYR.findall(w))
                lat = len(_LAT.findall(w))
                fix = None
                note = ""
                if lat >= cyr:
                    candidate = "".join(_CYR_TO_LAT.get(c, c) for c in w)
                    if "ИИ" in w or "ии" in w:
                        # "chИИn" -> "chain" (letters follow: it was "ai" inside a word);
                        # "OpenИИ" -> "OpenAI" (word-final: the brand spelling).
                        undone = re.sub(r"ИИ(?=[a-z])", "ai", w)
                        undone = undone.replace("ИИ", "AI").replace("ии", "ai")
                        candidate = "".join(_CYR_TO_LAT.get(c, c) for c in undone)
                        note = " Вероятно замяна „AI“→„ИИ“ е засегнала английска дума."
                else:
                    candidate = "".join(_LAT_TO_CYR.get(c, c) for c in w)
                if not (_CYR.search(candidate) and _LAT.search(candidate)) and p.text.count(w) == 1:
                    fix = {"kind": "replace", "old": w, "new": candidate}
                yield Finding(
                    self.id, "error" if fix else "warning", f"„{w}“ смесва кирилица и латиница.{note}",
                    para=p.key, excerpt=w, evidence=["текстът на абзаца"], fix=fix,
                )


@register
class DoubledWords(Check):
    id = "text.doubled-words"
    title = "Повторени думи"
    description = "Една и съща дума два пъти подред („на на“, „the the“)."

    _rx = re.compile(r"(?<!\w)(\w{2,})\s+\1(?!\w)", re.IGNORECASE | re.UNICODE)

    def run(self, ctx):
        for p in ctx.prose:
            for m in self._rx.finditer(p.text):
                if m.group(1).isdigit():
                    continue
                old = m.group(0)
                yield Finding(
                    self.id, "warning", f"Повторена дума: „{old}“.", para=p.key, excerpt=old,
                    evidence=["текстът на абзаца"],
                    fix={"kind": "replace", "old": old, "new": m.group(1)} if p.text.count(old) == 1 else None,
                )

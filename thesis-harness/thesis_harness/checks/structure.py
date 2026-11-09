"""Internal consistency of the document: heading numbers, cross-references,
figure and table captions. These compare the document with itself only."""

from __future__ import annotations

import re

from . import Check, Finding, register

CAPTION = re.compile(r"^\s*(Фигура|Фиг\.|Таблица|Табл\.)\s*(\d+)\s*[.:–-]", re.IGNORECASE)
_KIND = {"фигура": "Фигура", "фиг.": "Фигура", "таблица": "Таблица", "табл.": "Таблица"}
SECTION_REF = re.compile(r"(?<![\w.])(?:т\.|точка|точки|раздел|подраздел)\s*(\d+(?:\.\d+)+|\d+)(?!\d)")
APPENDIX_REF = re.compile(r"(?<!\w)Приложени[ея]\s*(?:№\s*)?(\d+)")
FIGTAB_REF = re.compile(r"(?<!\w)(Фигура|Фиг\.|Таблица|Табл\.)\s*(\d+)(?!\d)", re.IGNORECASE)


def _nums(number: str) -> tuple[int, ...]:
    return tuple(int(x) for x in number.split("."))


@register
class HeadingNumbering(Check):
    id = "structure.headings"
    title = "Номерация на заглавията"
    description = "Празни заглавия, пропуснати или повторени номера, номер с грешна дълбочина."

    def run(self, ctx):
        heads = ctx.doc.headings()
        prev_by_parent: dict[tuple[int, ...], tuple[int, ...]] = {}
        chapter: int | None = None
        for h in heads:
            if not h.text.strip():
                yield Finding(
                    self.id, "error", f"Празно заглавие (ниво {h.level}) – липсва текст/номер.",
                    para=h.key, evidence=[f"стил „{h.style}“ без текст"],
                )
                continue
            if h.level == 1:
                chapter = int(h.number) if h.number and h.number.isdigit() else None
                continue
            if not h.number:
                continue
            nums = _nums(h.number)
            if len(nums) != h.level:
                yield Finding(
                    self.id, "warning",
                    f"„{h.number}“ има {len(nums)} нива, а стилът е „{h.style}“ (ниво {h.level}).",
                    para=h.key, excerpt=h.number, evidence=["заглавията в документа"],
                )
            if h.level == 2 and chapter is not None and nums[0] != chapter:
                yield Finding(
                    self.id, "warning",
                    f"Раздел {h.number} е в глава {chapter}.", para=h.key, excerpt=h.number,
                    evidence=["заглавията в документа"],
                )
            parent = nums[:-1]
            expected = prev_by_parent.get(parent, parent + (0,))
            exp_last = expected[-1] + 1
            if nums[-1] != exp_last:
                if nums[-1] > exp_last:
                    missing = ", ".join(".".join(map(str, parent + (n,))) for n in range(exp_last, nums[-1]))
                    msg = f"След {'.'.join(map(str, expected)) if expected[-1] else 'началото на ' + '.'.join(map(str, parent))} идва {h.number} – липсва(т) {missing}."
                else:
                    msg = f"Номер {h.number} се повтаря или е извън ред (предходен: {'.'.join(map(str, expected))})."
                yield Finding(self.id, "warning", msg, para=h.key, excerpt=h.number, evidence=["заглавията в документа"])
            prev_by_parent[parent] = nums
            # A new parent resets deeper counters.
            for k in [k for k in prev_by_parent if len(k) > len(nums) and k[: len(nums)] == nums]:
                del prev_by_parent[k]


@register
class CrossReferences(Check):
    id = "structure.cross-refs"
    title = "Вътрешни препратки"
    description = "„т. X.Y“, „Приложение N“, „Фигура N“, „Таблица N“ сочат към нещо, което съществува."

    def run(self, ctx):
        heads = ctx.doc.headings()
        numbered = {h.number: h for h in heads if h.number}
        empty_heading_slots = set()
        # An empty heading between 2.8.4 and 2.8.6 is "2.8.5 without a title".
        for i, h in enumerate(heads):
            if not h.text.strip() and 0 < i < len(heads) - 1:
                a, b = heads[i - 1].number, heads[i + 1].number
                if a and b and len(a.split(".")) == len(b.split(".")):
                    na, nb = _nums(a), _nums(b)
                    if na[:-1] == nb[:-1] and nb[-1] - na[-1] == 2:
                        empty_heading_slots.add(".".join(map(str, na[:-1] + (na[-1] + 1,))))
        appendices = set()
        for h in heads:
            m = re.match(r"^\s*Приложение\s*(?:№\s*)?(\d+)", h.text)
            if m:
                appendices.add(m.group(1))
        captions = {(_KIND[m.group(1).lower()], m.group(2)) for p in ctx.prose if (m := CAPTION.match(p.text))}

        for p in ctx.prose:
            if p.kind == "heading":
                continue
            for m in SECTION_REF.finditer(p.text):
                num = m.group(1).rstrip(".")
                if num in numbered:
                    continue
                if num in empty_heading_slots:
                    yield Finding(
                        self.id, "error", f"Препратка към т. {num}, но това заглавие е празно.",
                        para=p.key, excerpt=m.group(0), evidence=["текстът на абзаца"],
                    )
                elif "." in num:  # bare "т. 3" is usually a list item, not a section
                    yield Finding(
                        self.id, "error", f"Препратка към несъществуваща точка {num}.",
                        para=p.key, excerpt=m.group(0), evidence=["текстът на абзаца"],
                    )
            for m in APPENDIX_REF.finditer(p.text):
                if appendices and m.group(1) not in appendices and not p.text.lstrip().startswith(m.group(0)):
                    yield Finding(
                        self.id, "error", f"Препратка към несъществуващо Приложение {m.group(1)}.",
                        para=p.key, excerpt=m.group(0), evidence=["текстът на абзаца"],
                    )
            if CAPTION.match(p.text):
                continue
            for m in FIGTAB_REF.finditer(p.text):
                kind = _KIND[m.group(1).lower()]
                if (kind, m.group(2)) not in captions:
                    yield Finding(
                        self.id, "error", f"Препратка към {kind} {m.group(2)}, а такъв надпис няма.",
                        para=p.key, excerpt=m.group(0), evidence=["текстът на абзаца"],
                    )


@register
class Captions(Check):
    id = "structure.captions"
    title = "Номерация на фигури и таблици"
    description = "Последователни номера на надписите, без пропуски и повторения."

    def run(self, ctx):
        seen: dict[str, list] = {"Фигура": [], "Таблица": []}
        for p in ctx.prose:
            m = CAPTION.match(p.text)
            if m:
                seen[_KIND[m.group(1).lower()]].append((int(m.group(2)), p))
        for kind, items in seen.items():
            expected = 1
            used = set()
            for n, p in items:
                if n in used:
                    yield Finding(self.id, "error", f"{kind} {n} се повтаря.", para=p.key,
                                  excerpt=f"{kind} {n}", evidence=["текстът на абзаца"])
                elif n != expected:
                    gap = f"липсва {kind} {expected}" if n > expected else f"очаквах {kind} {expected}"
                    if n > expected + 1:
                        gap = f"липсват {kind} {expected}–{n - 1}"
                    yield Finding(self.id, "warning", f"{kind} {n} след {kind} {expected - 1}: {gap}.",
                                  para=p.key, excerpt=f"{kind} {n}", evidence=["текстът на абзаца"])
                used.add(n)
                expected = max(expected, n + 1)

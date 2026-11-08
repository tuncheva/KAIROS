"""Deterministic checks that only run on behalf of a requirement rule.

None of these encode a requirement. Each is a measuring instrument; the rule in
``requirements/rules.yaml`` supplies the target values (``params``) together with
the verbatim quote from the official document that justifies them.
"""

from __future__ import annotations

import re
import zipfile

from . import Check, Finding, register

_EMU_PER_CM = 360000


def _open(ctx):
    import docx

    if ctx.source_path is None:
        raise RuntimeError("няма път до .docx (пуснете ingest отново)")
    return docx.Document(str(ctx.source_path))


@register
class RequiredHeadings(Check):
    id = "req.required-headings"
    title = "Задължителни раздели"
    description = "params.headings: списък от регулярни изрази; всеки трябва да съвпада с поне едно заглавие."
    requirement = True

    def run(self, ctx):
        heads = [h.text.strip() for h in ctx.doc.headings()]
        for rx in ctx.options.get("headings") or []:
            if not any(re.search(rx, h, re.IGNORECASE) for h in heads):
                yield Finding(self.id, "error", f"Няма заглавие, което да отговаря на „{rx}“.",
                              evidence=["заглавия: " + "; ".join(heads[:12]) + ("…" if len(heads) > 12 else "")])


@register
class PageSetup(Check):
    id = "req.page-setup"
    title = "Полета и размер на страницата"
    description = "params: margins_cm {top,bottom,left,right}, page {width_cm,height_cm}, tolerance_cm (0.1)."
    requirement = True

    def run(self, ctx):
        d = _open(ctx)
        tol = float(ctx.options.get("tolerance_cm", 0.1))
        margins = ctx.options.get("margins_cm") or {}
        page = ctx.options.get("page") or {}
        for i, s in enumerate(d.sections, 1):
            actual = {
                "top": s.top_margin, "bottom": s.bottom_margin, "left": s.left_margin, "right": s.right_margin,
                "width_cm": s.page_width, "height_cm": s.page_height,
            }
            for side, want in list(margins.items()) + list(page.items()):
                got = actual.get(side)
                if got is None:
                    continue
                got_cm = got / _EMU_PER_CM
                if abs(got_cm - float(want)) > tol:
                    yield Finding(self.id, "error",
                                  f"Раздел {i}: {side} = {got_cm:.2f} см, изискване {want} см.",
                                  evidence=[f"word/document.xml, w:sectPr #{i}"])


@register
class BodyFont(Check):
    id = "req.body-font"
    title = "Шрифт на основния текст"
    description = "params: name, size_pt, style (по подразбиране Normal), min_share (0.9) – дял на текста с този шрифт."
    requirement = True

    def run(self, ctx):
        d = _open(ctx)
        style_name = ctx.options.get("style", "Normal")
        want_name = ctx.options.get("name")
        want_size = ctx.options.get("size_pt")
        try:
            st = d.styles[style_name]
        except KeyError:
            yield Finding(self.id, "error", f"Стилът „{style_name}“ липсва в документа.")
            return
        base_name, base_size = st.font.name, st.font.size.pt if st.font.size else None
        total = matched = 0
        for p in d.paragraphs:
            if p.style is None or p.style.name != style_name:
                continue
            for r in p.runs:
                n = len(r.text.strip())
                if not n:
                    continue
                total += n
                name = r.font.name or base_name
                size = r.font.size.pt if r.font.size else base_size
                ok = (not want_name or (name or "").lower() == str(want_name).lower()) and (
                    not want_size or (size is not None and abs(size - float(want_size)) < 0.01)
                )
                matched += n if ok else 0
        share = matched / total if total else 1.0
        need = float(ctx.options.get("min_share", 0.9))
        if share < need:
            yield Finding(self.id, "error",
                          f"Само {share:.0%} от текста в стил „{style_name}“ е {want_name or ''} {want_size or ''} пт"
                          f" (стилът е {base_name} {base_size} пт).",
                          evidence=[f"styles.xml → {style_name}; преки форматирания по run-ове"])


@register
class PageCount(Check):
    id = "req.page-count"
    title = "Брой страници"
    description = (
        "params: min, max. Чете docProps/app.xml (<Pages>), което Word записва при запис;"
        " ако файлът е генериран от друг инструмент, стойността може да липсва или да е остаряла."
    )
    requirement = True

    def run(self, ctx):
        with zipfile.ZipFile(ctx.source_path) as z:
            try:
                xml = z.read("docProps/app.xml").decode("utf-8")
            except KeyError:
                yield Finding(self.id, "info", "Няма docProps/app.xml – броят страници е неизвестен; проверете в Word.")
                return
        m = re.search(r"<Pages>(\d+)</Pages>", xml)
        if not m:
            yield Finding(self.id, "info", "app.xml няма <Pages> – проверете броя страници в Word.")
            return
        pages = int(m.group(1))
        lo, hi = ctx.options.get("min"), ctx.options.get("max")
        if (lo is not None and pages < int(lo)) or (hi is not None and pages > int(hi)):
            yield Finding(self.id, "error", f"Документът е {pages} стр., изискване: {lo or '–'}…{hi or '–'}.",
                          evidence=["docProps/app.xml <Pages> (според последния запис в Word)"])

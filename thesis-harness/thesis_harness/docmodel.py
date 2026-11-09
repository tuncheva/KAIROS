"""Reading a .docx into addressable paragraphs, and writing approved edits back.

Design constraints:

* **Stable addresses.** Every paragraph gets a key. Word stamps paragraphs with
  ``w14:paraId`` and keeps it across saves, so that is the key whenever it is
  present and unique. Otherwise the key falls back to ``i<index>``, which is only
  stable within one version of the file; re-ingesting re-anchors those by text.
* **One notion of "the text".** Extraction and editing walk exactly the same
  nodes (``w:t``, ``w:tab``, ``w:br``, ``w:cr`` inside the paragraph's own runs,
  hyperlinks, insertions, smart tags and simple fields). If they disagreed, an
  ``old`` string copied from the extracted text could fail to match at apply time.
* **Formatting survives.** Edits rewrite ``w:t`` text in place. Replacement text
  inherits the formatting of the first run it overlaps; drawings, bookmarks and
  comment anchors are never touched by a replace.
"""

from __future__ import annotations

import copy
import hashlib
import random
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path

import docx
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph

W14_PARA_ID = "{http://schemas.microsoft.com/office/word/2010/wordml}paraId"
W14_TEXT_ID = "{http://schemas.microsoft.com/office/word/2010/wordml}textId"

# Runs that belong to the paragraph's visible text. Deleted runs (w:del) are left
# out on purpose: tracked deletions are not part of what the reader sees.
_RUN_XPATH = (
    "./w:r | ./w:hyperlink/w:r | ./w:ins/w:r | ./w:smartTag/w:r"
    " | ./w:fldSimple/w:r | ./w:sdt/w:sdtContent/w:r | ./w:hyperlink/w:ins/w:r"
)
_SEGMENT_TAGS = {qn("w:t"): None, qn("w:tab"): "\t", qn("w:br"): "\n", qn("w:cr"): "\n"}
_PROTECTED_TAGS = (qn("w:drawing"), qn("w:pict"), qn("w:object"))

_HEADING_STYLE = re.compile(r"(?:heading|заглавие)\s*(\d)", re.IGNORECASE)
_TOC_STYLE = re.compile(r"^(?:toc|съдържание)", re.IGNORECASE)
_SECTION_NUMBER = re.compile(r"^\s*(\d+(?:\.\d+)*)\.?(?=\s)")
_BG_ORDINALS = {
    "първа": 1, "втора": 2, "трета": 3, "четвърта": 4, "пета": 5,
    "шеста": 6, "седма": 7, "осма": 8, "девета": 9, "десета": 10,
}


class ApplyError(Exception):
    """An edit could not be applied as written; the document is left unchanged for it."""


# --------------------------------------------------------------------------- model


@dataclass
class Para:
    key: str
    index: int
    style: str
    kind: str  # heading | body | table | toc | caption | empty
    level: int  # heading level, 0 for non-headings
    number: str | None  # "2.8.9" for numbered headings, "2" for "Глава втора"
    section: str  # title of the nearest heading above (or this heading)
    text: str
    hash: str
    has_drawing: bool = False

    def to_dict(self) -> dict:
        return asdict(self)

    @staticmethod
    def from_dict(d: dict) -> "Para":
        return Para(**d)


@dataclass
class DocModel:
    paras: list[Para]
    warnings: list[str] = field(default_factory=list)

    def by_key(self) -> dict[str, Para]:
        return {p.key: p for p in self.paras}

    def headings(self) -> list[Para]:
        return [p for p in self.paras if p.kind == "heading"]

    def prose(self) -> list[Para]:
        """Paragraphs a reader reads as content: body text, tables, captions, headings."""
        return [p for p in self.paras if p.kind not in ("toc", "empty")]


def text_hash(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]


# ------------------------------------------------------------------- traversal


def _iter_paragraph_elements(body):
    """Every top-level-in-flow ``w:p`` under ``body`` in document order.

    Paragraphs inside text boxes (a ``w:p`` nested under another ``w:p``) are
    skipped: they belong to drawings and editing them in place is not safe.
    """
    p_tag = qn("w:p")
    for el in body.iter(p_tag):
        parent = el.getparent()
        nested = False
        while parent is not None and parent is not body:
            if parent.tag == p_tag:
                nested = True
                break
            parent = parent.getparent()
        if not nested:
            yield el


def _has_ancestor(el, tag: str, stop) -> bool:
    parent = el.getparent()
    while parent is not None and parent is not stop:
        if parent.tag == tag:
            return True
        parent = parent.getparent()
    return False


def _segments(p_el):
    """Ordered (element, text) pairs that make up the paragraph's text."""
    out = []
    for r in p_el.xpath(_RUN_XPATH):
        for child in r:
            if child.tag in _SEGMENT_TAGS:
                fixed = _SEGMENT_TAGS[child.tag]
                out.append((child, (child.text or "") if fixed is None else fixed))
    return out


def paragraph_text(p_el) -> str:
    return "".join(t for _, t in _segments(p_el))


def _style_name(p_el, body_parent) -> str:
    try:
        style = Paragraph(p_el, body_parent).style
        return style.name if style is not None else ""
    except Exception:  # styles part missing or malformed
        return ""


def _heading_level(style: str, p_el) -> int:
    m = _HEADING_STYLE.search(style or "")
    if m:
        return int(m.group(1))
    if (style or "").lower() == "title":
        return 0
    lvl = p_el.find(f"{qn('w:pPr')}/{qn('w:outlineLvl')}")
    if lvl is not None:
        try:
            v = int(lvl.get(qn("w:val")))
            if v < 9:
                return v + 1
        except (TypeError, ValueError):
            pass
    return 0


def heading_number(text: str, level: int) -> str | None:
    m = _SECTION_NUMBER.match(text)
    if m:
        return m.group(1)
    if level == 1:
        words = text.lower().split()
        if len(words) >= 2 and words[0] == "глава" and words[1] in _BG_ORDINALS:
            return str(_BG_ORDINALS[words[1]])
    return None


# ------------------------------------------------------------------- extraction


def extract(path: str | Path) -> DocModel:
    document = docx.Document(str(path))
    body = document.element.body
    body_parent = document._body  # noqa: SLF001 - python-docx has no public accessor
    tbl_tag, sdt_tag = qn("w:tbl"), qn("w:sdt")

    raw = []
    seen_ids: dict[str, int] = {}
    for el in _iter_paragraph_elements(body):
        pid = el.get(W14_PARA_ID)
        if pid:
            seen_ids[pid] = seen_ids.get(pid, 0) + 1
        raw.append((el, pid))

    warnings: list[str] = []
    dupes = {k for k, n in seen_ids.items() if n > 1}
    if dupes:
        warnings.append(
            f"{len(dupes)} paraId стойности се повтарят (обикновено от копирани абзаци);"
            " тези абзаци получават позиционни ключове."
        )
    if body.find(".//" + qn("w:del")) is not None or body.find(".//" + qn("w:ins")) is not None:
        warnings.append(
            "Документът съдържа непотвърдени Track Changes. Текстът е извлечен като"
            " приети вмъквания без изтритото; препоръчително е да ги приемете/отхвърлите в Word."
        )

    paras: list[Para] = []
    section = ""
    for index, (el, pid) in enumerate(raw):
        key = pid.lower() if pid and pid not in dupes else f"i{index:04d}"
        text = paragraph_text(el)
        style = _style_name(el, body_parent)
        level = _heading_level(style, el)
        has_drawing = any(el.find(".//" + t) is not None for t in _PROTECTED_TAGS)

        if _TOC_STYLE.match(style or "") or (
            _has_ancestor(el, sdt_tag, body) and re.search(r"\t\d+\s*$", text)
        ):
            kind = "toc"
        elif level:
            kind = "heading"
        elif _has_ancestor(el, tbl_tag, body):
            kind = "table"
        elif (style or "").lower() in ("caption", "надпис"):
            kind = "caption"
        elif not text.strip():
            kind = "empty"
        else:
            kind = "body"

        number = heading_number(text, level) if kind == "heading" else None
        if kind == "heading":
            section = text.strip() or f"(празно заглавие ¶{index})"
        paras.append(
            Para(
                key=key, index=index, style=style, kind=kind, level=level if kind == "heading" else 0,
                number=number, section=section, text=text, hash=text_hash(text),
                has_drawing=has_drawing,
            )
        )
    return DocModel(paras=paras, warnings=warnings)


# --------------------------------------------------------------------- editing


def _replace_span(p_el, start: int, end: int, new: str) -> None:
    segs = []
    pos = 0
    for el, t in _segments(p_el):
        segs.append((el, t, pos, pos + len(t)))
        pos += len(t)
    overlapping = [s for s in segs if s[2] < end and s[3] > start] if end > start else []
    if end == start:  # pure insertion at a position
        overlapping = [s for s in segs if s[2] <= start <= s[3] and s[0].tag == qn("w:t")][:1]
    host = next((s for s in overlapping if s[0].tag == qn("w:t")), None)
    if host is None:
        raise ApplyError("търсеният текст е само табулации/нови редове – редактирайте ръчно")
    for el, t, s0, s1 in overlapping:
        ls, le = max(start, s0) - s0, min(end, s1) - s0
        if el is host[0]:
            el.text = t[:ls] + new + t[le:]
            el.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
        elif el.tag == qn("w:t"):
            el.text = t[:ls] + t[le:]
            el.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
        else:
            el.getparent().remove(el)


def replace_all_in_paragraph(p_el, old: str, new: str) -> int:
    """Replace every occurrence, right to left so earlier offsets stay valid.
    Zero occurrences is not an error: an edit applied before this one may have
    rewritten that text already. Returns how many were replaced."""
    text = paragraph_text(p_el)
    starts = [m.start() for m in re.finditer(re.escape(old), text)]
    for start in reversed(starts):
        _replace_span(p_el, start, start + len(old), new)
    return len(starts)


def replace_in_paragraph(p_el, old: str, new: str) -> None:
    text = paragraph_text(p_el)
    count = text.count(old)
    if count == 0:
        raise ApplyError("старият текст вече не се среща в абзаца")
    if count > 1:
        raise ApplyError(f"старият текст се среща {count} пъти в абзаца – нужен е по-дълъг откъс")
    start = text.index(old)
    _replace_span(p_el, start, start + len(old), new)


def set_paragraph_text(p_el, new: str) -> None:
    text = paragraph_text(p_el)
    if not text:
        raise ApplyError("абзацът е празен – използвайте insert_after от съседен абзац")
    _replace_span(p_el, 0, len(text), new)


def _new_para_id(existing: set[str]) -> str:
    while True:
        v = f"{random.randint(1, 0x7FFFFFFF):08X}"
        if v.lower() not in existing:
            existing.add(v.lower())
            return v


def insert_paragraph_after(anchor_el, text: str, style_source_el, existing_ids: set[str], code: bool = False):
    """Insert a new paragraph after ``anchor_el`` with the paragraph and run
    formatting of ``style_source_el``. A newline in ``text`` becomes a line
    break; ``code`` sets a monospaced font for a listing. Returns the new element."""
    new_el = copy.deepcopy(style_source_el)
    ppr = new_el.find(qn("w:pPr"))
    first_run = next(iter(style_source_el.xpath(_RUN_XPATH)), None)
    for child in list(new_el):
        if child is not ppr:
            new_el.remove(child)
    if ppr is not None:
        # Section breaks and numbering restarts belong to the source paragraph only.
        for tag in ("w:sectPr",):
            for x in ppr.findall(qn(tag)):
                ppr.remove(x)
    run = copy.deepcopy(first_run) if first_run is not None else None
    if run is not None:
        for child in list(run):
            if child.tag != qn("w:rPr"):
                run.remove(child)
    else:
        run = new_el.makeelement(qn("w:r"), {})
    if code:
        rpr = run.find(qn("w:rPr"))
        if rpr is None:
            rpr = run.makeelement(qn("w:rPr"), {})
            run.insert(0, rpr)
        for tag in ("w:rFonts", "w:sz", "w:szCs"):
            for x in rpr.findall(qn(tag)):
                rpr.remove(x)
        fonts = rpr.makeelement(qn("w:rFonts"), {qn(a): "Consolas" for a in ("w:ascii", "w:hAnsi", "w:cs", "w:eastAsia")})
        rpr.insert(0, fonts)
        for tag in ("w:sz", "w:szCs"):
            rpr.append(rpr.makeelement(qn(tag), {qn("w:val"): "20"}))  # 10 pt
        if ppr is not None:  # a listing is not indented or justified like prose
            for tag in ("w:ind", "w:jc"):
                for x in ppr.findall(qn(tag)):
                    ppr.remove(x)
    # A tab is a w:tab element and a newline a w:br to Word, not characters in w:t.
    for li, line in enumerate(text.split("\n")):
        if li:
            run.append(run.makeelement(qn("w:br"), {}))
        for i, piece in enumerate(line.split("\t")):
            if i:
                run.append(run.makeelement(qn("w:tab"), {}))
            if piece:
                t = run.makeelement(qn("w:t"), {})
                t.text = piece
                t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
                run.append(t)
    new_el.append(run)
    if new_el.get(W14_PARA_ID) is not None:
        new_el.set(W14_PARA_ID, _new_para_id(existing_ids))
    if new_el.get(W14_TEXT_ID) is not None:
        new_el.set(W14_TEXT_ID, _new_para_id(existing_ids))
    anchor_el.addnext(new_el)
    return new_el


_A = "http://schemas.openxmlformats.org/drawingml/2006/main"
_WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
_EMU_PER_INCH = 914400


_MC = "http://schemas.openxmlformats.org/markup-compatibility/2006"


def _drawing_runs(p_el):
    """Runs of a paragraph that carry a picture or a drawing: a plain inline
    picture, or a Word drawing (shapes, text boxes, groups) wrapped in
    mc:AlternateContent whose fallback is often a 1×1 placeholder image."""
    out = []
    for r in p_el.iter(qn("w:r")):
        if r.find(f"{{{_MC}}}AlternateContent") is not None or r.find(qn("w:drawing")) is not None \
                or r.find(qn("w:pict")) is not None:
            out.append(r)
    return out


def _is_plain_picture(run) -> bool:
    return (run.find(f"{{{_MC}}}AlternateContent") is None and run.find(qn("w:pict")) is None
            and run.find(f".//{{{_A}}}blip") is not None)


def replace_figure_image(document, caption_el, image_path, max_width_emu: int | None = None) -> str:
    """Put ``image_path`` in place of the figure that belongs to a caption.

    The figure is the nearest drawing within three elements above the caption.
    A plain picture gets the new image in place: its displayed width is kept
    and its height follows the new aspect ratio, with its own image part so a
    shared placeholder never changes for other figures. A Word drawing (shapes,
    text boxes – what Word shows instead of its 1×1 fallback image) is removed
    from its paragraph, text untouched, and the image goes into a new centred
    paragraph right above the caption. Returns "replaced" or "inserted".
    """
    from docx.shared import Emu

    from .diagrams import png_size

    w_px, h_px = png_size(Path(image_path))
    usable = max_width_emu or 6 * _EMU_PER_INCH
    prev = caption_el.getprevious()
    for _ in range(3):
        if prev is None:
            break
        runs = _drawing_runs(prev)
        if runs:
            extent = prev.find(f".//{{{_WP}}}extent")
            cx = int(extent.get("cx")) if extent is not None else usable
            cx = min(cx, usable)
            if len(runs) == 1 and _is_plain_picture(runs[0]):
                rid, _ = document.part.get_or_add_image(str(image_path))
                runs[0].find(f".//{{{_A}}}blip").set(qn("r:embed"), rid)
                cy = int(cx * h_px / w_px)
                for el in [runs[0].find(f".//{{{_WP}}}extent"), runs[0].find(f".//{{{_A}}}xfrm/{{{_A}}}ext")]:
                    if el is not None:
                        el.set("cx", str(cx))
                        el.set("cy", str(cy))
                return "replaced"
            for r in runs:
                r.getparent().remove(r)
            width = cx
            break
        prev = prev.getprevious()
    else:
        width = usable
    if prev is None:
        width = usable
    new_p = caption_el.makeelement(qn("w:p"), {})
    caption_el.addprevious(new_p)
    para = Paragraph(new_p, document._body)  # noqa: SLF001
    para.alignment = 1
    para.add_run().add_picture(str(image_path), width=Emu(int(width)))
    return "inserted"


def delete_paragraph(p_el) -> None:
    if any(p_el.find(".//" + t) is not None for t in _PROTECTED_TAGS):
        raise ApplyError("абзацът съдържа изображение/обект – изтрийте го ръчно в Word")
    if p_el.find(f"{qn('w:pPr')}/{qn('w:sectPr')}") is not None:
        raise ApplyError("абзацът носи прекъсване на раздел – изтриването ще развали оформлението")
    p_el.getparent().remove(p_el)


def element_index(path: str | Path):
    """Open a document and map paragraph keys to their XML elements, with the
    same keying rules as :func:`extract`."""
    document = docx.Document(str(path))
    body = document.element.body
    raw = list(_iter_paragraph_elements(body))
    counts: dict[str, int] = {}
    for el in raw:
        pid = el.get(W14_PARA_ID)
        if pid:
            counts[pid] = counts.get(pid, 0) + 1
    index = {}
    for i, el in enumerate(raw):
        pid = el.get(W14_PARA_ID)
        key = pid.lower() if pid and counts[pid] == 1 else f"i{i:04d}"
        index[key] = el
    existing = {k.lower() for k in counts}
    return document, index, existing

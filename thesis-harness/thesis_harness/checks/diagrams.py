"""Checks for the diagram set (scope = "diagrams").

Each check reads the Mermaid sources (``ctx.doc`` paragraphs, one per diagram),
the facts from the code, and through ``ctx.extra`` the manifest, the render
errors and — when a thesis workspace exists — the thesis text, to compare the
figures with their captions and references.
"""

from __future__ import annotations

import re

from . import Check, Finding, register
from .code import _file_names, _source_index

_AGENT_CODE = re.compile(r"(?<![\w/.-])[AА](\d{1,2})(?:\s*[–-]\s*[AА]?(\d{1,2}))?(?![\w])")


def _diag(ctx, key):
    return ctx.extra["by_id"][key]


def _vis(ctx, p) -> str:
    from ..diagrams import visible_text
    return visible_text(p.text)


@register
class Render(Check):
    id = "dgm.render"
    title = "Диаграмата се рендерира"
    description = "Mermaid изходът се генерира без грешка (синтаксис, непознат тип диаграма)."
    scope = "diagrams"

    def run(self, ctx):
        for key, err in (ctx.extra.get("render_errors") or {}).items():
            if err:
                yield Finding(self.id, "error", f"{key}: не се рендерира – {err}", para=key,
                              evidence=["mmdc"])
        for p in ctx.doc.paras:
            if not p.text.strip():
                yield Finding(self.id, "error", f"{p.key}: липсва файлът с изходния код.", para=p.key,
                              evidence=[str(_diag(ctx, p.key).file)])


@register
class Manifest(Check):
    id = "dgm.figures"
    title = "Фигури в дипломната ↔ диаграми"
    description = (
        "Всяка фигура от дипломната има диаграма и обратно; надписът съвпада с този в"
        " манифеста; фигурата е спомената в текста."
    )
    scope = "diagrams"

    def run(self, ctx):
        thesis = ctx.extra.get("thesis_doc")
        if thesis is None:
            return
        ignore = set(ctx.options.get("ignore_figures") or [])
        caption_rx = re.compile(r"^\s*Фигура\s+(\d+)\.\s*(.*)$")
        captions = {int(m.group(1)): (p, m.group(2).strip()) for p in thesis.prose() if (m := caption_rx.match(p.text))}
        by_fig = {f: d for d in ctx.extra["diagrams"] for f in d.figures}
        for n, (p, cap) in sorted(captions.items()):
            if n in ignore:
                continue
            d = by_fig.get(n)
            if d is None:
                yield Finding(self.id, "error", f"Фигура {n} („{cap}“) няма диаграма в хранилището.",
                              evidence=[f"надпис в дипломната ¶{p.index}"])
                continue
            norm = lambda s: re.sub(r"\s+", " ", s.replace("(втори екземпляр)", "")).strip(" .")  # noqa: E731
            accepted = [norm(c) for c in [d.caption, *(d.meta.get("also_captions") or [])]]
            if norm(cap) not in accepted:
                yield Finding(self.id, "warning",
                              f"Фигура {n}: надписът в дипломната е „{cap}“, а в манифеста – „{d.caption}“.",
                              para=d.id, evidence=["diagrams.yaml", f"¶{p.index}"])
            refs = [q for q in thesis.prose() if q is not p and re.search(r"(?<!\w)[Фф]игура\s+" + str(n) + r"(?!\d)", q.text)]
            if not refs:
                yield Finding(self.id, "warning", f"Фигура {n} не е спомената никъде в текста.",
                              para=d.id, evidence=[f"надпис ¶{p.index}"], lead=True)
        for d in ctx.extra["diagrams"]:
            for n in d.figures:
                if n not in captions:
                    yield Finding(self.id, "warning",
                                  f"{d.id}: фигура {n} е в манифеста, но в дипломната няма такъв надпис.",
                                  para=d.id, evidence=["diagrams.yaml"])


@register
class AgentNames(Check):
    id = "dgm.agent-names"
    title = "Агентите с имената си"
    description = "Кодовете A1–A6 в диаграмите се заменят с имената на агентите (както в текста)."
    scope = "diagrams"

    def run(self, ctx):
        from .style import _names, _join
        script = ctx.options.get("script", "latin")
        names = _names(ctx.facts, script)
        if not names:
            return
        for p in ctx.doc.paras:
            vis = _vis(ctx, p)
            seen = set()
            for m in _AGENT_CODE.finditer(vis):
                old = m.group(0)
                if old in seen or old not in p.text:
                    continue
                seen.add(old)
                if m.group(2):
                    span = [names.get(f"A{i}") for i in range(int(m.group(1)), int(m.group(2)) + 1)]
                    if None in span:
                        continue
                    new = _join(span)
                else:
                    new = names.get(f"A{int(m.group(1))}")
                    if not new:
                        continue
                yield Finding(self.id, "warning", f"{p.key}: „{old}“ → „{new}“.", para=p.key, excerpt=old,
                              evidence=["src/lib/agentNames.ts"],
                              fix={"kind": "replace", "old": old, "new": new, "all": True})


@register
class Numbers(Check):
    id = "dgm.numbers"
    title = "Числа спрямо кода"
    description = "Брой таблици, миграции, tRPC рутери, езици и агенти, изписани в диаграмата, спрямо кода."
    scope = "diagrams"

    def _expected(self, facts):
        db = facts.get("database") or {}
        ag = facts.get("agents") or {}
        return [
            (r"(\d+)\s+таблици", db.get("table_count"), "брой таблици", db.get("schema_dir")),
            (r"(\d+)\s+миграции", db.get("migration_count"), "брой миграции", "src/server/db/migrations"),
            (r"(\d+)\s+рутера", (facts.get("api") or {}).get("router_count"), "tRPC рутери", "src/server/api/root.ts"),
            (r"(\d+)\s+езика", len((facts.get("locales") or {}).get("offered") or []) or None, "предлагани езици", "src/i18n/locales.ts"),
            (r"(\d+)\s+разговорни", ag.get("conversational_count"), "разговорни агенти", ag.get("source")),
            (r"(\d+)\s+(?:вградени\s+)?планирани", ag.get("scheduled_count"), "планирани агенти", ag.get("source")),
            (r"(\d+)\s+пишещи", ag.get("conversational_writing_count"), "пишещи агенти", ag.get("source")),
        ]

    def run(self, ctx):
        for p in ctx.doc.paras:
            for rx, want, label, src in self._expected(ctx.facts):
                if want is None:
                    continue
                for m in re.finditer(rx, p.text):
                    if int(m.group(1)) == int(want):
                        continue
                    old = m.group(0)
                    new = old.replace(m.group(1), str(want), 1)
                    yield Finding(self.id, "error", f"{p.key}: „{old}“ – {label} в кода: {want}.", para=p.key,
                                  excerpt=old, evidence=[str(src)],
                                  fix={"kind": "replace", "old": old, "new": new, "all": True})


@register
class ErSchema(Check):
    id = "dgm.er-schema"
    title = "ER диаграма спрямо схемата"
    description = "Таблиците и колоните в erDiagram съществуват в src/server/db/schemas; връзките съответстват на външните ключове."
    scope = "diagrams"

    def run(self, ctx):
        from ..diagrams import er_model
        cols = (ctx.facts.get("database") or {}).get("columns") or {}
        for p in ctx.doc.paras:
            if "er" not in _diag(ctx, p.key).checks:
                continue
            model = er_model(p.text)
            for ent, attrs in model.items():
                if ent not in cols:
                    yield Finding(self.id, "error", f"{p.key}: таблица „{ent}“ няма в схемата.", para=p.key,
                                  excerpt=ent, evidence=["src/server/db/schemas/"])
                    continue
                for a in attrs:
                    if a not in cols[ent]:
                        yield Finding(self.id, "error", f"{p.key}: колона „{ent}.{a}“ няма в схемата.", para=p.key,
                                      excerpt=a, evidence=[f"src/server/db/schemas/ – {ent}: {', '.join(list(cols[ent])[:12])}…"])
            for m in re.finditer(r'^\s*"?([A-Za-z0-9_]+)"?\s*[|}o][|o]?--[|o]?[|{o]\s*"?([A-Za-z0-9_]+)"?', p.text, re.MULTILINE):
                a, b = m.group(1), m.group(2)
                linked = any(c.get("references") == a for c in (cols.get(b) or {}).values()) or \
                    any(c.get("references") == b for c in (cols.get(a) or {}).values())
                if a in cols and b in cols and not linked:
                    yield Finding(self.id, "warning", f"{p.key}: връзка {a} – {b}, а в схемата няма външен ключ между тях.",
                                  para=p.key, excerpt=f"{a} -- {b}", evidence=["src/server/db/schemas/"])


@register
class TablesCoverage(Check):
    id = "dgm.tables-coverage"
    title = "Всички таблици в обзорната диаграма"
    description = "За диаграма с проверка „tables-all“: всяка таблица от схемата присъства точно веднъж, без непознати."
    scope = "diagrams"

    def run(self, ctx):
        db = ctx.facts.get("database") or {}
        tables = set(db.get("tables") or {})
        for p in ctx.doc.paras:
            if "tables-all" not in _diag(ctx, p.key).checks:
                continue
            tokens = re.findall(r"(?<![\w.])([a-z][a-z0-9]*(?:_[a-z0-9]+)*)(?![\w])", _vis(ctx, p))
            found = [t for t in tokens if t in tables]
            missing = sorted(tables - set(found))
            if missing:
                yield Finding(self.id, "error", f"{p.key}: липсват {len(missing)} таблици: {', '.join(missing)}.",
                              para=p.key, evidence=[db.get("schema_dir", "src/server/db/schemas")], lead=True)
            dup = sorted({t for t in found if found.count(t) > 1})
            if dup:
                yield Finding(self.id, "warning", f"{p.key}: таблици повече от веднъж: {', '.join(dup)}.", para=p.key,
                              evidence=["диаграмата"])
            unknown = sorted({t for t in tokens if "_" in t and t not in tables})
            if unknown:
                yield Finding(self.id, "warning", f"{p.key}: „{', '.join(unknown)}“ не са таблици в схемата.", para=p.key,
                              evidence=[db.get("schema_dir", "src/server/db/schemas")], lead=True)


@register
class Routes(Check):
    id = "dgm.routes"
    title = "Маршрути спрямо приложението"
    description = "За диаграма с проверка „routes“: всеки път (/dashboard, /api/…) съществува в src/app; всяка страница е показана."
    scope = "diagrams"

    def run(self, ctx):
        r = ctx.facts.get("routes") or {}
        known = set(r.get("pages") or {}) | set(r.get("api") or {})
        for p in ctx.doc.paras:
            if "routes" not in _diag(ctx, p.key).checks:
                continue
            paths = set(re.findall(r"(?<![\w.])(/[A-Za-z0-9_\-\[\]./*]*)", _vis(ctx, p)))
            for path in sorted(paths):
                path = path.rstrip(".")
                if path in known or (path.endswith("/*") and any(k.startswith(path[:-1]) for k in known)):
                    continue
                yield Finding(self.id, "error", f"{p.key}: път „{path}“ няма в приложението.", para=p.key, excerpt=path,
                              evidence=["src/app/**/page.tsx, route.ts"], lead=True)
            for page in sorted(set(r.get("pages") or {}) - paths):
                yield Finding(self.id, "warning", f"{p.key}: страницата „{page}“ не е показана.", para=p.key,
                              evidence=[(r.get("pages") or {}).get(page, "src/app")], lead=True)


@register
class Identifiers(Check):
    id = "dgm.identifiers"
    title = "Идентификатори от кода"
    description = "Имена на функции, колони и файлове в диаграмата (snake_case, camelCase, *.ts) съществуват в кода."
    scope = "diagrams"

    def run(self, ctx):
        index = ctx.shared("source_index", lambda: _source_index(ctx.repo))
        names = ctx.shared("file_names", lambda: _file_names(ctx.repo))
        ignore = set(ctx.options.get("ignore") or [])
        for p in ctx.doc.paras:
            vis = _vis(ctx, p)
            seen = set()
            for rx in (r"(?<![\w.])([a-z][a-z0-9]*(?:_[a-z0-9]+)+)(?![\w])", r"(?<![\w.])([a-z][a-z0-9]+(?:[A-Z][a-z0-9]*)+)(?![\w(])",
                       r"(?<![\w./])([a-z][\w-]*\.(?:ts|tsx|js))(?![\w])"):
                for m in re.finditer(rx, vis):
                    tok = m.group(1)
                    if tok in seen or tok in ignore or tok in index or tok in names:
                        continue
                    seen.add(tok)
                    yield Finding(self.id, "warning", f"{p.key}: „{tok}“ не се среща в кода.", para=p.key, excerpt=tok,
                                  evidence=["src/, ws-server/, scripts/"], lead=True)

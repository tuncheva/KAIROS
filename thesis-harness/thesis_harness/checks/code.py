"""Checks that compare statements in the document with facts from the code."""

from __future__ import annotations

import re
from pathlib import Path

from . import Check, Finding, register

# ------------------------------------------------------------------ versions

_VERSION_TAIL = r"(?P<sep>\s*(?:v\.?\s*|версия\s+|ver\.\s*)?)(?P<ver>\d+(?:\.\d+){0,2})(?P<plus>\+?)(?![\d.]*\d)"


def _major(v: str | None) -> int | None:
    if not v:
        return None
    m = re.search(r"\d+", v)
    return int(m.group(0)) if m else None


def _dep(facts: dict, name: str) -> dict | None:
    pkg = facts.get("package") or {}
    for section in ("dependencies", "devDependencies", "optionalDependencies"):
        if name in (pkg.get(section) or {}):
            return pkg[section][name]
    return None


@register
class StackVersions(Check):
    id = "code.stack-versions"
    title = "Версии на технологиите"
    description = (
        "Технология, спомената с версия („Next.js 15“), се сравнява с package.json/pnpm-lock;"
        " спомената технология, която вече не е зависимост, се отбелязва."
    )

    def run(self, ctx):
        techs = ctx.options.get("technologies") or []
        for tech in techs:
            name = tech["name"]
            match = tech.get("match") or re.escape(name)
            pattern = re.compile(r"(?<![\w.])(?P<name>" + match + r")" + _VERSION_TAIL, re.IGNORECASE)
            mention = re.compile(r"(?<![\w.])(?:" + match + r")(?![\w])", re.IGNORECASE)
            package = tech.get("package")
            dep = _dep(ctx.facts, package) if package else None
            present = dep is not None
            if not package and tech.get("present_if_file"):
                present = (ctx.repo / tech["present_if_file"]).exists()
            evidence_src = (dep or {}).get("source") or tech.get("present_if_file") or "package.json"

            mentioned_in = []
            for p in ctx.prose:
                if mention.search(p.text):
                    mentioned_in.append(p)
                if not dep:
                    continue
                for m in pattern.finditer(p.text):
                    stated = _major(m.group("ver"))
                    actual_full = dep.get("resolved") or dep.get("declared")
                    actual = _major(actual_full)
                    if stated is None or actual is None or stated == actual:
                        continue
                    if m.group("plus") and actual >= stated:
                        continue  # "Node 20+" style lower bounds are fine when satisfied
                    old = m.group(0)
                    new_ver = str(actual) if "." not in m.group("ver") else actual_full.split("-")[0]
                    new = old[: m.start("ver") - m.start()] + new_ver + m.group("plus")
                    yield Finding(
                        self.id, "error",
                        f"{name}: в текста е версия {m.group('ver')}, в проекта е {actual_full}.",
                        para=p.key, excerpt=old,
                        evidence=[f"{evidence_src} — {package}: {dep.get('declared')} (инсталирана {dep.get('resolved')})"],
                        fix={"kind": "replace", "old": old, "new": new},
                    )
            if mentioned_in and (package or tech.get("present_if_file")) and not present:
                first = mentioned_in[0]
                yield Finding(
                    self.id, "warning",
                    f"„{name}“ се споменава ({len(mentioned_in)} абзаца), но "
                    + (f"пакетът {package} не е в package.json." if package else f"файлът {tech['present_if_file']} липсва."),
                    para=first.key, excerpt=name,
                    evidence=["package.json (няма такава зависимост)" if package else tech["present_if_file"]],
                    lead=True,
                )


# ------------------------------------------------------------------ agents

_BG_NUM = {
    "един": 1, "една": 1, "едно": 1, "два": 2, "две": 2, "двама": 2, "три": 3, "трима": 3,
    "четири": 4, "четирима": 4, "пет": 5, "петима": 5, "шест": 6, "шестима": 6,
    "седем": 7, "осем": 8, "девет": 9, "десет": 10, "единадесет": 11, "дванадесет": 12,
}
_COUNT_NEAR_AGENT = re.compile(
    r"(?<!\w)(?P<num>\d+|" + "|".join(sorted(_BG_NUM, key=len, reverse=True)) + r")"
    r"(?P<mid>(?:\s+[\w-]+){0,2}?)\s+(?P<noun>агент(?:а|и|ът)?|ИИ\s+агент(?:а|и)?)(?!\w)",
    re.IGNORECASE,
)
_AGENT_CODE = re.compile(r"(?<![\w-])[AА](\d{1,2})(?![\w])")  # Latin A or Cyrillic А


@register
class Agents(Check):
    id = "code.agents"
    title = "Агенти: брой и кодове"
    description = "Броят на агентите в текста и кодовете A1…An спрямо src/server/llm/agents/registry.ts."

    def run(self, ctx):
        agents = ctx.facts.get("agents")
        if not agents:
            return
        conv, sched = agents["conversational_count"], agents["scheduled_count"]
        writing = agents["conversational_writing_count"]
        plausible = {conv, sched, writing, conv + sched}
        summary = (
            f"В кода: {conv} разговорни (от тях {writing} пишещи), {sched} планирани"
            f" ({', '.join(a['id'] for a in agents['items'] if a['kind'] == 'scheduled')})"
            + (", плюс потребителски графици" if agents.get("custom_schedules") else "")
        )
        src = agents.get("source", "registry.ts")
        for p in ctx.prose:
            for m in _COUNT_NEAR_AGENT.finditer(p.text):
                raw = m.group("num").lower()
                n = int(raw) if raw.isdigit() else _BG_NUM.get(raw)
                if n is None or n in plausible:
                    continue
                yield Finding(
                    self.id, "warning",
                    f"Текстът казва „{m.group(0)}“ ({n}), а това не съвпада с нито един брой агенти в кода. {summary}.",
                    para=p.key, excerpt=m.group(0), evidence=[src], lead=True,
                )
        codes = agents.get("codes") or {}
        mentioned: dict[str, object] = {}
        for p in ctx.prose:
            for m in _AGENT_CODE.finditer(p.text):
                code = f"A{int(m.group(1))}"
                mentioned.setdefault(code, p)
                if code not in codes:
                    yield Finding(
                        self.id, "error", f"{m.group(0)} се споменава, но в кода няма такъв агент ({', '.join(codes)}).",
                        para=p.key, excerpt=m.group(0), evidence=["src/server/llm/orchestrator/"],
                    )
                elif m.group(0)[0] == "А":
                    yield Finding(
                        self.id, "warning", f"„{m.group(0)}“ е изписано с кирилско „А“.",
                        para=p.key, excerpt=m.group(0), evidence=[codes[code]],
                        fix={"kind": "replace", "old": m.group(0), "new": "A" + m.group(0)[1:]}
                        if p.text.count(m.group(0)) == 1 else None,
                    )
        if mentioned:
            for code, file in codes.items():
                if code not in mentioned:
                    yield Finding(
                        self.id, "warning",
                        f"Агент {code} съществува в кода ({file}), но не се споменава в документа.",
                        evidence=[file], lead=True,
                    )


# ------------------------------------------------------------------ identifiers

_SOURCE_DIRS = ("src", "ws-server", "scripts", "tests")
_SOURCE_EXT = {".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".sql", ".css", ".yml", ".yaml", ".md"}
_PATH_RE = re.compile(r"(?<![\w/.])((?:src|tests|scripts|ws-server|docs|public|\.github)/[\w.\-/\[\]()@]+)")
_FILE_RE = re.compile(r"(?<![\w/.-])([a-z][\w-]*(?:\.[\w-]+)*\.(?:ts|tsx|mjs|json|ya?ml|sql|js))(?![\w])")
_ENV_RE = re.compile(r"(?<![\w])([A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+)(?![\w])")
_PNPM_RE = re.compile(r"(?<![\w])pnpm\s+(?:run\s+)?([a-z][\w:.-]*)")
_SNAKE_RE = re.compile(r"(?<![\w.])([a-z][a-z0-9]*(?:_[a-z0-9]+)+)(?![\w])")
_CAMEL_RE = re.compile(r"(?<![\w.])([a-z][a-z0-9]+(?:[A-Z][a-z0-9]*)+)(?![\w])")
_PNPM_BUILTINS = {"install", "i", "add", "remove", "exec", "dlx", "run", "update", "why", "list", "store", "create", "init"}


def _source_index(repo: Path) -> str:
    chunks = []
    for d in _SOURCE_DIRS:
        base = repo / d
        if not base.exists():
            continue
        for f in base.rglob("*"):
            if f.is_file() and f.suffix in _SOURCE_EXT and "node_modules" not in f.parts:
                try:
                    chunks.append(f.read_text(encoding="utf-8", errors="ignore"))
                except OSError:
                    pass
    for f in repo.iterdir():
        if f.is_file() and (f.suffix in _SOURCE_EXT or f.name.startswith(".env")) and f.name != "pnpm-lock.yaml":
            chunks.append(f.read_text(encoding="utf-8", errors="ignore"))
    return "\n".join(chunks)


def _file_names(repo: Path) -> set[str]:
    names = set()
    for f in repo.rglob("*"):
        if {"node_modules", ".git", ".next", "thesis-harness"} & set(f.parts):
            continue
        names.add(f.name)
    return names


@register
class Identifiers(Check):
    id = "code.identifiers"
    title = "Пътища, файлове и идентификатори"
    description = (
        "Пътища (src/…), имена на файлове, env променливи, pnpm скриптове и"
        " идентификатори от кода (snake_case, camelCase), споменати в текста, още съществуват."
    )

    def run(self, ctx):
        repo = ctx.repo
        ignore = set(ctx.options.get("ignore") or [])
        index = ctx.shared("source_index", lambda: _source_index(repo))
        names = ctx.shared("file_names", lambda: _file_names(repo))
        scripts = set(((ctx.facts.get("package") or {}).get("scripts") or {}).keys())
        reported: set[tuple[str, str]] = set()

        def once(kind: str, token: str) -> bool:
            if token in ignore or (kind, token) in reported:
                return False
            reported.add((kind, token))
            return True

        for p in ctx.prose:
            t = p.text
            for m in _PATH_RE.finditer(t):
                path = m.group(1).rstrip(".,;:)»“”\"'")
                if "*" in path or (repo / path).exists() or not once("path", path):
                    continue
                yield Finding(self.id, "error", f"Пътят {path} не съществува в репото.",
                              para=p.key, excerpt=path, evidence=["няма такъв файл/папка"], lead=True)
            for m in _FILE_RE.finditer(t):
                name = m.group(1)
                if "/" in name or name in names or not once("file", name):
                    continue
                yield Finding(self.id, "warning", f"Файл „{name}“ не е намерен никъде в репото.",
                              para=p.key, excerpt=name, evidence=["търсене по име във всички файлове"], lead=True)
            for m in _ENV_RE.finditer(t):
                var = m.group(1)
                if var in index or not once("env", var):
                    continue
                yield Finding(self.id, "warning", f"„{var}“ изглежда като env променлива/константа, но не се среща в кода.",
                              para=p.key, excerpt=var, evidence=["src/env.js, .env.example, src/**"], lead=True)
            for m in _PNPM_RE.finditer(t):
                s = m.group(1)
                if s in scripts or s in _PNPM_BUILTINS or not once("pnpm", s):
                    continue
                yield Finding(self.id, "error", f"„pnpm {s}“ – няма такъв скрипт в package.json.",
                              para=p.key, excerpt=m.group(0), evidence=["package.json → scripts"], lead=True)
            for rx, label in ((_SNAKE_RE, "snake_case"), (_CAMEL_RE, "camelCase")):
                for m in rx.finditer(t):
                    ident = m.group(1)
                    if ident in index or not once(label, ident):
                        continue
                    yield Finding(self.id, "warning", f"Идентификаторът „{ident}“ ({label}) не се среща в кода.",
                                  para=p.key, excerpt=ident, evidence=["src/, ws-server/, scripts/, tests/"], lead=True)

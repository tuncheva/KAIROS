"""Built-in collectors for the KAIROS codebase.

Each parser targets one well-known file. When a file moves or its shape
changes, the collector raises and the error shows up in ``facts.json._errors``
— update the parser here rather than letting a check run on empty facts.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import yaml

from . import collector, find_line, rel, src


@collector("package")
def package(repo: Path, _opts: dict) -> dict:
    path = repo / "package.json"
    text = path.read_text(encoding="utf-8")
    pkg = json.loads(text)

    resolved: dict[str, str] = {}
    lock = repo / "pnpm-lock.yaml"
    if lock.exists():
        data = yaml.safe_load(lock.read_text(encoding="utf-8")) or {}
        root = (data.get("importers") or {}).get(".") or {}
        for section in ("dependencies", "devDependencies", "optionalDependencies"):
            for name, info in (root.get(section) or {}).items():
                version = str((info or {}).get("version", ""))
                resolved[name] = version.split("(", 1)[0]

    def deps(section: str) -> dict:
        out = {}
        for name, spec in (pkg.get(section) or {}).items():
            m = re.search(r'^\s*"' + re.escape(name) + r'"\s*:', text, re.MULTILINE)
            out[name] = {
                "declared": spec,
                "resolved": resolved.get(name),
                "source": src(repo, path, text, m.start()) if m else "package.json",
            }
        return out

    scripts = {}
    for name, cmd in (pkg.get("scripts") or {}).items():
        m = re.search(r'^\s*"' + re.escape(name) + r'"\s*:', text, re.MULTILINE)
        scripts[name] = {"cmd": cmd, "source": src(repo, path, text, m.start()) if m else "package.json"}

    return {
        "name": pkg.get("name"),
        "version": pkg.get("version"),
        "packageManager": pkg.get("packageManager"),
        "engines": pkg.get("engines"),
        "dependencies": deps("dependencies"),
        "devDependencies": deps("devDependencies"),
        "optionalDependencies": deps("optionalDependencies"),
        "scripts": scripts,
        "lockfile": "pnpm-lock.yaml" if lock.exists() else None,
    }


_AGENT_BLOCK = re.compile(r"\{\s*id:\s*\"(?P<id>\w+)\"(?P<body>.*?)\n  \}", re.DOTALL)


@collector("agents")
def agents(repo: Path, _opts: dict) -> dict:
    path = repo / "src/server/llm/agents/registry.ts"
    text = path.read_text(encoding="utf-8")
    start = text.index("export const AGENTS")
    items = []
    for m in _AGENT_BLOCK.finditer(text, start):
        body = m.group("body")
        kind = re.search(r'kind:\s*"(\w+)"', body)
        writes = re.search(r"writes:\s*(true|false)", body)
        role = re.search(r'role:\s*("([^"]*)"|[\w.]+)', body)
        ops = re.search(r"operations:\s*\[(.*?)\]", body, re.DOTALL)
        items.append({
            "id": m.group("id"),
            "role": (role.group(2) if role and role.group(2) is not None else (role.group(1) if role else None)),
            "kind": kind.group(1) if kind else None,
            "writes": writes.group(1) == "true" if writes else None,
            "operations": re.findall(r'"([^"]+)"', ops.group(1)) if ops else [],
            "source": src(repo, path, text, m.start()),
        })
    if not items:
        raise ValueError("не открих агенти в AGENTS – парсерът трябва да се обнови")

    # Persona names: the untranslated defaults and the Bulgarian spelling.
    names_path = repo / "src/lib/agentNames.ts"
    names_text = names_path.read_text(encoding="utf-8")
    block = names_text[names_text.index("DEFAULT_AGENT_NAMES"):]
    defaults = dict(re.findall(r"^\s+(\w+):\s*\"([^\"]+)\"", block.split("};", 1)[0], re.MULTILINE))
    bg_names = {}
    bg_path = repo / "src/i18n/messages/bg.json"
    if bg_path.exists():
        bg = json.loads(bg_path.read_text(encoding="utf-8"))
        bg_names = ((bg.get("agents") or {}).get("names")) or {}
    for a in items:
        a["persona"] = defaults.get(a["id"])
        a["persona_bg"] = bg_names.get(a["id"]) if isinstance(bg_names, dict) else None

    # Orchestrator files carry the A<n> codes used in prose ("A1", "A5").
    codes = {}
    orch = repo / "src/server/llm/orchestrator"
    for f in sorted(orch.glob("a[0-9]*.ts")):
        m = re.match(r"a(\d+)", f.stem)
        codes[f"A{m.group(1)}"] = rel(repo, f)

    conversational = [a for a in items if a["kind"] == "conversational"]
    scheduled = [a for a in items if a["kind"] == "scheduled"]
    custom = repo / "src/server/llm/scheduled/customSchedules.ts"
    return {
        "items": items,
        "conversational_count": len(conversational),
        "conversational_writing_count": sum(1 for a in conversational if a["writes"]),
        "scheduled_count": len(scheduled),
        "codes": codes,
        "custom_schedules": rel(repo, custom) if custom.exists() else None,
        "source": rel(repo, path),
    }


@collector("locales")
def locales(repo: Path, _opts: dict) -> dict:
    path = repo / "src/i18n/locales.ts"
    text = path.read_text(encoding="utf-8")

    def arr(name: str):
        m = re.search(r"export const " + name + r"\s*=\s*\[(.*?)\]", text, re.DOTALL)
        return (re.findall(r"'([\w-]+)'|\"([\w-]+)\"", m.group(1)), src(repo, path, text, m.start())) if m else ([], None)

    offered, s1 = arr("locales")
    incomplete, s2 = arr("INCOMPLETE_LOCALES")
    flat = lambda xs: [a or b for a, b in xs]  # noqa: E731
    msgs = repo / "src/i18n/messages"
    return {
        "offered": flat(offered), "offered_source": s1,
        "incomplete": flat(incomplete), "incomplete_source": s2,
        "message_files": sorted(p.stem for p in msgs.glob("*.json")) if msgs.exists() else [],
    }


@collector("env")
def env(repo: Path, _opts: dict) -> dict:
    path = repo / "src/env.js"
    text = path.read_text(encoding="utf-8")
    sections = {}
    for section in ("server", "client"):
        m = re.search(r"^  " + section + r":\s*\{", text, re.MULTILINE)
        if not m:
            continue
        end = re.search(r"^  \},", text[m.end():], re.MULTILINE)
        chunk = text[m.end(): m.end() + (end.start() if end else len(text))]
        sections[section] = {
            k.group(1): src(repo, path, text, m.end() + k.start(1))
            for k in re.finditer(r"^\s+([A-Z][A-Z0-9_]+):", chunk, re.MULTILINE)
        }
    example = repo / ".env.example"
    example_keys = {}
    if example.exists():
        et = example.read_text(encoding="utf-8")
        example_keys = {m.group(1): src(repo, example, et, m.start()) for m in re.finditer(r"^#?\s*([A-Z][A-Z0-9_]+)=", et, re.MULTILINE)}
    return {"schema": sections, "example": example_keys}


@collector("database")
def database(repo: Path, _opts: dict) -> dict:
    schemas = repo / "src/server/db/schemas"
    tables = {}
    for f in sorted(schemas.glob("*.ts")):
        t = f.read_text(encoding="utf-8")
        for m in re.finditer(r"createTable\(\s*\"([a-z0-9_]+)\"", t):
            tables[m.group(1)] = src(repo, f, t, m.start())
    enums_path = schemas / "enums.ts"
    prefix = None
    if enums_path.exists():
        et = enums_path.read_text(encoding="utf-8")
        m = re.search(r"pgTableCreator\(\s*\(\s*name\s*\)\s*=>\s*`([^`$]*)\$\{name\}`", et)
        prefix = m.group(1) if m else None
    migrations = sorted((repo / "src/server/db/migrations").glob("*.sql"))
    return {
        "tables": tables,
        "table_count": len(tables),
        "table_prefix": prefix,
        "migration_count": len(migrations),
        "last_migration": migrations[-1].name if migrations else None,
        "orm": "drizzle-orm",
        "schema_dir": rel(repo, schemas),
    }


@collector("api")
def api(repo: Path, _opts: dict) -> dict:
    path = repo / "src/server/api/root.ts"
    text = path.read_text(encoding="utf-8")
    m = re.search(r"createTRPCRouter\(\{(.*?)\}\)", text, re.DOTALL)
    routers = {}
    if m:
        for r in re.finditer(r"(\w+):\s*(\w+Router)", m.group(1)):
            routers[r.group(1)] = src(repo, path, text, m.start(1) + r.start())
    return {"trpc_routers": routers, "router_count": len(routers), "source": rel(repo, path)}


@collector("tests")
def tests(repo: Path, _opts: dict) -> dict:
    root = repo / "tests"
    files = [p for p in root.rglob("*") if re.search(r"\.test\.(ts|tsx|js|mjs)$", p.name)] if root.exists() else []
    by_dir: dict[str, int] = {}
    for f in files:
        top = f.relative_to(root).parts[0] if len(f.relative_to(root).parts) > 1 else "."
        by_dir[top] = by_dir.get(top, 0) + 1
    configs = sorted(p.name for p in repo.glob("vitest*.config.ts"))
    ci = repo / ".github/workflows/ci.yml"
    return {
        "test_file_count": len(files),
        "by_directory": dict(sorted(by_dir.items())),
        "live_test_files": sorted(rel(repo, f) for f in files if ".live." in f.name),
        "vitest_configs": configs,
        "ci_workflow": rel(repo, ci) if ci.exists() else None,
        "note": "Брой тестови ФАЙЛОВЕ, не брой тестове. За реален брой добавете команден факт в harness.yaml.",
    }


@collector("llm")
def llm(repo: Path, _opts: dict) -> dict:
    path = repo / "src/server/llm/core/providers.ts"
    out: dict = {"providers_source": rel(repo, path) if path.exists() else None}
    if path.exists():
        text = path.read_text(encoding="utf-8")
        presets = re.findall(r"^\s{2}(\w+):\s*\{", text, re.MULTILINE)
        out["provider_presets"] = presets
        out["preset_source"] = find_line(repo, path, r"^\s{2}\w+:\s*\{")
    scheduled_dir = repo / "src/server/llm/scheduled"
    out["scheduled_modules"] = sorted(p.stem for p in scheduled_dir.glob("*.ts")) if scheduled_dir.exists() else []
    return out


@collector("repo")
def repo_info(repo: Path, _opts: dict) -> dict:
    from ..workspace import git_head

    top = sorted(p.name for p in repo.iterdir() if not p.name.startswith(".") and p.name != "node_modules")
    return {"git": git_head(repo), "top_level": top}

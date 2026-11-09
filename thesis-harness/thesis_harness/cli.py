"""Command line: ``python thesis-harness/run.py <command> ...``"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import yaml

from . import proposals as props
from .apply import apply as apply_doc
from .checks import Context, load_checks, run_check
from .config import Config, load_config
from .docmodel import DocModel, extract
from .facts import collect_all
from .requirements import import_source, load_rules, record_results, validate_rules
from .workspace import (
    Workspace, create_or_open_for_source, git_head, now_iso, open_workspace, read_json, read_yaml,
    sha256_file, slugify, write_json,
)


def _out(msg: str = "") -> None:
    print(msg)


# ------------------------------------------------------------------- rendering


def _render_doc_md(doc: DocModel, title: str) -> str:
    lines = [f"# {title}", "", "Формат: [¶индекс|ключ] текст. Ключът се ползва в предложенията (para).", ""]
    for p in doc.paras:
        if p.kind in ("toc", "empty"):
            continue
        tag = f"[¶{p.index}|{p.key}]"
        if p.kind == "heading":
            lines += ["", f"{'#' * min(p.level + 1, 6)} {tag} {p.text.strip() or '(ПРАЗНО ЗАГЛАВИЕ)'}", ""]
        else:
            prefix = "(таблица) " if p.kind == "table" else "(надпис) " if p.kind == "caption" else ""
            lines.append(f"{tag} {prefix}{p.text}")
    return "\n".join(lines).strip() + "\n"


def _chunks(doc: DocModel, max_chars: int) -> list[tuple[str, list]]:
    """Split at chapters; split a chapter longer than ``max_chars`` at its
    level-2 headings, packing whole sections greedily. A section is never cut."""
    size = lambda ps: sum(len(p.text) + 20 for p in ps)  # noqa: E731
    chapters: list[tuple[str, list]] = []
    for p in doc.paras:
        if p.kind in ("toc", "empty"):
            continue
        if (p.kind == "heading" and p.level == 1) or not chapters:
            chapters.append((p.text.strip() if p.kind == "heading" else "Начало", []))
        chapters[-1][1].append(p)
    # A short front matter (title page) rides along with the first chapter.
    if len(chapters) > 1 and chapters[0][0] == "Начало" and size(chapters[0][1]) < 3000:
        chapters[1] = (chapters[1][0], chapters[0][1] + chapters[1][1])
        chapters.pop(0)
    out: list[tuple[str, list]] = []
    for title, paras in chapters:
        if size(paras) <= max_chars:
            out.append((title, paras))
            continue
        sections: list[list] = [[]]
        for p in paras:
            if p.kind == "heading" and p.level == 2 and sections[-1]:
                sections.append([])
            sections[-1].append(p)
        groups: list[list] = [[]]
        for sec in sections:
            if groups[-1] and size(groups[-1]) + size(sec) > max_chars:
                groups.append([])
            groups[-1].extend(sec)
        groups = [g for g in groups if g]
        for i, g in enumerate(groups, 1):
            first_sub = next((p.text.strip() for p in g if p.kind == "heading" and p.level == 2), "")
            out.append((f"{title} ({i}/{len(groups)}{': ' + first_sub if first_sub else ''})", g))
    return out


def _write_doc_views(ws: Workspace, doc: DocModel, title: str) -> int:
    ws.p("doc.md").write_text(_render_doc_md(doc, title), encoding="utf-8")
    chunk_dir = ws.p("chunks")
    chunk_dir.mkdir(exist_ok=True)
    for old in chunk_dir.glob("*.md"):
        old.unlink()
    chunks = _chunks(doc, int(ws.config.data["chunking"]["max_chars"]))
    index = []
    for i, (name, paras) in enumerate(chunks, 1):
        fname = f"{i:02d}-{slugify(name)[:50]}.md"
        sub = DocModel(paras=paras)
        (chunk_dir / fname).write_text(_render_doc_md(sub, name), encoding="utf-8")
        index.append({"file": f"chunks/{fname}", "title": name, "keys": [p.key for p in paras]})
    write_json(ws.p("chunks.json"), index)
    return len(chunks)


# ------------------------------------------------------------------- commands


def cmd_ingest(cfg: Config, args) -> Workspace:
    source = Path(args.file).expanduser().resolve()
    if not source.exists() or source.suffix.lower() != ".docx":
        raise SystemExit(f"Очаквам съществуващ .docx файл: {source}")
    if args.doc:
        ws_root = cfg.workspace_root / slugify(args.doc)
        ws_root.mkdir(parents=True, exist_ok=True)
        (cfg.workspace_root / "current").write_text(slugify(args.doc), encoding="utf-8")
        ws = Workspace(root=ws_root, config=cfg)
    else:
        ws = create_or_open_for_source(cfg, source)
    state = ws.state()
    old_doc = ws.doc() if ws.p("doc.json").exists() else None
    doc = extract(source)
    write_json(ws.p("doc.json"), {"paras": [p.to_dict() for p in doc.paras], "warnings": doc.warnings})
    version = int(state.get("version", 0)) + (0 if state.get("source_sha256") == sha256_file(source) else 1)
    state.update({
        "source_path": str(source), "source_name": source.name, "source_sha256": sha256_file(source),
        "ingested_at": now_iso(), "version": version, "repo": git_head(cfg.repo_root),
    })
    ws.save_state(state)
    n_chunks = _write_doc_views(ws, doc, f"{source.name} (версия {version})")
    counts = props.reanchor(ws, old_doc, doc) if props.load(ws) else None

    kinds = {}
    for p in doc.paras:
        kinds[p.kind] = kinds.get(p.kind, 0) + 1
    _out(f"Документ: {source.name} → работна папка {ws.root}")
    _out(f"  абзаци: {len(doc.paras)} ({', '.join(f'{k} {v}' for k, v in sorted(kinds.items()))}); части за преглед: {n_chunks}")
    for w in doc.warnings:
        _out(f"  ⚠ {w}")
    if counts:
        _out(f"  предложения от предишна версия: влезли {counts['merged']}, пренесени {counts['kept']},"
             f" преадресирани {counts['rekeyed']}, остарели {counts['stale']}")
    return ws


def cmd_facts(cfg: Config, ws: Workspace) -> dict:
    facts = collect_all(cfg.repo_root, cfg.data)
    facts["_collected_at"] = now_iso()
    facts["_repo"] = git_head(cfg.repo_root)
    write_json(ws.p("facts.json"), facts)
    a = facts.get("agents") or {}
    _out(f"Факти от кода ({cfg.repo_root}, commit {facts['_repo'].get('commit')}): "
         f"{a.get('conversational_count', '?')} разговорни + {a.get('scheduled_count', '?')} планирани агента, "
         f"{(facts.get('database') or {}).get('table_count', '?')} таблици, "
         f"{(facts.get('api') or {}).get('router_count', '?')} tRPC рутера")
    for e in facts["_errors"]:
        _out(f"  ⚠ събирачът се провали: {e}")
    if facts["_repo"].get("dirty"):
        _out("  ⚠ работното копие има некомитнати промени – фактите отразяват тях")
    return facts


def _requirement_runs(cfg: Config, registry: dict) -> tuple[list[tuple[dict, type]], list[str]]:
    req_dir = cfg.requirements_dir
    data = load_rules(req_dir)
    rules = data.get("rules") or []
    if not rules:
        return [], []
    errs = validate_rules(req_dir, {k for k, v in registry.items() if v.requirement})
    if errs:
        return [], errs
    runs = [(r, registry[r["check"]]) for r in rules if r.get("check") != "semantic"]
    return runs, []


def cmd_check(cfg: Config, ws: Workspace, args) -> list:
    plugin_dirs = [cfg.path(d) for d in cfg.data["checks"].get("plugin_dirs") or []]
    registry = load_checks(plugin_dirs)
    if args.list:
        for cid, cls in sorted(registry.items()):
            flag = "изискване" if cls.requirement else ("изключена" if cid in cfg.data["checks"]["disabled"] else "активна")
            _out(f"{cid:28} [{flag}] {cls.title} – {cls.description}")
        return []
    doc, facts = ws.doc(), ws.facts()
    source = Path(ws.state()["source_path"])
    only = set(args.only.split(",")) if args.only else None
    findings, errors = [], []
    for cid, cls in registry.items():
        if cls.requirement or cid in cfg.data["checks"]["disabled"] or (only and cid not in only):
            continue
        ctx = Context(doc=doc, facts=facts, repo=cfg.repo_root, options=cfg.check_options(cid), source_path=source)
        res, err = run_check(cls(), ctx)
        findings += res
        if err:
            errors.append(err)
    runs, req_errs = _requirement_runs(cfg, registry)
    for rule, cls in runs:
        if only and cls.id not in only and rule["id"] not in only:
            continue
        ctx = Context(doc=doc, facts=facts, repo=cfg.repo_root, options=dict(rule.get("params") or {}), source_path=source)
        res, err = run_check(cls(), ctx)
        for f in res:
            f.rule = rule["id"]
            if rule.get("severity") in ("error", "warning", "info"):
                f.severity = rule["severity"]
            f.evidence = [f"изискване {rule['id']}, стр. {rule.get('page', '?')}: „{rule['quote']}“"] + f.evidence
        findings += res
        if err:
            errors.append(f"{rule['id']}: {err}")

    write_json(ws.p("findings.json"), {"at": now_iso(), "findings": [f.to_dict() for f in findings], "errors": errors})

    incoming = []
    by_key = doc.by_key()
    for f in findings:
        if f.lead and not f.fix:
            continue
        para = by_key.get(f.para) if f.para else None
        base = {
            "source": f"requirement:{f.rule}" if f.rule else f"check:{f.check}",
            "severity": f.severity, "para": f.para, "rationale": f.message, "evidence": f.evidence or [f.check],
            "section": para.section if para else None,
        }
        if f.fix:
            incoming.append({**base, **f.fix})
        else:
            incoming.append({**base, "kind": "note"})
    added, invalid, dupes = props.add(ws, incoming, doc) if not args.no_propose else ([], [], 0)

    leads = sum(1 for f in findings if f.lead and not f.fix)
    sev = {s: sum(1 for f in findings if f.severity == s) for s in ("error", "warning", "info")}
    _out(f"Проверки: {len(findings)} находки (грешки {sev['error']}, внимание {sev['warning']}, инфо {sev['info']});"
         f" нови предложения {len(added)}, вече известни {dupes}, насоки за смислов преглед {leads}")
    for e in errors + [f"изисквания: {e}" for e in req_errs]:
        _out(f"  ⚠ {e}")
    for raw, errs in invalid:
        _out(f"  ⚠ находка не стана предложение ({raw.get('source')}): {'; '.join(errs)}")
    return findings


def _frontmatter(path: Path) -> tuple[dict, str]:
    text = path.read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.DOTALL)
    return (yaml.safe_load(m.group(1)) or {}, m.group(2)) if m else ({}, text)


def cmd_tasks(cfg: Config, ws: Workspace) -> list:
    chunks = read_json(ws.p("chunks.json"), [])
    findings = (read_json(ws.p("findings.json"), {}) or {}).get("findings", [])
    leads = [f for f in findings if f.get("lead") and not f.get("fix")]
    rules = load_rules(cfg.requirements_dir).get("rules") or []
    semantic = [r for r in rules if r.get("check") == "semantic"]
    semantic_rules = [r["id"] for r in semantic]

    def rules_for(title: str) -> list[str]:
        # applies_to: regex over the part's title; a rule without it goes to every part.
        return [r["id"] for r in semantic
                if not r.get("applies_to") or re.search(r["applies_to"], title, re.IGNORECASE)]
    tasks = []
    for pf in sorted(cfg.prompts_dir.glob("*.md")):
        meta, _ = _frontmatter(pf)
        if not meta or meta.get("enabled", True) is False:
            continue
        pid = meta.get("id", pf.stem)
        scope = meta.get("scope", "chunks")
        if scope == "requirements" and not semantic_rules:
            continue
        targets = chunks if scope in ("chunks", "requirements") else [{"file": "doc.md", "title": "целият документ", "keys": None}]
        skip = [re.compile(rx, re.IGNORECASE) for rx in meta.get("exclude_chunks") or []]
        targets = [t for t in targets if not any(rx.search(t["title"]) for rx in skip)]
        for i, ch in enumerate(targets, 1):
            part_rules = rules_for(ch["title"]) if scope == "requirements" else None
            if scope == "requirements" and not part_rules:
                continue
            keys = set(ch["keys"]) if ch.get("keys") else None
            ch_leads = [] if meta.get("leads") is False else [
                f for f in leads if keys is None or f.get("para") in keys or (f.get("para") is None and i == 1)]
            tasks.append({
                "id": f"{pid}--{i:02d}",
                "prompt": pid,
                "title": f"{meta.get('title', pid)} — {ch['title']}",
                "prompt_file": str(pf.resolve()),
                "chunk_file": str(ws.p(ch["file"])),
                "facts_file": str(ws.p("facts.json")),
                "output_file": str(ws.p(f"review/{pid}--{i:02d}.yaml")),
                "leads": ch_leads,
                "rules": part_rules,
                "rules_file": str(cfg.requirements_dir / "rules.yaml") if scope == "requirements" else None,
                "repo_root": str(cfg.repo_root),
            })
    write_json(ws.p("tasks.json"), tasks)
    _out(f"Задачи за смислов преглед: {len(tasks)} → {ws.p('tasks.json')}")
    for t in tasks:
        _out(f"  {t['id']:32} {t['title']}  (насоки: {len(t['leads'])})")
    return tasks


def cmd_propose(cfg: Config, ws: Workspace, args) -> None:
    doc = ws.doc()
    total_added, total_invalid = 0, 0
    for f in args.files:
        data = read_yaml(Path(f), None)
        if data is None:
            _out(f"{f}: празен или липсващ файл")
            continue
        items = (data.get("proposals") or []) if isinstance(data, dict) else data
        added, invalid, dupes = props.add(ws, items, doc)
        total_added += len(added)
        total_invalid += len(invalid)
        _out(f"{Path(f).name}: добавени {len(added)} ({', '.join(p['id'] for p in added) or '–'}), дубликати {dupes}, невалидни {len(invalid)}")
        for raw, errs in invalid:
            _out(f"  ✗ para={raw.get('para')} old={str(raw.get('old', ''))[:50]!r}: {'; '.join(errs)}")
        if isinstance(data, dict) and data.get("requirements"):
            errs = record_results(ws.p("requirements-results.yaml"), cfg.requirements_dir, data["requirements"], Path(f).stem)
            total_invalid += len(errs)
            for e in errs:
                _out(f"  ✗ изискване: {e}")
        if isinstance(data, dict) and data.get("unverified") is not None:
            store = read_json(ws.p("unverified.json"), {}) or {}
            store[Path(f).stem] = data["unverified"] or []
            write_json(ws.p("unverified.json"), store)
            if data["unverified"]:
                _out(f"  непроверени твърдения: {len(data['unverified'])}")
    if total_invalid:
        sys.exit(2)


def cmd_review(cfg: Config, ws: Workspace, args) -> None:
    results = read_yaml(ws.p("requirements-results.yaml"), None)
    text = props.render_review(ws, ws.doc(), results)
    if args.print:
        _out(text)
    else:
        items = props.load(ws)
        _out(f"Лист за преглед: {ws.p('review.md')}")
        for status in props.STATUSES:
            ids = [p["id"] for p in items if p["status"] == status]
            if ids:
                _out(f"  {props._STATUS_BG[status]:18} {len(ids):3}  {_compress(ids)}")  # noqa: SLF001


def _compress(ids: list[str]) -> str:
    nums = sorted(int(i[1:]) for i in ids)
    parts, start, prev = [], None, None
    for n in nums + [None]:
        if start is None:
            start = prev = n
        elif n is not None and n == prev + 1:
            prev = n
        else:
            parts.append(f"P{start}" if start == prev else f"P{start}-P{prev}")
            start = prev = n
    return ", ".join(parts)


def cmd_show(cfg: Config, ws: Workspace, args) -> None:
    items = props.load(ws)
    doc = ws.doc().by_key()
    for p in props.parse_ids(args.ids, items):
        para = doc.get(str(p.get("para")))
        _out(yaml.dump(p, allow_unicode=True, sort_keys=False, width=100).rstrip())
        if para:
            _out(f"текущ текст на абзаца ¶{para.index}:\n  {para.text}")
        _out("-" * 60)


def cmd_decide(cfg: Config, ws: Workspace, args, decision: str) -> None:
    try:
        changed = props.decide(ws, args.ids, decision, args.note, ws.doc())
    except props.ProposalError as e:
        raise SystemExit(str(e))
    _out(f"{ {'approve': 'Одобрени', 'reject': 'Отхвърлени', 'reopen': 'Върнати за преглед'}[decision] }: {_compress([p['id'] for p in changed]) or '–'}")
    props.render_review(ws, ws.doc(), read_yaml(ws.p("requirements-results.yaml"), None))


def cmd_edit(cfg: Config, ws: Workspace, args) -> None:
    changes = {k: getattr(args, k) for k in ("new", "old", "kind", "para", "rationale", "severity") if getattr(args, k) is not None}
    if args.new_file:
        changes["new"] = Path(args.new_file).read_text(encoding="utf-8").strip()
    if args.evidence:
        changes["evidence"] = args.evidence
    try:
        p = props.edit(ws, args.id, changes, args.note, ws.doc())
    except props.ProposalError as e:
        raise SystemExit(f"Промяната не е валидна: {e}")
    _out(f"{p['id']} обновено → статус „{props._STATUS_BG[p['status']]}“ (нужно е ново одобрение)")  # noqa: SLF001
    props.render_review(ws, ws.doc(), read_yaml(ws.p("requirements-results.yaml"), None))


def cmd_apply(cfg: Config, ws: Workspace, args) -> None:
    log = apply_doc(ws, Path(args.out) if args.out else None, dry_run=args.dry_run)
    if args.dry_run:
        _out(f"Проба (нищо не е записано): биха се приложили {len(log['applied'])}, неуспешни {len(log['failed'])}")
    else:
        _out(f"Записан: {log['output']}")
        _out(f"  приложени: {_compress(log['applied']) or '–'}")
    for f in log["failed"]:
        _out(f"  ✗ {f['id']}: {f['error']}")
    for m in log["manual"]:
        _out(f"  ✋ ръчно: {m['id']} – {m['rationale']}")
    for v in log["verification"]:
        _out(f"  ⚠ проверка след запис: {v}")
    if not args.dry_run:
        props.render_review(ws, ws.doc(), read_yaml(ws.p("requirements-results.yaml"), None))


def cmd_status(cfg: Config, ws: Workspace) -> None:
    st = ws.state()
    _out(f"Документ: {st.get('source_name')} (версия {st.get('version')}), {st.get('source_path')}")
    _out(f"Работна папка: {ws.root}")
    facts = read_json(ws.p("facts.json"))
    _out(f"Факти: {'от ' + facts['_collected_at'] + ', commit ' + str(facts['_repo'].get('commit')) if facts else 'няма'}"
         f"; текущ commit: {git_head(cfg.repo_root).get('commit')}")
    cmd_review(cfg, ws, argparse.Namespace(print=False))


def cmd_requirements(cfg: Config, args) -> None:
    req_dir = cfg.requirements_dir
    registry = load_checks([cfg.path(d) for d in cfg.data["checks"].get("plugin_dirs") or []])
    if args.req_cmd == "import":
        metas = import_source([Path(f).expanduser().resolve() for f in args.files], req_dir)
        for m in metas:
            _out(f"{m['id']}: {m['title'] or m['file']} – {m['pages']} стр.")
            if m["empty_pages"]:
                _out(f"  ⚠ страници без извлечен текст: {m['empty_pages']} – вероятно сканирани изображения;"
                     " препишете ги в source.txt или подайте текстова версия")
        _out(f"→ {req_dir / 'source.txt'}")
    elif args.req_cmd == "validate":
        errs = validate_rules(req_dir, {k for k, v in registry.items() if v.requirement})
        rules = load_rules(req_dir).get("rules") or []
        if errs:
            for e in errs:
                _out(f"✗ {e}")
            sys.exit(2)
        _out(f"✓ {len(rules)} правила, всяко с дословен цитат от източника")
    elif args.req_cmd == "record":
        ws = open_workspace(cfg, args.doc_slug)
        data = read_yaml(Path(args.file), []) or []
        errs = record_results(ws.p("requirements-results.yaml"), req_dir, data.get("requirements", data) if isinstance(data, dict) else data)
        for e in errs:
            _out(f"✗ {e}")
        if errs:
            sys.exit(2)
        _out("✓ записано")


def cmd_scan(cfg: Config, args) -> None:
    ws = cmd_ingest(cfg, args) if args.file else open_workspace(cfg, args.doc_slug)
    cmd_facts(cfg, ws)
    cmd_check(cfg, ws, argparse.Namespace(list=False, only=None, no_propose=False))
    cmd_tasks(cfg, ws)
    cmd_review(cfg, ws, argparse.Namespace(print=False))


# ------------------------------------------------------------------------ main


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="thesis-harness", description="Проверка на дипломната документация спрямо кода и изискванията.")
    ap.add_argument("--doc-slug", help="работна папка (по подразбиране: последно заредената)")
    ap.add_argument("--profile", help="набор изисквания: requirements/<профил> (по подразбиране: дипломната)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("ingest", help="зареди .docx (нова версия пренася старите предложения)")
    s.add_argument("file")
    s.add_argument("--doc", help="име на работната папка, ако новата версия е с друго име на файла")
    s = sub.add_parser("scan", help="ingest + facts + check + tasks + review наведнъж")
    s.add_argument("file", nargs="?")
    s.add_argument("--doc")
    sub.add_parser("facts", help="събери факти от кода")
    s = sub.add_parser("check", help="детерминистични проверки")
    s.add_argument("--only", help="само тези проверки/правила, разделени със запетая")
    s.add_argument("--list", action="store_true", help="покажи наличните проверки")
    s.add_argument("--no-propose", action="store_true", help="само находки, без предложения")
    sub.add_parser("tasks", help="задачи за смисловия преглед от Claude")
    s = sub.add_parser("propose", help="добави предложения от YAML файл(ове)")
    s.add_argument("files", nargs="+")
    s = sub.add_parser("review", help="генерирай review.md")
    s.add_argument("--print", action="store_true")
    s = sub.add_parser("show", help="покажи предложения")
    s.add_argument("ids", nargs="+")
    for name, help_ in (("approve", "одобри"), ("reject", "отхвърли"), ("reopen", "върни за преглед")):
        s = sub.add_parser(name, help=f"{help_} предложения (P3 P5-P9 all)")
        s.add_argument("ids", nargs="+")
        s.add_argument("--note", help="коментар")
    s = sub.add_parser("edit", help="промени предложение (връща го за одобрение)")
    s.add_argument("id")
    s.add_argument("--new")
    s.add_argument("--new-file", help="новият текст от файл (за дълги абзаци)")
    s.add_argument("--old")
    s.add_argument("--kind", choices=props.KINDS)
    s.add_argument("--para")
    s.add_argument("--rationale")
    s.add_argument("--severity", choices=props.SEVERITIES)
    s.add_argument("--evidence", nargs="+")
    s.add_argument("--note")
    s = sub.add_parser("apply", help="запиши одобрените промени в чисто копие")
    s.add_argument("--out")
    s.add_argument("--dry-run", action="store_true")
    sub.add_parser("status")
    s = sub.add_parser("requirements", help="официални изисквания")
    rs = s.add_subparsers(dest="req_cmd", required=True)
    r = rs.add_parser("import", help="всички официални документи наведнъж (заменя предишния импорт)")
    r.add_argument("files", nargs="+")
    rs.add_parser("validate")
    r = rs.add_parser("record")
    r.add_argument("file")
    return ap


def main(argv: list[str] | None = None) -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass
    args = build_parser().parse_args(argv)
    cfg = load_config()
    if args.profile:
        # A profile is a separate requirement set (its own source.txt and rules.yaml),
        # e.g. "defense" for the concept-defense materials.
        if not re.fullmatch(r"[\w-]+", args.profile):
            raise SystemExit("профилът е име на папка: букви, цифри, - и _")
        cfg.data["requirements"]["dir"] = str(cfg.requirements_dir / args.profile)
    if args.cmd == "ingest":
        cmd_ingest(cfg, args)
        return
    if args.cmd == "scan":
        cmd_scan(cfg, args)
        return
    if args.cmd == "requirements":
        cmd_requirements(cfg, args)
        return
    if args.cmd == "check" and args.list:
        cmd_check(cfg, None, args)
        return
    ws = open_workspace(cfg, args.doc_slug)
    {
        "facts": lambda: cmd_facts(cfg, ws),
        "check": lambda: cmd_check(cfg, ws, args),
        "tasks": lambda: cmd_tasks(cfg, ws),
        "propose": lambda: cmd_propose(cfg, ws, args),
        "review": lambda: cmd_review(cfg, ws, args),
        "show": lambda: cmd_show(cfg, ws, args),
        "approve": lambda: cmd_decide(cfg, ws, args, "approve"),
        "reject": lambda: cmd_decide(cfg, ws, args, "reject"),
        "reopen": lambda: cmd_decide(cfg, ws, args, "reopen"),
        "edit": lambda: cmd_edit(cfg, ws, args),
        "apply": lambda: cmd_apply(cfg, ws, args),
        "status": lambda: cmd_status(cfg, ws),
    }[args.cmd]()


if __name__ == "__main__":
    main()

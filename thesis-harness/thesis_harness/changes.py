"""What the code changed since the thesis was last synced — read from PR descriptions.

Every PR into ``development`` carries a ``## Documentation impact`` section (see
CLAUDE.md and ``.github/pull_request_template.md``)::

    ## Documentation impact
    - 2.8.10 — Scheduled agents can be paused per workspace until midnight.
    - 2.7, app-1 — New `agent_pause` table (workspace_id, until, created_by).

or ``- none — <why>``. The ids are the thesis sections in ``sections.yaml``.

This module

- parses and validates that section (``pr-check``, run on every PR in CI);
- collects every PR merged since ``sync.yaml`` plus the commits that reached
  ``development`` without a PR, and groups them by thesis section (the ledger,
  ``H changes``, and ``facts.json → changes``);
- maps changed files to sections, so a PR that touches ``src/server/llm/scheduled``
  without naming 2.8.10 is flagged, and PRs without a block still get a guess.

The PR text is a *hint*. The checks in ``checks/changes.py`` turn it into leads
for Claude's review, where every proposed sentence still needs ``file:line``
evidence from the code.

PR data comes from the GitHub REST API (stdlib only; ``GH_TOKEN``/``GITHUB_TOKEN``
optional for a public repo). ``THESIS_HARNESS_OFFLINE=1`` disables the network;
``THESIS_HARNESS_CHANGES=<file.json>`` supplies the PR list instead (tests,
offline runs).
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import yaml

DOC_HEADING = "Documentation impact"
NONE_ID = "none"
MIN_TEXT = 15
EXCERPT = 700

DEFAULTS = {
    "github": None,          # "owner/repo"; null = local git only
    "branch": "development",
    "sections": "sections.yaml",
    "sync": "sync.yaml",
    "ignore": [],  # globs: a change that touches only these never reaches the ledger
}


# ------------------------------------------------------------------ config


def settings(cfg) -> dict:
    data = {**DEFAULTS, **((cfg.data.get("changes") or {}))}
    data["sections_path"] = cfg.path(data["sections"])
    data["sync_path"] = cfg.path(data["sync"])
    return data


def load_sections(path: Path) -> list[dict]:
    data = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    out = []
    for s in data.get("sections") or []:
        s = dict(s)
        s["id"] = str(s["id"]).lower()
        out.append(s)
    return out


def load_sync(path: Path) -> dict:
    if not Path(path).exists():
        return {}
    return yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}


def save_sync(path: Path, data: dict) -> None:
    text = Path(path).read_text(encoding="utf-8") if Path(path).exists() else ""
    header = "".join(line for line in text.splitlines(keepends=True) if line.startswith("#"))
    body = yaml.safe_dump(data, allow_unicode=True, sort_keys=False)
    Path(path).write_text((header + "\n" if header else "") + body, encoding="utf-8")


def iso(value: str | datetime | None) -> str:
    """Normalise a date or timestamp to UTC ``YYYY-MM-DDTHH:MM:SSZ``."""
    if value is None:
        dt = datetime.now(timezone.utc)
    elif isinstance(value, datetime):
        dt = value
    else:
        s = str(value).strip().replace("Z", "+00:00")
        dt = datetime.fromisoformat(s if "T" in s or ":" in s else s + "T00:00:00+00:00")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ------------------------------------------------------------- PR parsing


def _strip_comments(s: str) -> str:
    return re.sub(r"<!--.*?-->", "", s, flags=re.DOTALL)


def extract_section(body: str | None, heading: str) -> str | None:
    """Text under the first ``##``/``###`` heading named ``heading``, or None."""
    lines = _strip_comments(body or "").splitlines()
    want = heading.strip().lower()
    for i, line in enumerate(lines):
        m = re.match(r"^#{2,3}\s+(.+?)\s*#*\s*$", line)
        if m and m.group(1).strip().lower() == want:
            out = []
            for nxt in lines[i + 1:]:
                if re.match(r"^#{1,3}\s", nxt):
                    break
                out.append(nxt)
            return "\n".join(out).strip()
    return None


_ID = r"[A-Za-z0-9][A-Za-z0-9.\-]*"
_ONE = r"\[?`?" + _ID + r"`?\]?"
# `- 2.8.10 — text`, `- [2.8.10]: text`, `- 2.7, app-1 – text`, `- none - reason`
_ENTRY = re.compile(r"^(" + _ONE + r"(?:\s*,\s*" + _ONE + r")*)\s*(?:[—–:]|\s-)\s*(.*)$")


def normalise_id(raw: str) -> str:
    return re.sub(r"\.+$", "", re.sub(r"[\[\]`]", "", raw).strip()).lower()


@dataclass
class DocImpact:
    found: bool = False
    entries: list[tuple[list[str], str]] = field(default_factory=list)
    none: str | None = None
    unparsed: list[str] = field(default_factory=list)

    @property
    def named(self) -> list[str]:
        return [i for ids, _ in self.entries for i in ids]


def parse_doc_impact(body: str | None) -> DocImpact:
    section = extract_section(body, DOC_HEADING)
    if section is None:
        return DocImpact()
    out = DocImpact(found=True)
    current: list | None = None
    for line in section.splitlines():
        item = re.match(r"^\s?[-*]\s+(.*)$", line)
        if item:
            current = None
            m = _ENTRY.match(item.group(1).strip())
            if not m:
                out.unparsed.append(item.group(1).strip())
                continue
            ids = [i for i in (normalise_id(x) for x in m.group(1).split(",")) if i]
            text = m.group(2).strip()
            if ids == [NONE_ID]:
                out.none = text
                continue
            current = [ids, text]
            out.entries.append(current)
        elif current is not None and re.match(r"^\s+\S", line):
            current[1] = f"{current[1]} {line.strip()}".strip()
    out.entries = [(ids, text) for ids, text in out.entries]
    return out


# ------------------------------------------------------------ path mapping


def glob_to_regex(glob: str) -> re.Pattern:
    """``**`` spans directories, ``*`` stays within one, ``?`` is one character."""
    out, i = "", 0
    while i < len(glob):
        c = glob[i]
        if c == "*":
            if glob[i + 1:i + 2] == "*":
                i += 1
                if glob[i + 1:i + 2] == "/":
                    i += 1
                    out += "(?:.*/)?"
                else:
                    out += ".*"
            else:
                out += "[^/]*"
        elif c == "?":
            out += "[^/]"
        else:
            out += re.escape(c)
        i += 1
    return re.compile("^" + out + "$")


def is_within(child: str, parent: str) -> bool:
    return child != parent and child.startswith(parent + ".")


def suggest_sections(files: list[str], sections: list[dict], structural: list[str] | None = None) -> dict[str, list[str]]:
    """Section id → files that point there, in thesis order. Per file only the most
    specific match in a branch counts (``llm/scheduled/x.ts`` → 2.8.10, not 2.8)."""
    compiled = [(s["id"], [glob_to_regex(p) for p in s["paths"]], bool(s.get("structural_only")))
                for s in sections if s.get("paths")]
    struct = None if structural is None else set(structural)
    hits_by_id: dict[str, list[str]] = {}
    for f in files:
        is_struct = struct is None or f in struct
        hits = [sid for sid, res, only in compiled if (not only or is_struct) and any(r.match(f) for r in res)]
        for sid in hits:
            if not any(is_within(other, sid) for other in hits):
                hits_by_id.setdefault(sid, []).append(f)
    order = {s["id"]: i for i, s in enumerate(sections)}
    return dict(sorted(hits_by_id.items(), key=lambda kv: order.get(kv[0], 999)))


def is_covered(suggested: str, named: list[str]) -> bool:
    """Naming the section, a parent or a child counts."""
    return any(n == suggested or is_within(suggested, n) or is_within(n, suggested) for n in named)


def parse_name_status(out: str) -> tuple[list[str], list[str]]:
    """``git diff --name-status`` → (all files, files added/removed/renamed)."""
    files, structural = [], []
    for line in out.splitlines():
        if not line.strip():
            continue
        status, *paths = line.split("\t")
        for p in paths:
            files.append(p)
            if not status.startswith(("M", "T")):
                structural.append(p)
    return files, structural


# ---------------------------------------------------------------- pr-check


CONVENTIONAL_TITLE = re.compile(r"^(feat|fix|refactor|perf|test|docs|chore|build|ci|style|revert)(\([\w\-./, ]+\))?!?: \S")


@dataclass
class PrCheck:
    errors: list[str]
    warnings: list[str]
    impact: DocImpact
    suggested: dict[str, list[str]]


def check_pr(title: str, body: str | None, files: list[str], sections: list[dict],
             structural: list[str] | None = None) -> PrCheck:
    errors: list[str] = []
    warnings: list[str] = []
    impact = parse_doc_impact(body)
    suggested = suggest_sections(files, sections, structural)
    known = {s["id"] for s in sections}

    if not CONVENTIONAL_TITLE.match(title or ""):
        warnings.append(f'Title "{title}" is not a conventional commit title (`feat(scope): …`, `fix: …`, …).')
    if extract_section(body, "What changes") is None:
        errors.append("Missing a `## What changes` section.")
    if extract_section(body, "Tests") is None:
        warnings.append("No `## Tests` section — say what was run and what passed.")

    if not impact.found:
        errors.append(
            f"Missing a `## {DOC_HEADING}` section. List `- <section id> — <what the thesis must now say>` "
            "per affected section (ids in thesis-harness/sections.yaml), or `- none — <why>`.")
        return PrCheck(errors, warnings, impact, suggested)

    for u in impact.unparsed:
        errors.append(f'Cannot read Documentation impact item "{u}". Use `- <section id> — <text>`.')
    if impact.none is not None and impact.entries:
        errors.append("Documentation impact lists sections and `none` at the same time — keep one.")
    if impact.none is not None and len(impact.none) < MIN_TEXT:
        errors.append("`- none` needs a reason, e.g. `- none — test-only change, no behaviour moved`.")
    if impact.none is None and not impact.entries and not impact.unparsed:
        errors.append(f"`## {DOC_HEADING}` is empty. Name the affected sections or write `- none — <why>`.")
    for ids, text in impact.entries:
        for i in ids:
            if i not in known:
                errors.append(f'Unknown section id "{i}" — use an id from thesis-harness/sections.yaml.')
        if len(text) < MIN_TEXT:
            errors.append(f"Entry for {', '.join(ids)} is too short to write from — say what the thesis must now say.")

    missed = {sid: fs for sid, fs in suggested.items() if not is_covered(sid, impact.named)}
    if missed:
        listed = "; ".join(f"{sid} ({', '.join(fs[:3])}{', …' if len(fs) > 3 else ''})" for sid, fs in missed.items())
        warnings.append(
            f"Declared no doc impact, but the changed files map to: {listed}. Confirm none of these sections goes stale."
            if impact.none is not None else
            f"Changed files map to sections the description does not name: {listed}.")
    return PrCheck(errors, warnings, impact, suggested)


def is_release_rollup(base: str, head: str) -> bool:
    """``development`` → ``main`` repeats PRs that were checked on the way in."""
    return base == "main" and head == "development"


# ----------------------------------------------------------------- sources


def _token() -> str | None:
    tok = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if tok:
        return tok
    try:
        out = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, timeout=10)
        return out.stdout.strip() or None
    except Exception:  # noqa: BLE001 - gh is optional
        return None


def _api(path: str, token: str | None):
    req = urllib.request.Request(f"https://api.github.com{path}", headers={
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "kairos-thesis-harness",
        **({"Authorization": f"Bearer {token}"} if token else {}),
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        hint = " (лимит на заявките – задайте GH_TOKEN)" if e.code == 403 and not token else ""
        raise RuntimeError(f"GitHub {e.code} за {path}{hint}") from e


def _paged(path: str, token: str | None, max_pages: int = 30) -> list:
    out: list = []
    sep = "&" if "?" in path else "?"
    for page in range(1, max_pages + 1):
        batch = _api(f"{path}{sep}per_page=100&page={page}", token)
        out += batch
        if len(batch) < 100:
            break
    return out


def fetch_merged_prs(repo_slug: str, since: str, until: str, bases=("development", "main")) -> list[dict]:
    token = _token()
    found: dict[int, dict] = {}
    for base in bases:
        for page in range(1, 21):
            batch = _api(f"/repos/{repo_slug}/pulls?state=closed&base={base}&sort=updated&direction=desc"
                         f"&per_page=50&page={page}", token)
            for pr in batch:
                merged = pr.get("merged_at")
                if merged and since < iso(merged) <= until and not is_release_rollup(pr["base"]["ref"], pr["head"]["ref"]):
                    found[pr["number"]] = pr
            # Sorted by last update: once a whole page predates the window, so does the rest.
            if len(batch) < 50 or all(iso(pr["updated_at"]) < since for pr in batch):
                break
    out = []
    for pr in found.values():
        files = _paged(f"/repos/{repo_slug}/pulls/{pr['number']}/files", token)
        commits = _paged(f"/repos/{repo_slug}/pulls/{pr['number']}/commits", token, max_pages=3)
        out.append({
            "number": pr["number"], "title": pr["title"], "body": pr.get("body") or "",
            "url": pr["html_url"], "merged_at": iso(pr["merged_at"]),
            "base": pr["base"]["ref"], "head": pr["head"]["ref"],
            "files": [f["filename"] for f in files],
            "structural": [f["filename"] for f in files if f.get("status") not in ("modified", "changed")],
            "commit_subjects": [c["commit"]["message"].split("\n", 1)[0] for c in commits],
        })
    return out


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=repo, capture_output=True, text=True, check=True,
                          encoding="utf-8", errors="replace", timeout=120).stdout


def resolve_ref(repo: Path, branch: str) -> str | None:
    for ref in (f"origin/{branch}", branch):
        try:
            _git(repo, "rev-parse", "--verify", "--quiet", ref)
            return ref
        except Exception:  # noqa: BLE001
            continue
    return None


def local_commits(repo: Path, branch: str, since: str, until: str) -> list[dict]:
    ref = resolve_ref(repo, branch)
    if not ref:
        return []
    raw = _git(repo, "log", ref, "--no-merges", f"--since={since}", f"--until={until}",
               "--format=%H%x1f%cI%x1f%s%x1f%b%x1e")
    out = []
    for rec in raw.split("\x1e"):
        rec = rec.strip()
        if not rec:
            continue
        sha, date, subject, body = (rec.split("\x1f") + ["", "", "", ""])[:4]
        files, structural = parse_name_status(_git(repo, "show", "--name-status", "--format=", sha))
        out.append({"sha": sha, "date": iso(date), "subject": subject, "body": body.strip(),
                    "files": files, "structural": structural})
    return out


def subject_key(s: str) -> str:
    return re.sub(r"\s*\(#\d+\)\s*$", "", s or "").strip().lower()


# ------------------------------------------------------------------ ledger


def _excerpt(text: str) -> str:
    flat = _strip_comments(text or "")
    flat = re.sub(r"^🤖 Generated with.*$", "", flat, flags=re.MULTILINE)
    flat = re.sub(r"^Co-Authored-By:.*$", "", flat, flags=re.MULTILINE | re.IGNORECASE).strip()
    return flat if len(flat) <= EXCERPT else flat[:EXCERPT].rstrip() + " …"


def _files_by(by_sec: dict[str, list[str]], limit: int = 5) -> dict[str, list[str]]:
    return {sid: fs[:limit] for sid, fs in by_sec.items()}


def _ignored(files: list[str], ignore: list[re.Pattern]) -> bool:
    return bool(files) and bool(ignore) and all(any(r.match(f) for r in ignore) for f in files)


def build_ledger(prs: list[dict], commits: list[dict], sections: list[dict], since: str, until: str,
                 ignore: list[str] | None = None) -> dict:
    ignore_res = [glob_to_regex(g) for g in ignore or []]
    prs = [p for p in prs if not _ignored(p.get("files") or [], ignore_res)]
    order = {s["id"]: i for i, s in enumerate(sections)}
    titles = {s["id"]: s["title"] for s in sections}
    by_section: dict[str, list[dict]] = {}
    ledger = {"since": since, "until": until, "pr_count": len(prs), "commit_count": 0,
              "sections": [], "no_change": [], "needs_review": [], "possibly_missed": []}
    pr_subjects: set[str] = set()

    for pr in sorted(prs, key=lambda p: p["merged_at"]):
        ref = f"#{pr['number']}"
        pr_subjects.add(subject_key(pr["title"]))
        pr_subjects.update(subject_key(s) for s in pr.get("commit_subjects") or [])
        impact = parse_doc_impact(pr.get("body"))
        by_sec = suggest_sections(pr.get("files") or [], sections, pr.get("structural"))
        suggested = list(by_sec)
        base = {"ref": ref, "title": pr["title"], "url": pr.get("url", ""), "merged_at": pr["merged_at"]}
        if not impact.found or (not impact.entries and impact.none is None):
            body = pr.get("body") or ""
            ledger["needs_review"].append({**base, "suggested": suggested, "files": _files_by(by_sec),
                                           "excerpt": _excerpt(extract_section(body, "What changes") or body)})
            continue
        if impact.none is not None and not impact.entries:
            ledger["no_change"].append({**base, "text": impact.none, "suggested": suggested})
            continue
        for ids, text in impact.entries:
            for sid in ids:
                by_section.setdefault(sid, []).append({**base, "text": text})
        missed = [sid for sid in suggested if not is_covered(sid, impact.named)]
        if missed:
            ledger["possibly_missed"].append({**base, "sections": missed,
                                              "files": _files_by({k: by_sec[k] for k in missed})})

    for c in sorted(commits, key=lambda c: c["date"]):
        if subject_key(c["subject"]) in pr_subjects or _ignored(c["files"], ignore_res):
            continue
        ledger["commit_count"] += 1
        by_sec = suggest_sections(c["files"], sections, c.get("structural"))
        ledger["needs_review"].append({
            "ref": c["sha"][:7], "title": c["subject"], "url": "", "merged_at": c["date"],
            "suggested": list(by_sec), "files": _files_by(by_sec), "excerpt": _excerpt(c["body"]),
        })

    ledger["sections"] = [
        {"id": sid, "title": titles.get(sid, sid), "items": items}
        for sid, items in sorted(by_section.items(), key=lambda kv: order.get(kv[0], 999))
    ]
    return ledger


def collect(cfg, since: str | None = None, until: str | None = None) -> dict:
    """The ledger for the configured window. Never raises for a missing source:
    what could not be read is listed under ``errors``."""
    st = settings(cfg)
    sync = load_sync(st["sync_path"])
    since = iso(since or sync.get("last_synced_at") or "1970-01-01")
    until = iso(until)
    sections = load_sections(st["sections_path"])
    errors: list[str] = []

    injected = os.environ.get("THESIS_HARNESS_CHANGES")
    prs: list[dict] = []
    if injected:
        prs = [p for p in json.loads(Path(injected).read_text(encoding="utf-8"))
               if since < iso(p["merged_at"]) <= until]
        source = f"file:{injected}"
    elif os.environ.get("THESIS_HARNESS_OFFLINE") or not st["github"]:
        source = "local git only"
    else:
        source = f"github:{st['github']}"
        try:
            prs = fetch_merged_prs(st["github"], since, until)
        except Exception as e:  # noqa: BLE001 - offline must not stop a scan
            errors.append(f"PR описанията не се прочетоха: {e}")
    try:
        commits = local_commits(cfg.repo_root, st["branch"], since, until)
    except Exception as e:  # noqa: BLE001
        commits = []
        errors.append(f"git log: {e}")

    ledger = build_ledger(prs, commits, sections, since, until, st["ignore"])
    ledger.update({"source": source, "errors": errors, "sync": sync,
                   "sections_file": str(st["sections_path"])})
    return ledger


# ------------------------------------------------------------- rendering


def render_ledger(ledger: dict, sections: list[dict]) -> str:
    meta = {s["id"]: s for s in sections}

    def label(sid: str) -> str:
        s = meta.get(sid)
        return f"{sid} {s['title']}" if s else sid

    def link(item: dict) -> str:
        return f"[{item['ref']}]({item['url']})" if item.get("url") else f"`{item['ref']}`"

    out = [
        "# Промени за дипломната",
        "",
        "Какво е влязло в кода след последната синхронизация на документа, по раздели.",
        "",
        f"- Прозорец: след **{ledger['since']}** до **{ledger['until']}** (източник: {ledger.get('source', '?')})",
        f"- {ledger['pr_count']} PR, {ledger['commit_count']} commit(а) в `development` без PR",
        "- Разделите са от `thesis-harness/sections.yaml`. След като документът е обновен:"
        " `python thesis-harness/run.py changes --mark-synced`.",
        "",
    ]
    for e in ledger.get("errors") or []:
        out += [f"> ⚠ {e}", ""]

    out += ["## За писане, по раздели", ""]
    if not ledger["sections"]:
        out += ["_Няма декларирани._", ""]
    for s in ledger["sections"]:
        out += [f"### {label(s['id'])}", ""]
        out += [f"- {link(i)} {i['title']} — {i['text']}" for i in s["items"]]
        out.append("")

    out += ["## За решение", "",
            "Без `## Documentation impact`: по-стари PR или commit-и директно в `development`."
            " Разделите са предположение по променените файлове.", ""]
    if not ledger["needs_review"]:
        out += ["_Няма._", ""]
    for r in ledger["needs_review"]:
        out += [f"### {link(r)} {r['title']}", ""]
        out.append("Файловете сочат: " + (", ".join(f"`{x}`" for x in r["suggested"]) if r["suggested"] else "нито един раздел от картата") + ".")
        if r.get("excerpt"):
            out += [""] + [f"> {line}" for line in r["excerpt"].splitlines()]
        out.append("")

    out += ["## Вероятно пропуснати", ""]
    if not ledger["possibly_missed"]:
        out += ["_Няма._", ""]
    out += [f"- {link(m)} {m['title']} — пипа и {', '.join(label(x) for x in m['sections'])}" for m in ledger["possibly_missed"]]
    if ledger["possibly_missed"]:
        out.append("")

    out += ["## Без промяна в документа", ""]
    if not ledger["no_change"]:
        out += ["_Няма._", ""]
    for n in ledger["no_change"]:
        hint = f" _(файловете сочат {', '.join(n['suggested'])})_" if n["suggested"] else ""
        out.append(f"- {link(n)} {n['title']} — {n['text']}{hint}")
    out.append("")
    return "\n".join(out)


# ------------------------------------------------------- document mapping


def heading_for(section: dict, headings: list) -> object | None:
    """The document heading a section id stands for, or None."""
    if section.get("heading"):
        rx = re.compile(section["heading"], re.IGNORECASE)
        return next((h for h in headings if rx.search(h.text.strip())), None)
    return next((h for h in headings if h.number == section["id"]), None)


def anchor_for(sid: str, sections: list[dict], headings: list) -> tuple[object | None, str | None]:
    """Heading for ``sid``; if the document lacks it (e.g. 2.8.5 has an empty
    heading), the nearest ancestor that exists. Returns (heading, id it matched)."""
    meta = {s["id"]: s for s in sections}
    cur = sid
    while cur:
        s = meta.get(cur) or {"id": cur}
        if s.get("in_document") is False:
            return None, None
        h = heading_for(s, headings)
        if h is not None:
            return h, cur
        cur = cur.rsplit(".", 1)[0] if "." in cur else ""
    return None, None


def map_drift(sections: list[dict], headings: list) -> tuple[list[str], list[str]]:
    """(map ids with no heading in the document, numbered headings missing from the map)."""
    missing = [s["id"] for s in sections if s.get("in_document") is not False and heading_for(s, headings) is None]
    known = {s["id"] for s in sections}
    unmapped = [h.number for h in headings if h.number and h.number not in known]
    return missing, unmapped

"""PreToolUse hook: no PR is created or re-described unless its description passes
the thesis-harness pr-check (CLAUDE.md → Pull requests).

Covers the GitHub MCP tools (create_pull_request, update_pull_request) and
`gh pr create` / `gh pr edit` in Bash. On failure it denies the call and tells
Claude exactly what to fix; the PR is then retried with a corrected body.

Fails closed: if the check itself cannot run (harness dependencies missing,
unexpected error) the PR is blocked with the reason, never silently let through.
"""

from __future__ import annotations

import json
import re
import shlex
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GUIDE = (
    "Write the description with the `make-pr` skill: `.github/pull_request_template.md` headings, "
    "`## What changes`, `## Tests`, and `## Documentation impact` with `- <section id> — <fact>` per thesis "
    "section (ids in thesis-harness/sections.yaml) or `- none — <why>`. Verify it with "
    "`python thesis-harness/run.py pr-check --title \"<title>\" --body-file <file> --base <base> --head <branch>` "
    "and retry with the same body."
)


def respond(decision: str | None, reason: str = "", context: str = "") -> None:
    out: dict = {"hookSpecificOutput": {"hookEventName": "PreToolUse"}}
    if decision:
        out["hookSpecificOutput"]["permissionDecision"] = decision
        out["hookSpecificOutput"]["permissionDecisionReason"] = reason
    if context:
        out["hookSpecificOutput"]["additionalContext"] = context
    print(json.dumps(out))
    sys.exit(0)


def deny(reason: str) -> None:
    respond("deny", f"PR blocked: {reason}\n\n{GUIDE}")


def from_gh(command: str) -> dict | None:
    """The PR fields of a `gh pr create|edit` call, or None when there is none."""
    # Only `gh` in command position: at the start, or after a separator or `(`.
    # Text that merely mentions it (echo, grep, a heredoc, quoted JSON) is not a PR.
    m = re.search(r"(?:^|[;&|(\n]|\$\()\s*gh\s+pr\s+(create|edit)\b(.*)", command, re.DOTALL)
    if not m:
        return None
    action, rest = m.group(1), m.group(2)
    rest = re.split(r"\s(?:&&|\|\||;|\|)\s", rest, maxsplit=1)[0]
    try:
        args = shlex.split(rest)
    except ValueError:
        deny("could not parse the `gh pr` command; put the body in a file and pass `--body-file`.")
    out: dict = {"action": action, "title": None, "body": None, "base": None, "head": None, "fill": False}
    flags = {"-t": "title", "--title": "title", "-b": "body", "--body": "body", "-F": "body_file",
             "--body-file": "body_file", "-B": "base", "--base": "base", "-H": "head", "--head": "head"}
    i = 0
    while i < len(args):
        a = args[i]
        key, val = (a.split("=", 1) + [None])[:2] if a.startswith("--") and "=" in a else (a, None)
        if key in flags:
            if val is None and i + 1 < len(args):
                i += 1
                val = args[i]
            out[flags[key]] = val
        elif key.startswith("--fill"):
            out["fill"] = True
        i += 1
    if out.get("body_file"):
        if out["body_file"] == "-":
            deny("`--body-file -` reads stdin, which this check cannot see; write the body to a file.")
        path = Path(out["body_file"])
        if not path.is_absolute():
            path = Path.cwd() / path
        if not path.exists():
            deny(f"body file {out['body_file']} does not exist.")
        out["body"] = path.read_text(encoding="utf-8")
    return out


def main() -> None:
    data = json.load(sys.stdin)
    tool, inp = data.get("tool_name", ""), data.get("tool_input") or {}

    if tool == "Bash":
        pr = from_gh(inp.get("command", ""))
        if pr is None:
            sys.exit(0)
        if pr["action"] == "create" and (pr["fill"] or pr["body"] is None):
            deny("`gh pr create` without an explicit body (or with --fill) skips the conventions.")
        if pr["action"] == "create" and not pr["base"]:
            deny("`gh pr create` without `--base` targets the repository's default branch; "
                 "pass `--base development` (or `--base main` for a release from development).")
        if pr["action"] == "edit" and pr["body"] is None:
            sys.exit(0)  # title/label edits leave the checked body as it is
        title, body, base, head = pr["title"], pr["body"], pr["base"], pr["head"]
    elif tool.endswith("create_pull_request"):
        title, body, base, head = inp.get("title"), inp.get("body"), inp.get("base"), inp.get("head")
        if not body:
            deny("the PR has no body.")
    elif tool.endswith("update_pull_request"):
        if inp.get("body") is None:
            sys.exit(0)
        title, body, base, head = inp.get("title"), inp.get("body"), inp.get("base"), None
    else:
        sys.exit(0)

    sys.path.insert(0, str(ROOT / "thesis-harness"))
    try:
        from thesis_harness import changes as chg
        from thesis_harness.config import load_config
    except ImportError as e:
        deny(f"the check needs the harness dependencies ({e}). Run "
             "`python -m pip install -r thesis-harness/requirements.txt` and retry.")

    cfg = load_config()
    base = base or "development"
    if head is None and tool == "Bash":
        try:  # gh defaults --head to the checked-out branch
            head = chg._git(cfg.repo_root, "rev-parse", "--abbrev-ref", "HEAD").strip() or None
        except Exception:  # noqa: BLE001
            head = None
    flow = chg.branch_flow_error(base, head)
    if flow:
        deny(flow)
    found = chg.changed_files(cfg.repo_root, base, head)
    if found is None:  # the base branch was never fetched in this checkout
        try:
            chg._git(cfg.repo_root, "fetch", "-q", "origin", base)
            found = chg.changed_files(cfg.repo_root, base, head)
        except Exception:  # noqa: BLE001 - the file hints are optional
            found = None
    files, structural = found if found else ([], None)
    sections = chg.load_sections(chg.settings(cfg)["sections_path"])
    # An update that only changes the body keeps the PR's existing title; a title is
    # only judged when it is being set.
    res = chg.check_pr(title if title is not None else "chore: (unchanged title)", body, files, sections, structural)
    if res.errors:
        deny("the description does not follow the conventions:\n- " + "\n- ".join(res.errors)
             + ("\nAlso:\n- " + "\n- ".join(res.warnings) if res.warnings else ""))
    if res.warnings:
        respond(None, context="PR description passed with warnings — fix them with update_pull_request "
                "if they are right:\n- " + "\n- ".join(res.warnings))
    sys.exit(0)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001 - fail closed, with the reason
        deny(f"the PR check failed to run ({type(e).__name__}: {e}).")

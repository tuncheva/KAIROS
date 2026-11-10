---
name: make-pr
description: Open (or re-describe) a pull request in KAIROS with the house conventions — work on its own branch, PR into `development`, with the `## Documentation impact` section the thesis harness reads. Use every time the user asks to make, open, create, raise or send a PR or pull request, to merge work into development, for a release PR (development → main), or to fix a PR description.
---

# Make a PR

Every PR description in KAIROS records which thesis sections the change makes
stale. `/thesis-check` later turns those lines into the list of what the
documentation must include. A hook (`.claude/hooks/pr_check.py`) blocks a PR
whose description fails `pr-check`, so do it right the first time.

## 1. Branch and base

Work reaches `development` through PRs from its own branch. `main` only
receives `development` (a release). The hook and CI refuse a feature branch
→ `main`.

**A feature PR (the default)** — head: a branch, base: `development`.

- Already on a feature branch: use it.
- Commits made on local `development` that are **not pushed** yet: move them
  onto a branch, then put `development` back where the remote is:
  ```bash
  git fetch origin development
  git switch -c <type>/<short-name>            # takes the commits along
  git branch -f development origin/development  # local development = remote again
  ```
- Nothing committed yet: `git switch -c <type>/<short-name> origin/development`,
  then commit there.
- Branch name: the conventional type and a few words, e.g.
  `feat/pause-scheduled-agents`, `fix/workload-timestamps`.
- Commits already **pushed** to `development` cannot be PR-ed into it. Say so;
  they go out with the next release PR, which must then carry their
  Documentation impact.
- Push the branch: `git push -u origin <branch>`. If the session's git access
  only allows another branch, stop and tell the user rather than pushing
  elsewhere.

**A release PR** (only when the user asks to release / merge development into
main) — head: `development`, base: `main`. Its Documentation impact is
`- none — release of #17, #18; their PRs carry the documentation impact`,
plus real entries for any commit in it that did not come through a PR.

## 2. Read what actually changed

```bash
git fetch origin <base>
git log --oneline origin/<base>..<head>
git diff --stat origin/<base>...<head>
```

Then read the diff of the parts that matter. Write from the diff, not from
memory of the session: a release PR covers every commit, including ones made
in other sessions.

## 3. Map the change to thesis sections

1. Draft the body (below) with an empty Documentation impact and run
   `python thesis-harness/run.py pr-check --title "<title>" --body-file <draft> --base <base> --head <head>`.
   Its summary lists **the sections the changed files point at**.
2. Read those sections' `title`/`en` in `thesis-harness/sections.yaml`. For each,
   decide whether a reader of the thesis would now read something false or
   miss something new. Path hints are a heuristic: a CSS tweak under
   `src/components/` rarely changes 2.11.
3. Also consider sections no file points at: `app-5` (a screen changed
   visibly), `app-1` (tables changed), `2.1` (a dependency added/removed),
   `2.5` (a route added/removed), chapter 3 (future work that has now shipped),
   `readme`.
4. If the thesis has been scanned (`thesis-harness/work/*/doc.md`), check what
   the section currently says, so the entry states the difference.

Each entry is the fact the thesis must now state, specific enough to write a
paragraph from without the diff: names, numbers, limits, what the user sees.
Not "updated agents".

- Good: `- 2.8.10 — Scheduled agents can be paused per workspace until midnight; paused runs are skipped, not queued.`
- Bad: `- 2.8 — agent improvements`

Nothing the thesis describes changed (tests, internal refactor, CI): one line
`- none — <why>`. For a release PR whose PRs all declared already:
`- none — release of #17, #18; their PRs carry the documentation impact`.

## 4. Write the body

Title: conventional commit (`feat(ai): pause scheduled agents`). Body, in this
order (`.github/pull_request_template.md`):

```markdown
<one or two sentences: what and why>

## What changes
- …

## Tests
- what was run and what passed; known flakes

## Documentation impact
- <id> — <fact>

## Not verified
- (only if there is something)

## Left open
- (only if there is something)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Keep the attribution lines your session instructions ask for at the end.

## 5. Check, then open

1. Save the body to a file in the scratchpad and run `pr-check` on it until it
   prints `Description OK`. Treat each warning: add the section, or be sure it
   is not stale.
2. Open the PR with exactly that body: the GitHub MCP `create_pull_request`
   (`body` = file contents) or `gh pr create --title … --body-file <file> --base … --head …`.
   Never `gh pr create --fill`.
3. If the hook still blocks, read its reason, fix the body, retry. Do not work
   around the hook.
4. Give the user the PR link and the Documentation impact lines.

To change an existing description, the same check applies to
`update_pull_request` / `gh pr edit --body-file`.

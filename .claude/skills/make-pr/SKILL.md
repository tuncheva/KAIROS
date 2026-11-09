---
name: make-pr
description: Open (or re-describe) a pull request in KAIROS with the house conventions, including the `## Documentation impact` section the thesis harness reads. Use every time the user asks to make, open, create, raise or send a PR, a pull request, or a release PR (development → main), or to fix a PR description.
---

# Make a PR

Every PR description in KAIROS records which thesis sections the change makes
stale. `/thesis-check` later turns those lines into the list of what the
documentation must include. A hook (`.claude/hooks/pr_check.py`) blocks a PR
whose description fails `pr-check`, so do it right the first time.

## 1. Decide base and head

- Feature branch → `development` (the default).
- `development` → `main` when the user asks for a release / to merge development
  into main, or when the work was committed straight to `development`.
- Make sure the work is committed and pushed (`git push -u origin <head>`).

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

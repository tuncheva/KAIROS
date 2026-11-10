# KAIROS — working conventions

This repository is also the subject of a diploma thesis (Bulgarian, `.docx`, kept
outside the repo). Every change that lands has to be traceable to the thesis
sections it makes stale. The PR description is where that is recorded.

## Commits

- Conventional commits: `type(scope): subject` — `feat`, `fix`, `refactor`, `perf`,
  `test`, `docs`, `chore`, `build`, `ci`, `style`. Imperative, lower case, no period.
- Body: what changed and why, wrapped at ~72 columns, bullets for several changes.

## Pull requests

**Whenever you are asked to make a PR, use the `make-pr` skill.** A hook
(`.claude/hooks/pr_check.py`, registered in `.claude/settings.json`) blocks
`create_pull_request`, `update_pull_request`, `gh pr create` and `gh pr edit`
when the description fails `pr-check`; fix the body and retry, never work
around it. Release PRs (`development` → `main`) follow the same rules.

Work goes on its own branch (`feat/…`, `fix/…`, from `origin/development`) and
reaches `development` through a PR. Do not push features straight to
`development`: a commit without a PR has no Documentation impact and shows up
in the doc ledger as "Needs a decision". `main` only receives `development`
(release PRs); a feature branch → `main` is refused.

- **Title**: a conventional commit title (`feat(ai): pause scheduled agents`).
- **Body**: follow `.github/pull_request_template.md`:
  - a one- or two-sentence summary,
  - `## What changes` (required),
  - `## Tests` — what was run and what passed,
  - `## Documentation impact` (required, see below),
  - `## Not verified` and `## Left open` when there is something to say.
- Before opening the PR, check the body locally:
  `python thesis-harness/run.py pr-check --title "<title>" --body-file <file> --base development`.
  CI runs the same check ("PR description" workflow) and fails the PR on errors.

### Documentation impact

One line per thesis section the change makes stale, using the ids in
`thesis-harness/sections.yaml`:

```markdown
## Documentation impact
- 2.8.10 — Scheduled agents can be paused per workspace until midnight; the pause is stored in `agent_pause`.
- 2.7, app-1 — New `agent_pause` table (workspace_id, until, created_by).
- app-5 — The settings screen for scheduled agents changed; retake the screenshot.
```

- Write each entry as the fact the thesis must now state, specific enough to
  write a paragraph from without reading the diff: names, numbers, limits,
  what the user sees. Not "updated agents".
- Pick the most specific section. Chapter 3 ids (future work) apply when a
  change ships something the thesis lists as future work — it has to move out.
- `app-1` when tables change (ER diagram), `app-5` when a screen changes
  visibly, `2.1` when a dependency is added or removed, `2.5` when a route is
  added or removed, `readme` when the README goes stale.
- Nothing a reader of the thesis would notice (tests only, internal refactor,
  CI plumbing): `- none — <why>`.
- The check warns when the changed files map to sections the PR does not name.
  Either add the section or be sure it is not stale; the warning does not fail CI.

When a new area of the code appears that no section covers, add its paths to the
right section in `thesis-harness/sections.yaml` in the same PR.

These entries are what the thesis harness reads when the documentation checks
run (`/thesis-check`): each one becomes a lead on its section, and the reviewer
proposes the text with evidence from the code.

## Checks

- `pnpm check` — lint, typecheck, theme tokens, migration journal.
- `pnpm test` — unit and component tests.
- `python thesis-harness/run.py pr-check` — PR description (above).
- `python thesis-harness/run.py changes` — what the thesis has to absorb since
  the last sync, by section; see the `/thesis-check` skill.

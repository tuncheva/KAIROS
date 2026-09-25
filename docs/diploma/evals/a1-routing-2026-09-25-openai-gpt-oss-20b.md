# A1 routing eval — 2026-09-25

Model chain: `openai/gpt-oss-20b → minimaxai/minimax-m3` · cases: 55 · repeats: 1

| Metric | Result |
|---|---|
| Routing accuracy | 72.7% (40/55) |
| Schema validity, first pass | 96.4% (53/55) |
| Schema validity, after repair | 98.2% (54/55) |
| Tool selection | 76.5% (13/17) |
| Tool argument validity | 70.6% (36/51) |
| Routing, English | 72.9% (35/48) |
| Routing, other languages | 71.4% (5/7) |
| Latency p50 / p95 | 10275 ms / 52076 ms |
| Tokens per case (avg) | 8640 |
| Model errors | 0 |

## By category

| Category | Routing |
|---|---|
| clarify | 50.0% (2/4) |
| events | 100.0% (2/2) |
| locale | 80.0% (4/5) |
| memory | 100.0% (3/3) |
| multi | 50.0% (2/4) |
| notes | 50.0% (1/2) |
| org | 100.0% (4/4) |
| projects | 100.0% (2/2) |
| read | 86.7% (13/15) |
| refine | 66.7% (2/3) |
| scope | 66.7% (2/3) |
| tasks | 37.5% (3/8) |

## Misrouted

| Case | Expected | Got |
|---|---|---|
| `read.workload` | answer | clarify |
| `read.blocked-why` | answer | (tool budget exhausted) — tool budget exhausted |
| `tasks.reassign` | handoff → task_planner | clarify |
| `tasks.mark-done` | handoff → task_planner | handoff |
| `tasks.remind-me` | handoff → task_planner | answer |
| `tasks.delete` | handoff → task_planner | clarify |
| `tasks.bulgarian` | handoff → task_planner | clarify |
| `notes.create` | handoff → notes_vault | handoff |
| `multi.dedupes-same-agent` | handoff → task_planner | clarify |
| `multi.legacy-single-field` | handoff → task_planner | clarify |
| `clarify.ambiguous-person` | clarify | handoff → org_admin |
| `clarify.ambiguous-timeframe` | clarify | answer |
| `scope.injection-in-message` | answer | clarify |
| `refine.confirmation-language` | answer | handoff → task_planner |
| `locale.unsupported-language` | answer | clarify |

_Restored from the run's console output. The per-case JSON for this run was overwritten by a filtered probe run before report names carried the filter._

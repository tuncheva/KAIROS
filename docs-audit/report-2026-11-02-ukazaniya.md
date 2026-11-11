# Documentation audit — KAIROS_v09-10.docx

**NOT READY — mandatory criteria are failing**

- Profile: `ai-diploma-ukazaniya` (version 1)
- Document: `C:\Users\ttuncheva\Downloads\KAIROS_v09-10.docx`
- Audited: 2026-11-02T13:33:10+02:00
- Quality score (recommended criteria only): **81/100** — 17/21 judged recommended rules
- Mandatory: 20 passed, **8 failed**, 0 unjudged, 0 n/a (of 28)
- Recommended: 17 passed, 4 failed, 0 unjudged (of 21)

The document cannot be considered ready until every mandatory criterion below is satisfied. Recommended items affect the score only.

## Fix plan

| Fixability | Failing criteria | Meaning |
|---|---|---|
| `auto` | 1 | auto — a mechanical edit docaudit applies itself |
| `generate` | 1 | generate — docaudit builds the diagram from your code, then inserts it |
| `draft` | 6 | draft — docaudit drafts the Bulgarian prose for your review |
| `manual` | 4 | manual — only you can supply this |

Run `/fix-docs` to apply the `auto` fixes (R-GEN-080) to a new copy of the document. The original is never modified.

## Mandatory failures (8)

#### R-GEN-080 — Номерация на страниците
`mandatory` · source Част 1, т. 1.2 „Оформление“ · auto — a mechanical edit docaudit applies itself

Page numbering exists but starts on the title page: neither 'different first page' nor a separate section break is set.

#### R-API-030 — Тестове и оценка на качеството на резултатите
`mandatory` · source Част 2, т. 2.3 „Допустимо“ / „Недостатъчно: липса на тестове и анализ на резултатите“ · draft — docaudit drafts the Bulgarian prose for your review · judged by model

The reported evaluation measures only the code around the model: the offline run feeds hand-written answers instead of the model, and the document states that the live mode was not measured. That is the 'липса на … анализ на резултатите' case in т. 2.3. The repo already has the missing measurement: live routing eval on 2026-09-25 (gpt-oss-20b) with 72.7% routing accuracy, 96.4%/98.2% schema validity before/after repair, 76.5% tool selection, p50 10.3 s; and a persona evaluation on 2026-10-17 (44 turns, 2 of 9 criteria fully met).

**Contradicts the code:**
  - document claims: Live mode not measured
  - code says: docs/diploma/evals/a1-routing-2026-09-25-openai-gpt-oss-20b.md; docs/diploma/evals/persona-desi-*.md; tests/agents/evals/persona.live.test.ts
  - Live results exist in the repo and are omitted.

Evidence:
  - paragraph 372 · „Той не измерва дали моделът произвежда такъв отговор; това е предмет на живия режим, който … не е включен в настоящите резултати."

#### R-GEN-030 — Съответствие между теория и практика
`mandatory` · source Част 1, т. 1.2 „Теория и практика“ · draft — docaudit drafts the Bulgarian prose for your review · judged by model

Theory and practice agree in design, but several practical-part claims no longer match the code: five interface languages (only en and bg are offered); three provider presets (four exist); OAuth only via Google (Microsoft Entra ID is also implemented); 19 agent settings (20 now); 141 test files (163 now); live evaluation 'не е измерен' (a live run exists).

**Contradicts the code:**
  - document claims: 5 languages; 3 presets; Google-only OAuth; 19 settings; 141 test files
  - code says: src/i18n/locales.ts locales=['en','bg']; src/server/llm/core/providers.ts:78-100 (4 presets); src/server/auth/config.ts:7 MicrosoftEntraID; src/lib/agentSettings.ts (20 keys); 163 *.test.ts(x)
  - The document describes an earlier state of the code.

Evidence:
  - paragraph 169 · „…преводи за пет езика."
  - paragraph 174 · „…предварителни настройки за три доставчика;"
  - paragraph 175 · „OAuth 2.0 доставчици – Google…"
  - paragraph 279 · „…общо 19…"
  - paragraph 376 · „…в 141 тестови файла."

#### R-GEN-090 — Логично подреден текст
`mandatory` · source Част 1, т. 1.2 „Оформление“ · draft — docaudit drafts the Bulgarian prose for your review · judged by model

Internal contradictions and an unfinished sentence: 59 tables / 48 migrations in §2.1.4 and §2.7 vs 57 / 44 in the conclusion and Table 12; vector retrieval described as implemented in §1.4 and §2.8.9 but as a future direction in §3.1; paragraph 436 stops mid-sentence.

Evidence:
  - paragraph 435 · „Проектиран е релационен модел от 57 таблици в осем домейна."
  - paragraph 436 · „…шест разговорни агента с ясно разделени"
  - paragraph 404 · „3.1. Векторно извличане на документи"

#### R-MIN-080 — Оценка: изводи
`mandatory` · source Част 2, т. 2.2, изискване 4; т. 2.5 „Как проверих… и какви са неговите слабости?“ · draft — docaudit drafts the Bulgarian prose for your review · judged by model

The conclusions drawn from the evaluation are only that the offline run passes 55/55 and that its scope is limited. No weakness of the solution's real behaviour is identified, although the repo holds live results that show them (routing 72.7%, tool-argument validity 70.6%; persona run: replies in the wrong language to Latin-script Bulgarian, invented entities, event times saved in UTC).

**Contradicts the code:**
  - document claims: Only offline results; no weaknesses identified
  - code says: docs/diploma/evals/a1-routing-2026-09-25-openai-gpt-oss-20b.md; docs/diploma/evals/persona-desi-findings-2026-10-17.md
  - Weaknesses were measured but are not reported.

Evidence:
  - paragraph 369 · „Всичките 55 случая преминават и двете проверки…"

#### R-MIN-150 — Възпроизводимост
`mandatory` · source Част 2, т. 2.2, изискване 6 · draft — docaudit drafts the Bulgarian prose for your review · judged by model

Nothing in the document allows reproduction: no system requirements (Node 22, pnpm 10, PostgreSQL with pgvector), no install steps, no list of required environment variables (LLM_PROVIDER and the provider key, database URL, auth secrets, optional Redis/Stripe/Resend/UploadThing/VAPID), no migration or start commands. The URL and repo link let someone use or download the project but not run it.

**Contradicts the code:**
  - document claims: (absent)
  - code says: package.json scripts; .env.example; drizzle.config.ts; .github/workflows/ci.yml (Node 22, pgvector service)
  - The repo has everything needed for a setup section, but the document does not include one.

#### R-GEN-010 — Тема, утвърдена със задание
`mandatory` · source Част 1, т. 1.2 „Тема и задание“ · manual — only you can supply this · judged by model

The topic fits the specialty, but the document contains no задание page and no reference to one. Confirm with the supervisor whether the signed задание must be bound into the document.

#### R-GEN-060 — Номерация на разделите
`mandatory` · source Част 1, т. 1.2 „Оформление“ · manual — only you can supply this

7 heading(s) skip a numbering level.

Evidence:
  - paragraph 19 · found: 0.1 · level 2 heading without a 0 above it · „0.1. Актуалност на темата"
  - paragraph 22 · found: 0.2 · level 2 heading without a 0 above it · „0.2. Научен проблем"
  - paragraph 24 · found: 0.3 · level 2 heading without a 0 above it · „0.3. Цел и задачи на разработката"
  - paragraph 37 · found: 0.4 · level 2 heading without a 0 above it · „0.4. Методи на изследване"
  - paragraph 39 · found: 0.5 · level 2 heading without a 0 above it · „0.5. Ограничения на разработката"
  - paragraph 43 · found: 0.6 · level 2 heading without a 0 above it · „0.6. Структура на разработката"

## Recommended gaps (4)

#### R-STR-150 — Практическа част: фрагменти от кода
`recommended` · source Част 1, т. 1.3 „Практическа част“ · generate — docaudit builds the diagram from your code, then inserts it · judged by model

The practical part contains no code fragments at all: no monospaced paragraphs, no listings. Candidate excerpts: the tool loop limits (src/server/llm/core/toolLoop.ts:58-78), the Zod output schema with handoffs.max(3) (src/server/llm/schemas/a1WorkspaceConciergeSchemas.ts:193), the undo window (src/server/llm/undo.ts:54-82), the small-plan auto-apply limit (src/server/llm/agents/smallPlans.ts:12).

#### R-STR-080 — Увод: използвани технологии
`recommended` · source Част 1, т. 1.3 „Увод“ · draft — docaudit drafts the Bulgarian prose for your review · judged by model

The introduction never names the technologies used (Next.js, TypeScript, PostgreSQL/pgvector, tRPC, the LLM provider); they appear only in §2.1.

#### R-STR-030 — Заглавна страница: професия и специалност
`recommended` · source Част 1, т. 1.3 „Заглавна страница“ · manual — only you can supply this · judged by model

Cover names the specialty ('специалност „Програмиране на изкуствен интелект“') but not the profession 481040 'Програмист на изкуствен интелект' or the codes.

#### R-STR-210 — Приложения
`recommended` · source Част 1, т. 1.3 „Приложения“ · manual — only you can supply this · judged by model

Appendix 5 announces nine screenshots (/dashboard, /projects, /progress, /notes, /events/[id], /chat/ai, /settings, /calendar, /orgs) but contains no images; Appendix 4 shows only the offline evaluation.

Evidence:
  - paragraph 499 · „В това приложение се прилагат екранни снимки на основните изгледи…"

## Full criterion table

| Rule | Tag | Status | Criterion | Verdict |
|---|---|---|---|---|
| R-API-010 | man | pass | API като компонент, а не цялото решение | The LLM is presented explicitly as one interchangeable component behind an OpenAI-compatible client (§1.2, §2.8, §2.8.11). |
| R-API-020 | man | pass | Собствена обработка на входа и отговорите | Input processing (context packets, page context, summarisation) and output processing (Zod validation, repair, authorisation, p… |
| R-API-030 | man | FAIL | Тестове и оценка на качеството на резултатите | The reported evaluation measures only the code around the model: the offline run feeds hand-written answers instead of the mode… |
| R-API-040 | man | pass | Обосновка на избора на технология | The choice of a pretrained API model, the OpenAI-compatible format and the provider abstraction are justified (§1.2, §2.8.11, §… |
| R-GEN-010 | man | FAIL | Тема, утвърдена със задание | The topic fits the specialty, but the document contains no задание page and no reference to one. Confirm with the supervisor wh… |
| R-GEN-020 | man | pass | Посочени източници, библиотеки и чужд код | Libraries and services are named (§2.1, §2.2, Table 5) and the main ones are cited ([17]-[24]); the document states the model i… |
| R-GEN-030 | man | FAIL | Съответствие между теория и практика | Theory and practice agree in design, but several practical-part claims no longer match the code: five interface languages (only… |
| R-GEN-040 | man | pass | Ясно заглавие | Clear title on the cover. |
| R-GEN-050 | man | pass | Съдържание | Section 'toc' found at paragraph 15. |
| R-GEN-060 | man | FAIL | Номерация на разделите | 7 heading(s) skip a numbering level. |
| R-GEN-070 | man | pass | Списък с литература | Section 'literatura' found at paragraph 444. |
| R-GEN-080 | man | FAIL | Номерация на страниците | Page numbering exists but starts on the title page: neither 'different first page' nor a separate section break is set. |
| R-GEN-090 | man | FAIL | Логично подреден текст | Internal contradictions and an unfinished sentence: 59 tables / 48 migrations in §2.1.4 and §2.7 vs 57 / 44 in the conclusion a… |
| R-MIN-010 | man | pass | Собствена работа, а не готов инструмент | The document states the project's own contribution explicitly: the layer above the model (orchestration, validation, access con… |
| R-MIN-020 | man | pass | Реален проблем и ясна задача | §0.2 problem, §0.3 goal, §0.7 expected results. |
| R-MIN-030 | man | pass | Собствена програмна логика | Own logic is described in depth: context packets (§2.8.8), Zod schema validation and JSON repair (§2.8.7), tool loop with per-c… |
| R-MIN-040 | man | pass | Работа с данни: произход | Data origin is described: workspace data from the database, user-uploaded PDF/text documents, and a hand-written 55-case set fo… |
| R-MIN-050 | man | pass | Работа с данни: подготовка | Preparation is described: PDF text extraction, overlapping chunking with page numbers, embeddings, context packets and rolling … |
| R-MIN-060 | man | pass | Работа с данни: използване | Use of data is described: retrieval (hybrid search) with citations, domain-limited context per agent. |
| R-MIN-070 | man | pass | Оценка: тестови примери и показатели | 55 test cases with two metrics and a confusion matrix are presented (§2.14). |
| R-MIN-080 | man | FAIL | Оценка: изводи | The conclusions drawn from the evaluation are only that the offline run passes 55/55 and that its scope is limited. No weakness… |
| R-MIN-090 | man | pass | Разбиране: основни понятия със собствени думи | Chapter 1 explains the concepts in the author's own words. |
| R-MIN-100 | man | pass | Разбиране: ограничения на технологията | §0.5 and §2.14.1 explain the limits: non-determinism, no own training, embeddings dependency. |
| R-MIN-110 | man | pass | Разбиране: рискове — грешни отговори | §1.5 (hallucinations) and §1.2 (non-determinism) explain wrong answers and mitigation. |
| R-MIN-120 | man | pass | Разбиране: рискове — пристрастия | §2.16 discusses bias in language models. |
| R-MIN-130 | man | pass | Разбиране: рискове — поверителност на данните | §1.5, §2.11.3 and §2.16 discuss confidentiality, locked notes excluded from context and GDPR. |
| R-MIN-140 | man | pass | Работещ продукт, който може да се демонстрира | §2.17 gives the public URL, the GitHub repository and test accounts. |
| R-MIN-150 | man | FAIL | Възпроизводимост | Nothing in the document allows reproduction: no system requirements (Node 22, pnpm 10, PostgreSQL with pgvector), no install st… |
| R-STR-010 | rec | pass | Заглавна страница: тема | Topic is on the cover. |
| R-STR-020 | rec | pass | Заглавна страница: име на ученика | Student's full name in the cover table: 'Тина Веселинова Тунчева'. |
| R-STR-030 | rec | FAIL | Заглавна страница: професия и специалност | Cover names the specialty ('специалност „Програмиране на изкуствен интелект“') but not the profession 481040 'Програмист на изк… |
| R-STR-040 | rec | pass | Заглавна страница: ръководител | Supervisor in the cover table: 'Мария Христова'. |
| R-STR-050 | rec | pass | Заглавна страница: година | Year on the cover: '2027 г.'. |
| R-STR-060 | rec | pass | Увод: актуалност | §0.1 argues relevance. |
| R-STR-070 | rec | pass | Увод: цел и конкретни задачи | §0.3 states the goal and nine tasks. |
| R-STR-080 | rec | FAIL | Увод: използвани технологии | The introduction never names the technologies used (Next.js, TypeScript, PostgreSQL/pgvector, tRPC, the LLM provider); they app… |
| R-STR-090 | rec | pass | Теоретична част: основни понятия и методи | §1.2-§1.4 explain LLMs, reasoning models, tool calling, multi-agent architecture and RAG. |
| R-STR-100 | rec | pass | Теоретична част: обосновка на подхода и технологиите | §1.2-§1.3 justify using a pretrained model via API, the OpenAI-compatible format and specialised agents over a universal one. |
| R-STR-110 | rec | pass | Теоретична част: ограничения и рискове | §1.5 lists four risks; §0.5 lists limitations. |
| R-STR-120 | rec | pass | Практическа част: архитектура | §2.6 and Figure 4 describe the layered architecture. |
| R-STR-130 | rec | pass | Практическа част: данни | §2.7 and Table 6 describe the data model; counts match the 59 tables in src/server/db/schemas. |
| R-STR-140 | rec | pass | Практическа част: ключови стъпки на реализацията | §2.8 describes the key implementation steps in detail. |
| R-STR-150 | rec | FAIL | Практическа част: фрагменти от кода | The practical part contains no code fragments at all: no monospaced paragraphs, no listings. Candidate excerpts: the tool loop … |
| R-STR-160 | rec | pass | Практическа част: тестване и резултати | §2.14 and §2.15 describe testing and results (see R-API-030 for what the results omit). |
| R-STR-170 | rec | pass | Заключение: постигнато спрямо целта | The conclusion and Table 12 compare the outcome with the tasks. |
| R-STR-180 | rec | pass | Заключение: ограничения | Paragraph 441 states the limitations explicitly. |
| R-STR-190 | rec | pass | Заключение: възможни подобрения | Paragraph 442 and chapter 3 list improvements. |
| R-STR-200 | rec | pass | Литература: видове източници | Literature includes scientific articles, RFCs/standards, official documentation and web resources. There are no books, but the … |
| R-STR-210 | rec | FAIL | Приложения | Appendix 5 announces nine screenshots (/dashboard, /projects, /progress, /notes, /events/[id], /chat/ai, /settings, /calendar, … |

---

Generated by [docaudit](https://github.com/) · criteria are editable in `criteria/` and reviewed on every run.

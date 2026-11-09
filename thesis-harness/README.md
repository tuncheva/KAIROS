# Харнес за дипломната документация

Проверява `.docx` на дипломната работа спрямо **кода на KAIROS** и спрямо
**официалните изисквания**. Предлага промени, които одобрявате, и връща чисто
копие на документа с приложените промени.

```
.docx ──ingest──► абзаци с устойчиви ключове ─┐
код ────facts───► факти с файл:ред ───────────┼─► check (детерминистични)  ─┐
изисквания ─────► правила с дословни цитати ──┘   преглед от Claude (prompts) ┤
                                                                               ▼
                         proposals.yaml ◄── propose (валидиране: old съществува, има доказателство)
                               │  вие: approve / reject / edit (в чата или във файла)
                               ▼
                         apply ──► <име>.revised.docx (чисто, оригиналът не се пипа)
```

## Употреба

Най-лесно е през Claude Code: `/thesis-check C:\Users\...\KAIROS_v28-09.docx`.
Skill-ът (`.claude/skills/thesis-check`) минава през всички стъпки и ви
питате/одобрявате в чата.

Ръчно (от корена на репото; на Windows `python` или `py -3`):

```bash
python -m pip install -r thesis-harness/requirements.txt
python thesis-harness/run.py scan "C:\path\KAIROS_v28-09.docx"   # ingest + facts + check + tasks + review
python thesis-harness/run.py review                              # опресни review.md
python thesis-harness/run.py show P7
python thesis-harness/run.py approve P1-P5 P9 --note "ок"
python thesis-harness/run.py reject P6 --note "умишлено"
python thesis-harness/run.py edit P7 --new "нов текст" --note "по-кратко"
python thesis-harness/run.py apply --dry-run
python thesis-harness/run.py apply                               # → KAIROS_v28-09.revised.docx до оригинала
python thesis-harness/run.py status
```

Всички команди: `python thesis-harness/run.py --help`.

### Нова версия на документа

Пуснете `scan` с новия файл. Предложенията от предишната версия се пренасят:

- приложените, чийто текст вече е в документа, стават „влезли“;
- тези, които вече не пасват (абзацът е преписан), стават „остарели“.

Ако файлът е с ново име (`KAIROS_v15-10.docx`), добавете `--doc KAIROS_v28-09`,
за да остане същата работна папка.

### Къде е какво

`work/<документ>/` (не се commit-ва):

| Файл | Съдържание |
|---|---|
| `doc.md` | целият текст с маркери `[¶индекс\|ключ]` |
| `chunks/` | текстът, разделен по глави за паралелен преглед |
| `facts.json` | фактите от кода (агенти, зависимости, таблици, env, рутери, тестове, …) |
| `findings.json` | находките от проверките |
| `proposals.yaml` | всички предложения и статусът им; може да се редактира на ръка |
| `review.md` | листът за преглед |
| `apply-log.json` | какво е приложило последното `apply` |

## Какво се проверява

| Проверка | Какво |
|---|---|
| `code.stack-versions` | „Next.js 15“ спрямо `pnpm-lock.yaml`; спомената технология, която вече не е зависимост |
| `code.agents` | брой агенти в текста спрямо `registry.ts`; кодове A1…An; агенти, които не се споменават |
| `code.identifiers` | пътища `src/…`, имена на файлове, env променливи, `pnpm` скриптове, `snake_case`/`camelCase` идентификатори, които ги няма в кода |
| `structure.headings` | празни заглавия, пропуснати номера (1.2 → 1.6) |
| `structure.cross-refs` | „т. 2.8.5“, „Приложение 6“, „Фигура 8“, които сочат към несъществуващо |
| `structure.captions` | последователност на номерата на фигури и таблици |
| `text.mixed-script` | кирилица и латиница в една дума („chИИn“ от замяна AI→ИИ) |
| `text.doubled-words` | „на на“ |
| prompt `code-accuracy` | Claude сверява всяко проверимо твърдение за реализацията с кода |
| prompt `requirements` | Claude оценява смисловите правила от изискванията |

`python thesis-harness/run.py check --list` показва активните проверки.

## Изисквания

Харнесът няма вградени изисквания. Всички идват от вашия официален документ:

1. `python thesis-harness/run.py requirements import <файл1> [<файл2> …]` записва
   текста на всички документи в `requirements/source.txt` (D1, D2, …). Подавайте
   всички наведнъж – повторният импорт заменя предишния.
2. Claude предлага правила и вие ги потвърждавате. Всяко правило има дословен
   `quote`, `doc` (D1…) и `page`; по желание `severity` (препоръка → `warning`)
   и `applies_to` (регулярен израз по заглавието на частта, за която се отнася).
3. `python thesis-harness/run.py requirements validate` отхвърля правило,
   чийто цитат не е намерен в източника.

Правилото посочва как се проверява:

- `check: semantic` – оценява го Claude;
- някой от измервателните инструменти `req.required-headings`,
  `req.page-setup`, `req.body-font` или `req.page-count`, с `params` от цитата.

`requirements/` може да се commit-не, за да са правилата проследими.

### Профили (отделни набори изисквания)

Изискванията към различни материали се държат отделно:

- `requirements/` – за дипломната (сега: „Указания за разработване на дипломен проект“, 18 правила);
- `requirements/<профил>/` – друг набор, напр. `defense` за материалите за
  защитата на концепцията.

Всяка команда приема `--profile <име>`:

```bash
python thesis-harness/run.py --profile defense requirements import <файл>
python thesis-harness/run.py --profile defense scan <материал.docx>
```

## Разширяване

### Нова детерминистична проверка

Създайте `plugins/<име>.py`. Зарежда се автоматично:

```python
from thesis_harness.checks import Check, Finding, register

@register
class NoTodo(Check):
    id = "text.todo"
    title = "Забравени TODO"
    description = "Абзаци с TODO/XXX."

    def run(self, ctx):
        # ctx.prose – абзаците; ctx.facts – facts.json; ctx.repo – кодът; ctx.options – от harness.yaml
        for p in ctx.prose:
            if "TODO" in p.text:
                yield Finding(self.id, "warning", "Остана TODO", para=p.key,
                              excerpt="TODO", evidence=["текстът на абзаца"],
                              fix=None)   # или {"kind": "replace", "old": "...", "new": "..."}
```

Находка с `fix` става предложение, което одобрявате. Находка с `lead=True`
стига само до Claude като насока за смисловия преглед. Всяка друга находка
става `note` – ръчно действие.

Настройки на проверката се дават в `harness.yaml` → `checks.options.<id>`.
Проверка се изключва с `checks.disabled`.

### Нов факт от кода

- Добавете `@collector("име")` в `thesis_harness/facts/collectors.py`.
- За стойност от изпълнение на команда (напр. реалният брой тестове) добавете
  запис в `facts.commands` в `harness.yaml`. Там има закоментиран пример с
  `pnpm test`.

### Нова смислова проверка (Claude)

Създайте `prompts/<име>.md`:

```markdown
---
id: terminology
title: Единна терминология
scope: chunks          # chunks (по глави) | whole (целият документ) | requirements
enabled: true
exclude_chunks: ['ЛИТЕРАТУРА']
---
Инструкции за рецензента… Изходът е YAML във формата от prompts/code-accuracy.md.
```

`tasks` я включва автоматично. Skill-ът пуска по един субагент
`thesis-verifier` за всяка задача.

## Ограничения

- **Какво се чете:** основният текст и таблиците. Колонтитулите, бележките под
  линия и текстовите полета в рисунки не се четат и не се редактират.
- **Нови абзаци:** вмъкнатият абзац копира оформлението на съседния. Ако е
  нужен друг стил, задайте `style_from: <ключ>`.
- **Съдържанието и номерата на страници** не се преизчисляват. След `apply`
  обновете полетата в Word.
- **Track Changes:** ако документът съдържа непотвърдени промени, `ingest`
  предупреждава. По-добре първо ги приемете или отхвърлете в Word.
- **Номера на страници:** `req.page-count` чете броя, записан от Word при
  последния запис. Броят на страници не може да се изчисли надеждно без
  рендериране.

## Тестове

```bash
python thesis-harness/tests/test_harness.py
```

Тестовете ползват изкуствен документ и изкуствено репо. Пускат се и в CI.

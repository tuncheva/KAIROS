"""End-to-end tests for the harness on a synthetic document and repository.

Run: ``python thesis-harness/tests/test_harness.py`` (or ``python -m unittest`` from
``thesis-harness/``). No network, no real thesis needed.
"""

from __future__ import annotations

import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

HARNESS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HARNESS))

import docx  # noqa: E402

from thesis_harness import cli  # noqa: E402
from thesis_harness.docmodel import extract  # noqa: E402


def make_doc(path: Path) -> None:
    d = docx.Document()
    d.add_heading("Глава първа ТЕОРИЯ", level=1)
    d.add_heading("1.1. Технологии", level=2)
    p = d.add_paragraph()
    p.add_run("Платформата е написана на ")
    bold = p.add_run("Next.js 15")
    bold.bold = True
    p.add_run(" и React 19, с pnpm build за production.")
    d.add_heading("1.3. Агенти", level=2)  # 1.2 is missing on purpose
    d.add_paragraph("Системата има три агента, като A1 маршрутизира заявките (вж. т. 1.1 и т. 4.2).")
    d.add_paragraph("Моделът реализира chИИn of thought, описан във Фигура 2.")
    d.add_paragraph("Фигура 1. Архитектура")
    d.add_paragraph("Файлът src/server/missing.ts и променливата LLM_API_KEY_NOPE не съществуват.")
    d.save(str(path))


def make_repo(root: Path) -> None:
    (root / "src/server/llm/agents").mkdir(parents=True)
    (root / "src/server/llm/orchestrator").mkdir(parents=True)
    (root / "src/lib").mkdir(parents=True)
    (root / "src/i18n/messages").mkdir(parents=True)
    (root / "package.json").write_text(json.dumps({
        "name": "kairos", "version": "0.1.0",
        "scripts": {"build": "next build", "dev": "next dev"},
        "dependencies": {"next": "16.1.1", "react": "19.2.3"},
    }, indent=2), encoding="utf-8")
    agents = ",\n".join(
        f'  {{\n    id: "{i}",\n    role: "{i}",\n    kind: "{k}",\n    operations: [],\n    writes: {w},\n  }}'
        for i, k, w in [("a", "conversational", "false"), ("b", "conversational", "true"), ("c", "conversational", "true"),
                        ("d", "conversational", "true"), ("e", "conversational", "true"), ("f", "conversational", "true"),
                        ("s", "scheduled", "false")]
    )
    (root / "src/server/llm/agents/registry.ts").write_text(
        "export const AGENTS: readonly AgentDescriptor[] = [\n" + agents + "\n] as const;\n", encoding="utf-8")
    (root / "src/lib/agentNames.ts").write_text(
        'export const DEFAULT_AGENT_NAMES = {\n  a: "Mentor",\n};\n', encoding="utf-8")
    for n in range(1, 7):
        (root / f"src/server/llm/orchestrator/a{n}Agent.ts").write_text("//", encoding="utf-8")


class HarnessTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.repo = self.tmp / "repo"
        self.repo.mkdir()
        make_repo(self.repo)
        self.doc_path = self.tmp / "thesis.docx"
        make_doc(self.doc_path)
        self.env = {
            "THESIS_HARNESS_WORKSPACE": str(self.tmp / "work"),
            "THESIS_HARNESS_REPO": str(self.repo),
            "THESIS_HARNESS_REQUIREMENTS": str(self.tmp / "req"),
        }
        self._old = {k: os.environ.get(k) for k in self.env}
        os.environ.update(self.env)

    def tearDown(self):
        for k, v in self._old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_cli(self, *args: str) -> str:
        buf = io.StringIO()
        with redirect_stdout(buf):
            try:
                cli.main(list(args))
            except SystemExit as e:
                if e.code not in (0, None):
                    raise AssertionError(f"exit {e.code}: {buf.getvalue()}") from e
        return buf.getvalue()

    def proposals(self) -> list[dict]:
        import yaml
        return yaml.safe_load((self.tmp / "work/thesis/proposals.yaml").read_text(encoding="utf-8"))

    def findings(self) -> list[dict]:
        return json.loads((self.tmp / "work/thesis/findings.json").read_text(encoding="utf-8"))["findings"]

    # ------------------------------------------------------------------ tests

    def test_extract_text_spans_runs(self):
        doc = extract(self.doc_path)
        body = [p for p in doc.paras if "Next.js" in p.text][0]
        self.assertEqual(body.text, "Платформата е написана на Next.js 15 и React 19, с pnpm build за production.")
        self.assertEqual(body.section, "1.1. Технологии")
        heads = [(h.level, h.number) for h in doc.headings()]
        self.assertEqual(heads, [(1, "1"), (2, "1.1"), (2, "1.3")])

    def test_scan_finds_real_problems(self):
        self.run_cli("scan", str(self.doc_path))
        f = self.findings()
        by_check = {}
        for x in f:
            by_check.setdefault(x["check"], []).append(x)
        version = by_check["code.stack-versions"]
        self.assertEqual(len(version), 1)  # React 19 is correct, Next.js 15 is not
        self.assertEqual(version[0]["fix"], {"kind": "replace", "old": "Next.js 15", "new": "Next.js 16"})
        self.assertIn("1.2", by_check["structure.headings"][0]["message"])
        refs = [x["message"] for x in by_check["structure.cross-refs"]]
        self.assertTrue(any("4.2" in m for m in refs), refs)
        self.assertTrue(any("Фигура 2" in m for m in refs), refs)
        self.assertEqual(by_check["text.mixed-script"][0]["fix"]["new"], "chain")
        self.assertTrue(any("три агента" in x.get("excerpt", "") for x in by_check["code.agents"]))
        ident = {x["excerpt"] for x in by_check["code.identifiers"]}
        self.assertIn("src/server/missing.ts", ident)
        self.assertIn("LLM_API_KEY_NOPE", ident)
        self.assertNotIn("pnpm build", ident)

    def test_propose_rejects_unanchored_and_unevidenced(self):
        self.run_cli("scan", str(self.doc_path))
        key = [p for p in extract(self.doc_path).paras if "три агента" in p.text][0].key
        review = self.tmp / "r.yaml"
        review.write_text(
            "proposals:\n"
            f"  - {{para: '{key}', kind: replace, old: 'нещо измислено', new: 'x', source: review:t, rationale: r, evidence: [e]}}\n"
            f"  - {{para: '{key}', kind: replace, old: 'три агента', new: 'шест агента', source: review:t, rationale: r}}\n"
            f"  - {{para: '{key}', kind: replace, old: 'три агента', new: 'шест агента', source: review:t, rationale: r, evidence: ['registry.ts:1']}}\n",
            encoding="utf-8",
        )
        with self.assertRaises(AssertionError) as ctx:
            self.run_cli("propose", str(review))
        out = str(ctx.exception)
        self.assertIn("old не се среща", out)
        self.assertIn("липсва evidence", out)
        added = [p for p in self.proposals() if p["source"] == "review:t"]
        self.assertEqual(len(added), 1)

    def test_unquoted_numeric_keys_stay_text(self):
        from thesis_harness.workspace import read_yaml_text
        f = self.tmp / "k.yaml"
        f.write_text("- {para: 00000225, page: 3}\n- {para: 00000149}\n", encoding="utf-8")
        self.assertEqual([x["para"] for x in read_yaml_text(f)], ["00000225", "00000149"])

    def test_agent_codes_become_names(self):
        doc = self.tmp / "names.docx"
        d = docx.Document()
        d.add_heading("1.1. Агенти", level=2)
        d.add_paragraph("A1 · Mentor (Concierge)")
        d.add_paragraph("Mentor (A1) отговаря, а A1 делегира към A2–A3. Пак A1.")
        d.save(str(doc))
        (self.repo / "src/lib/agentNames.ts").write_text(
            'export const DEFAULT_AGENT_NAMES = {\n  a: "Mentor",\n  b: "Odysseus",\n  c: "Mnemosyne",\n};\n', encoding="utf-8")
        for n in range(1, 7):
            (self.repo / f"src/server/llm/orchestrator/a{n}Agent.ts").unlink()
        for stem in ("a1A", "a2B", "a3C"):
            (self.repo / f"src/server/llm/orchestrator/{stem}.ts").write_text("//", encoding="utf-8")
        cfg = self.tmp / "harness.yaml"
        cfg.write_text("checks:\n  options:\n    style.agent-names: {script: latin}\n", encoding="utf-8")
        os.environ["THESIS_HARNESS_CONFIG"] = str(cfg)
        try:
            self.run_cli("scan", str(doc))
            import yaml
            props = yaml.safe_load((self.tmp / "work/names/proposals.yaml").read_text(encoding="utf-8"))
            self.run_cli("approve", *[p["id"] for p in props if p["source"] == "check:style.agent-names"])
            out = self.run_cli("apply")
        finally:
            os.environ.pop("THESIS_HARNESS_CONFIG")
        self.assertNotIn("✗", out)
        texts = [p.text for p in docx.Document(str(self.tmp / "names.revised.docx")).paragraphs]
        self.assertIn("Mentor (Concierge)", texts)
        self.assertIn("Mentor отговаря, а Mentor делегира към Odysseus и Mnemosyne. Пак Mentor.", texts)

    def test_inserts_after_same_anchor_keep_order_and_code(self):
        self.run_cli("scan", str(self.doc_path))
        anchor = next(p for p in extract(self.doc_path).paras if p.text.startswith("Фигура 1.")).key
        review = self.tmp / "r.yaml"
        review.write_text(
            f"- {{para: '{anchor}', kind: insert_after, new: 'Първи.', source: user, rationale: r}}\n"
            f"- {{para: '{anchor}', kind: insert_after, new: 'Втори.', source: user, rationale: r}}\n"
            f"- {{para: '{anchor}', kind: insert_after, new: \"const a = 1;\\nconst b = 2;\", code: true, source: user, rationale: r}}\n",
            encoding="utf-8")
        self.run_cli("propose", str(review))
        self.run_cli("approve", *[p["id"] for p in self.proposals() if p["source"] == "user"])
        self.assertNotIn("✗", self.run_cli("apply"))
        d = docx.Document(str(self.tmp / "thesis.revised.docx"))
        texts = [p.text for p in d.paragraphs]
        i = texts.index("Фигура 1. Архитектура")
        self.assertEqual(texts[i + 1: i + 4], ["Първи.", "Втори.", "const a = 1;\nconst b = 2;"])
        code = d.paragraphs[i + 3].runs[0]
        self.assertEqual(code.font.name, "Consolas")

    def _diagram_repo(self):
        root = self.repo / "docs/diploma/diagrams"
        (root / "src").mkdir(parents=True)
        (root / "out").mkdir()
        (self.repo / "src/server/db/schemas").mkdir(parents=True)
        (self.repo / "src/server/db/schemas/a.ts").write_text(
            'export const users = createTable("user", (d) => ({\n'
            '    id: d.varchar({ length: 255 }).primaryKey(),\n'
            '    name: d.varchar({ length: 255 }),\n'
            '}));\n'
            'export const tasks = createTable("tasks", (d) => ({\n'
            '    id: integer("id").primaryKey(),\n'
            '    createdById: d\n      .varchar({ length: 255 })\n      .references(() => users.id),\n'
            '}));\n', encoding="utf-8")
        for n in range(1, 7):
            (self.repo / f"src/server/llm/orchestrator/a{n}Agent.ts").unlink()
        (self.repo / "src/server/llm/orchestrator/a1A.ts").write_text("//", encoding="utf-8")
        (self.repo / "src/app/dashboard").mkdir(parents=True)
        (self.repo / "src/app/dashboard/page.tsx").write_text("//", encoding="utf-8")
        (root / "src/er.mmd").write_text(
            "erDiagram\n  user {\n    varchar id PK\n    varchar nickname\n  }\n  tasks {\n    integer id PK\n  }\n"
            "  ghosts {\n    integer id\n  }\n  user ||--o{ tasks : createdById\n", encoding="utf-8")
        (root / "src/arch.mmd").write_text(
            'flowchart TB\n  a["PostgreSQL (3 таблици)"] --> b["A1 решава"]\n  c["/dashboard"] --> d["/nowhere"]\n', encoding="utf-8")
        (root / "diagrams.yaml").write_text(
            "diagrams:\n  - {id: er, figure: 1, caption: ER, file: src/er.mmd, checks: [er]}\n"
            "  - {id: arch, figure: 2, caption: Архитектура, file: src/arch.mmd, checks: [routes]}\n", encoding="utf-8")
        return root

    def test_diagram_checks(self):
        from thesis_harness.diagrams import er_model, visible_text
        self._diagram_repo()
        self.run_cli("diagrams", "scan", "--no-render")
        f = json.loads((self.tmp / "work/diagrams/findings.json").read_text(encoding="utf-8"))["findings"]
        msgs = " | ".join(x["message"] for x in f)
        self.assertIn("ghosts", msgs)             # entity not in schema
        self.assertIn("user.nickname", msgs)      # column not in schema
        self.assertIn("3 таблици", msgs)           # schema has 2
        self.assertIn("/nowhere", msgs)            # route not in src/app
        self.assertIn("„A1“ → „Mentor“", msgs)     # agent code in a diagram
        self.assertNotIn("/dashboard“ няма", msgs)
        self.assertEqual(er_model("erDiagram\n  a {\n    int x\n  }\n")["a"], ["x"])
        self.assertIn("Мент", visible_text('flowchart LR\n  a["Мент<br>ор"]'))

    def test_diagram_apply_writes_source(self):
        root = self._diagram_repo()
        self.run_cli("diagrams", "scan", "--no-render")
        import yaml
        props = yaml.safe_load((self.tmp / "work/diagrams/proposals.yaml").read_text(encoding="utf-8"))
        fix = next(p for p in props if p["source"] == "check:dgm.numbers")
        self.run_cli("--doc-slug", "diagrams", "approve", fix["id"])
        os.environ["THESIS_HARNESS_SKIP_RENDER"] = "1"
        try:
            self.run_cli("--doc-slug", "diagrams", "apply")
        finally:
            os.environ.pop("THESIS_HARNESS_SKIP_RENDER")
        self.assertIn("2 таблици", (root / "src/arch.mmd").read_text(encoding="utf-8"))

    def test_replace_image_in_docx(self):
        from PIL import Image
        d = docx.Document()
        img = self.tmp / "old.png"
        Image.new("RGB", (40, 20), "white").save(img)
        d.add_paragraph().add_run().add_picture(str(img))
        d.add_paragraph("Фигура 1. Нещо")
        d.save(str(self.doc_path))
        new = self.repo / "fig.png"
        Image.new("RGB", (100, 200), "red").save(new)
        self.run_cli("scan", str(self.doc_path))
        key = [p for p in extract(self.doc_path).paras if p.text.startswith("Фигура 1.")][0].key
        review = self.tmp / "r.yaml"
        review.write_text(f"- {{para: '{key}', kind: replace_image, figure: 1, image: fig.png, source: user, rationale: r}}\n",
                          encoding="utf-8")
        self.run_cli("propose", str(review))
        self.run_cli("approve", "all")
        self.assertNotIn("✗", self.run_cli("apply"))
        out = docx.Document(str(self.tmp / "thesis.revised.docx"))
        blobs = [r.target_part.blob for r in out.part.rels.values() if "image" in r.reltype]
        self.assertTrue(any(b == new.read_bytes() for b in blobs))
        shape = out.inline_shapes[0]
        self.assertAlmostEqual(shape.height / shape.width, 2.0, places=2)

    def test_apply_is_clean_and_keeps_formatting(self):
        self.run_cli("scan", str(self.doc_path))
        props = self.proposals()
        version = next(p for p in props if p["source"] == "check:code.stack-versions")
        chain = next(p for p in props if p["source"] == "check:text.mixed-script")
        anchor = chain["para"]
        review = self.tmp / "r.yaml"
        review.write_text(
            f"- {{para: '{anchor}', kind: insert_after, new: \"\\tНов абзац.\", source: user, rationale: r}}\n",
            encoding="utf-8")
        self.run_cli("propose", str(review))
        new_id = self.proposals()[-1]["id"]
        self.run_cli("approve", version["id"], chain["id"], new_id)
        out = self.run_cli("apply")
        self.assertNotIn("✗", out)
        revised = self.tmp / "thesis.revised.docx"
        self.assertTrue(revised.exists())
        self.assertEqual(extract(self.doc_path).paras[2].text.count("Next.js 15"), 1, "original untouched")
        d = docx.Document(str(revised))
        para = next(p for p in d.paragraphs if "Next.js" in p.text)
        self.assertIn("Next.js 16", para.text)
        self.assertTrue(next(r for r in para.runs if "Next.js" in r.text).bold, "formatting of the edited run kept")
        texts = [p.text for p in d.paragraphs]
        self.assertIn("\tНов абзац.", texts)  # python-docx reads w:tab back as \t
        self.assertEqual(texts.index("\tНов абзац."), next(i for i, t in enumerate(texts) if "chain" in t) + 1)
        self.assertNotIn("\t", "".join(t.text or "" for t in d.element.body.iter(
            "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t")))
        xml = d.element.xml
        self.assertNotIn("w:ins ", xml)
        self.assertNotIn("w:highlight", xml)

    def test_reingest_marks_applied_as_merged(self):
        self.run_cli("scan", str(self.doc_path))
        version = next(p for p in self.proposals() if p["source"] == "check:code.stack-versions")
        self.run_cli("approve", version["id"])
        self.run_cli("apply")
        out = self.run_cli("ingest", str(self.tmp / "thesis.revised.docx"))
        self.assertIn("влезли 1", out)
        merged = next(p for p in self.proposals() if p["id"] == version["id"])
        self.assertEqual(merged["status"], "merged")

    def test_edit_requires_reapproval(self):
        self.run_cli("scan", str(self.doc_path))
        version = next(p for p in self.proposals() if p["source"] == "check:code.stack-versions")
        self.run_cli("approve", version["id"])
        self.run_cli("edit", version["id"], "--new", "Next.js 16 (App Router)", "--note", "уточни")
        p = next(p for p in self.proposals() if p["id"] == version["id"])
        self.assertEqual(p["status"], "proposed")
        self.assertEqual(p["user_note"], "уточни")

    def test_requirements_quotes_must_exist(self):
        src = self.tmp / "naredba.txt"
        src.write_text("Дипломният проект съдържа увод, изложение и заключение.\nОбемът е до 60 страници.", encoding="utf-8")
        self.run_cli("requirements", "import", str(src))
        rules = self.tmp / "req/rules.yaml"
        import yaml
        data = yaml.safe_load(rules.read_text(encoding="utf-8"))
        data["rules"] = [
            {"id": "R01", "title": "Структура", "quote": "съдържа увод, изложение и заключение", "doc": "D1", "page": 1,
             "check": "req.required-headings", "params": {"headings": ["УВОД", "ЗАКЛЮЧЕНИЕ"]}},
            {"id": "R02", "title": "Измислено", "quote": "шрифт Times New Roman 14 пункта", "page": 1, "check": "semantic"},
        ]
        rules.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")
        with self.assertRaises(AssertionError) as ctx:
            self.run_cli("requirements", "validate")
        self.assertIn("R02", str(ctx.exception))
        self.assertNotIn("R01:", str(ctx.exception))
        data["rules"].pop()
        rules.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")
        self.run_cli("requirements", "validate")
        self.run_cli("scan", str(self.doc_path))
        req = [x for x in self.findings() if x.get("rule") == "R01"]
        self.assertEqual(len(req), 2)  # neither heading exists in the synthetic document
        self.assertIn("съдържа увод", req[0]["evidence"][0])

    def test_profiles_keep_requirement_sets_apart(self):
        a, b = self.tmp / "a.txt", self.tmp / "b.txt"
        a.write_text("Изискване за дипломната работа.", encoding="utf-8")
        b.write_text("Изискване за защитата на концепцията.", encoding="utf-8")
        self.run_cli("requirements", "import", str(a))
        self.run_cli("--profile", "defense", "requirements", "import", str(b))
        main = (self.tmp / "req/source.txt").read_text(encoding="utf-8")
        defense = (self.tmp / "req/defense/source.txt").read_text(encoding="utf-8")
        self.assertIn("дипломната", main)
        self.assertNotIn("защитата", main)
        self.assertIn("защитата", defense)

    def test_plugin_directory_is_loaded(self):
        plugins = self.tmp / "plugins"
        plugins.mkdir()
        (plugins / "todo.py").write_text(
            "from thesis_harness.checks import Check, Finding, register\n"
            "@register\n"
            "class Todo(Check):\n"
            "    id = 'test.todo'\n"
            "    def run(self, ctx):\n"
            "        for p in ctx.prose:\n"
            "            if 'production' in p.text:\n"
            "                yield Finding(self.id, 'info', 'found', para=p.key, evidence=['x'])\n",
            encoding="utf-8")
        cfg = self.tmp / "harness.yaml"
        cfg.write_text(f"checks:\n  plugin_dirs: ['{plugins.as_posix()}']\n", encoding="utf-8")
        os.environ["THESIS_HARNESS_CONFIG"] = str(cfg)
        try:
            self.run_cli("scan", str(self.doc_path))
        finally:
            os.environ.pop("THESIS_HARNESS_CONFIG")
        self.assertTrue(any(x["check"] == "test.todo" for x in self.findings()))


if __name__ == "__main__":
    unittest.main(verbosity=2)

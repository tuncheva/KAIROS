"""Deterministic checks and the plugin mechanism.

Writing a check
---------------

Drop a ``.py`` file into ``thesis-harness/plugins/`` (or any directory listed in
``checks.plugin_dirs``)::

    from thesis_harness.checks import Check, Finding, register

    @register
    class MyCheck(Check):
        id = "my.check"
        title = "Кратко име"
        description = "Какво проверява."

        def run(self, ctx):
            for p in ctx.prose:
                if "TODO" in p.text:
                    yield Finding(self.id, "warning", "Остана TODO", para=p.key,
                                  excerpt="TODO", evidence=[f"¶{p.index}"])

A finding with ``fix`` becomes a proposal the user can approve. A finding with
``lead=True`` is a hint for Claude's semantic review rather than a proposal on
its own (e.g. "this paragraph states an agent count — verify it"). Anything
else becomes a ``note`` proposal: a problem to fix by hand.

Options for a check come from ``checks.options.<id>`` in ``harness.yaml`` and
are available as ``ctx.options``. Disable a check with ``checks.disabled``.

Requirement checks (``requirement = True``) never run on their own. They run
once per rule in ``requirements/rules.yaml`` that names them, with the rule's
``params`` as options, so every requirement check traces to a quoted rule.
"""

from __future__ import annotations

import importlib
import importlib.util
import pkgutil
import sys
from dataclasses import asdict, dataclass, field
from functools import cached_property
from pathlib import Path
from typing import Iterable

from ..docmodel import DocModel, Para

SEVERITIES = ("error", "warning", "info")


@dataclass
class Finding:
    check: str
    severity: str
    message: str
    para: str | None = None
    excerpt: str | None = None
    evidence: list[str] = field(default_factory=list)
    fix: dict | None = None  # {"kind": "replace", "old": ..., "new": ...}
    lead: bool = False
    rule: str | None = None

    def to_dict(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v not in (None, [], False)}


@dataclass
class Context:
    doc: DocModel
    facts: dict
    repo: Path
    options: dict
    source_path: Path | None = None
    _shared: dict = field(default_factory=dict)

    @property
    def prose(self) -> list[Para]:
        return self.doc.prose()

    @cached_property
    def by_key(self) -> dict[str, Para]:
        return self.doc.by_key()

    def shared(self, key: str, factory):
        """Cache something expensive (e.g. a source index) across checks."""
        if key not in self._shared:
            self._shared[key] = factory()
        return self._shared[key]


class Check:
    id: str = ""
    title: str = ""
    description: str = ""
    requirement: bool = False

    def run(self, ctx: Context) -> Iterable[Finding]:  # pragma: no cover - interface
        raise NotImplementedError


REGISTRY: dict[str, type[Check]] = {}


def register(cls: type[Check]) -> type[Check]:
    if not cls.id:
        raise ValueError(f"{cls.__name__} няма id")
    REGISTRY[cls.id] = cls
    return cls


def load_checks(plugin_dirs: list[Path]) -> dict[str, type[Check]]:
    pkg = sys.modules[__name__]
    for mod in pkgutil.iter_modules(pkg.__path__):
        importlib.import_module(f"{__name__}.{mod.name}")
    for d in plugin_dirs:
        if not d.exists():
            continue
        for f in sorted(d.glob("*.py")):
            if f.name.startswith("_"):
                continue
            spec = importlib.util.spec_from_file_location(f"thesis_plugins.{f.stem}", f)
            module = importlib.util.module_from_spec(spec)
            sys.modules[spec.name] = module
            spec.loader.exec_module(module)
    return REGISTRY


def run_check(check: Check, ctx: Context) -> tuple[list[Finding], str | None]:
    try:
        findings = list(check.run(ctx) or [])
        for f in findings:
            if f.severity not in SEVERITIES:
                f.severity = "warning"
        return findings, None
    except Exception as e:  # noqa: BLE001 - one broken check must not hide the others
        return [], f"{check.id}: {type(e).__name__}: {e}"

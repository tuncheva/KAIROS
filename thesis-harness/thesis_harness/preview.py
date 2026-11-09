"""``preview``: a self-contained HTML page that shows every open proposal inside
its paragraph — deleted text struck through, new text underlined — with the
reason and the evidence. The page lets the author mark decisions and copies them
as one chat message ("одобри P3, P11; отхвърли P51"); decisions are recorded by
the harness from that message, never by the page."""

from __future__ import annotations

import json
from pathlib import Path

from . import proposals as props
from .workspace import Workspace, read_yaml

_TEMPLATE = Path(__file__).with_name("preview_template.html")


def _mermaid_config(ws: Workspace) -> dict:
    from . import diagrams as dg
    conf = dg.repo_dir(ws.config) / "mermaid.json"
    return json.loads(conf.read_text(encoding="utf-8")) if conf.exists() else {}


def build(ws: Workspace) -> Path:
    doc = ws.doc()
    by_key = doc.by_key()
    items = props.load(ws)
    state = ws.state()

    diagram_png = {}
    if state.get("kind") == "diagrams":
        import base64

        from . import diagrams as dg
        dg_repo, dg_items = dg.load(ws.config)
        for d in dg_items:
            png = d.out("png", dg_repo)
            if png.exists():
                diagram_png[d.id] = "data:image/png;base64," + base64.b64encode(png.read_bytes()).decode()

    def context(p: dict) -> dict:
        para = by_key.get(str(p.get("para"))) if p.get("para") else None
        out = {"index": para.index if para else None, "text": para.text if para else ""}
        if str(p.get("para")) in diagram_png:
            out["image"] = diagram_png[str(p.get("para"))]
        if p["kind"] == "replace_image":
            import base64

            from .proposals import _image_path
            img = _image_path(p.get("image", ""))
            if img.exists():
                out["image"] = "data:image/png;base64," + base64.b64encode(img.read_bytes()).decode()
        if para is not None and p["kind"] == "insert_after":
            out["after_style"] = para.kind
        return out

    data = {
        "document": state.get("source_name", ""),
        "version": state.get("version"),
        "commit": (state.get("repo") or {}).get("commit"),
        "proposals": [
            {
                "id": p["id"], "status": p["status"], "severity": p.get("severity", "warning"),
                "kind": p["kind"], "source": p.get("source", ""), "section": p.get("section") or "Общи бележки",
                "old": p.get("old"), "new": p.get("new"), "all": bool(p.get("all")), "code": bool(p.get("code")),
                "rationale": p.get("rationale", ""), "evidence": p.get("evidence") or [],
                "user_note": p.get("user_note", ""), "para": context(p),
            }
            for p in items
            if p["status"] in ("proposed", "approved", "failed")
        ],
        "requirements": read_yaml(ws.p("requirements-results.yaml"), []) or [],
        "kind": state.get("kind", "document"),
        "mermaid_config": _mermaid_config(ws) if state.get("kind") == "diagrams" else None,
    }
    data["proposals"].sort(key=lambda x: (x["para"]["index"] if x["para"]["index"] is not None else 10**6, x["id"]))
    for r in data["requirements"]:
        r.pop("by_part", None)
    html = _TEMPLATE.read_text(encoding="utf-8")
    payload = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    out = ws.p("preview.html")
    out.write_text(html.replace("/*__DATA__*/null", payload), encoding="utf-8")
    return out

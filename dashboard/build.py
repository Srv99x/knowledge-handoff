#!/usr/bin/env python3
"""Bundle the dashboard into a single self-contained HTML file.

The output dashboard.html embeds every report as JSON plus the CSS and JS,
so it can be double-clicked / opened without any server (file:// works).

Usage:
    python3 dashboard/build.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUTPUTS = ROOT.parent / "backend" / "outputs"

REPORTS = [
    "contributor_report.json",
    "complexity_report.json",
    "documentation_report.json",
    "risk_report.json",
    "onboarding_report.json",
    "extraction_report.json",
]


def main():
    bundle = {}
    for name in REPORTS:
        path = OUTPUTS / name
        if path.exists():
            bundle[name.split("_")[0]] = json.loads(
                path.read_text(encoding="utf-8-sig")
            )

    html = (ROOT / "index.html").read_text(encoding="utf-8")
    css = (ROOT / "styles.css").read_text(encoding="utf-8")
    js = (ROOT / "app.js").read_text(encoding="utf-8")

    payload = json.dumps(bundle, ensure_ascii=False)
    inline = (
        "<style>\n"
        + css
        + '\n</style>\n<script>window.INLINE_REPORTS = '
        + payload
        + ";</script>\n<script>\n"
        + js
        + "\n</script>"
    )

    html = html.replace('<link rel="stylesheet" href="styles.css">', "")
    html = html.replace('<script src="app.js"></script>', inline)
    title = f"Knowledge Continuity Suite — Dashboard ({len(bundle)} reports embedded)"
    html = html.replace("Knowledge Continuity Suite — Dashboard", title)

    out = ROOT / "dashboard.html"
    out.write_text(html, encoding="utf-8")
    print(f"Wrote {out} ({out.stat().st_size / 1024:.0f} KB, {len(bundle)} reports inlined).")


if __name__ == "__main__":
    main()
#!/usr/bin/env python3
"""Zero-dependency dashboard server.

Serves the dashboard UI and exposes the report JSON over /api for the frontend.
Usage:
    python3 dashboard/server.py            # http://127.0.0.1:8765
    python3 dashboard/server.py 9000
"""
import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parent
OUTPUTS = PROJECT / "backend" / "outputs"

REPORTS = [
    "contributor_report.json",
    "complexity_report.json",
    "documentation_report.json",
    "risk_report.json",
    "onboarding_report.json",
    "extraction_report.json",
]


def load_all():
    bundle = {}
    for name in REPORTS:
        path = OUTPUTS / name
        if path.exists():
            bundle[name.split("_")[0]] = json.loads(
                path.read_text(encoding="utf-8-sig")
            )
    return {"reports": bundle, "project": PROJECT.name}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        if self.path == "/api/all":
            body = json.dumps(load_all(), ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def log_message(self, fmt, *args):
        sys.stdout.write("[dashboard] " + fmt % args + "\n")


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    host = "127.0.0.1"
    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f"Serving Knowledge Continuity Suite dashboard at http://{host}:{port}")
    print(f"Reports directory: {OUTPUTS}")
    print("Press Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
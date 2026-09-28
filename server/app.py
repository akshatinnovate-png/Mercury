"""
MERCURY — development server.

Serves the interface and stubs the endpoints the interpreter will use.
No model is attached yet: this build is the interface only, and every
route below answers with the shape the real thing will answer with.

    python server/app.py            # http://127.0.0.1:8000
    python server/app.py 5500       # pick another port if 8000 is taken
"""

from __future__ import annotations

import json
import mimetypes
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOST, PORT = "127.0.0.1", 8000

# The 21 landmarks Mercury solves for, in MediaPipe order.
LANDMARKS = [
    "WRIST",
    "THUMB_CMC", "THUMB_MCP", "THUMB_IP", "THUMB_TIP",
    "INDEX_MCP", "INDEX_PIP", "INDEX_DIP", "INDEX_TIP",
    "MIDDLE_MCP", "MIDDLE_PIP", "MIDDLE_DIP", "MIDDLE_TIP",
    "RING_MCP", "RING_PIP", "RING_DIP", "RING_TIP",
    "PINKY_MCP", "PINKY_PIP", "PINKY_DIP", "PINKY_TIP",
]

PIPELINE = [
    {"id": "01", "name": "CAPTURE",   "detail": "Camera frames in, 60 per second, never stored."},
    {"id": "02", "name": "LANDMARKS", "detail": "21 points per hand, solved on device."},
    {"id": "03", "name": "TEMPORAL",  "detail": "A 16-frame window — movement is meaning."},
    {"id": "04", "name": "FACE",      "detail": "Brow, mouth and gaze carry the grammar."},
    {"id": "05", "name": "DECODE",    "detail": "Sequence model resolves the utterance."},
    {"id": "06", "name": "GLOSS",     "detail": "Signed order becomes written order."},
    {"id": "07", "name": "VOICE",     "detail": "Spoken aloud in the signer's cadence."},
]


class Mercury(SimpleHTTPRequestHandler):
    """Static files, plus a small JSON surface the front end can grow into."""

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    # ---- routing -------------------------------------------------
    def do_GET(self):  # noqa: N802  (stdlib naming)
        routes = {
            "/api/health":   lambda: {"status": "ok", "stage": "interface-build", "model": None},
            "/api/topology": lambda: {"landmarks": LANDMARKS, "bones": 20},
            "/api/pipeline": lambda: {"stages": PIPELINE},
        }
        handler = routes.get(self.path.split("?")[0])
        if handler:
            return self._json(handler())
        return super().do_GET()

    def do_POST(self):  # noqa: N802
        if self.path.split("?")[0] != "/api/interpret":
            self.send_error(404)
            return
        # Placeholder: the interpreter is not wired up in this build.
        self._json(
            {
                "ok": False,
                "reason": "no model attached in the interface build",
                "expects": {"frames": "list[list[[x, y, z] * 21]]", "fps": "int"},
                "returns": {"gloss": "list[str]", "text": "str", "confidence": "float"},
            },
            status=501,
        )

    # ---- helpers -------------------------------------------------
    def _json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload, indent=2).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self) -> None:
        # ES modules and a fast edit loop both want these.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))


def main() -> None:
    mimetypes.add_type("text/javascript", ".js")
    port = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    try:
        server = HTTPServer((HOST, port), Mercury)
    except OSError as exc:
        # Port 8000 is a popular default; say so plainly instead of a traceback.
        print(f"\n  Port {port} is not free ({exc.strerror}).")
        print(f"  Try another one:  python server/app.py {port + 1}\n")
        raise SystemExit(1)

    print(f"\n  MERCURY — interface build\n  http://{HOST}:{port}\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  stopped\n")


if __name__ == "__main__":
    main()

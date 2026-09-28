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
import os
import sys
import urllib.error
import urllib.request
from http.server import HTTPServer, ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOST, PORT = "127.0.0.1", 8000

# The key stays on this side. The browser never sees it, and the page
# talks only to /api/llm on this server.
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")
GROQ_KEY = os.environ.get("GROQ_API_KEY", "").strip()

# Mercury sends fingerspelled letters, which arrive without spaces, without
# punctuation and with the odd misread. The model's whole job is to turn that
# into the sentence the signer meant.
SYSTEM_PROMPT = """You reconstruct sentences from American Sign Language fingerspelling.

The input is a raw stream of recognised letters. It may contain no spaces, missing letters, or letters misread as visually similar ones (M/N, S/T, U/V, A/E, D/Z, I/J, K/P, G/Q are the common confusions).

Return ONLY the most likely intended sentence:
- insert word boundaries and punctuation
- correct letters that were clearly misread
- use normal sentence capitalisation
- never add information that is not implied by the letters
- if the letters cannot form sensible words, return your best literal reading

Reply with the sentence and nothing else. No quotes, no explanation."""

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
            "/api/health": lambda: {
                "status": "ok",
                "llm": {
                    "configured": bool(GROQ_KEY),
                    "model": GROQ_MODEL if GROQ_KEY else None,
                },
            },
            "/api/topology": lambda: {"landmarks": LANDMARKS, "bones": 20},
            "/api/pipeline": lambda: {"stages": PIPELINE},
        }
        handler = routes.get(self.path.split("?")[0])
        if handler:
            return self._json(handler())
        return super().do_GET()

    def do_POST(self):  # noqa: N802
        route = self.path.split("?")[0]
        if route == "/api/llm":
            return self._llm()
        self.send_error(404)

    # ---- language model ------------------------------------------
    def _llm(self) -> None:
        """Proxy a completion to Groq. Degrades to a clear 'off' rather than
        an error, so the studio keeps working with the model unavailable."""
        try:
            size = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(size) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return self._json({"ok": False, "reason": "bad request body"}, 400)

        text = str(body.get("text", ""))[:4000].strip()
        if not text:
            return self._json({"ok": False, "reason": "nothing to interpret"}, 400)

        # The environment variable is the documented path. A key sent from the
        # page is accepted as a convenience because this server only ever
        # listens on loopback, and it is never written to disk.
        key = GROQ_KEY or (self.headers.get("X-Mercury-Key") or "").strip()

        if not key:
            return self._json(
                {
                    "ok": False,
                    "reason": "no-key",
                    "detail": "Set GROQ_API_KEY in the environment to enable sentence repair.",
                },
                503,
            )

        payload = {
            "model": GROQ_MODEL,
            "messages": [
                {"role": "system", "content": body.get("system") or SYSTEM_PROMPT},
                {"role": "user", "content": text},
            ],
            "temperature": 0.2,
            "max_tokens": 300,
        }
        req = urllib.request.Request(
            GROQ_URL,
            data=json.dumps(payload).encode(),
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=25) as res:
                data = json.loads(res.read())
            out = data["choices"][0]["message"]["content"].strip()
            usage = data.get("usage", {})
            return self._json(
                {
                    "ok": True,
                    "text": out,
                    "model": data.get("model", GROQ_MODEL),
                    "tokens": usage.get("total_tokens"),
                }
            )
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="replace")[:400]
            return self._json(
                {"ok": False, "reason": f"groq {exc.code}", "detail": detail}, 502
            )
        except Exception as exc:  # network down, DNS, timeout
            return self._json(
                {"ok": False, "reason": "unreachable", "detail": str(exc)[:200]}, 502
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
        # getUserMedia and the MediaPipe WASM both need a trustworthy origin;
        # localhost already counts, and these let the model load cross-thread.
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "credentialless")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))


def main() -> None:
    mimetypes.add_type("text/javascript", ".js")
    port = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    try:
        server = ThreadingHTTPServer((HOST, port), Mercury)
    except OSError as exc:
        # Port 8000 is a popular default; say so plainly instead of a traceback.
        print(f"\n  Port {port} is not free ({exc.strerror}).")
        print(f"  Try another one:  python server/app.py {port + 1}\n")
        raise SystemExit(1)

    state = f"sentence repair: {GROQ_MODEL}" if GROQ_KEY else "sentence repair: off (set GROQ_API_KEY)"
    print(f"\n  MERCURY\n  http://{HOST}:{port}\n  {state}\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  stopped\n")


if __name__ == "__main__":
    main()

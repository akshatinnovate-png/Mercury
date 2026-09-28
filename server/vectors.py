"""
MERCURY — the vector layer.

Two things live in Qdrant, and both earn their place:

1. `calibration` — the signer's own hands.
   A model trained on synthetic poses has never seen a real hand. Rather
   than pretend that gap does not exist, Mercury lets a person record
   their own version of each letter. Those encodings go in here, and
   recognition queries them by nearest neighbour. A signer with unusual
   proportions, limited mobility, or a regional variant gets a system
   that adapts to them instead of the other way round.

2. `transcript` — everything that has been said.
   Sentences are embedded and stored so a conversation can be searched
   by meaning later, not just scrolled.

Runs embedded by default: a local on-disk Qdrant with no server and no
container, so the whole thing works from a clean clone. Point
QDRANT_URL at a cluster and the same code talks to that instead.
"""

from __future__ import annotations

import hashlib
import math
import os
import re
import threading
import time
import uuid
from typing import Any

POSE_DIM = 83          # must match ENCODE_DIM in assets/js/studio/encode.js
TEXT_DIM = 256         # hashed lexical embedding

QDRANT_URL = os.environ.get("QDRANT_URL", "").strip()
QDRANT_KEY = os.environ.get("QDRANT_API_KEY", "").strip()
QDRANT_PATH = os.environ.get(
    "QDRANT_PATH", os.path.join(os.path.dirname(__file__), "..", ".qdrant")
)

_lock = threading.Lock()
_client = None
_status: dict[str, Any] = {"available": False, "mode": None, "reason": "not started"}


# ----------------------------------------------------------------- text
_TOKEN = re.compile(r"[a-z0-9']+")


def embed_text(text: str) -> list[float]:
    """
    A hashed bag of words and character trigrams, L2 normalised.

    Deliberately not a neural embedder: this has to work on a clean
    clone with no network and no model download. It captures lexical
    overlap, which is what makes "find where I mentioned the pharmacy"
    work. It does not capture paraphrase, and the search UI says so.
    """
    vec = [0.0] * TEXT_DIM
    low = text.lower()
    words = _TOKEN.findall(low)

    def bump(token: str, weight: float) -> None:
        h = hashlib.blake2b(token.encode(), digest_size=8).digest()
        idx = int.from_bytes(h[:4], "little") % TEXT_DIM
        sign = 1.0 if h[4] & 1 else -1.0
        vec[idx] += weight * sign

    for w in words:
        bump(w, 1.0)
    for w in words:                      # trigrams catch typos and inflection
        padded = f"  {w} "
        for i in range(len(padded) - 2):
            bump(padded[i : i + 3], 0.35)

    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


# --------------------------------------------------------------- client
def _connect():
    global _client, _status
    if _client is not None:
        return _client
    with _lock:
        if _client is not None:
            return _client
        try:
            from qdrant_client import QdrantClient
            from qdrant_client.models import Distance, VectorParams

            if QDRANT_URL:
                client = QdrantClient(url=QDRANT_URL, api_key=QDRANT_KEY or None, timeout=10)
                mode = f"remote ({QDRANT_URL})"
            else:
                os.makedirs(QDRANT_PATH, exist_ok=True)
                client = QdrantClient(path=QDRANT_PATH)
                mode = "embedded"

            for name, dim in (("calibration", POSE_DIM), ("transcript", TEXT_DIM)):
                existing = {c.name for c in client.get_collections().collections}
                if name not in existing:
                    client.create_collection(
                        collection_name=name,
                        vectors_config=VectorParams(size=dim, distance=Distance.COSINE),
                    )

            _client = client
            _status = {"available": True, "mode": mode, "reason": None}
        except Exception as exc:
            _status = {"available": False, "mode": None, "reason": f"{type(exc).__name__}: {exc}"}
            _client = False
    return _client


def status() -> dict:
    _connect()
    return dict(_status)


# ----------------------------------------------------------- operations
def add_calibration(letter: str, vectors: list[list[float]], session: str) -> dict:
    """Store one or more encodings of a letter as signed by this person."""
    client = _connect()
    if not client:
        return {"ok": False, "reason": _status["reason"]}
    from qdrant_client.models import PointStruct

    now = time.time()
    points = [
        PointStruct(
            id=uuid.uuid4().hex,
            vector=[float(x) for x in v],
            payload={"letter": letter, "session": session, "ts": now},
        )
        for v in vectors
        if len(v) == POSE_DIM
    ]
    if not points:
        return {"ok": False, "reason": f"expected {POSE_DIM}-dim vectors"}
    client.upsert(collection_name="calibration", points=points, wait=True)
    return {"ok": True, "stored": len(points), "letter": letter}


def query_calibration(vector: list[float], k: int = 9, session: str | None = None) -> dict:
    """
    Nearest neighbours among this person's own recorded hands.

    The caller turns these into a vote. A signer who has calibrated gets
    their own examples pulling the decision; one who has not gets an
    empty list and the parametric path alone.
    """
    client = _connect()
    if not client or len(vector) != POSE_DIM:
        return {"ok": False, "neighbours": [], "reason": _status.get("reason")}
    try:
        hits = client.query_points(
            collection_name="calibration",
            query=[float(x) for x in vector],
            limit=k,
            with_payload=True,
        ).points
    except Exception as exc:
        return {"ok": False, "neighbours": [], "reason": str(exc)[:160]}

    return {
        "ok": True,
        "neighbours": [
            {"letter": h.payload.get("letter"), "score": float(h.score)} for h in hits
        ],
    }


def calibration_summary() -> dict:
    client = _connect()
    if not client:
        return {"ok": False, "letters": {}, "total": 0}
    try:
        counts: dict[str, int] = {}
        offset = None
        total = 0
        while True:
            batch, offset = client.scroll(
                collection_name="calibration", limit=512, offset=offset, with_payload=True
            )
            for p in batch:
                letter = p.payload.get("letter")
                counts[letter] = counts.get(letter, 0) + 1
                total += 1
            if offset is None:
                break
        return {"ok": True, "letters": counts, "total": total}
    except Exception as exc:
        return {"ok": False, "letters": {}, "total": 0, "reason": str(exc)[:160]}


def clear_calibration() -> dict:
    client = _connect()
    if not client:
        return {"ok": False}
    from qdrant_client.models import Distance, VectorParams

    client.delete_collection("calibration")
    client.create_collection(
        collection_name="calibration",
        vectors_config=VectorParams(size=POSE_DIM, distance=Distance.COSINE),
    )
    return {"ok": True}


def add_transcript(text: str, raw: str, session: str) -> dict:
    client = _connect()
    if not client or not text.strip():
        return {"ok": False}
    from qdrant_client.models import PointStruct

    client.upsert(
        collection_name="transcript",
        points=[
            PointStruct(
                id=uuid.uuid4().hex,
                vector=embed_text(text),
                payload={"text": text, "raw": raw, "session": session, "ts": time.time()},
            )
        ],
        wait=True,
    )
    return {"ok": True}


def search_transcript(query: str, k: int = 8) -> dict:
    client = _connect()
    if not client or not query.strip():
        return {"ok": False, "results": []}
    try:
        hits = client.query_points(
            collection_name="transcript",
            query=embed_text(query),
            limit=k,
            with_payload=True,
        ).points
    except Exception as exc:
        return {"ok": False, "results": [], "reason": str(exc)[:160]}

    return {
        "ok": True,
        "results": [
            {
                "text": h.payload.get("text"),
                "raw": h.payload.get("raw"),
                "ts": h.payload.get("ts"),
                "score": round(float(h.score), 4),
            }
            for h in hits
        ],
    }

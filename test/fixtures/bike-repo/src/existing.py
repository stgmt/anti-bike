"""Кэш ответов модели: код, который в проекте уже был."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


class ResponseCache:
    """Хранит ответы модели на диске по хешу входа."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
        return self.root / f"{digest}.json"

    def get(self, key: str) -> Any | None:
        path = self._path(key)
        if not path.exists():
            return None
        raw = path.read_text(encoding="utf-8")
        return json.loads(raw)

    def put(self, key: str, value: Any) -> None:
        path = self._path(key)
        payload = json.dumps(value, ensure_ascii=False, sort_keys=True)
        path.write_text(payload, encoding="utf-8")

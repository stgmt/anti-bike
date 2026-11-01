"""То же самое, написанное заново с другими именами — велосипед."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


class AnswerStore:
    """Сохраняет ответы рядом с прогоном."""

    def __init__(self, base: Path) -> None:
        self.base = base
        self.base.mkdir(parents=True, exist_ok=True)

    def _file(self, text: str) -> Path:
        value = hashlib.sha256(text.encode("utf-8")).hexdigest()
        return self.base / f"{value}.json"

    def load(self, text: str) -> Any | None:
        target = self._file(text)
        if not target.exists():
            return None
        body = target.read_text(encoding="utf-8")
        return json.loads(body)

    def save(self, text: str, data: Any) -> None:
        target = self._file(text)
        blob = json.dumps(data, ensure_ascii=False, sort_keys=True)
        target.write_text(blob, encoding="utf-8")

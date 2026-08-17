"""Shared helpers for the Phase 0 ETL scripts.

These run once, locally, to turn the ETS PDFs in Data/raw_cache/ into the
small JSON knowledge base under kb/. Nothing here runs in production.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "Data" / "raw_cache"
KB = ROOT / "kb"

# Curly quotes and dashes that ETS PDFs use; normalised so downstream string
# matching and JSON stay predictable. Essay text keeps its original wording --
# only the character encoding is normalised, never the words.
_PUNCT = {
    "‘": "'", "’": "'", "“": '"', "”": '"',
    "–": "-", "—": "--", "…": "...", " ": " ",
    "": "", "•": "",
}


def pdf_text(name: str) -> str:
    """Concatenated text of every page in a cached PDF."""
    reader = PdfReader(RAW / name)
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def normalise(text: str) -> str:
    """Collapse whitespace and fold ETS's typographic characters to ASCII."""
    for src, dst in _PUNCT.items():
        text = text.replace(src, dst)
    return re.sub(r"\s+", " ", text).strip()


_PAGE_LINE = re.compile(r"^\s*(?:-\s*)?\d{1,3}(?:\s*-)?\s*$")


def strip_page_furniture(text: str) -> str:
    """Drop page-number lines from raw PDF text, before whitespace collapse.

    ETS uses `- 17 -` in the practice-test booklets and a bare `3` in the
    sample-task PDFs. Both sit on their own line, so filtering line-wise is
    safe -- doing it after `normalise()` would also match the digit in
    "Score 6" and "a 6 response".
    """
    return "\n".join(
        line for line in text.splitlines() if not _PAGE_LINE.match(line)
    )


def sentences(text: str, count: int) -> str:
    """First `count` sentences of `text`, joined back together."""
    parts = re.split(r"(?<=\.)\s+", text)
    return " ".join(parts[:count]).strip()


def write_kb(filename: str, payload: object) -> Path:
    KB.mkdir(exist_ok=True)
    path = KB / filename
    path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return path

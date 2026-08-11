"""Patch DocsGPT shared-agent serialization to preserve multi-source bindings."""

from __future__ import annotations

import sys
from pathlib import Path


MARKER = '        "source": str(source_id) if source_id else "",\n'
REPLACEMENT = (
    MARKER
    + '        "sources": [\n'
    + '            str(source)\n'
    + '            for source in (agent.get("extra_source_ids") or [])\n'
    + '            if source\n'
    + '        ],\n'
)


def patch_source(source: str) -> str:
    if '"sources": [' in source:
        return source
    if MARKER not in source:
        raise RuntimeError("Expected shared-agent source serializer was not found")
    return source.replace(MARKER, REPLACEMENT, 1)


def main() -> None:
    target = Path(
        sys.argv[1]
        if len(sys.argv) > 1
        else "/app/application/api/user/agents/sharing.py"
    )
    original = target.read_text(encoding="utf-8")
    patched = patch_source(original)
    target.write_text(patched, encoding="utf-8")


if __name__ == "__main__":
    main()

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


SENSITIVE_KEYS = {
    "api_key",
    "authorization",
    "conversation_id",
    "internal_key",
    "session_id",
    "shared_agent_token",
}


def sanitize(value: Any) -> Any:
    if isinstance(value, dict):
        sanitized = {
            key: sanitize(item)
            for key, item in value.items()
            if key.lower() not in SENSITIVE_KEYS
        }
        if "conversation_id" in value:
            sanitized["conversation_id_redacted"] = True
        return sanitized
    if isinstance(value, list):
        return [sanitize(item) for item in value]
    return value


def sanitize_jsonl(source: Path, destination: Path) -> int:
    destination.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with source.open("r", encoding="utf-8") as source_file, destination.open(
        "w", encoding="utf-8", newline="\n"
    ) as destination_file:
        for line_number, line in enumerate(source_file, start=1):
            if not line.strip():
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError as error:
                raise ValueError(f"{source}:{line_number} 不是有效 JSON") from error
            destination_file.write(json.dumps(sanitize(record), ensure_ascii=False) + "\n")
            count += 1
    return count


def main() -> None:
    parser = argparse.ArgumentParser(description="生成可公开提交的脱敏 RAG JSONL 证据")
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    count = sanitize_jsonl(args.source, args.destination)
    print(f"sanitized_records={count}")


if __name__ == "__main__":
    main()

"""Sanitise synchronous answer text and knowledge-boundary sources."""

from pathlib import Path


TARGET = Path("/app/application/api/answer/routes/answer.py")
IMPORT_OLD = "import logging\nimport traceback\n"
IMPORT_NEW = '''import ast
import logging
import traceback


KNOWLEDGE_ABSTENTION = "当前知识库中未找到相关信息，建议联系人工客服确认。"


def _strip_serialized_thought_events(text):
    """Remove only leading serialized thought event dictionaries."""
    remaining = str(text or "")
    marker = "{'type': 'thought'"
    while remaining.startswith(marker):
        parsed_end = None
        for index, character in enumerate(remaining):
            if character != "}":
                continue
            try:
                candidate = ast.literal_eval(remaining[: index + 1])
            except (SyntaxError, ValueError):
                continue
            if isinstance(candidate, dict) and candidate.get("type") == "thought":
                parsed_end = index + 1
                break
        if parsed_end is None:
            break
        remaining = remaining[parsed_end:]
    return remaining.lstrip()


def _filter_answer_sources(answer, sources):
    """Keep only chunks whose heading is named in an explicit source line."""
    source_notes = "\\n".join(
        line for line in str(answer or "").splitlines() if "来源：" in line
    )
    if not source_notes or not isinstance(sources, list):
        return sources
    matched = []
    for source in sources:
        if not isinstance(source, dict):
            continue
        text = str(source.get("text") or source.get("page_content") or "")
        heading = next((line.strip() for line in text.splitlines() if line.strip()), "")
        if heading and heading in source_notes:
            matched.append(source)
    return matched or sources


def _is_full_knowledge_abstention(answer):
    """Clear sources only when the entire answer is the standard refusal."""
    return str(answer or "").strip() == KNOWLEDGE_ABSTENTION
'''
OLD = '''            if stream_result["error"]:
                return make_response({"error": stream_result["error"]}, 400)
'''
NEW = '''            stream_result["answer"] = _strip_serialized_thought_events(
                stream_result.get("answer")
            )
            if _is_full_knowledge_abstention(stream_result.get("answer")):
                stream_result["sources"] = []
            else:
                stream_result["sources"] = _filter_answer_sources(
                    stream_result.get("answer"), stream_result.get("sources")
                )

            if stream_result["error"]:
                return make_response({"error": stream_result["error"]}, 400)
'''


def patch_source(source: str) -> str:
    patched = source
    if IMPORT_NEW not in patched:
        if patched.count(IMPORT_OLD) != 1:
            raise RuntimeError("Expected answer route import marker was not found")
        patched = patched.replace(IMPORT_OLD, IMPORT_NEW)
    if NEW not in patched:
        if patched.count(OLD) != 1:
            raise RuntimeError("Expected synchronous answer response marker was not found")
        patched = patched.replace(OLD, NEW)
    return patched


if __name__ == "__main__":
    source = TARGET.read_text(encoding="utf-8")
    TARGET.write_text(patch_source(source), encoding="utf-8")

"""Sanitise synchronous answer text and knowledge-boundary sources."""

from pathlib import Path


TARGET = Path("/app/application/api/answer/routes/answer.py")
IMPORT_OLD = "import logging\nimport traceback\n"
IMPORT_NEW = '''import ast
import logging
import re
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
    """Keep only chunks explicitly identified by an answer source line."""
    source_lines = [
        line for line in str(answer or "").splitlines()
        if re.search(r"来源\\s*[:：]", line)
    ]
    if not source_lines or not isinstance(sources, list):
        return []
    candidates = []
    for source in sources:
        if not isinstance(source, dict):
            continue
        text = str(source.get("text") or source.get("page_content") or "")
        heading = next((line.strip() for line in text.splitlines() if line.strip()), "")
        metadata = source.get("metadata") if isinstance(source.get("metadata"), dict) else {}
        files = [
            source.get("title"), source.get("file"), source.get("filename"), source.get("source"),
            metadata.get("title"), metadata.get("file"), metadata.get("filename"), metadata.get("source"),
        ]
        details = [
            heading, source.get("heading"), source.get("section"),
            source.get("chunk_id"), source.get("id"), metadata.get("heading"),
            metadata.get("section"), metadata.get("chunk_id"), metadata.get("id"),
        ]
        clean = lambda values: [str(value).strip() for value in values if str(value or "").strip()]
        candidates.append((source, clean(files), clean(details)))
    def matches(line, value):
        return re.search(
            r"(?:^|[\\s·《（(:：])" + re.escape(value) + r"(?:$|[\\s·》）)])", line
        )
    matched = []
    for source, files, details in candidates:
        if any(
            matches(line, detail) and (
                sum(detail in other_details for _, _, other_details in candidates) == 1
                or any(
                    matches(line, file) and
                    sum(file in other_files and detail in other_details for _, other_files, other_details in candidates) == 1
                    for file in files
                )
            )
            for line in source_lines for detail in details
        ):
            matched.append(source)
    return matched


def _is_full_knowledge_abstention(answer):
    """Recognize punctuation/spacing variants, but never a partial answer."""
    content = "\\n".join(
        line for line in str(answer or "").splitlines()
        if not re.match(r"\\s*来源\\s*[:：]", line)
    )
    return bool(re.fullmatch(
        r"\\s*(?:抱歉\\s*[,，。]?\\s*)?当前知识库中未找到相关信息\\s*[,，。；;!！]?\\s*"
        r"建议联系人工客服确认\\s*[。.!！]?\\s*",
        content,
    ))
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

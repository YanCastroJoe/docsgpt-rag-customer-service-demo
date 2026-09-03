"""Lightweight Chinese/English keyword ranking for local FAISS chunks."""

from __future__ import annotations

import re
from typing import Iterable, List


_SYNONYM_RULES = (
    (r"东西坏了|商品坏了|有毛病|出毛病|用不了|有故障", "质量问题"),
    (r"寄回去的钱|寄回的钱|快递费谁出|寄回费用|寄回快递费|邮费", "退货运费"),
    (r"最多给报多少|最多能报多少|最多报多少|报销上限", "最高报销"),
    # Preserve the specific policy phrase while adding its broader intent.
    # Replacing it outright made generic return chunks outrank the exact
    # seven-day policy section.
    (
        r"七天无理由退货|七天无理由|无理由退货",
        "七天无理由退货 非质量问题退货",
    ),
)


def _normalise(text: str) -> str:
    normalised = re.sub(r"\s+", "", (text or "").lower())
    for pattern, replacement in _SYNONYM_RULES:
        normalised = re.sub(pattern, replacement, normalised)
    return normalised


def _terms(text: str) -> set[str]:
    normalised = _normalise(text)
    terms = set(re.findall(r"[a-z0-9]+", normalised))
    for run in re.findall(r"[\u4e00-\u9fff]+", normalised):
        terms.update(run[index : index + 2] for index in range(len(run) - 1))
        terms.update(run[index : index + 3] for index in range(len(run) - 2))
    return terms


def _term_weight(term: str) -> int:
    if term.isdigit():
        return 5
    if re.fullmatch(r"[a-z0-9]+", term):
        return 3
    return 2 if len(term) >= 3 else 1


def rank_documents_by_keyword(question: str, documents: Iterable, k: int) -> List:
    """Rank LangChain-like documents by exact terms and Chinese n-grams."""
    if k <= 0:
        return []

    query_text = _normalise(question)
    query_terms = _terms(question)
    ranked = []

    for position, document in enumerate(documents):
        content = getattr(document, "page_content", "") or ""
        content_text = _normalise(content)
        overlap = query_terms.intersection(_terms(content))
        score = sum(_term_weight(term) for term in overlap)

        if query_text and query_text in content_text:
            score += 100
        if score > 0:
            ranked.append((score, -position, document))

    ranked.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return [document for _, _, document in ranked[:k]]

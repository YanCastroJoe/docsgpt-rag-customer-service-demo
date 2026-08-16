"""Lightweight Chinese/English keyword ranking for local FAISS chunks."""

from __future__ import annotations

import re
from typing import Iterable, List


def _normalise(text: str) -> str:
    return re.sub(r"\s+", "", (text or "").lower())


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

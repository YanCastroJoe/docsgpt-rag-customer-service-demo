"""Hybrid retriever with bounded RRF output."""

from application.retriever.classic_rag import ClassicRAG

RRF_K = 60


def _doc_key(doc):
    if hasattr(doc, "page_content") and hasattr(doc, "metadata"):
        content = doc.page_content
        metadata = doc.metadata or {}
    else:
        content = doc.get("text", doc.get("page_content", ""))
        metadata = doc.get("metadata") or {}
    return (metadata.get("source", ""), content)


def reciprocal_rank_fusion(vector_hits, keyword_hits, k=RRF_K):
    scores = {}
    docs = {}
    # Chinese policy terms and deterministic synonym normalisation carry
    # stronger intent evidence than a broad semantic neighbour.
    for hits, weight in ((vector_hits, 1.0), (keyword_hits, 8.0)):
        for rank, doc in enumerate(hits):
            key = _doc_key(doc)
            scores[key] = scores.get(key, 0.0) + weight / (k + rank)
            docs.setdefault(key, doc)
    ordered = sorted(docs, key=lambda key: scores[key], reverse=True)
    return [docs[key] for key in ordered]


class HybridRetriever(ClassicRAG):
    """Fuse semantic and keyword candidates, then enforce the requested limit."""

    def _fetch_candidates(self, docsearch, question, src_k, score_threshold):
        candidate_k = min(max(src_k * 2, 20), 500)
        vector_hits = docsearch.search(question, k=candidate_k)
        keyword_hits = docsearch.keyword_search(question, k=candidate_k)
        return reciprocal_rank_fusion(vector_hits, keyword_hits)[:src_k]

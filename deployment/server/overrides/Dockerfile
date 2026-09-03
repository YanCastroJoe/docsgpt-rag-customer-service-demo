FROM docker.io/arc53/docsgpt@sha256:275db764560c1df535b17a47086df490ffd11a41038e01e898ecc7dc780dc348

COPY faiss.py /app/application/vectorstore/faiss.py
COPY keyword_ranker.py /app/application/vectorstore/keyword_ranker.py
COPY hybrid_rag.py /app/application/retriever/hybrid_rag.py
COPY patch_sharing.py /tmp/patch_sharing.py
COPY patch_answer_sources.py /tmp/patch_answer_sources.py
RUN python /tmp/patch_sharing.py \
    && python /tmp/patch_answer_sources.py

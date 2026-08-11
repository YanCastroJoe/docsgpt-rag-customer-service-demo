FROM ghcr.nju.edu.cn/arc53/docsgpt@sha256:36544ab364f44a9813baaa6469dcdcdd18eda5e91e470cd56d7cbdbb2441dbc1

COPY faiss.py /app/application/vectorstore/faiss.py
COPY keyword_ranker.py /app/application/vectorstore/keyword_ranker.py
COPY patch_sharing.py /tmp/patch_sharing.py
RUN python /tmp/patch_sharing.py

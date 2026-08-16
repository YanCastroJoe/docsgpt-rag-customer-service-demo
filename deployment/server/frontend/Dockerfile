FROM ghcr.nju.edu.cn/arc53/docsgpt-fe@sha256:484b16abf86ec505a37a450aa62a0bf98debdcf68a2413a6ce2cd937af2c7dc1 AS builder

ARG PUBLIC_API_URL
ENV VITE_API_HOST=${PUBLIC_API_URL}
ENV VITE_API_STREAMING=true

COPY patch_abstain_sources.mjs /tmp/patch_abstain_sources.mjs
RUN node /tmp/patch_abstain_sources.mjs /app/src \
    && npm run build

FROM nginx:1.27.5-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 5173

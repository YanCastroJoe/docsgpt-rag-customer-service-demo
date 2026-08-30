FROM ghcr.nju.edu.cn/arc53/docsgpt-fe@sha256:484b16abf86ec505a37a450aa62a0bf98debdcf68a2413a6ce2cd937af2c7dc1 AS builder

ARG PUBLIC_API_URL
ENV VITE_API_HOST=${PUBLIC_API_URL}
ENV VITE_API_STREAMING=true

COPY patch_abstain_sources.mjs /tmp/patch_abstain_sources.mjs
RUN node /tmp/patch_abstain_sources.mjs /app/src \
    && npm run build

FROM nginx:1.27.5-alpine

COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=builder /app/dist /usr/share/nginx/html
COPY ops /usr/share/nginx/html/ops
COPY demo-shell.css /usr/share/nginx/html/demo-shell.css
COPY demo-shell.js /usr/share/nginx/html/demo-shell.js

EXPOSE 5173

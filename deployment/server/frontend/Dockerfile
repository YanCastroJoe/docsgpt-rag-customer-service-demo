FROM docker.io/arc53/docsgpt-fe@sha256:ede521bce6d7cfaddd3d3e2245aaad1acf3ae116bb94483832bd793be0789d01 AS builder

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
COPY preview /usr/share/nginx/html/preview
COPY preview/shared /usr/share/nginx/html/demo
COPY demo-shell.css /usr/share/nginx/html/demo-shell.css
COPY demo-shell.js /usr/share/nginx/html/demo-shell.js
COPY demo-entry.html /usr/share/nginx/html/demo-entry.html
RUN chmod -R a+rX /usr/share/nginx/html/demo /usr/share/nginx/html/ops /usr/share/nginx/html/preview

EXPOSE 5173

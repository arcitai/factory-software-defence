FROM node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c
RUN apt-get update && apt-get install -y --no-install-recommends git python3 python3-venv ca-certificates procps \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global --engine-strict @openai/codex@0.156.1 @earendil-works/pi-coding-agent@0.87.1 \
    && npm cache clean --force
COPY mock.mjs /opt/factory/mock.mjs
USER node
WORKDIR /workspace

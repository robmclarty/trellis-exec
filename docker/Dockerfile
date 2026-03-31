# ---
# trellis-exec container images
#
# Build targets:
#   slim    — ~200MB, no browser support
#   browser — ~1.5GB, includes Playwright + Chromium
#
# Usage:
#   docker build --target slim    -t trellis-exec:slim    -f docker/Dockerfile .
#   docker build --target browser -t trellis-exec:browser -f docker/Dockerfile .
# ---

# ---
# Stage: slim
# ---
FROM node:22-slim AS slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code

WORKDIR /opt/trellis-exec
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY dist/ dist/
COPY agents/ agents/
RUN npm link

RUN useradd -m -s /bin/bash claude \
  && mkdir -p /home/claude/.claude \
  && chown claude:claude /home/claude/.claude
USER claude

WORKDIR /workspace
ENTRYPOINT ["trellis-exec"]

# ---
# Stage: browser (adds Playwright + Chromium)
# ---
FROM mcr.microsoft.com/playwright:v1.52.0-noble AS browser

RUN npm install -g @anthropic-ai/claude-code

WORKDIR /opt/trellis-exec
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY dist/ dist/
COPY agents/ agents/
RUN npm link

RUN useradd -m -s /bin/bash claude \
  && mkdir -p /home/claude/.claude \
  && chown claude:claude /home/claude/.claude
USER claude

WORKDIR /workspace
ENTRYPOINT ["trellis-exec"]

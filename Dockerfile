# ── Stage 1: Build TypeScript ─────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
# Copy dashboard HTML to dist (not compiled by tsc)
RUN cp src/dashboard.html dist/dashboard.html

# ── Stage 2: Production image ─────────────────────────────────────────────
FROM node:20-slim AS runner

# Install Playwright system dependencies
RUN apt-get update && apt-get install -y \
    libglib2.0-0 libnss3 libnspr4 libdbus-1-3 libatk1.0-0 \
    libatk-bridge2.0-0 libcups2 libxkbcommon0 libatspi2.0-0 \
    libxcomposite1 libxdamage1 libxext6 libxfixes3 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libasound2 libxshmfence1 \
    # WebKit extra deps
    libwoff1 libopus0 libwebp7 libenchant-2-2 libsecret-1-0 \
    libhyphen0 libmanette-0.2-0 libgles2 gstreamer1.0-libav \
    gstreamer1.0-plugins-bad gstreamer1.0-plugins-base \
    gstreamer1.0-plugins-good \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built output
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./

# Install Playwright browsers (chromium + webkit only — saves ~400MB vs all)
RUN npx playwright install chromium webkit

# Videos directory
RUN mkdir -p /app/videos

EXPOSE 7331

# Accept sitemap URL as env var or arg
ENV PORT=7331
ENV CONCURRENCY=3

# No SITEMAP_URL required — configure via UI
# Optional env vars: PORT=7331 CONCURRENCY=3 VIDEOS_DIR=/app/videos
CMD ["node", "dist/index.js"]
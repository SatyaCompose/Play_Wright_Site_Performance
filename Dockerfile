# ── Stage 1: Build TypeScript ─────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
RUN cp src/dashboard.html dist/dashboard.html

# ── Stage 2: Production ───────────────────────────────────────────────────
FROM node:20-slim AS runner

# Playwright system deps for Chromium + WebKit on Debian Bookworm (node:20-slim)
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Shared / Chromium
    libglib2.0-0 libnss3 libnspr4 libdbus-1-3 libatk1.0-0 \
    libatk-bridge2.0-0 libcups2 libxkbcommon0 libatspi2.0-0 \
    libxcomposite1 libxdamage1 libxext6 libxfixes3 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libxshmfence1 \
    libasound2t64 \
    # WebKit
    libwoff1 libopus0 libwebp7 libenchant-2-2 libsecret-1-0 \
    libhyphen0 libmanette-0.2-0 libgles2 \
    gstreamer1.0-libav gstreamer1.0-plugins-bad \
    gstreamer1.0-plugins-base gstreamer1.0-plugins-good \
    # Fonts (needed for correct rendering)
    fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/dist        ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./

# Install only chromium + webkit — saves ~400MB vs all browsers
RUN npx playwright install chromium webkit

RUN mkdir -p /app/videos

EXPOSE 7331

ENV PORT=7331
ENV CONCURRENCY=3
ENV VIDEOS_DIR=/app/videos
ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+process.env.PORT+'/', r => process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/index.js"]
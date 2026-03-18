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

# Let Playwright install its own system dependencies — avoids hardcoding
# package names that differ between Debian versions
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/dist         ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./

# --with-deps installs all OS-level packages Playwright needs automatically
RUN npx playwright install --with-deps chromium webkit \
    && mkdir -p /app/videos

EXPOSE 7331

ENV PORT=7331
ENV CONCURRENCY=3
ENV VIDEOS_DIR=/app/videos
ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+process.env.PORT+'/',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/index.js"]
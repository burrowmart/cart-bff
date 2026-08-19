# ── Build stage ────────────────────────────────────────────────────────────────
# Build context: backend repo root  →  docker build -f cart-bff/Dockerfile .
FROM node:20-alpine AS build

WORKDIR /workspace

# 1. Build the contracts package so the file: dep has a dist/ to resolve
COPY contracts/package*.json contracts/
RUN cd contracts && npm install --ignore-scripts

COPY contracts/src contracts/src
COPY contracts/tsconfig*.json contracts/
RUN cd contracts && npm run build

# 2. Install service deps (npm ci respects the symlink created by file: ref)
COPY cart-bff/package*.json cart-bff/
RUN cd cart-bff && npm ci --ignore-scripts

# 3. Compile the service
COPY cart-bff/src          cart-bff/src
COPY cart-bff/tsconfig*.json cart-bff/
COPY cart-bff/nest-cli.json  cart-bff/
RUN cd cart-bff && npm run build

# ── Runtime stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

# Create a non-root user before copying files
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY --from=build --chown=appuser:appgroup /workspace/cart-bff/dist        ./dist
COPY --from=build --chown=appuser:appgroup /workspace/cart-bff/node_modules ./node_modules
COPY --from=build --chown=appuser:appgroup /workspace/cart-bff/package.json ./

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/main"]

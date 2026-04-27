# Dockerfile for docs app (must be run from monorepo root)
# Build: docker build -f apps/docs/Dockerfile -t questpie-docs .
# Run: docker run -p 3000:3000 questpie-docs

FROM oven/bun:1.3.0-alpine AS base

# Prune stage - create minimal workspace for docs app
FROM base AS pruner
WORKDIR /app

# Install turbo globally
RUN bun add -g turbo@2.7.3

# Copy repo structure
COPY . .

# Prune the workspace to only include docs app and its dependencies
RUN turbo prune @questpie/docs --docker

# Build stage
FROM base AS builder
WORKDIR /app

# Copy pruned workspace (only what's needed for docs)
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/bun.lock ./bun.lock

# Copy source code BEFORE install (needed for postinstall fumadocs-mdx)
COPY --from=pruner /app/out/full/ .

# Install dependencies
RUN bun install --frozen-lockfile

# Build workspace dependencies first (vite-plugin-iconify dist/ is gitignored)
RUN bun run --filter @questpie/vite-plugin-iconify build

# Build docs app
WORKDIR /app/apps/docs
ENV DISABLE_PRERENDER=true
RUN bun run build

# Production stage
FROM base AS runner
WORKDIR /app

# Copy built application
COPY --from=builder /app/apps/docs/.output ./.output
COPY --from=builder /app/apps/docs/package.json ./package.json

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://localhost:3000').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start the application
CMD ["bun", "run", ".output/server/index.mjs"]

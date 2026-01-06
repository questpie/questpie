# Dockerfile for building docs app from monorepo root
# Usage: docker build -f apps/docs/Dockerfile.monorepo -t questpie-docs .

# Build stage
FROM oven/bun:1.3.0-alpine AS builder

WORKDIR /app

# Copy root package files
COPY package.json bun.lock ./
COPY turbo.json ./

# Copy all workspace package.json files for dependency resolution
COPY packages/cms/package.json ./packages/cms/
COPY packages/admin/package.json ./packages/admin/
COPY packages/elysia/package.json ./packages/elysia/
COPY packages/hono/package.json ./packages/hono/
COPY packages/next/package.json ./packages/next/
COPY packages/tanstack-start/package.json ./packages/tanstack-start/
COPY packages/tanstack-query/package.json ./packages/tanstack-query/
COPY packages/adapter-compat/package.json ./packages/adapter-compat/
COPY packages/typescript-config/package.json ./packages/typescript-config/
COPY apps/docs/package.json ./apps/docs/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source files
COPY apps/docs ./apps/docs

# Build only the docs app
WORKDIR /app/apps/docs
ENV DISABLE_PRERENDER=true
RUN bun run build

# Production stage
FROM oven/bun:1.3.0-alpine AS runner

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

# Start the application (Nitro with bun preset)
CMD ["bun", "run", ".output/server/index.mjs"]

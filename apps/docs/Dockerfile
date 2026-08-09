# Dockerfile for docs app (must be run from monorepo root)
# Build: docker build -f apps/docs/Dockerfile -t questpie-docs .
# Run: docker run -p 3000:3000 questpie-docs

FROM oven/bun:1.3.14-alpine AS base

# Build stage
FROM base AS builder
WORKDIR /app

# Keep the complete workspace so Bun can honor the committed lockfile. A
# pruned workspace makes Bun discard that lock and re-resolve TanStack's
# tightly-coupled packages, which can produce a build that passes CI but
# crashes during browser hydration.
COPY . .

RUN bun install --frozen-lockfile \
	--filter @questpie/docs \
	--filter @questpie/vite-plugin-iconify

# Build workspace dependencies first (vite-plugin-iconify dist/ is gitignored)
RUN bun run --filter @questpie/vite-plugin-iconify build

# Build docs app
WORKDIR /app/apps/docs
RUN bun run build

# Production stage
FROM base AS runner
WORKDIR /app

# Copy built application
COPY --from=builder /app/apps/docs/.output ./.output
COPY --from=builder /app/apps/docs/package.json ./package.json

# The markdown sources, which /llms.mdx/docs/* reads at request time. fumadocs
# resolves them by a path relative to the working directory —
# `content/docs/<slug>.mdx` — so they have to sit beside .output, not inside it.
# Without this the HTML renders from the bundle and only the markdown route
# fails, which is why it stayed hidden: every page looked fine.
COPY --from=builder /app/apps/docs/content ./content

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

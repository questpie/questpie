# Build stage
FROM oven/bun:1.3.0-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Copy source files (needed for postinstall script)
COPY . .

# Install dependencies
RUN bun install --frozen-lockfile

# Build the application (disable prerendering in Docker)
ENV DISABLE_PRERENDER=true
RUN bun run build

# Production stage
FROM oven/bun:1.3.0-alpine AS runner

WORKDIR /app

# Copy built application
COPY --from=builder /app/.output ./.output
COPY --from=builder /app/package.json ./package.json

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

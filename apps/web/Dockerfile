# ===========================================
# PairUX Web App (pairux.com, installer.pairux.com on dev2)
# ===========================================
# Runs on Bun. pnpm stays this monorepo's package manager: the desktop
# (Electron) and mobile (Expo) toolchains, the patched @expo/cli
# (pnpm.patchedDependencies) and the release scripts all depend on it, and
# none of that runs here. So Node + pnpm install dependencies and build in the
# first stages (see the build step for why Next builds on Node), and the
# standalone server runs under Bun on Alpine.
#
# Alpine 3.24 at run time, as under node:24-alpine: call analysis shells out
# to ffmpeg/ffprobe (src/lib/call-analysis/media.ts), and oven/bun:*-alpine is
# Alpine 3.22 (older ffmpeg). So the runtime is alpine:3.24 with Bun's musl
# binary copied in, the same pattern icemap.app runs in production.
# ===========================================

FROM oven/bun:1.4.0-alpine AS bun

# Stage 1: Dependencies
FROM node:24-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Copy workspace config
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY package.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/ ./packages/
# pnpm.patchedDependencies pins @expo/cli, and the install reads the patch file
# itself to hash it — without this the whole build dies on ENOENT.
COPY patches/ ./patches/

# Install dependencies
RUN pnpm install --frozen-lockfile --filter @pairux/web...

# Stage 2: Builder
FROM node:24-alpine AS builder
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages ./packages

# Copy source code
COPY . .

# Build arguments for environment variables
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL

# Set environment variables for build
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Build shared-types first (dependency of web)
RUN pnpm --filter @pairux/shared-types build

# Build the web application. The build stays on Node: Next 16.3's Turbopack
# runs PostCSS (Tailwind) in a separate `node` worker and hands it the parent
# process's flags, so under `bun --bun` with a real Node on PATH the worker
# dies with "node: --bun is not allowed in NODE_OPTIONS". What runs in
# production is the standalone server below, and that runs on Bun.
RUN pnpm --filter @pairux/web build

# Stage 3: Runner
FROM alpine:3.24 AS runner
WORKDIR /app

# libstdc++/libgcc for Bun's musl binary. ffmpeg/ffprobe: AI call analysis
# joins the uploaded call audio, measures it and cuts it into pieces for
# transcription (src/lib/call-analysis/media.ts).
RUN apk add --no-cache libstdc++ libgcc ffmpeg
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

# Security: Run as non-root user (same uid/gid as the Node image)
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Set environment
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8080
ENV HOSTNAME="0.0.0.0"

# Copy built application
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
# Public folder must be at apps/web/public since server.js runs from apps/web/
COPY --from=builder /app/apps/web/public ./apps/web/public

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 8080

# Health check (Bun's fetch; 127.0.0.1, since Next binds IPv4 only)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Start the standalone server under Bun
CMD ["bun", "apps/web/server.js"]

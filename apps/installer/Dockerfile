# ===========================================
# PairUX Installer Service - Dockerfile
# ===========================================

FROM node:22-alpine

WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN npm install --production

# Copy source
COPY src/ ./src/
COPY scripts/ ./scripts/

# Create releases directory (will be mounted as volume in production)
RUN mkdir -p releases

# Environment
ENV NODE_ENV=production
ENV PORT=3001

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# Start
CMD ["node", "src/server.js"]

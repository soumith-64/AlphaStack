# Production Dockerfile for AlphaStack INAI PhoneMail Platform
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Install curl/wget for healthchecks
RUN apk add --no-cache wget

# Copy package descriptors first to leverage Docker layer caching
COPY package.json package-lock.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Copy application source code
COPY app.js loader.cjs ./
COPY src/ ./src/
COPY data/ ./data/

# Expose HTTP & WebSocket port
EXPOSE 3000

# Container healthcheck hitting the Hostinger/local health probe
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start PhoneMail application
CMD ["node", "app.js"]

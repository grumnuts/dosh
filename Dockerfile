# Stage 1: Build frontend
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Build backend
FROM node:22-alpine AS backend-builder
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

# Stage 3: Production image
FROM node:22-alpine
WORKDIR /app

# Install production dependencies (no native modules needed)
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

# Copy compiled backend
COPY --from=backend-builder /app/backend/dist ./backend/dist

# Copy frontend build where the backend expects it
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Copy migration SQL files alongside the compiled output
COPY backend/src/db/migrations ./backend/dist/migrations

WORKDIR /app/backend

# Install su-exec for privilege dropping in entrypoint
RUN apk add --no-cache su-exec

# Create data directory and non-root user
RUN mkdir -p /data && \
    addgroup -S dosh && adduser -S dosh -G dosh && \
    chown -R dosh:dosh /app

# Entrypoint fixes /data ownership at runtime (Docker volumes mount as root:root)
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000

ENV NODE_ENV=production
ENV DB_PATH=/data/dosh.db
ENV PORT=3000
ENV HOST=0.0.0.0

ENTRYPOINT ["/entrypoint.sh"]

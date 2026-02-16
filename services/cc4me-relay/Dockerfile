# CC4Me Relay Service — multi-stage build
# Stage 1: Build TypeScript + native deps
# Stage 2: Lean production image

FROM node:22-alpine AS builder

# better-sqlite3 needs build tools for native compilation
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY services/cc4me-relay/package.json services/cc4me-relay/package-lock.json* ./
RUN npm install

COPY services/cc4me-relay/tsconfig.json ./
COPY services/cc4me-relay/src/ ./src/

RUN npx tsc

# Stage 2: Production
FROM node:22-alpine

# better-sqlite3 runtime needs libstdc++
RUN apk add --no-cache libstdc++

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

# SQLite data directory (mount persistent volume here)
RUN mkdir -p /data

ENV NODE_ENV=production
ENV PORT=8080
ENV DB_PATH=/data/relay.db

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --spider --quiet http://localhost:8080/health || exit 1

CMD ["node", "dist/index.js"]

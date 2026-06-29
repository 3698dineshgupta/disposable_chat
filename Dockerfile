# ── Stage 1: Build Next.js frontend ────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /app/client

COPY client/package.json ./
RUN npm install

COPY client/ ./

ENV NEXT_PUBLIC_API_URL=http://localhost:10000
ENV NEXT_PUBLIC_SOCKET_URL=http://localhost:10000

RUN npm run build

# ── Stage 2: Production server ───────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Backend deps
COPY backend/package.json ./backend/
RUN cd backend && npm install --production

# Copy backend source
COPY backend/ ./backend/

# Copy Next.js build output (standalone)
COPY --from=frontend-builder /app/client/.next/standalone ./client/
COPY --from=frontend-builder /app/client/.next/static ./client/.next/static
COPY --from=frontend-builder /app/client/public ./client/public

ENV NODE_ENV=production
ENV PORT=10000

EXPOSE 10000

# Start both backend API and Next.js server
# For simplicity in single-container deployment, the backend serves the frontend via proxy
CMD ["node", "backend/server.js"]

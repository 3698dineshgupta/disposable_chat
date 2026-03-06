# ---------- Build React Client ----------
FROM node:20-alpine AS builder

WORKDIR /app

# Install client dependencies
COPY client/package.json ./client/
RUN cd client && npm install

# Copy client source
COPY client/ ./client/

# Build client
RUN cd client && npm run build


# ---------- Production Server ----------
FROM node:20-alpine

WORKDIR /app

# Install backend dependencies
COPY backend/package.json ./backend/
RUN cd backend && npm install --production

# Copy backend source
COPY backend/ ./backend/

# Copy built frontend
COPY --from=builder /app/client/dist ./client/dist

ENV NODE_ENV=production
ENV PORT=10000

EXPOSE 10000

CMD ["node", "backend/server.js"]

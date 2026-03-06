# ── Build Stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install root dependencies (includes concurrently)
COPY package.json ./
RUN npm install

# Build client
COPY client/package.json ./client/
RUN cd client && npm install

COPY client/ ./client/
RUN cd client && npm run build

# ── Production Stage ──────────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Install server dependencies
COPY server/package.json ./server/
RUN cd server && npm install --production

# Copy server source
COPY server/ ./server/

# Copy built client
COPY --from=builder /app/client/dist ./client/dist

# Set environment
ENV NODE_ENV=production
ENV PORT=10000

EXPOSE 10000

CMD ["node", "server/index.js"]

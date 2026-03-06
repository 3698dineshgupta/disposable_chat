# ---------- Build Stage ----------
FROM node:20-alpine AS builder

WORKDIR /app

# Install root dependencies
COPY package.json package-lock.json* ./
RUN npm install

# Install client dependencies
COPY client/package.json ./client/
RUN cd client && npm install

# Copy client source
COPY client/ ./client/

# Build React app
RUN cd client && npm run build


# ---------- Production Stage ----------
FROM node:20-alpine

WORKDIR /app

# Install server dependencies
COPY server/package.json ./server/
RUN cd server && npm install --production

# Copy server source code
COPY server/ ./server/

# Copy built frontend from builder
COPY --from=builder /app/client/dist ./client/dist

# Environment variables
ENV NODE_ENV=production
ENV PORT=10000

EXPOSE 10000

# Start server
CMD ["node", "server/index.js"]

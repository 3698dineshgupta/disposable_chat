require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const path = require('path');
const cookieParser = require('cookie-parser');

require('./src/config/database'); // connect on startup
const initSocket = require('./src/socket');

const authRoutes = require('./src/routes/auth');
const usersRoutes = require('./src/routes/users');
const conversationsRoutes = require('./src/routes/conversations');
const callsRoutes = require('./src/routes/calls');
const statusRoutes = require('./src/routes/status');

const app = express();
const server = http.createServer(app);

/* ── Socket.IO ── */
const allowedOrigins = [
  process.env.CLIENT_URL || 'http://localhost:3000',
  'http://localhost:3000',
  'http://localhost:10000',
];

const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'], credentials: true },
  pingTimeout: 60000,
  pingInterval: 25000,
});

/* ── Security ── */
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(cookieParser());

/* ── Rate Limiting ── */
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

app.use('/api/', apiLimiter);
app.use('/api/auth/', authLimiter);

/* ── Middleware ── */
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

/* ── API Routes ── */
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/conversations', conversationsRoutes);
app.use('/api/calls', callsRoutes);
app.use('/api/status', statusRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

/* ── Socket Handler ── */
initSocket(io);

/* ── Serve Next.js Build ── */
const clientBuildPath = path.join(__dirname, '../client/.next/server/app');
const clientPublicPath = path.join(__dirname, '../client/public');

// Serve static files from Next.js public folder
app.use(express.static(clientPublicPath));

// Fallback: serve from client/out (static export) if present
const clientOutPath = path.join(__dirname, '../client/out');
app.use(express.static(clientOutPath));

app.get('*', (req, res) => {
  const indexPath = path.join(clientOutPath, 'index.html');
  const fs = require('fs');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(200).json({ message: 'ZapChat API running. Start the Next.js dev server on port 3000.' });
  }
});

/* ── Start ── */
const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 ZapChat backend running on port ${PORT}`);
});

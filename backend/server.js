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

require('./src/config/database');
const initSocket = require('./src/socket');

const authRoutes = require('./src/routes/auth');
const usersRoutes = require('./src/routes/users');
const conversationsRoutes = require('./src/routes/conversations');
const callsRoutes = require('./src/routes/calls');
const statusRoutes = require('./src/routes/status');

const app = express();
const server = http.createServer(app);
const isProd = process.env.NODE_ENV === 'production';

/* ── CORS origin checker ── */
function isAllowedOrigin(origin) {
  if (!origin) return true; // server-to-server / health checks
  const clientUrl = (process.env.CLIENT_URL || '').replace(/\/$/, '');
  if (clientUrl && origin === clientUrl) return true;
  if (!isProd && origin.includes('localhost')) return true;
  // Allow Vercel preview deploys for the same project
  if (clientUrl.includes('vercel.app')) {
    const baseDomain = clientUrl.replace('https://', '').split('-')[0];
    if (origin.includes('vercel.app') && origin.includes(baseDomain)) return true;
  }
  return false;
}

const corsOptions = {
  origin: (origin, cb) => isAllowedOrigin(origin) ? cb(null, true) : cb(new Error('CORS: origin not allowed')),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
};

/* ── Socket.IO ── */
const io = new Server(server, {
  cors: corsOptions,
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 1e6, // 1 MB max socket message
});

/* ── Security headers ── */
app.use(helmet({
  contentSecurityPolicy: false,     // frontend is on a separate domain
  crossOriginEmbedderPolicy: false,
  hsts: isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
  frameguard: { action: 'deny' },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(cookieParser());

// Remove server fingerprint
app.disable('x-powered-by');

/* ── Rate Limiting ── */
const apiLimiter  = rateLimit({ windowMs: 15 * 60 * 1000, max: 500,  standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20,   standardHeaders: true, legacyHeaders: false }); // stricter: 20 auth calls per 15 min
const uploadLimiter = rateLimit({ windowMs: 60 * 1000,    max: 10,   standardHeaders: true, legacyHeaders: false }); // 10 uploads per minute

app.use('/api/', apiLimiter);
app.use('/api/auth/', authLimiter);
app.use('/api/users/upload', uploadLimiter);
app.use('/api/users/me/avatar', uploadLimiter);

/* ── Body parsing — tight limit for JSON, larger for multipart ── */
app.use(express.json({ limit: '1mb' }));  // was 10mb — API requests don't need that
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(isProd ? morgan('combined') : morgan('dev'));

/* ── API Routes ── */
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/conversations', conversationsRoutes);
app.use('/api/calls', callsRoutes);
app.use('/api/status', statusRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

/* ── 404 for unknown API routes ── */
app.use('/api/*', (req, res) => res.status(404).json({ error: 'Not found' }));

/* ── Socket Handler ── */
initSocket(io);

/* ── Serve Next.js static build (development fallback) ── */
const clientOutPath = path.join(__dirname, '../client/out');
app.use(express.static(clientOutPath));
app.get('*', (req, res) => {
  const fs = require('fs');
  const indexPath = path.join(clientOutPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(200).json({ message: 'ZapChat API running.' });
  }
});

/* ── Start ── */
const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`ZapChat backend running on port ${PORT} [${isProd ? 'production' : 'development'}]`);
});

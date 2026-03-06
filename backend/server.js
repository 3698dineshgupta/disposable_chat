require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const mongoose = require('./utils/mongooseMock');

const initSocket = require('./socketHandler');
const generateRoomRoute = require('./routes/generateRoom');
const healthRoute = require('./routes/health');

const app = express();
const server = http.createServer(app);

// MongoDB Connection (Mocked for portability in this environment)
mongoose.connect()
    .then(() => console.log('🍃 Connected to Mock Database'))
    .catch(err => console.error('❌ Database connection error:', err));

// CORS & Socket.io
const allowedOrigins = [
    process.env.CLIENT_URL || 'http://localhost:5173',
    'http://localhost:4173'
];

const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
        methods: ['GET', 'POST'],
        credentials: true,
    },
    pingTimeout: 60000,
});

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            connectSrc: ["*"], // Relaxed for dev connectivity
        },
    },
}));

app.use(cors({
    origin: true, // Allow all origins in dev
    credentials: true,
}));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000, // Increase limit for dev
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', limiter);

app.use(express.json({ limit: '10kb' }));
app.use(morgan('dev'));

// Routes
app.use('/api/rooms', generateRoomRoute);
app.use('/api/health', healthRoute);

// Initialize Socket.io
initSocket(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Disposable Chat Backend running on port ${PORT}`);
});

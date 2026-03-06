# chat-e2ee

**Production-ready End-to-End Encrypted Real-Time Chatroom**

Messages are encrypted in your browser. The server **never** sees plaintext.

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│                      CLIENT (Browser)                      │
│                                                            │
│  Login → Generate ECDH Key Pair (P-256)                   │
│  Public Key → Server   Private Key → stays in memory      │
│                                                            │
│  To send message:                                          │
│    Fetch recipient's public key                            │
│    Derive shared secret via ECDH                           │
│    Derive AES-GCM key via HKDF                             │
│    Encrypt with random IV                                  │
│    Send: { encryptedContent, iv } → Server                 │
│                                                            │
│  To receive message:                                       │
│    Get sender's public key                                 │
│    Re-derive shared secret (ECDH is commutative)           │
│    Decrypt with stored IV                                  │
└────────────────────┬───────────────────────────────────────┘
                     │  Socket.io / HTTPS
                     │  Payload: ciphertext only
                     ▼
┌────────────────────────────────────────────────────────────┐
│                      SERVER (Node.js)                      │
│                                                            │
│  Stores: public keys, encrypted ciphertext, metadata      │
│  Cannot decrypt: no private keys, no shared secrets       │
│                                                            │
│  Responsibilities:                                         │
│  - JWT authentication                                      │
│  - Room membership authorization                           │
│  - Message relay (encrypted blobs only)                    │
│  - Public key distribution                                 │
└────────────────────────────────────────────────────────────┘
```

## Encryption Flow

```
Alice                              Server                         Bob
  │                                  │                             │
  │── Login ──────────────────────► │                             │
  │◄─ JWT ──────────────────────── │                             │
  │                                  │                             │
  │── Generate ECDH Keypair          │  Bob does same ────────── │
  │   publicKey_A, privateKey_A      │                             │
  │                                  │                             │
  │── Register publicKey_A ────────► │ ◄── Register publicKey_B ─ │
  │                                  │                             │
  │── Fetch publicKey_B ───────────► │                             │
  │◄─ publicKey_B ───────────────── │                             │
  │                                  │                             │
  │  sharedSecret = ECDH(            │                             │
  │    privateKey_A, publicKey_B)    │  Bob computes same:        │
  │                                  │  sharedSecret = ECDH(      │
  │  aesKey = HKDF(sharedSecret)     │    privateKey_B,publicKey_A)│
  │                                  │                             │
  │  iv = randomBytes(12)            │                             │
  │  ct = AES-GCM(aesKey, msg, iv)   │                             │
  │                                  │                             │
  │── {ct, iv} ────────────────────► │ ──── {ct, iv} ──────────► │
  │                                  │                             │
  │                                  │  Bob decrypts:              │
  │                                  │  msg = AES-GCM-decrypt(     │
  │                                  │    aesKey, ct, iv)          │
```

## Tech Stack

- **Frontend**: React + Vite + TailwindCSS + Socket.io client
- **Backend**: Node.js + Express + Socket.io
- **Database**: MongoDB (Mongoose)
- **Crypto**: Web Crypto API (SubtleCrypto) — ECDH P-256 + AES-GCM-256 + HKDF

## Security Features

- ECDH P-256 key exchange
- AES-GCM-256 symmetric encryption
- HKDF key derivation (domain separated)
- Random 96-bit IV per message (IND-CCA2 security)
- Private keys never leave the browser
- Server stores only ciphertext and public keys
- JWT authentication with bcrypt password hashing
- Helmet security headers
- Rate limiting on all endpoints (strict on /auth)
- MongoDB injection sanitization
- CORS whitelist
- Input validation (Joi)

## Local Development

### Prerequisites

- Node.js 18+
- MongoDB (local or Atlas)

### Setup

```bash
# 1. Clone the repo
git clone https://github.com/yourname/chat-e2ee
cd chat-e2ee

# 2. Install all dependencies
npm run install:all

# 3. Configure server environment
cp server/.env.example server/.env
# Edit server/.env with your MongoDB URI and a strong JWT_SECRET

# 4. Start development servers
npm run dev
```

The app runs at:
- Frontend: http://localhost:5173
- Backend API: http://localhost:5000

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGODB_URI` | ✅ | MongoDB connection string |
| `JWT_SECRET` | ✅ | Min 32 chars. Use: `openssl rand -hex 32` |
| `JWT_EXPIRES_IN` | ❌ | Token lifetime (default: 7d) |
| `CLIENT_URL` | ❌ | Frontend URL for CORS (default: http://localhost:5173) |
| `PORT` | ❌ | Server port (default: 5000) |
| `NODE_ENV` | ❌ | Environment (development/production) |

## Deployment on Render

### Option A: Using render.yaml (recommended)

1. Push code to GitHub
2. Go to [render.com](https://render.com) → New → Blueprint
3. Connect your repo — Render reads `render.yaml` automatically
4. Set `MONGODB_URI` in the Render dashboard (Environment tab)
5. Deploy!

### Option B: Manual

1. **New Web Service** → connect your GitHub repo
2. **Build Command**: `npm run build`
3. **Start Command**: `npm start`
4. **Environment Variables**:
   - `NODE_ENV=production`
   - `PORT=10000`
   - `MONGODB_URI=<your Atlas URI>`
   - `JWT_SECRET=<generate with openssl rand -hex 32>`
   - `CLIENT_URL=<your render app URL>`

### MongoDB Atlas Setup

1. Create a free cluster at [mongodb.com/cloud/atlas](https://cloud.atlas.com)
2. Create a database user
3. Whitelist all IPs (0.0.0.0/0) for Render's dynamic IPs
4. Copy the connection string to `MONGODB_URI`

## Docker

```bash
# Build
docker build -t chat-e2ee .

# Run
docker run -p 10000:10000 \
  -e MONGODB_URI=mongodb://host.docker.internal:27017/chat-e2ee \
  -e JWT_SECRET=your-secret-here \
  -e CLIENT_URL=http://localhost:10000 \
  chat-e2ee
```

## Project Structure

```
chat-e2ee/
├── client/                    # React + Vite frontend
│   ├── src/
│   │   ├── components/        # UI components
│   │   │   ├── ChatRoom.jsx   # Main chat interface
│   │   │   ├── Sidebar.jsx    # Room list & navigation
│   │   │   ├── CreateRoomModal.jsx
│   │   │   └── WelcomePanel.jsx
│   │   ├── contexts/
│   │   │   ├── AuthContext.jsx  # Auth state + key management
│   │   │   └── SocketContext.jsx # Socket.io connection
│   │   ├── hooks/
│   │   │   └── useRoom.js     # Room state + E2EE logic
│   │   ├── pages/
│   │   │   ├── LoginPage.jsx
│   │   │   ├── RegisterPage.jsx
│   │   │   └── ChatLayout.jsx
│   │   └── utils/
│   │       ├── crypto.js      # 🔐 All crypto operations
│   │       └── api.js         # Axios instance
│   └── package.json
├── server/                    # Node.js + Express backend
│   ├── middleware/
│   │   └── auth.js           # JWT middleware (HTTP + Socket)
│   ├── models/
│   │   ├── User.js           # User model (stores public key only)
│   │   ├── Room.js           # Room model
│   │   ├── Membership.js     # Room membership
│   │   └── Message.js        # Message metadata (no plaintext)
│   ├── routes/
│   │   ├── auth.js           # Register, login, public key
│   │   ├── rooms.js          # Room CRUD + messages
│   │   └── users.js          # User public key lookup
│   ├── socket/
│   │   └── socketHandler.js  # Real-time events
│   ├── utils/
│   │   └── validateEnv.js    # Startup env validation
│   ├── index.js              # Server entry point
│   └── package.json
├── Dockerfile
├── render.yaml
└── package.json              # Root scripts
```

## License

MIT

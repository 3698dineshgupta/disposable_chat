require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const morgan = require("morgan");
const path = require("path");

const mongoose = require("./utils/mongooseMock");

const initSocket = require("./socketHandler");
const generateRoomRoute = require("./routes/generateRoom");
const healthRoute = require("./routes/health");

const app = express();
const server = http.createServer(app);

/* ---------------- DATABASE ---------------- */

mongoose
  .connect()
  .then(() => console.log("🍃 Connected to Mock Database"))
  .catch((err) => console.error("❌ Database connection error:", err));

/* ---------------- SOCKET.IO ---------------- */

const allowedOrigins = [
  process.env.CLIENT_URL || "http://localhost:5173",
  "http://localhost:4173",
];

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
  pingTimeout: 60000,
});

/* ---------------- SECURITY ---------------- */

app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

/* ---------------- RATE LIMIT ---------------- */

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/", limiter);

/* ---------------- MIDDLEWARE ---------------- */

app.use(express.json({ limit: "10kb" }));
app.use(morgan("dev"));

/* ---------------- API ROUTES ---------------- */

app.use("/api/rooms", generateRoomRoute);
app.use("/api/health", healthRoute);

/* ---------------- SOCKET HANDLER ---------------- */

initSocket(io);

/* ---------------- SERVE FRONTEND ---------------- */

const clientBuildPath = path.join(__dirname, "../client/dist");

app.use(express.static(clientBuildPath));

app.get("*", (req, res) => {
  res.sendFile(path.join(clientBuildPath, "index.html"));
});

/* ---------------- SERVER START ---------------- */

const PORT = process.env.PORT || 10000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Disposable Chat Backend running on port ${PORT}`);
});

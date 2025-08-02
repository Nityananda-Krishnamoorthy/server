require('dotenv').config();
const express = require('express');
const { connect } = require('mongoose');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const upload = require('express-fileupload');
const { notFound, errorHandler } = require('./middleware/errorMiddleware');
const { socketHandler } = require('./socket/socket');
const { createAdapter } = require('@socket.io/redis-adapter');
const Redis = require('ioredis');

const app = express();

// CORS setup
app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// File upload setup
app.use(upload({
  useTempFiles: true,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  createParentPath: true
}));




// Logging middleware (optional)
app.locals.onlineUsers = new Set();
app.use((req, res, next) => {
  console.log("INCOMING REQUEST:", req.method, req.originalUrl);
  console.log("Params:", req.params);
  console.log("Body:", req.body);
  console.log("User:", req.user);
  next();
});

// ===== Redis Setup (Upstash or Local) =====
let pubClient, subClient;
const isCluster = process.env.REDIS_CLUSTER === 'true';

const handleRedisError = (clientName) => (err) => {
  console.error(`[Redis Error - ${clientName}]:`, err.message || err);
};

if (isCluster) {
  const nodes = JSON.parse(process.env.REDIS_NODES || '[]');
  pubClient = new Redis.Cluster(nodes, { redisOptions: { tls: true } });
  subClient = pubClient.duplicate();
} else {
  pubClient = new Redis(process.env.REDIS_URL, {
    tls: {}, // Important for Upstash TLS
    maxRetriesPerRequest: 5,
    enableReadyCheck: true,
    reconnectOnError: () => true
  });
  subClient = pubClient.duplicate();
}

pubClient.on('error', handleRedisError('pubClient'));
subClient.on('error', handleRedisError('subClient'));

// ===== Socket.IO Setup =====
const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: process.env.CLIENT_URL,
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

io.adapter(createAdapter(pubClient, subClient));
socketHandler(io, pubClient);

// ===== Share Redis client with app =====
app.locals.redisClient = pubClient;

// ===== Routes =====
app.use('/api/v1.1', require('./routes/index.js'));
app.use(notFound);
app.use(errorHandler);

// ===== Start Server =====
connect(process.env.MONGO_URI)
  .then(() => {
    console.log(' MongoDB connected');
    const PORT = process.env.PORT || 3030;
    server.listen(PORT, () => {
      console.log(` Server running at http://localhost:${PORT}`);
      console.log(` Redis Mode: ${isCluster ? 'Cluster' : 'Single'}`);
    });
  })
  .catch((err) => {
    console.error(' MongoDB connection error:', err);
    process.exit(1);
  });

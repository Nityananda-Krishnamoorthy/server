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
const Redis = require('ioredis'); // Fixed: single Redis import

const app = express();
app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(upload({
  useTempFiles: true,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  createParentPath: true
}));
// Initialize online users set
app.locals.onlineUsers = new Set();
  app.use((req, res, next) => {
  console.log("INCOMING REQUEST:", req.method, req.originalUrl);
  console.log("Params:", req.params);
  console.log("Body:", req.body);
  console.log("User:", req.user);
  next();
});
// Create Redis clients with error handlers
let pubClient, subClient;

const handleRedisError = (clientName) => (err) => {
  console.error(`[Redis Error - ${clientName}]:`, err.message || err);
};

if (process.env.REDIS_CLUSTER === 'true') {
  const nodes = JSON.parse(process.env.REDIS_NODES || '[]');
  pubClient = new Redis.Cluster(nodes);
  subClient = pubClient.duplicate();
} else {
  pubClient = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 5,          // Limit retries
    enableReadyCheck: true,           // Wait for connection
    reconnectOnError: () => true,     // Reconnect logic
  });

  subClient = pubClient.duplicate();
}

// Attach error handlers
pubClient.on('error', handleRedisError('pubClient'));
subClient.on('error', handleRedisError('subClient'));

// Create server and Socket.IO instance
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.CLIENT_URL,
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// Set Redis adapter
io.adapter(createAdapter(pubClient, subClient));

// Pass Redis client to socket handler
socketHandler(io, pubClient); 

// Share Redis client with app
app.locals.redisClient = pubClient;

// Routes
app.use('/api/v1.1', require('./routes/index.js'));
app.use(notFound);
app.use(errorHandler);

// Connect to MongoDB and start server
connect(process.env.MONGO_URI)
  .then(() => {
    console.log('MongoDB connected');
    const PORT = process.env.PORT || 3030;
    server.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      console.log(`Using Redis: ${process.env.REDIS_CLUSTER === 'true' ? 'Cluster' : 'Single'}`);
    });
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });
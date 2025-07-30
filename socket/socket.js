const jwt = require('jsonwebtoken');
const UserModel = require('../models/userModel');
const { updateMessageStatus } = require('../controllers/chatControllers');

let _io;
let _redis;

function socketHandler(io, redisClient) {
  _io = io;
  _redis = redisClient;

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error('Authentication error'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await UserModel.findById(decoded.id);
      
      if (!user) return next(new Error('User not found'));
      socket.user = user;
      next();
    } catch (error) {
      next(new Error(error.name === 'TokenExpiredError' 
        ? 'Token expired' 
        : 'Authentication failed'));
    }
  });

   io.on('connection', async (socket) => {
    const userId = socket.user._id.toString();
    
    try {
        await _redis.hset('online-users', userId, socket.id);
      socket.broadcast.emit('user-online', { userId: socket.user._id });
      socket.join(`user_${userId}`);

      // Event handlers with error protection
      const safeEmit = (handler) => async (...args) => {
        try { await handler(...args); } 
        catch (error) {
          console.error(`Socket error (${handler.name}):`, error);
          socket.emit('error', 'Event processing failed');
        }
      };

      socket.on('join-conversations', safeEmit((conversationIds) => {
        conversationIds.forEach(id => socket.join(id));
      }));

      socket.on('send-message', safeEmit((message) => {
        io.to(message.conversationId).emit('new-message', message);
      }));

      socket.on('typing', (conversationId) => {
        socket.to(conversationId).emit('typing', {
          userId: socket.user._id,
          conversationId
        });
      });

      socket.on('stop-typing', (conversationId) => {
        socket.to(conversationId).emit('stop-typing', {
          userId: socket.user._id,
          conversationId
        });
      });

      // Message status updates
      socket.on('message-delivered', async (messageId) => {
        await updateMessageStatus(messageId, socket.user._id, 'delivered');
      });

      socket.on('message-seen', async (messageId) => {
        await updateMessageStatus(messageId, socket.user._id, 'seen');
      });
      socket.on('batch-message-seen', async (messageIds) => {
        await Promise.all(messageIds.map(id => 
          updateMessageStatus(id, userId, 'seen')
        ));
      });

      // WebRTC Signaling
      socket.on('webrtc-offer', async (data) => {
        const { to, offer, callId } = data;
        const targetSocketId = await redisClient.hget('online-users', to);
        await _redis.hset(`call:${callId}`, 'initiator', userId);
        await _redis.expire(`call:${callId}`, 60); // 60s timeout
        
        if (targetSocketId) {
          socket.to(targetSocketId).emit('webrtc-offer', { 
            from: userId, 
            offer,
            callId
          });
        }
      });

      socket.on('webrtc-answer', async (data) => {
        const { to, answer, callId } = data;
        const targetSocketId = await redisClient.hget('online-users', to);
        
        if (targetSocketId) {
          socket.to(targetSocketId).emit('webrtc-answer', { 
            from: userId, 
            answer,
            callId
          });
        }
      });

      socket.on('webrtc-ice-candidate', async (data) => {
        const { to, candidate, callId } = data;
        const targetSocketId = await redisClient.hget('online-users', to);
        
        if (targetSocketId) {
          socket.to(targetSocketId).emit('webrtc-ice-candidate', {
            from: userId,
            candidate,
            callId
          });
        }
      });

      socket.on('disconnect', safeEmit(async () => {
        await _redis.hdel('online-users', userId);
        if (await _redis.hexists('online-users', userId) === 0) {
          socket.broadcast.emit('user-offline', { userId });
        }
      }));
    } catch (error) {
      console.error('Connection error:', error);
      socket.disconnect(true);
    }
  });
}

const getIO = () => _io;
const getRedis = () => _redis;

module.exports = {
  socketHandler,
  getIO,
  getRedis,
};
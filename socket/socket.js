// socket/socket.js
const jwt = require('jsonwebtoken');
const UserModel = require('../models/userModel');
const { updateMessageStatus } = require('../controllers/chatControllers');

function socketHandler(io, redisClient) {
  // Authentication
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error('Authentication error: Token missing'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Token expiration check
      if (decoded.exp < Date.now() / 1000) {
        return next(new Error('Token expired'));
      }

      const user = await UserModel.findById(decoded.id);
      if (!user) return next(new Error('Authentication error: User not found'));

      socket.user = user;
      next();
    } catch (error) {
      next(new Error('Authentication failed: ' + error.message));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.user._id.toString();
    console.log(`User connected: ${userId}`);
    
    try {
      // Add to Redis presence tracking
      await redisClient.hset('online-users', userId, socket.id);
      socket.broadcast.emit('user-online', { userId: socket.user._id });

      // Join user to their own room for direct signaling
      socket.join(`user_${userId}`);

      socket.on('join-conversations', (conversationIds) => {
        conversationIds.forEach(id => socket.join(id));
      });

      socket.on('send-message', (message) => {
        io.to(message.conversationId).emit('new-message', message);
      });

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

      // WebRTC Signaling
      socket.on('webrtc-offer', async (data) => {
        const { to, offer, callId } = data;
        const targetSocketId = await redisClient.hget('online-users', to);
        
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

      socket.on('disconnect', async () => {
        console.log(`User disconnected: ${userId}`);
        
        // Remove from Redis presence tracking
        await redisClient.hdel('online-users', userId);
        io.emit('user-offline', { userId: socket.user._id });
      });

    } catch (error) {
      console.error('Socket Error:', error);
      socket.disconnect(true);
    }
  });
}

module.exports = {socketHandler};
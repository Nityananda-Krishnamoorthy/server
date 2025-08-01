const Notification = require('../models/NotificationModel');
const { getIO } = require('../socket/socket');

const notifyUser = async (userId, type, data) => {
  try {
    const notification = await Notification.create({
      user: userId,
      type,
      data,       
      read: false,
      timestamp: new Date()
    });

     // Deliver via socket.io
    const io = getIO();
    io.to(`user_${userId}`).emit('new-notification', notification);
  } catch (err) {
    console.error('Failed to notify user:', err.message);
  }
};

module.exports = notifyUser;

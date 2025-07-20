const Notification = require('../models/NotificationModel'); // or your schema path

const notifyUser = async (userId, type, data) => {
  try {
    const notification = new Notification({
      user: userId,
      type,         // e.g. 'follow', 'comment', 'like'
      data,         // { userId: '...', postId: '...', etc. }
      read: false,
      createdAt: new Date()
    });

    await notification.save();
  } catch (err) {
    console.error('Failed to notify user:', err.message);
  }
};

module.exports = notifyUser;

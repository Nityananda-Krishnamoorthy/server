const Notification = require('../models/notificationModel');
const HttpError = require('../models/errorModel');

// ================= GET USER NOTIFICATIONS =================
const getUserNotifications = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Get notifications without populating first
    const notifications = await Notification.find({ user: userId })
  .sort({ createdAt: -1 })
  .skip(skip)
  .limit(limit)
  .populate([
    { path: 'data.actor', select: 'userName fullName profilePhoto' },
    { path: 'data.post', select: 'body image' },
    { path: 'data.comment', select: 'text' },
    { path: 'data.conversation', select: 'groupName isGroup' }
  ]);

    
    // Extract IDs to mark as read
    const notificationIds = notifications.map(n => n._id);
    
    // Mark fetched notifications as read
    if (notificationIds.length > 0) {
      await Notification.updateMany(
        { _id: { $in: notificationIds }, read: false },
        { $set: { read: true } }
      );
    }

    // Now populate after marking as read
    // In getNotifications
        const populatedNotifications = await Notification.populate(notifications, [
          { path: 'data.actor', select: 'userName fullName profilePhoto' },
          { path: 'data.post', select: 'body image' },
          { path: 'data.comment', select: 'text' },
          { path: 'data.conversation', select: 'groupName' }
        ]);

    // Format notifications
    const formattedNotifications = populatedNotifications.map(notification => {
      const notificationObj = notification.toObject();
      let message = 'New notification';
      
      const actorName = notification.data.actor?.userName || 'Someone';
      
      switch(notification.type) {
        case 'like':
          message = `${actorName} liked your post`;
          break;
        case 'comment':
          message = `${actorName} commented on your post`;
          break;
        case 'share':
          message = `${actorName} shared your post`;
          break;
        case 'mention':
          message = `${actorName} mentioned you`;
          break;
        case 'follow':
          message = `${actorName} started following you`;
          break;
        case 'tag':
          message = `${actorName} tagged you in a post`;
          break;
        case 'message':
          message = notification.data.conversation?.isGroup
            ? `New message in ${notification.data.conversation?.groupName || 'a group'}`
            : `${actorName} sent you a message`;
          break;
        case 'call':
          message = `${actorName} is calling you`;
          break;
        default:
          message = 'New notification';
      }
      
      return {
        ...notificationObj,
        message
      };
    });

    const total = await Notification.countDocuments({ user: userId });

   const readCount = await Notification.countDocuments({ user: userId, read: true });
    const unreadCount = total - readCount;

    res.status(200).json({
      page,
      limit,
      total,
      readCount,
      unreadCount,
      notifications: formattedNotifications
    });
  } catch (error) {
    console.error('Get Notifications Error:', error);
    return next(new HttpError(500, 'Failed to get notifications'));
  }
};

// ================= MARK AS READ =================
const markAsRead = async (req, res, next) => {
  try {
    const notificationId = req.params.id;
    const userId = req.user.id;

    // Use findById instead of findOneAndUpdate to ensure proper population
    const notification = await Notification.findById(notificationId)
      .populate('data.actor', 'userName fullName profilePhoto')
      .populate('data.conversation', 'isGroup groupName');

    if (!notification) {
      return next(new HttpError(404, 'Notification not found'));
    }

    // Check if notification belongs to user
    if (!notification.user.equals(userId)) {
      return next(new HttpError(403, 'Not authorized to mark this notification'));
    }

    // Only update if not already read
    if (!notification.read) {
      notification.read = true;
      await notification.save();
    }

    // Format message for response
      const actorName = notification?.data?.actor?.userName || 'Someone';

      const typeMessages = {
        like: `${actorName} liked your post`,
        comment: `${actorName} commented on your post`,
        follow: `${actorName} started following you`,
        mention: `${actorName} mentioned you`,
        message: notification.data.conversation?.isGroup
          ? `New message in ${notification.data.conversation?.groupName || 'a group'}`
          : `${actorName} sent you a message`,
        tag: `${actorName} tagged you in a post`,
        call: `${actorName} is calling you`
      };

      const message = typeMessages[notification.type] || 'New notification';

      const response = {
        ...notification.toObject(),
        message
      };


    res.status(200).json(response);
  } catch (error) {
    console.error('Mark as Read Error:', error);
    return next(new HttpError(500, 'Failed to mark notification as read'));
  }
};
const deleteNotification = async (req, res, next) => {
  try {
    const notificationId = req.params.id;
    const userId = req.user.id;

    const notification = await Notification.findOneAndDelete({
      _id: notificationId,
      user: userId
    });

    if (!notification) {
      return next(new HttpError(404, 'Notification not found'));
    }

    res.status(200).json({ message: 'Notification deleted' });
  } catch (error) {
    console.error('Delete Notification Error:', error);
    return next(new HttpError(500, 'Failed to delete notification'));
  }
};

// Update exports
module.exports = {
  getUserNotifications,
  markAsRead,
  deleteNotification 
};
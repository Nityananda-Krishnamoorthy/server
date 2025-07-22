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
      .limit(limit);
    
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
    const populatedNotifications = await Notification.populate(notifications, [
      {
        path: 'data.actor',
        select: 'userName fullName profilePhoto'
      },
      {
        path: 'data.conversation',
        select: 'isGroup groupName'
      }
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

    res.status(200).json({
      page,
      limit,
      total,
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
    let message = 'New notification';
    const actorName = notification.data.actor?.userName || 'Someone';
    
    switch(notification.type) {
      case 'like':
        message = `${actorName} liked your post`;
        break;
      case 'comment':
        message = `${actorName} commented on your post`;
        break;
      // ... other cases ...
      default:
        message = 'New notification';
    }
    
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

module.exports = {
  getUserNotifications,
  markAsRead
};
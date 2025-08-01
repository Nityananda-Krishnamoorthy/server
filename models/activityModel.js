const mongoose = require('mongoose');
const { Schema } = mongoose;
const { notifyUser } = require('./NotificationModel'); // Import notification helper

const activitySchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  action: { 
    type: String, 
    required: true,
    enum: [
      'login', 'logout', 'register', 'create_post', 'like_post', 
      'comment', 'follow', 'update_profile', 'change_password'
    ]
  },
  details: Object,
  ipAddress: String,
  userAgent: String
}, { timestamps: true });

// Post-save hook to create notifications for specific activities
activitySchema.post('save', async function(doc) {
  try {
    // Only create notifications for certain actions
    const notifyActions = ['like_post', 'comment', 'follow', 'create_post'];
    
    if (notifyActions.includes(doc.action)) {
      const notificationData = {
        actor: doc.details?.actorId,
        post: doc.details?.postId,
        comment: doc.details?.commentId,
        extra: this.getNotificationMessage()
      };

      await notifyUser(
        doc.user, 
        this.getNotificationType(), 
        notificationData
      );
    }
  } catch (error) {
    console.error('Activity notification error:', error);
  }
});

// Helper to generate notification type based on action
activitySchema.methods.getNotificationType = function() {
  const typeMap = {
    'like_post': 'like',
    'comment': 'comment',
    'follow': 'follow',
    'create_post': 'post_created'
  };
  
  return typeMap[this.action] || 'activity';
};

// Helper to generate notification message
activitySchema.methods.getNotificationMessage = function() {
  const actor = this.details?.actorName || 'Someone';
  
  switch(this.action) {
    case 'like_post':
      return `${actor} liked your post`;
    case 'comment':
      return `${actor} commented on your post`;
    case 'follow':
      return `${actor} started following you`;
    case 'create_post':
      return `Your post was published`;
    default:
      return `New activity: ${this.action.replace('_', ' ')}`;
  }
};

module.exports = mongoose.model('Activity', activitySchema);
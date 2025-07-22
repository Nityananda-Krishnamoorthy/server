const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const notificationSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
 type: {
    type: String,
    required: true,
    enum: ['like', 'comment', 'share', 'mention', 'follow', 'tag', 'message', 'call'] // Define all possible notification types
  },
   data: {
    actor: { type: Schema.Types.ObjectId, ref: 'User' },
    conversation: { type: Schema.Types.ObjectId, ref: 'Conversation' }, // Added reference
    message: { type: Schema.Types.ObjectId, ref: 'Message' }, // Added reference
    post: { type: Schema.Types.ObjectId, ref: 'Post' },
    comment: { type: Schema.Types.ObjectId, ref: 'Comment' },
    extra: { type: String }
  },
  read: {
    type: Boolean,
    default: false
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Add TTL index to auto-delete notifications after 60 days
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 24 * 60 * 60 });

// Virtual for formatted notification message
notificationSchema.virtual('message').get(function() {
  const actor = this.data?.actor?.userName || 'Someone';
  
  switch(this.type) {
    case 'like':
      return `${actor} liked your post`;
    case 'comment':
      return `${actor} commented on your post`;
    case 'share':
      return `${actor} shared your post`;
    case 'mention':
      return `${actor} mentioned you`;
    case 'follow':
      return `${actor} started following you`;
    case 'tag':
      return `${actor} tagged you in a post`;
    case 'message':
      return this.data?.isGroup 
        ? `New message in ${this.data?.groupName || 'group'}`
        : `${actor} sent you a message`;
    case 'call':
      return `${actor} is calling you`;
    default:
      return 'New notification';
  }
});

// Add indexes for common queries
notificationSchema.index({ user: 1, read: 1 });
notificationSchema.index({ 'data.actor': 1 });
notificationSchema.index({ 'data.post': 1 });
notificationSchema.index({ 'data.conversationId': 1 });
notificationSchema.index({ 'data.messageId': 1 });

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = Notification;
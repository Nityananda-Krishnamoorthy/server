const { Schema, model } = require('mongoose');

const conversationSchema = new Schema({
  participants: [{
    type: Schema.Types.ObjectId, 
    ref: 'User',
    required: true
  }],
  isGroup: {
    type: Boolean,
    default: false
  },
  groupName: {
    type: String,
    trim: true
  },
  groupPhoto: {
    type: String,
    validate: {
      validator: v => v === null || /^(http|https):\/\/[^ "]+$/.test(v),
      message: 'Invalid image URL format'
    }
  },
  groupAdmins: [{
    type: Schema.Types.ObjectId, 
    ref: 'User'
  }],
  lastMessage: {
    type: Schema.Types.ObjectId,
    ref: 'Message'
  },
  mutedBy: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true }
});

// Indexes
conversationSchema.index({ participants: 1 });
conversationSchema.index({ updatedAt: -1 });
conversationSchema.index({ isGroup: 1, updatedAt: -1 });

// Virtual for unread message count per user
conversationSchema.virtual('unreadCount', {
  ref: 'Message',
  localField: '_id',
  foreignField: 'conversationId',
  count: true
});

module.exports = model('Conversation', conversationSchema);
// models/MessageModel.js
const { Schema, model } = require('mongoose');

const messageSchema = new Schema({
  conversationId: {
    type: Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
    index: true
  },
  senderId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  text: String,
  media: [{
    type: String,
    validate: {
      validator: v => /^(http|https):\/\/[^ "]+$/.test(v),
      message: 'Invalid media URL format'
    }
  }],
  call: {
    type: Schema.Types.ObjectId,
    ref: 'Call'
  },
  readBy: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  deliveredTo: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  deletedBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],

  status: {
    type: String,
    enum: ['sent', 'delivered', 'seen'],
    default: 'sent',
    index: true
  }
}, { 
  timestamps: true,
  toJSON: { virtuals: true }
});

// Virtual for message type
messageSchema.virtual('type').get(function() {
  if (this.call) return 'call';
  if (this.media && this.media.length > 0) return 'media';
  return 'text';
});

// Indexes
messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ senderId: 1, status: 1 });

module.exports = model('Message', messageSchema);
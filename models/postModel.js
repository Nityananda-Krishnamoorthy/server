// models/PostModel.js
const { Schema, model } = require('mongoose');

const postSchema = new Schema({
  creator: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  body: { type: String, trim: true, maxlength: 2000 },
  media: [{
    url: {
      type: String,
      required: true,
      validate: {
        validator: v => /^(http|https):\/\/[^ "]+$/.test(v),
        message: 'Invalid media URL format'
      }
    },
    type: {
      type: String,
      enum: ['image', 'gif', 'video', 'file'],
      required: true
    }
  }],
  likes: [{ user: { type: Schema.Types.ObjectId, ref: 'User' }, createdAt: { type: Date, default: Date.now } }],
  comments: [{
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    text: { type: String, required: true, trim: true, maxlength: 500 },
    isEdited: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
  }],
  shares: [{ user: { type: Schema.Types.ObjectId, ref: 'User' }, createdAt: { type: Date, default: Date.now } }],
  tags: [{ type: String, validate: v => /^[a-zA-Z0-9_]{1,20}$/.test(v) }],
  mentions: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  views: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  location: { type: String, default: null, trim: true },
  isEdited: { type: Boolean, default: false },
  originalPost: { type: Schema.Types.ObjectId, ref: 'Post' },
  sharedContent: {
    originalCreator: { type: Schema.Types.ObjectId, ref: 'User' },
    originalBody: String,
    originalImage: String
  },
  bookmarks: [{ type: Schema.Types.ObjectId, ref: 'User' }],

  // Soft delete
  deletedAt: { type: Date, default: null, index: true },
  deletionDeadline: { type: Date, default: null },

  // Scheduled post
  isScheduled: { type: Boolean, default: false },
  scheduledAt: { type: Date, default: null }
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform(doc, ret) {
      delete ret.views;
      delete ret.deletedAt;
      delete ret.deletionDeadline;
      return ret;
    }
  },
  toObject: {
    virtuals: true,
    transform(doc, ret) {
      delete ret.views;
      delete ret.deletedAt;
      delete ret.deletionDeadline;
      return ret;
    }
  }
});

// Virtuals
postSchema.virtual('likeCount').get(function () { return this.likes.length });
postSchema.virtual('commentCount').get(function () { return this.comments.length });
postSchema.virtual('shareCount').get(function () { return this.shares.length });
postSchema.virtual('viewCount').get(function () { return this.views.length });

// Indexes
postSchema.index({ createdAt: -1 });
postSchema.index({ creator: 1, deletedAt: 1, createdAt: -1 });
postSchema.index({ scheduledAt: 1, isScheduled: 1 });

// Query helper
postSchema.query.active = function () {
  return this.where({
    deletedAt: null,
    $or: [
      { isScheduled: false },
      { isScheduled: true, scheduledAt: { $lte: new Date() } }
    ]
  });
};

module.exports = model('Post', postSchema);

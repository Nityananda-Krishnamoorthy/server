// await Activity.create({
//   user: req.user.id,
//   action: 'post_created',
//   details: { postId: newPost._id }
// });const { Schema, model } = require('mongoose');
const { Schema, model } = require('mongoose');

const postSchema = new Schema({
  creator: { 
    type: Schema.Types.ObjectId, 
    ref: 'User', 
    required: true,
    index: true 
  },
  body: { 
    type: String, 
    required: true,
    trim: true,
    maxlength: 2000 
  },
  image: { 
    type: String, 
    default: null,
    validate: {
      validator: v => v === null || /^(http|https):\/\/[^ "]+$/.test(v),
      message: 'Invalid image URL format'
    }
  },
  likes: [{ 
    user: { 
      type: Schema.Types.ObjectId, 
      ref: 'User',
      index: true 
    },
    createdAt: { 
      type: Date, 
      default: Date.now 
    }
  }],
  comments: [{
    user: { 
      type: Schema.Types.ObjectId, 
      ref: 'User',
      index: true 
    },
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500
    },
    isEdited: { 
      type: Boolean, 
      default: false 
    },
    createdAt: { 
      type: Date, 
      default: Date.now 
    }
  }],
  shares: [{ 
    user: { 
      type: Schema.Types.ObjectId, 
      ref: 'User',
      index: true 
    },
    createdAt: { 
      type: Date, 
      default: Date.now 
    }
  }],
  tags: [{ 
    type: String, 
    validate: {
      validator: function(v) {
        return /^[a-zA-Z0-9_]{1,20}$/.test(v);
      },
      message: props => `${props.value} is not a valid tag!`
    },
    index: true
  }],
  views: [{ 
    type: Schema.Types.ObjectId, 
    ref: 'User',
    index: true 
  }],
  location: { 
    type: String, 
    default: null,
    trim: true
  },
  isEdited: { 
    type: Boolean, 
    default: false 
  },
  originalPost: { 
    type: Schema.Types.ObjectId, 
    ref: 'Post',
    index: true 
  },
  sharedContent: {
    originalCreator: { 
      type: Schema.Types.ObjectId, 
      ref: 'User' 
    },
    originalBody: String,
    originalImage: String
  },
  // Soft-delete fields
  deletedAt: { 
    type: Date, 
    default: null,
    index: true 
  },
  deletionDeadline: { 
    type: Date, 
    default: null,
    index: true 
  },
  // Scheduled post fields
  isScheduled: {
    type: Boolean,
    default: false
  },
  scheduledAt: {
    type: Date,
    default: null,
    index: true
  }
}, { 
  timestamps: true,
  toJSON: { 
    virtuals: true,
    transform: function(doc, ret) {
      delete ret.views;
      delete ret.deletedAt;
      delete ret.deletionDeadline;
      return ret;
    }
  },
  toObject: { 
    virtuals: true,
    transform: function(doc, ret) {
      delete ret.views;
      delete ret.deletedAt;
      delete ret.deletionDeadline;
      return ret;
    }
  }
});

// Virtuals for counts
postSchema.virtual('likeCount').get(function() {
  return this.likes.length;
});

postSchema.virtual('commentCount').get(function() {
  return this.comments.length;
});

postSchema.virtual('shareCount').get(function() {
  return this.shares.length;
});

postSchema.virtual('viewCount').get(function() {
  return this.views.length;
});

// Indexes for optimized queries
postSchema.index({ createdAt: -1 });
postSchema.index({ creator: 1, deletedAt: 1, createdAt: -1 });
postSchema.index({ scheduledAt: 1, isScheduled: 1 });
postSchema.index({ 'sharedContent.originalCreator': 1 });

// Query helper for active posts
postSchema.query.active = function() {
  return this.where({ 
    deletedAt: null,
    $or: [
      { isScheduled: false },
      { isScheduled: true, scheduledAt: { $lte: new Date() } }
    ]
  });
};

// Middleware to clean up before removal
postSchema.pre('remove', async function(next) {
  // Clean up references in other documents
  await this.model('User').updateMany(
    { savedPosts: this._id },
    { $pull: { savedPosts: this._id } }
  );
  
  // Remove associated activities
  await this.model('Activity').deleteMany({
    $or: [
      { 'details.postId': this._id },
      { 'details.originalPostId': this._id },
      { 'details.newPostId': this._id }
    ]
  });
  
  next();
});

module.exports = model('Post', postSchema);
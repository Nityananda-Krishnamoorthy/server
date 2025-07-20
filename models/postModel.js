// await Activity.create({
//   user: req.user.id,
//   action: 'post_created',
//   details: { postId: newPost._id }
// });

const { Schema, model } = require('mongoose');

const postSchema = new Schema({
  creator: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  body: { type: String, required: true },
  image: { type: String, default: null },
  likes: [{ 
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now }
  }],
  comments: [{ 
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    isEdited: { type: Boolean, default: false }
  }],
  shares: [{ 
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now }
  }],
  tags: [{ 
    type: String, 
    validate: {
      validator: function(v) {
        return /^[a-zA-Z0-9_]{1,20}$/.test(v);
      },
      message: props => `${props.value} is not a valid tag!`
    }
  }],
  location: { type: String, default: null },
  isEdited: { type: Boolean, default: false },
  isDeleted: { type: Boolean, default: false },
  originalPost: { type: Schema.Types.ObjectId, ref: 'Post' } // For shared posts
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for like count
postSchema.virtual('likeCount').get(function() {
  return this.likes.length;
});

// Virtual for comment count
postSchema.virtual('commentCount').get(function() {
  return this.comments.length;
});

// Virtual for share count
postSchema.virtual('shareCount').get(function() {
  return this.shares.length;
});

module.exports = model('Post', postSchema);


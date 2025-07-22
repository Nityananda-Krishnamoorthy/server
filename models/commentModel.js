const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  post: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Post', 
    required: true 
  },
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  text: { 
    type: String, 
    required: true,
    maxlength: 500
  },
  mentions: [String],
  isEdited: { 
    type: Boolean, 
    default: false 
  }
}, {
  timestamps: true // Adds createdAt and updatedAt
});

module.exports = mongoose.model('Comment', commentSchema);
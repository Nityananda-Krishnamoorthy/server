const mongoose = require('mongoose');
const { Schema } = mongoose;

const activitySchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  action: { type: String, required: true }, // e.g., 'login', 'post_created', 'profile_updated'
  details: Object, // optional meta info like postId, changes, etc.
  ipAddress: String,
  userAgent: String
}, { timestamps: true });

module.exports = mongoose.model('Activity', activitySchema);

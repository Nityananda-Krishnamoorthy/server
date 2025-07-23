const { Schema, model } = require('mongoose');

const userSchema = new Schema({
  fullName: { type: String, required: true },
  userName: { type: String, required: true, unique: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  profilePhoto: {
    type: String,
    default: "https://res.cloudinary.com/dydb9kwzu/image/upload/v1752883837/Profile_Picture_Avatar_zkftw4.png"
  },
  bio: {
    type: String,
    default: "This user has no bio"
  },
  followers: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  following: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  bookmarks: [{ type: Schema.Types.ObjectId, ref: 'Post' }],
  posts: [{ type: Schema.Types.ObjectId, ref: 'Post' }],
  isPrivate: { type: Boolean, default: false },
  blockedUsers: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  pendingFollowers: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  socialMedia: {
    twitter: String,
    instagram: String,
    linkedin: String,
    github: String
  },

  // Email Verification
  isVerified: { type: Boolean, default: false },
  verificationToken: String,
  verificationExpires: Date,
  resetPasswordToken: String,
  resetPasswordExpires: Date,

  //2FA
  tfaEnabled: { type: Boolean, default: false },
  tfaSecret: String,

}, { timestamps: true });




userSchema.methods.toJSON = function () {
  const user = this.toObject();
  delete user.password;
  delete user.__v;
  return user;
};

module.exports = model('User', userSchema);

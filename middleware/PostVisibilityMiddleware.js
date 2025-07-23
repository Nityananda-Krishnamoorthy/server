const HttpError = require('../models/errorModel');

// Middleware to check post visibility
const checkPostVisibility = async (req, res, next) => {
  try {
    const post = await PostModel.findById(req.params.id)
      .populate('author', 'isPrivate followers');
      
    if (!post) return next(new HttpError(404, "Post not found"));
    
    const isOwner = post.author._id.equals(req.user.id);
    const isFollowing = post.author.followers.includes(req.user.id);
    const isPublic = !post.author.isPrivate;
    
    if (!isOwner && (!isPublic || (post.author.isPrivate && !isFollowing))) {
      return next(new HttpError(403, "You don't have permission to view this post"));
    }
    
    req.post = post;
    next();
  } catch (error) {
    return next(new HttpError(500, "Visibility check failed"));
  }
};

module.exports = { checkPostVisibility };
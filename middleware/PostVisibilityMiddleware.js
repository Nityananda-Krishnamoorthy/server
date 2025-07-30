const mongoose = require('mongoose');
const HttpError = require('../models/errorModel');
const PostModel = require('../models/postModel');

const checkPostVisibility = async (req, res, next) => {
  const postId = req.params.id;

  // ✅ Validate ObjectId
  if (!mongoose.Types.ObjectId.isValid(postId)) {
    return next(new HttpError(400, "Invalid post ID"));
  }

  try {
    const post = await PostModel.findById(postId)
      .populate('creator', 'isPrivate followers');

    if (!post) {
      return next(new HttpError(404, "Post not found"));
    }

    const isOwner = post.creator._id.equals(req.user.id);
    const isFollowing = post.creator.followers.some(follower =>
      follower.toString() === req.user.id
    );
    const isPublic = !post.creator.isPrivate;

    const canView =
      isOwner || isPublic || (post.creator.isPrivate && isFollowing);

    if (!canView) {
      return next(new HttpError(403, "You don't have permission to view this post"));
    }

    req.post = post;
    next();
  } catch (error) {
    console.error("Visibility Check Error:", error);
    return next(new HttpError(500, "Visibility check failed"));
  }
};

module.exports = { checkPostVisibility };

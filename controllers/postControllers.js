const PostModel = require('../models/postModel');
const UserModel = require('../models/userModel');
const Notification = require('../models/notificationModel');
const HttpError = require('../models/errorModel');
//const notifyUser = require('../utils/notifyUser');
const uuid = require('uuid').v4;
const cloudinary = require('../utils/cloudinary');
const fs = require('fs');
const path = require('path');
const Activity = require('../models/activityModel');
const CommentModel = require('../models/commentModel');
const { sanitize } = require('../utils/sanitizer');
const bannedWords = require('../utils/bannedWords');
const mongoose = require('mongoose');
const NodeCache = require('node-cache');

// Initialize cache
const userCache = new NodeCache({ stdTTL: 300 }); // 5 minutes cache

// Validation constants
const MAX_POST_LENGTH = 2000;
const MAX_COMMENT_LENGTH = 500;

// ================== HELPER FUNCTIONS ====================
const uploadToCloudinary = async (file, folder, transformations = []) => {
  const tempFilePath = path.join(__dirname, '../uploads', `${uuid()}-${file.name}`);
  await file.mv(tempFilePath);
  
  const result = await cloudinary.uploader.upload(tempFilePath, {
    folder,
    transformation: transformations
  });
  
  fs.unlinkSync(tempFilePath);
  return result.secure_url;
};

// Improved profanity filter
function containsBannedWords(content) {
  if (!content) return false;
  return bannedWords.some(word => {
    const regex = new RegExp(`\\b${word.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
    return regex.test(content);
  });
}

// Efficient mention extraction
function extractMentions(text) {
  if (!text) return [];
  return [...new Set((text.match(/@([\w.-]+)/g) || []).map(m => m.slice(1).toLowerCase()))];
}


// Get user with caching
async function getCachedUser(userId) {
  const key = `user_${userId}`;
  let user = userCache.get(key);
  
  if (!user) {
    user = await UserModel.findById(userId).lean();
    if (user) userCache.set(key, user);
  }
  
  return user;
}

// Optimized notification
async function notifyMentionedUsers(usernames, postId, userId, commentId = null) {
  try {
    const users = await UserModel.find({ 
      userName: { $in: usernames },
      blockedUsers: { $ne: new mongoose.Types.ObjectId(userId) }
    });

    const notifications = users.map(user => ({
      user: user._id,
      type: 'mention',
      details: { 
        postId, 
        userId, 
        commentId,
        timestamp: new Date()
      }
    }));

    if (notifications.length > 0) {
      await Notification.insertMany(notifications);
    }
  } catch (error) {
    console.error('Notify Mentioned Users Error:', error);
  }
}

async function notifyUser(userId, type, data) {
  try {
    await Notification.create({
      user: userId,
      type,
      data,
      timestamp: new Date()
    });
  } catch (error) {
    console.error('Notify User Error:', error);
  }
}

function schedulePostDeletion(postId, deletionDate) {
  const delay = deletionDate - Date.now();
  
  setTimeout(async () => {
    try {
      const post = await PostModel.findById(postId);
      if (post && post.deletedAt && post.deletionDeadline < new Date()) {
        // Delete image
        if (post.image) {
          const publicId = post.image.split('/').pop().split('.')[0];
          await cloudinary.uploader.destroy(`posts/${publicId}`);
        }
        
        // Delete post and related activities
        await PostModel.findByIdAndDelete(postId);
        await Activity.deleteMany({ 'details.postId': postId });
        await Notification.deleteMany({ 'details.postId': postId });
      }
    } catch (error) {
      console.error('Scheduled Post Deletion Error:', error);
    }
  }, delay);
}

// ================= CREATE POST =================
const createPost = async (req, res, next) => {
  try {
    const { body, tags, location, scheduledAt } = req.body;
    const userId = req.user.id;

    if (!body && !req.files?.image) {
      return next(new HttpError(400, 'Post content or image is required'));
    }

    if (body && body.length > MAX_POST_LENGTH) {
      return next(new HttpError(400, `Post exceeds ${MAX_POST_LENGTH} character limit`));
    }

    if (body && containsBannedWords(body)) {
      return next(new HttpError(400, 'Post contains prohibited content'));
    }

    let imageUrl = '';
    if (req.files?.image) {
      imageUrl = await uploadToCloudinary(
        req.files.image, 
        'posts', 
        [{ width: 1000, crop: "limit" }, { quality: "auto" }]
      );
    }

    const tagArray = tags ? tags.split(',').map(tag => tag.trim().toLowerCase()) : [];
    const mentions = extractMentions(body);

    const newPost = new PostModel({
      creator: userId,
      body: body ? sanitize(body) : '',
      tags: tagArray,
      mentions: mentions,
      location: location || '',
      image: imageUrl,
      isScheduled: !!scheduledAt,
      scheduledAt: scheduledAt || null
    });

    await newPost.save();

    // Add post to user's posts array
    await UserModel.findByIdAndUpdate(userId, {
      $push: { posts: newPost._id }
    });

    // Log activity
    await Activity.create({
      user: userId,
      action: 'create_post',
      details: { postId: newPost._id }
    });

    // Notify mentioned users
    if (mentions.length > 0) {
      await notifyMentionedUsers(mentions, newPost._id, userId);
    }

    res.status(201).json(scheduledAt 
      ? { message: 'Post scheduled successfully', post: newPost, scheduledAt }
      : newPost
    );

  } catch (error) {
    console.error('Create Post Error:', error);
    return next(new HttpError(500, 'Failed to create post'));
  }
};


// ================= LIKE POST =================
const likePost = async (req, res, next) => {
  try {
    const postId = req.params.id;
    const userId = req.user.id;
    
    const post = await PostModel.findById(postId);
    if (!post) {
      return next(new HttpError(404, 'Post not found'));
    }

    // Check if user is blocked
    const creator = await getCachedUser(post.creator);
    if (creator.blockedUsers.some(id => id.equals(userId))) {
      return next(new HttpError(403, 'Action not allowed'));
    }

    // Check if already liked
    const existingLikeIndex = post.likes.findIndex(like => like.user.equals(userId));
    if (existingLikeIndex > -1) {
      return next(new HttpError(400, 'Post already liked'));
    }

    // Add like
    post.likes.push({ user: userId });
    await post.save();
    
    // Log activity
    await Activity.create({
      user: userId,
      action: 'like_post',
      details: { postId }
    });
    
    // Notify post owner
    if (!post.creator.equals(userId)) {
      await notifyUser(post.creator, 'like', {
        postId,
        userId
      });
    }

    res.status(200).json({ message: 'Post liked', likes: post.likes });
  } catch (error) {
    console.error('Like Post Error:', error);
    return next(new HttpError(500, 'Failed to like post'));
  }
};

// ================= UNLIKE POST =================
const unlikePost = async (req, res, next) => {
  try {
    const postId = req.params.id;
    const userId = req.user.id;
    
    const post = await PostModel.findById(postId);
    if (!post) {
      return next(new HttpError(404, 'Post not found'));
    }

    // Find and remove like
    const likeIndex = post.likes.findIndex(like => like.user.equals(userId));
    if (likeIndex === -1) {
      return next(new HttpError(400, 'Post not liked'));
    }

    post.likes.splice(likeIndex, 1);
    await post.save();
    
    // Log activity
    await Activity.create({
      user: userId,
      action: 'unlike_post',
      details: { postId }
    });

    res.status(200).json({ message: 'Post unliked', likes: post.likes });
  } catch (error) {
    console.error('Unlike Post Error:', error);
    return next(new HttpError(500, 'Failed to unlike post'));
  }
};

// ================= ADD COMMENT =================
const addComment = async (req, res, next) => {
  try {
    const postId = req.params.id;
    const userId = req.user.id;
    const { text } = req.body;

    if (!text) {
      return next(new HttpError(400, 'Comment text is required'));
    }
    
    // Content length validation
    if (text.length > MAX_COMMENT_LENGTH) {
      return next(new HttpError(400, `Comment exceeds ${MAX_COMMENT_LENGTH} character limit`));
    }
    
    // Content moderation
    if (containsBannedWords(text)) {
      return next(new HttpError(400, 'Comment contains prohibited content'));
    }

    const post = await PostModel.findById(postId);
    if (!post) {
      return next(new HttpError(404, 'Post not found'));
    }

    // Check if user is blocked
    const creator = await getCachedUser(post.creator);
    if (creator.blockedUsers.some(id => id.equals(userId))) {
      return next(new HttpError(403, 'Action not allowed'));
    }

    const mentions = extractMentions(text);
    
    // Create full comment document
    const newComment = new CommentModel({
      post: postId,
      user: userId,
      text: sanitize(text),
      mentions
    });
    await newComment.save();
    
    // Create minimal embedded comment
    const embeddedComment = {
      _id: newComment._id,
      user: userId,
      text: newComment.text,
      createdAt: newComment.createdAt
    };
    
    // Add to post's comments array
    post.comments.push(embeddedComment);
    await post.save();
    
    // Populate user info for response
    const populatedComment = await CommentModel.populate(newComment, {
      path: 'user',
      select: 'userName fullName profilePhoto'
    });

    // Log activity
    await Activity.create({
      user: userId,
      action: 'add_comment',
      details: { postId, commentId: newComment._id }
    });
    
    // Notify post owner and mentioned users
    if (!post.creator.equals(userId)) {
      await notifyUser(post.creator, 'comment', {
        postId,
        userId,
        commentId: newComment._id
      });
    }
    
    if (mentions.length > 0) {
      await notifyMentionedUsers(mentions, postId, userId, newComment._id);
    }

    // Return the full comment with user populated
    res.status(201).json(populatedComment);
  } catch (error) {
    console.error('Add Comment Error:', error);
    return next(new HttpError(500, 'Failed to add comment'));
  }
};

// ================= EDIT COMMENT =================
const editComment = async (req, res, next) => {
  try {
    const { postId, commentId } = req.params;
    const userId = req.user.id;
    const { text } = req.body;

    if (!text) {
      return next(new HttpError(400, 'Comment text is required'));
    }
    
    // Content length validation
    if (text.length > MAX_COMMENT_LENGTH) {
      return next(new HttpError(400, `Comment exceeds ${MAX_COMMENT_LENGTH} character limit`));
    }
    
    // Content moderation
    if (containsBannedWords(text)) {
      return next(new HttpError(400, 'Comment contains prohibited content'));
    }

    // Find the full comment document
    const comment = await CommentModel.findById(commentId);
    if (!comment) {
      return next(new HttpError(404, 'Comment not found'));
    }

    // Check ownership
    if (!comment.user.equals(userId)) {
      return next(new HttpError(403, 'Not authorized to edit this comment'));
    }

    const mentions = extractMentions(text);
    
    // Update full comment document
    comment.text = sanitize(text);
    comment.mentions = mentions;
    comment.isEdited = true;
    comment.updatedAt = Date.now();
    await comment.save();
    
    // Update embedded comment in post
    await PostModel.updateOne(
      { _id: postId, 'comments._id': commentId },
      { 
        $set: { 
          'comments.$.text': comment.text,
          'comments.$.isEdited': true
        } 
      }
    );
    
    // Log activity
    await Activity.create({
      user: userId,
      action: 'edit_comment',
      details: { postId, commentId }
    });
    
    // Notify new mentioned users
    if (mentions.length > 0) {
      await notifyMentionedUsers(mentions, postId, userId, commentId);
    }

    // Return updated comment
    const updatedComment = await CommentModel.findById(commentId)
      .populate('user', 'userName fullName profilePhoto');
      
    res.status(200).json(updatedComment);
  } catch (error) {
    console.error('Edit Comment Error:', error);
    return next(new HttpError(500, 'Failed to edit comment'));
  }
};

// ================= DELETE COMMENT =================
const deleteComment = async (req, res, next) => {
  try {
    const { commentId } = req.params; // Only need commentId
    const userId = req.user.id;

    // Find the full comment document
    const comment = await CommentModel.findById(commentId);
    if (!comment) {
      return next(new HttpError(404, 'Comment not found'));
    }

    // Get post ID from comment
    const postId = comment.post;
    
    // Check authorization
    const isCommentOwner = comment.user.equals(userId);
    const post = await PostModel.findById(postId);
    const isPostOwner = post?.creator.equals(userId); // Optional chaining
    
    if (!isCommentOwner && !isPostOwner) {
      return next(new HttpError(403, 'Not authorized to delete this comment'));
    }

    // Delete full comment document
    await CommentModel.findByIdAndDelete(commentId);
    
    // Remove from embedded comments (if post exists)
    if (post) {
      await PostModel.findByIdAndUpdate(postId, {
        $pull: { comments: { _id: commentId } }
      });
    }
    
    // Log activity
    await Activity.create({
      user: userId,
      action: 'delete_comment',
      details: { postId, commentId }
    });

    res.status(200).json({ message: 'Comment deleted' });
  } catch (error) {
    console.error('Delete Comment Error:', error);
    return next(new HttpError(500, 'Failed to delete comment'));
  }
};
// ================= SHARE POST =================
const sharePost = async (req, res, next) => {
  try {
    const postId = req.params.id;
    const userId = req.user.id;
    const { message } = req.body || {};
    
    const originalPost = await PostModel.findById(postId);
    if (!originalPost) {
      return next(new HttpError(404, 'Post not found'));
    }
    
    // Check if user is blocked
    const creator = await getCachedUser(originalPost.creator);
    if (creator.blockedUsers.some(id => id.equals(userId))) {
      return next(new HttpError(403, 'Action not allowed'));
    }

    // Create shared post
    const newPost = new PostModel({
      creator: userId,
      body: message || `Shared post: ${originalPost.body.substring(0, 100)}...`,
      originalPost: postId,
      sharedContent: {
        originalCreator: originalPost.creator,
        originalBody: originalPost.body,
        originalImage: originalPost.image
      }
    });

    await newPost.save();
    
    // Add share to original post
    originalPost.shares.push({ user: userId });
    await originalPost.save();
    
    // Log activity
    await Activity.create({
      user: userId,
      action: 'share_post',
      details: { originalPostId: postId, newPostId: newPost._id }
    });
    
    // Notify original creator
    if (!originalPost.creator.equals(userId)) {
      await notifyUser(originalPost.creator, 'share', {
        postId,
        userId
      });
    }

    res.status(201).json({
      message: 'Post shared successfully',
      sharedPost: newPost
    });
  } catch (error) {
    console.error('Share Post Error:', error);
    return next(new HttpError(500, 'Failed to share post'));
  }
};

// ================= EDIT POST =================
const editPost = async (req, res, next) => {
  try {
    const postId = req.params.id;
    const userId = req.user.id;
    const { body, tags, location } = req.body;

    const post = await PostModel.findById(postId);
    if (!post) {
      return next(new HttpError(404, 'Post not found'));
    }

    // Check ownership
    if (!post.creator.equals(userId)) {
      return next(new HttpError(403, 'Not authorized to edit this post'));
    }
    
    // Content moderation
    if (body && containsBannedWords(body)) {
      return next(new HttpError(400, 'Post contains prohibited content'));
    }
    
    // Content length validation
    if (body && body.length > MAX_POST_LENGTH) {
      return next(new HttpError(400, `Post exceeds ${MAX_POST_LENGTH} character limit`));
    }

    let newImageUrl;
    if (req.files?.image) {
      newImageUrl = await uploadToCloudinary(
        req.files.image, 
        'posts', 
        [{ width: 1000, crop: "limit" }, { quality: "auto" }]
      );
      
      // Delete old image if exists
      if (post.image) {
        const publicId = post.image.split('/').pop().split('.')[0];
        await cloudinary.uploader.destroy(`posts/${publicId}`);
      }
    }

    // Update fields
    if (body) {
      post.body = sanitize(body);
      post.mentions = extractMentions(body);
    }
    if (tags) post.tags = tags.split(',').map(tag => tag.trim().toLowerCase());
    if (location) post.location = location;
    if (newImageUrl) post.image = newImageUrl;
    
    post.isEdited = true;
    post.editedAt = Date.now();
    
    await post.save();
    
    // Log activity
    await Activity.create({
      user: userId,
      action: 'edit_post',
      details: { postId }
    });

    res.status(200).json(post);
  } catch (error) {
    console.error('Edit Post Error:', error);
    return next(new HttpError(500, 'Failed to edit post'));
  }
};

// ================= DELETE POST =================
const deletePost = async (req, res, next) => {
  try {
    const postId = req.params.id;
    const userId = req.user.id;

    const post = await PostModel.findById(postId);
    if (!post) {
      return next(new HttpError(404, 'Post not found'));
    }

    // Check ownership
    if (!post.creator.equals(userId)) {
      return next(new HttpError(403, 'Not authorized to delete this post'));
    }

    // Soft delete with recovery period
    post.deletedAt = Date.now();
    post.deletionDeadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    await post.save();

    // Schedule permanent deletion
    schedulePostDeletion(postId, post.deletionDeadline);
    
    // Log activity
    await Activity.create({
      user: userId,
      action: 'delete_post',
      details: { postId }
    });

    res.status(200).json({ 
      message: 'Post marked for deletion',
      recoverableUntil: post.deletionDeadline
    });
  } catch (error) {
    console.error('Delete Post Error:', error);
    return next(new HttpError(500, 'Failed to delete post'));
  }
};

// ================= RECOVER POST =================
const recoverPost = async (req, res, next) => {
  try {
    const postId = req.params.id;
    const userId = req.user.id;

    const post = await PostModel.findById(postId);
    if (!post) {
      return next(new HttpError(404, 'Post not found'));
    }

    if (!post.creator.equals(userId)) {
      return next(new HttpError(403, 'Not authorized to recover this post'));
    }

    if (!post.deletedAt || post.deletionDeadline < new Date()) {
      return next(new HttpError(400, 'Post cannot be recovered'));
    }

    post.deletedAt = null;
    post.deletionDeadline = null;
    await post.save();
    
    // Log activity
    await Activity.create({
      user: userId,
      action: 'recover_post',
      details: { postId }
    });

    res.status(200).json({ message: 'Post recovered successfully' });
  } catch (error) {
    console.error('Recover Post Error:', error);
    return next(new HttpError(500, 'Failed to recover post'));
  }
};

// ================= GET POST DETAILS =================
const getPost = async (req, res, next) => {
  try {
    const postId = req.params.id;
    const userId = req.user.id;

    // Use lean() for read-only operation
    const post = await PostModel.findById(postId)
      .populate('creator', 'userName fullName profilePhoto isPrivate')
      .populate('likes.user', 'userName fullName profilePhoto')
      .populate('comments.user', 'userName fullName profilePhoto')
      .populate('shares.user', 'userName fullName profilePhoto')
      .populate({
        path: 'originalPost',
        select: 'creator body image',
        populate: { 
          path: 'creator', 
          select: 'userName fullName profilePhoto' 
        }
      })
      .lean();

    // Check post existence and deletion status
    if (!post || post.deletedAt) {
      return next(new HttpError(404, 'Post not found'));
    }

    // Check block status using cached user
    const creator = await getCachedUser(post.creator._id);
    if (creator.blockedUsers.some(id => id.equals(userId))) {
      return next(new HttpError(403, 'You are blocked by this user'));
    }

    // Check visibility for private accounts
    const isFollowing = creator.followers.some(id => id.equals(userId));
    if (creator.isPrivate && !isFollowing && !creator._id.equals(userId)) {
      return next(new HttpError(403, 'This account is private'));
    }

    // Efficient view tracking using atomic update
    if (!post.views.some(viewId => viewId.equals(userId))) {
      await PostModel.updateOne(
        { _id: postId, 'views': { $ne: userId } },
        { $addToSet: { views: userId } }
      );
    }

    // Add view status to response
    const postWithViewStatus = { 
      ...post, 
      hasViewed: post.views.some(viewId => viewId.equals(userId))
    };
    
    res.status(200).json(postWithViewStatus);
  } catch (error) {
    console.error('Get Post Error:', error);
    return next(new HttpError(500, 'Failed to get post'));
  }
};

// ================= GET ALL POSTS (TIMELINE) =================
const getAllPosts = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;

    // Get following list from cached user
    const currentUser = await getCachedUser(userId);
    if (!currentUser) {
      return next(new HttpError(404, "User not found"));
    }

    // Create combined user IDs (following + self)
    const visibleUserIds = [
      ...currentUser.following, 
      new mongoose.Types.ObjectId(userId)
    ];

    // Optimized query with index support
    const query = {
      creator: { $in: visibleUserIds },
      deletedAt: null,
      $or: [
        { isScheduled: false },
        { isScheduled: true, scheduledAt: { $lte: new Date() } }
      ]
    };

    // Use parallel operations
    const [totalPosts, posts] = await Promise.all([
      PostModel.countDocuments(query),
      PostModel.find(query)
        .populate({
          path: 'creator',
          select: 'userName fullName profilePhoto isPrivate',
          match: { blockedUsers: { $nin: [userId] } }
        })
        .populate('likes.user', 'userName fullName profilePhoto')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
    ]);

    // Filter blocked users and add engagement metrics
    const filteredPosts = posts
      .filter(post => post.creator !== null)
      .map(post => ({
        ...post,
        likeCount: post.likes.length,
        commentCount: post.comments.length
      }));

    res.status(200).json({
      page,
      limit,
      total: totalPosts,
      count: filteredPosts.length,
      posts: filteredPosts
    });
  } catch (error) {
    console.error('Get All Posts Error:', error);
    next(new HttpError(500, 'Failed to fetch posts'));
  }
};

// ================= GET USER POSTS =================
const getPostsByUser = async (req, res, next) => {
  try {
    const username = req.params.username;
    const currentUserId = req.user.id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;

    // Get target user with projection
    const targetUser = await UserModel.findOne({ userName: username })
      .select('_id followers isPrivate blockedUsers');
    
    if (!targetUser) {
      return next(new HttpError(404, "User not found"));
    }

    // Check block status
    if (targetUser.blockedUsers.some(id => id.equals(currentUserId))) {
      return next(new HttpError(403, 'You are blocked by this user'));
    }

    // Check privacy settings
    const isFollowing = targetUser.followers.some(id => id.equals(currentUserId));
    if (targetUser.isPrivate && !isFollowing && !targetUser._id.equals(currentUserId)) {
      return next(new HttpError(403, 'This account is private'));
    }

    // Query with index support
    const postQuery = {
      creator: targetUser._id,
      deletedAt: null,
      $or: [
        { isScheduled: false },
        { isScheduled: true, scheduledAt: { $lte: new Date() } }
      ]
    };

    // Parallel execution
    const [total, posts] = await Promise.all([
      PostModel.countDocuments(postQuery),
      PostModel.find(postQuery)
        .populate('creator', 'userName fullName profilePhoto')
        .populate('likes.user', 'userName fullName profilePhoto')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
    ]);

    res.status(200).json({
      page,
      limit,
      total,
      posts: posts.map(post => ({
        ...post,
        likeCount: post.likes.length,
        commentCount: post.comments.length
      }))
    });
  } catch (error) {
    console.error('Get User Posts Error:', error);
    return next(new HttpError(500, 'Failed to fetch user posts'));
  }
};

// ================= BOOKMARK POST =================
const bookmarkPost = async (req, res, next) => {
  try {
    const postId = req.params.id;
    const userId = req.user.id;

    const post = await PostModel.findById(postId);
    if (!post) {
      return next(new HttpError(404, 'Post not found'));
    }

    // Check if already bookmarked
    const user = await UserModel.findById(userId);
    if (user.bookmarks.some(bm => bm.equals(postId))) {
      return next(new HttpError(400, 'Post already bookmarked'));
    }

    // Add bookmark
    user.bookmarks.push(postId);
    await user.save();
    
    // Log activity
    await Activity.create({
      user: userId,
      action: 'bookmark_post',
      details: { postId }
    });

    res.status(200).json({ message: 'Post bookmarked' });
  } catch (error) {
    console.error('Bookmark Post Error:', error);
    return next(new HttpError(500, 'Failed to bookmark post'));
  }
};

// ================= REMOVE BOOKMARK =================
const removeBookmark = async (req, res, next) => {
  try {
    const postId = req.params.id;
    const userId = req.user.id;

    const user = await UserModel.findById(userId);
    const index = user.bookmarks.findIndex(bm => bm.equals(postId));
    
    if (index === -1) {
      return next(new HttpError(400, 'Post not bookmarked'));
    }

    user.bookmarks.splice(index, 1);
    await user.save();

    res.status(200).json({ message: 'Bookmark removed' });
  } catch (error) {
    console.error('Remove Bookmark Error:', error);
    return next(new HttpError(500, 'Failed to remove bookmark'));
  }
};

// ================= GET BOOKMARKED POSTS =================
const getBookmarkedPosts = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    // Get current user with bookmarks
    const currentUser = await UserModel.findById(userId)
      .select('bookmarks following')
      .lean();

    if (!currentUser) {
      return next(new HttpError(404, 'User not found'));
    }

    // Get bookmarked posts with pagination
    const posts = await PostModel.find({
      _id: { $in: currentUser.bookmarks },
      deletedAt: null
    })
    .populate('creator', 'userName fullName profilePhoto isPrivate')
    .populate('likes.user', 'userName fullName profilePhoto')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit))
    .lean();

    // Early exit if no posts
    if (posts.length === 0) {
      return res.status(200).json({
        page,
        limit,
        count: 0,
        total: currentUser.bookmarks.length,
        posts: []
      });
    }

    // Get creator IDs and check blocks
    const creatorIds = [...new Set(posts.map(post => post.creator._id.toString()))];
    
    // Bulk check for blocked users
    const blockedByCreators = await UserModel.find(
      { 
        _id: { $in: creatorIds },
        blockedUsers: new mongoose.Types.ObjectId(userId)
      },
      '_id'
    ).lean();
    
    const blockedCreatorIds = new Set(blockedByCreators.map(u => u._id.toString()));

    // Filter accessible posts
    const accessiblePosts = posts.filter(post => {
      const creatorId = post.creator._id.toString();
      
      // Skip if blocked by creator
      if (blockedCreatorIds.has(creatorId)) {
        return false;
      }
      
      // Handle private accounts
      if (post.creator.isPrivate) {
        const isOwner = creatorId === userId;
        const isFollowing = currentUser.following.some(id => id.toString() === creatorId);
        return isOwner || isFollowing;
      }
      
      return true;
    });

    res.status(200).json({
      page,
      limit,
      count: accessiblePosts.length,
      total: currentUser.bookmarks.length,
      posts: accessiblePosts
    });
  } catch (error) {
    console.error('Get Bookmarked Posts Error:', error);
    return next(new HttpError(500, 'Failed to fetch bookmarked posts'));
  }
};

module.exports = {
  createPost,
  likePost,
  unlikePost,
  addComment,
  editComment,
  deleteComment,
  sharePost,
  editPost,
  deletePost,
  recoverPost,
  getPost,
  getAllPosts,
  getPostsByUser,
  bookmarkPost,
  getBookmarkedPosts,
  removeBookmark
};
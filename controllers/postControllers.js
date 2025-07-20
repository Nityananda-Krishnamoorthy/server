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

    // Validate content
    if (!body && !req.files?.image) {
      return next(new HttpError(400, 'Post content or image is required'));
    }

    // Content length validation
    if (body && body.length > MAX_POST_LENGTH) {
      return next(new HttpError(400, `Post exceeds ${MAX_POST_LENGTH} character limit`));
    }

    // Content moderation
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

    // Process tags and mentions
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

    const commentId = new mongoose.Types.ObjectId();
    const mentions = extractMentions(text);
    
    post.comments.push({
      _id: commentId,
      user: userId,
      text: sanitize(text),
      mentions
    });

    await post.save();
    
    // Log activity
    await Activity.create({
      user: userId,
      action: 'add_comment',
      details: { postId, commentId }
    });
    
    // Notify post owner and mentioned users
    if (!post.creator.equals(userId)) {
      await notifyUser(post.creator, 'comment', {
        postId,
        userId,
        commentId
      });
    }
    
    if (mentions.length > 0) {
      await notifyMentionedUsers(mentions, postId, userId, commentId);
    }

    res.status(201).json(post.comments);
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

    const post = await PostModel.findById(postId);
    if (!post) {
      return next(new HttpError(404, 'Post not found'));
    }

    const comment = post.comments.id(commentId);
    if (!comment) {
      return next(new HttpError(404, 'Comment not found'));
    }

    // Check ownership
    if (!comment.user.equals(userId)) {
      return next(new HttpError(403, 'Not authorized to edit this comment'));
    }

    const mentions = extractMentions(text);
    comment.text = sanitize(text);
    comment.isEdited = true;
    comment.mentions = mentions;
    comment.updatedAt = Date.now();
    
    await post.save();
    
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

    res.status(200).json(post.comments);
  } catch (error) {
    console.error('Edit Comment Error:', error);
    return next(new HttpError(500, 'Failed to edit comment'));
  }
};

// ================= DELETE COMMENT =================
const deleteComment = async (req, res, next) => {
  try {
    const { postId, commentId } = req.params;
    const userId = req.user.id;

    const post = await PostModel.findById(postId);
    if (!post) {
      return next(new HttpError(404, 'Post not found'));
    }

    const comment = post.comments.id(commentId);
    if (!comment) {
      return next(new HttpError(404, 'Comment not found'));
    }

    // Check ownership or post ownership
    const isCommentOwner = comment.user.equals(userId);
    const isPostOwner = post.creator.equals(userId);
    
    if (!isCommentOwner && !isPostOwner) {
      return next(new HttpError(403, 'Not authorized to delete this comment'));
    }

    post.comments.pull(commentId);
    await post.save();
    
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
    const { message } = req.body;
    
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

    const post = await PostModel.findById(postId)
      .populate('creator', 'userName fullName profilePhoto isPrivate')
      .populate('likes.user', 'userName fullName profilePhoto')
      .populate('comments.user', 'userName fullName profilePhoto')
      .populate('shares.user', 'userName fullName profilePhoto')
      .populate({
        path: 'originalPost',
        populate: { path: 'creator', select: 'userName fullName profilePhoto' }
      });

    // Check post existence
    if (!post || (post.deletedAt && post.deletionDeadline < new Date())) {
      return next(new HttpError(404, 'Post not found'));
    }

    // Check block status
    const creator = await getCachedUser(post.creator._id);
    if (creator.blockedUsers.some(id => id.equals(userId))) {
      return next(new HttpError(403, 'You are blocked by this user'));
    }

    // Check visibility for private accounts
    const isNotFollowing = 
      !creator.followers.some(id => id.equals(userId)) && 
      !post.creator._id.equals(userId);
      
    if (creator.isPrivate && isNotFollowing) {
      return next(new HttpError(403, 'This account is private'));
    }

    // Track unique views
    if (!post.views.includes(userId)) {
      post.views.push(userId);
      await post.save();
    }

    res.status(200).json(post);
  } catch (error) {
    console.error('Get Post Error:', error);
    return next(new HttpError(500, 'Failed to get post'));
  }
};

// ================= GET ALL POSTS (TIMELINE) =================
const getAllPosts = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    // Validate user existence
    const currentUser = await UserModel.findById(userId);
    if (!currentUser) {
      return next(new HttpError(404, "User not found"));
    }

    // Convert following list to ObjectIds
    const following = currentUser.following.map(id => id.toString());

    // Main query with combined conditions
    const query = {
      $and: [
        { 
          $or: [
            { creator: { $in: following } },
            { creator: userId } 
          ]
        },
        { deletedAt: null },
        { 
          $or: [
            { isScheduled: false },
            { 
              isScheduled: true, 
              scheduledAt: { $lte: new Date() } 
            }
          ]
        }
      ]
    };

    // Get total count BEFORE pagination
    const totalPosts = await PostModel.countDocuments(query);

    // Fetch posts with optimized population
    const posts = await PostModel.find(query)
      .populate({
        path: 'creator',
        select: 'userName fullName profilePhoto isPrivate blockedUsers',
        match: { blockedUsers: { $ne: userId } } // Pre-filter blocked
      })
      .populate('likes.user', 'userName fullName profilePhoto')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Filter out null creators (blocked users)
    const filteredPosts = posts.filter(post => post.creator !== null);

    res.status(200).json({
      page: parseInt(page),
      limit: parseInt(limit),
      total: totalPosts,  // Actual total matching documents
      count: filteredPosts.length,  // Current page count
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
    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    // Get target user
    const targetUser = await UserModel.findOne({ userName: username });
    if (!targetUser) {
      return next(new HttpError(404, "User not found"));
    }

    // Check block status
    if (targetUser.blockedUsers.some(id => id.equals(currentUserId))) {
      return next(new HttpError(403, 'You are blocked by this user'));
    }

    // Check privacy
    const isNotFollowing = 
      !targetUser.followers.some(id => id.equals(currentUserId)) && 
      !targetUser._id.equals(currentUserId);
      
    if (targetUser.isPrivate && isNotFollowing) {
      return next(new HttpError(403, 'This account is private'));
    }

    // Get posts
    const posts = await PostModel.find({
      creator: targetUser._id,
      deletedAt: null,
      $or: [
        { isScheduled: false },
        { isScheduled: true, scheduledAt: { $lte: new Date() } }
      ]
    })
    .populate('creator', 'userName fullName profilePhoto')
    .populate('likes.user', 'userName fullName profilePhoto')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit))
    .lean();

    const total = await PostModel.countDocuments({
      creator: targetUser._id,
      deletedAt: null
    });

    res.status(200).json({
      page,
      limit,
      total,
      posts
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
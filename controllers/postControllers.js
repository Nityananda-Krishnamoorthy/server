const PostModel = require('../models/postModel');
const UserModel = require('../models/userModel');
const Notification = require('../models/notificationModel');
const HttpError = require('../models/errorModel');
const notifyUser = require('../utils/notifyUser');
const uuid = require('uuid').v4;
const cloudinary = require('../utils/cloudinary');
const fs = require('fs');
const path = require('path');
const CommentModel = require('../models/commentModel');
const { sanitize } = require('../utils/sanitizer');
const bannedWords = require('../utils/bannedWords');
const mongoose = require('mongoose');
const NodeCache = require('node-cache');
const schedulePostDeletion = require('../utils/SchdulePostDeletion')

// Initialize cache
const userCache = new NodeCache({ stdTTL: 300 }); // 5 minutes cache

// Validation constants
const MAX_POST_LENGTH = 2000;
const MAX_COMMENT_LENGTH = 500;

// 🧠 Helper to inject isBookmarked
const injectBookmarkStatus = (post, userId) => {
  if (!post || !userId) return;
  const bookmarks = post.bookmarks || [];
  post.isBookmarked = bookmarks.some(bm => bm.toString() === userId.toString());
};

const dispatchNotification = async (type, recipients, data) => {
  try {
    const notifications = recipients.map(userId => ({
      user: userId,
      type,
      data: {
        actor: data.actor,
        ...data,
        timestamp: new Date()
      }
    }));

    if (notifications.length > 0) {
      await Notification.insertMany(notifications);
    }
  } catch (error) {
    console.error('Notification Dispatch Error:', error);
  }
};

// ================= MODIFIED HELPER: NOTIFY PARTICIPANTS =================
const notifyParticipants = async (type, recipients, data) => {
  try {
    if (!recipients || recipients.length === 0) return;
    
    await dispatchNotification(type, recipients, {
      actor: data.actor,
      ...data
    });
  } catch (error) {
    console.error('Notification Error:', error);
  }
};


// ================== HELPER FUNCTIONS ====================
const uploadToCloudinary = async (file, folder, transformations = []) => {
  const tempFilePath = path.join(__dirname, '../uploads', `${uuid()}-${file.name}`);
  await file.mv(tempFilePath);

  const mimeType = file.mimetype;
  let resourceType = 'auto'; // covers image, video, gif

  if (mimeType.startsWith('image/')) {
    resourceType = 'image';
  } else if (mimeType.startsWith('video/')) {
    resourceType = 'video';
  }

  const result = await cloudinary.uploader.upload(tempFilePath, {
    folder,
    resource_type: resourceType,
    transformation: transformations
  });

  fs.unlinkSync(tempFilePath);

  return {
    url: result.secure_url,
    format: result.format,
    resource_type: resourceType
  };
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


// ================= CREATE POST =================
const createPost = async (req, res, next) => {
  try {
    const { body, tags, location, scheduledAt } = req.body;
    const userId = req.user.id;

    if (!body && !req.files?.media) {
      return next(new HttpError(400, 'Post content or media is required'));
    }

    if (body && body.length > MAX_POST_LENGTH) {
      return next(new HttpError(400, `Post exceeds ${MAX_POST_LENGTH} character limit`));
    }

    if (body && containsBannedWords(body)) {
      return next(new HttpError(400, 'Post contains prohibited content'));
    }

    let media = [];

    if (req.files?.media) {
      const files = Array.isArray(req.files.media) ? req.files.media : [req.files.media];

      for (const file of files) {
        const upload = await uploadToCloudinary(
          file,
          'posts',
          [{ width: 1000, crop: "limit" }, { quality: "auto" }]
        );

        media.push({
          url: upload.url,
          type: upload.resource_type
        });
      }
    }

    const tagArray = tags
      ? Array.isArray(tags)
        ? tags.map(tag => tag.trim().toLowerCase())
        : tags.split(',').map(tag => tag.trim().toLowerCase())
      : [];

    const mentions = extractMentions(body);

    const newPost = new PostModel({
      creator: userId,
      body: body ? sanitize(body) : '',
      tags: tagArray,
      mentions,
      location: location || '',
      media,
      isScheduled: !!scheduledAt,
      scheduledAt: scheduledAt || null
    });

    await newPost.save();

    await UserModel.findByIdAndUpdate(userId, {
      $push: { posts: newPost._id }
    });

    if (mentions.length > 0) {
      await notifyMentionedUsers(mentions, newPost._id, userId);
    }

    return res.status(201).json(
      scheduledAt
        ? { message: 'Post scheduled successfully', post: newPost }
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
    // Inside likePost controller
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });


    //  Find the post
    const post = await PostModel.findById(postId);
    if (!post) {
      return next(new HttpError(404, 'Post not found'));
    }

    // Get the post creator and check if user is blocked
    const creator = await getCachedUser(post.creator);
    if (creator?.blockedUsers?.map(id => id.toString()).includes(userId)) {
      return next(new HttpError(403, 'Action not allowed — you are blocked by this user'));
    }

    // Check if user already liked the post
    const alreadyLiked = post.likes.some(like => like.user.toString() === userId);
    if (alreadyLiked) return next(new HttpError(400, 'Post already liked'));
    if (post.creator.toString() === userId) {
    return next(new HttpError(400, 'You cannot like your own post'));
  }
      //  Add like
    post.likes.push({ user: userId, timestamp: new Date() });
    await post.save();

    

 

    //  Log user Notification
      await notifyParticipants('like', [post.creator], {
      actor: userId,
      postId,
      isGroup: false
    });


    //  Respond
    res.status(200).json({
      message: 'Post liked successfully',
      likes: post.likes
    });

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

    const likeIndex = post.likes.findIndex(
      like => like.user.toString() === userId
    );

    if (likeIndex === -1) {
      return next(new HttpError(400, 'Post not liked'));
    }

    // Remove like
    post.likes.splice(likeIndex, 1);
    await post.save();

    
    // await notifyParticipants('unlike', [post.creator], {
    //   actor: userId,
    //   postId,
    //   isGroup: false
    // });

    return res.status(200).json({ message: 'Post unliked', likes: post.likes });
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

    // Log Notification
    const recipients = [];
    if (!post.creator.equals(userId)) {
      recipients.push(post.creator);
    }
    
    await notifyParticipants('comment', recipients, {
      actor: userId,
      postId,
      commentId: newComment._id,
      isGroup: false
    });
    
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
    
      await notifyParticipants('edit_comment', [comment.user], {
      actor: userId,
      postId,
      commentId,
      isGroup: false
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
    let isPostOwner = false;
    let post = null;

    if (postId) {
      post = await PostModel.findById(postId);
      isPostOwner = post?.creator?.equals(userId);
    }

    
    // Check authorization
    const isCommentOwner = comment.user.equals(userId);
    // const post = await PostModel.findById(postId);
    // const isPostOwner = post?.creator.equals(userId); // Optional chaining
    
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
    
    // Log Notification
     await notifyParticipants('delete_comment', [comment.user], {
      actor: userId,
      postId,
      commentId,
      isGroup: false
    });
    res.status(200).json({ message: 'Comment deleted' });
  } catch (error) {
    console.error('Delete Comment Error:', error.message, error.stack);
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
    
    // Log Notification
    if (!originalPost.creator.equals(userId)) {
      await notifyParticipants('share', [originalPost.creator], {
        actor: userId,
        postId,
        newPostId: newPost._id,
        isGroup: false
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

    const post = await PostModel.findById(postId);
    if (!post) return res.status(404).json({ message: 'Post not found' });
    if (post.creator.toString() !== userId) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    const { body, tags, location } = req.body;
    const updatedFields = {
      body: body || post.body,
      tags: tags ? tags.split(',').map(tag => tag.trim()) : post.tags,
      location: location || post.location,
    };

    // Handle media if uploaded
    if (req.files && req.files.length > 0) {
      updatedFields.media = req.files.map(file => ({
        url: file.path, // Or Cloudinary URL
        type: file.mimetype.startsWith('image')
          ? 'image'
          : file.mimetype.startsWith('video')
          ? 'video'
          : file.mimetype.startsWith('audio')
          ? 'audio'
          : 'unknown',
      }));
    }

    const updatedPost = await PostModel.findByIdAndUpdate(postId, updatedFields, { new: true });
    res.status(200).json(updatedPost);
  } catch (err) {
    next(err);
  }
};

// ================= DELETE POST =================
const deletePost = async (req, res, next) => {
  try {
    const postId = req.params.id;
    const userId = req.user.id;

    const post = await PostModel.findById(postId);
    if (!post) return next(new HttpError(404, 'Post not found'));

    if (!post.creator.equals(userId)) {
      return next(new HttpError(403, 'Not authorized to delete this post'));
    }

    // Soft delete
    post.deletedAt = Date.now();
    post.deletionDeadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await post.save();

    schedulePostDeletion(postId, post.deletionDeadline);

    res.status(200).json({
      message: 'Post marked for deletion. Recover within 30 days.',
      recoverableUntil: post.deletionDeadline
    });
  } catch (err) {
    console.error('Delete Post Error:', err);
    next(new HttpError(500, 'Failed to delete post'));
  }
};
//=================== DELETE PERMANENENTLY ============
const deletePostPermanently = async (req, res, next) => {
  try {
    const postId = req.params.id;
    const userId = req.user.id;

    const post = await PostModel.findById(postId);
    if (!post) return next(new HttpError(404, 'Post not found'));

    if (!post.creator.equals(userId)) {
      return next(new HttpError(403, 'Not authorized to delete this post'));
    }

    if (!post.deletedAt) {
      return next(new HttpError(400, 'Post must be soft-deleted first'));
    }

    await PostModel.findByIdAndDelete(postId);

    res.status(200).json({ message: 'Post permanently deleted' });
  } catch (err) {
    console.error('Permanent Delete Error:', err);
    next(new HttpError(500, 'Failed to permanently delete post'));
  }
};



const getDeletedPosts = async (req, res, next) => {
  try {
    const posts = await PostModel.find({
  creator: req.user.id,
  deletedAt: { $ne: null },
  deletionDeadline: { $gte: new Date() }
})
  .sort({ deletedAt: -1 })
  .lean(); // optional


    res.status(200).json(posts);
  } catch (err) {
    console.error('Get Deleted Posts Error:', err);
    next(new HttpError(500, 'Failed to fetch deleted posts'));
  }
};


// ================= RECOVER POST =================
const recoverPost = async (req, res, next) => {
  try {
    const postId = req.params.id;
    const userId = req.user.id;

    const post = await PostModel.findOne({ _id: postId, creator: userId });

    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    if (!post.deletedAt) {
      return res.status(400).json({ message: 'Post is not deleted' });
    }

    post.deletedAt = null;
    post.deletionDeadline = null;
    await post.save();

    res.status(200).json({ message: 'Post recovered successfully', post });
  } catch (err) {
    console.error('Recover Post Error:', err);
    next(new HttpError(500, 'Failed to recover post'));
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
    if (creator.blockedUsers.some(id => id.equals(userId))) {
  return next(new HttpError(403, 'You are blocked by this user'));
    }
    if (creator.isPrivate && !isFollowing && !creator._id.equals(userId)) {
      return next(new HttpError(403, 'This account is private'));
    }

    if (!post || post.deletedAt) {
  return next(new HttpError(404, 'Post not found'));
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
const getUserPost = async (req, res, next) => {
  try {
    const user = await UserModel.findById(req.params.id).select('-password');
    if (!user) {
      return next(new HttpError(404, 'User not found'));
    }

    res.status(200).json(user);
  } catch (error) {
    console.error('Get User By ID Error:', error);
    return next(new HttpError(500, 'Failed to fetch user'));
  }
};

// ================= GET ALL POSTS (TIMELINE) =================
const getAllPosts = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;

    const currentUser = await getCachedUser(userId);
    if (!currentUser) {
      return next(new HttpError(404, "User not found"));
    }
    const isExplore = req.query.explore === 'true';

    const visibleUserIds = [
      ...currentUser.following.map(id => new mongoose.Types.ObjectId(id)),
      new mongoose.Types.ObjectId(userId)
    ];

    const query = {
      deletedAt: null,
      $or: [
        { isScheduled: false },
        { isScheduled: true, scheduledAt: { $lte: new Date() } }
      ]
    };
    if (!isExplore) {
      query.creator = { $in: visibleUserIds };
    }

    const [totalPosts, posts] = await Promise.all([
      PostModel.countDocuments(query),
      PostModel.find(query)
          .populate({
                path: "creator",
                select: "userName fullName profilePhoto isPrivate blockedUsers"
              })

        .populate("likes bookmarks", "userName fullName profilePhoto")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select("+deletedAt creater media comments body likes shares tags mentions bookmarks location views originalPost sharedContent") // Include `comments` and `likes` if using `.lean()`
        .lean()
        
    ]);

     const filteredPosts = posts
  .filter(post => {
    if (!post.creator) return false;
    if (isExplore && post.creator.isPrivate) return false;
    return true;
  })
  .map(post => ({
    ...post,
    likeCount: post.likes?.length || 0,
    commentCount: post.comments?.length || 0
  }));


    res.status(200).json({
      page,
      limit,
      total: totalPosts,
      count: filteredPosts.length,
      posts: filteredPosts
    });
  } catch (error) {
    console.error("Get All Posts Error:", error);
    next(new HttpError(500, "Failed to fetch posts"));
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
      .select('+deletedAt')
        .populate('creator', 'userName fullName profilePhoto')
        .populate('likes bookmarks', 'userName fullName profilePhoto')
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
    if (!post) return next(new HttpError(404, "Post not found"));

    const user = await UserModel.findById(userId);
    if (!user) return next(new HttpError(404, "User not found"));

    if (user.bookmarks?.some(bm => bm.toString() === postId)) {
      return next(new HttpError(400, "Post already bookmarked"));
    }

    user.bookmarks.push(postId);
    await user.save();

    res.status(200).json({
      message: "Post bookmarked",
      isBookmarked: true,
      postId
    });

    notifyParticipants("bookmark", [userId], {
      actor: userId,
      postId,
      isGroup: false
    }).catch(console.error);

  } catch (error) {
    console.error("Bookmark Post Error:", error);
    return next(new HttpError(500, "Failed to bookmark post"));
  }
};

// ================= REMOVE BOOKMARK =================
const removeBookmark = async (req, res, next) => {
  try {
    const postId = req.params.id;
    const userId = req.user.id;

    const user = await UserModel.findById(userId);
    if (!user) {
      return next(new HttpError(404, 'User not found'));
    }

    const index = user.bookmarks.findIndex(bm => bm?.toString() === postId);
    if (index === -1) {
      return next(new HttpError(400, 'Post not bookmarked'));
    }

    user.bookmarks.splice(index, 1);
    await user.save();

    res.status(200).json({ message: 'Bookmark removed', postId });

    // Optional: Notify (non-blocking)
    notifyParticipants('remove_bookmark', [userId], {
      actor: userId,
      postId,
      isGroup: false
    }).catch(console.error);

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

    // Validate pagination parameters
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    
    if (isNaN(pageNum)) {
      return next(new HttpError(400, 'Invalid page parameter'));
    }
    
    if (isNaN(limitNum)) {
      return next(new HttpError(400, 'Invalid limit parameter'));
    }


    // Get current user with bookmarks
    const currentUser = await UserModel.findById(userId)
      .select('bookmarks following')
      .lean();

    if (!currentUser) {
      return next(new HttpError(404, 'User not found'));
    }

    // Early exit if no bookmarks
    if (currentUser.bookmarks.length === 0) {
      return res.status(200).json({
        page: pageNum,
        limit: limitNum,
        count: 0,
        total: 0,
        posts: []
      });
    }

    // Get bookmarked posts with pagination
    const posts = await PostModel.find({
      _id: { $in: currentUser.bookmarks },
      deletedAt: null // Exclude soft-deleted posts
    })
    .populate('creator', 'userName fullName profilePhoto isPrivate')
    .populate('likes.user', 'userName fullName profilePhoto')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNum)
    .lean();

    // Early exit if no posts
    if (posts.length === 0) {
      return res.status(200).json({
        page: pageNum,
        limit: limitNum,
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
      page: pageNum,
      limit: limitNum,
      count: accessiblePosts.length,
      total: currentUser.bookmarks.length,
      posts: accessiblePosts
    });
  } catch (error) {
    console.error('Get Bookmarked Posts Error:', error);
    return next(new HttpError(500, 'Failed to fetch bookmarked posts'));
  }
};
// ================= GET Trend =================
const getTrendingTopics = async (req, res, next) => {
  try {
    // Get top 10 trending tags from last 7 days
    const trendingTopics = await PostModel.aggregate([
      {
        $match: {
          createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          tags: { $exists: true, $ne: [] }
        }
      },
      { $unwind: "$tags" },
      {
        $group: {
          _id: "$tags",
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
      {
        $project: {
          tag: "$_id",
          count: 1,
          _id: 0
        }
      }
    ]);
    
    res.status(200).json(trendingTopics);
  } catch (error) {
    console.error("Trending Topics Error:", error);
    return next(new HttpError(500, "Failed to fetch trending topics"));
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
  deletePostPermanently ,
   getDeletedPosts,
  recoverPost,
  getPost,
  getAllPosts,
  getPostsByUser,
  bookmarkPost,
  getBookmarkedPosts,
  removeBookmark,
  getTrendingTopics
};
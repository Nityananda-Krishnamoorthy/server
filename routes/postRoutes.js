const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const {checkPostVisibility} = require('../middleware/PostVisibilityMiddleware');

const {
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
} = require('../controllers/postControllers');

// Create Post
router.post('/', authMiddleware, createPost);

// Get Posts
router.get('/', authMiddleware, getAllPosts);
router.get('/user/:username', authMiddleware, getPostsByUser);
router.get('/bookmarks', authMiddleware, getBookmarkedPosts);

// Apply visibility middleware to all post ID routes
router.use('/:id', authMiddleware, checkPostVisibility);

// Post ID routes (protected by visibility check)
router.get('/:id', getPost);
router.patch('/:id', editPost);
router.delete('/:id', deletePost);
router.patch('/:id/recover', recoverPost);
router.post('/:id/like', likePost);
router.delete('/:id/like', unlikePost);
router.post('/:id/comments', addComment);
router.post('/:id/share', sharePost);
router.post('/:id/bookmarks', bookmarkPost);
router.delete('/:id/bookmarks', removeBookmark);

// Comments routes (need to adjust to include post ID)
router.patch('/:id/comments/:commentId', editComment);
router.delete('/:id/comments/:commentId', deleteComment);

module.exports = router;
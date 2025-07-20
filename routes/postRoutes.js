const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');

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
router.get('/:id', authMiddleware, getPost);

// Reactions
router.post('/:id/like', authMiddleware, likePost);
router.delete('/:id/like', authMiddleware, unlikePost);

// Comments
router.post('/:id/comments', authMiddleware, addComment);
router.patch('/:id/comments/:commentId', authMiddleware, editComment);
router.delete('/:id/comments/:commentId', authMiddleware, deleteComment);

// Sharing
router.post('/:id/share', authMiddleware, sharePost);

// Post Management
router.patch('/:id', authMiddleware, editPost);
router.delete('/:id', authMiddleware, deletePost);
router.patch('/:id/recover', authMiddleware, recoverPost);

// Bookmarks
router.post('/:id/bookmarks', authMiddleware, bookmarkPost);
router.delete('/:id/bookmarks', authMiddleware, removeBookmark);

module.exports = router;
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
} = require('../controllers/postControllers');

// Create Post
router.post('/', authMiddleware, createPost);

// Get Posts
router.get('/', authMiddleware, getAllPosts);
router.get('/user/:username', authMiddleware, getPostsByUser);
router.post('/:id/bookmarks',authMiddleware, bookmarkPost);
router.delete('/:id/bookmarks',authMiddleware, removeBookmark);

// Add this route
router.get('/trending', authMiddleware, getTrendingTopics);
router.get('/deleted/list',authMiddleware, getDeletedPosts);

// Post ID routes (protected by visibility check)
router.get('/:id',authMiddleware, checkPostVisibility, getPost);
router.patch('/:id',authMiddleware, checkPostVisibility, editPost);
router.delete('/:id', authMiddleware, checkPostVisibility,deletePost);
router.delete('/:id/permanent', authMiddleware, checkPostVisibility, deletePostPermanently);




router.patch('/:id/recover',authMiddleware, checkPostVisibility, recoverPost);
router.post('/:id/like',authMiddleware, checkPostVisibility, likePost);
router.delete('/:id/like',authMiddleware, checkPostVisibility, unlikePost);
router.post('/:id/comments',authMiddleware, checkPostVisibility, addComment);
router.post('/:id/share',authMiddleware, checkPostVisibility,sharePost);


// Comments routes (need to adjust to include post ID)
router.patch('/:id/comments/:commentId',authMiddleware, checkPostVisibility, editComment);
router.delete('/:id/comments/:commentId',authMiddleware, checkPostVisibility, deleteComment);

module.exports = router;
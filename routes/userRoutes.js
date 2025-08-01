const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { authLimiter } = require('../middleware/rateLimit');
const { refreshToken } = require('../controllers/authController');
const {
  registerUser,
  verifyEmail,
  loginUser,
  forgotPassword,
  resetPassword,
  validateResetToken,
  getCurrentUser,
  getUserProfile,
  updateUser,
  changeUserProfilePhoto,
  followUser,
  unfollowUser,
  blockUser,
  unblockUser,
  respondToFollowRequest,
  getFollowRequests,
  getSuggestedUsers,
  searchUsers,
  deactivateAccount,
   getBookmarkedPosts,
   getBlockedUsers,
   getUserById,
   getUserPosts
  
} = require('../controllers/userControllers');


// Public
router.post('/register', authLimiter, registerUser);
router.post('/login', authLimiter, loginUser);
// Email verification
router.get('/verify-email/:token', verifyEmail);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.get('/validate-reset-token/:token', validateResetToken);
router.get('/bookmarks', authMiddleware, getBookmarkedPosts);

// Authenticated
router.get('/me', authMiddleware, getCurrentUser);
router.get('/suggested', authMiddleware, getSuggestedUsers);
router.get('/search', authMiddleware, searchUsers);
router.get('/:id', authMiddleware, getUserById);
router.get('/:id/posts', authMiddleware, getUserPosts);
router.get('/:username', authMiddleware, getUserProfile);
// router.get('/', authMiddleware, getUsers);
// Route
router.get('/me/blocked-users', authMiddleware, getBlockedUsers);
// In your routes file (e.g., userRoutes.js)
router.get('/me/pending-requests', authMiddleware, getFollowRequests);
router.post('/:username/follow-requests', authMiddleware, respondToFollowRequest);




router.patch('/me', authMiddleware,updateUser);
router.patch('/me/avatar', authMiddleware, changeUserProfilePhoto);
router.post('/me/deactivate', authMiddleware, deactivateAccount);

router.post('/:username/follow', authMiddleware, followUser);
router.delete('/:username/follow', authMiddleware, unfollowUser);
router.post('/:username/block', authMiddleware, blockUser);
router.delete('/:username/block', authMiddleware, unblockUser);

//refresh token route
router.post('/refresh-token', authMiddleware, refreshToken);


module.exports = router;

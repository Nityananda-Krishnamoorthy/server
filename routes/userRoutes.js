const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { authLimiter } = require('../middleware/rateLimit');

const {
  registerUser,
  loginUser,
  getCurrentUser,
  getUserProfile,
  updateUser,
  changeUserProfilePhoto,
  followUser,
  unfollowUser,
  blockUser,
  unblockUser,
  respondToFollowRequest,
  getSuggestedUsers,
  searchUsers,
  deactivateAccount
} = require('../controllers/userControllers');

// Public
router.post('/register', authLimiter, registerUser);
router.post('/login', authLimiter, loginUser);

// Authenticated
router.get('/me', authMiddleware, getCurrentUser);
router.get('/suggested', authMiddleware, getSuggestedUsers);
router.get('/search', authMiddleware, searchUsers);
router.get('/:username', authMiddleware, getUserProfile);
// router.get('/', authMiddleware, getUsers);

router.patch('/me', authMiddleware, updateUser);
router.patch('/me/avatar', authMiddleware, changeUserProfilePhoto);
router.post('/me/deactivate', authMiddleware, deactivateAccount);

router.post('/:username/follow', authMiddleware, followUser);
router.delete('/:username/follow', authMiddleware, unfollowUser);
router.post('/:username/block', authMiddleware, blockUser);
router.delete('/:username/block', authMiddleware, unblockUser);
router.post('/:username/follow-requests', authMiddleware, respondToFollowRequest);

module.exports = router;

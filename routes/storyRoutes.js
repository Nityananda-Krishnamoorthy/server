const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const {
  createStory,
  getUserStories,
  getTimelineStories,
  markStoryAsSeen,
  reactToStory
} = require('../controllers/storyController');

router.post('/', authMiddleware, createStory);
router.get('/user/:userId', authMiddleware, getUserStories);
router.get('/timeline', authMiddleware, getTimelineStories);
router.post('/:storyId/seen', authMiddleware, markStoryAsSeen);
router.post('/:storyId/react', authMiddleware, reactToStory);

module.exports = router;
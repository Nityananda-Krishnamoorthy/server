const express = require('express');
const router = express.Router();

const userRoutes = require('./userRoutes');
const postRoutes = require('./postRoutes');
const chatRoutes = require('./chatRoutes');
const storyRoutes = require('./storyRoutes')
const notificationRoutes = require('./notificationRoutes');
const activityLog = require('./activityLog')
const { getTurnCredentials } = require('../controllers/turnController');
const authMiddleware = require('../middleware/authMiddleware');

router.use('/users', userRoutes);
router.use('/posts', postRoutes);
router.use('/chats', chatRoutes);
router.use('/stories', storyRoutes)
router.use('/notifications', notificationRoutes);
router.use('/activities', activityLog )
router.post('/turn-credentials', authMiddleware, getTurnCredentials);

module.exports = router;

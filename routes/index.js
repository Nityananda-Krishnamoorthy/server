const express = require('express');
const router = express.Router();

const userRoutes = require('./userRoutes');
const postRoutes = require('./postRoutes');
const chatRoutes = require('./chatRoutes');
const notificationRoutes = require('./notificationRoutes');
const { getTurnCredentials } = require('../controllers/turnController');
const authMiddleware = require('../middleware/authMiddleware');

router.use('/users', userRoutes);
router.use('/posts', postRoutes);
router.use('/chat', chatRoutes);
router.use('/notifications', notificationRoutes);
router.post('/turn-credentials', authMiddleware, getTurnCredentials);

module.exports = router;

const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const {
  getUserNotifications,
  markAsRead
} = require('../controllers/notificationControllers');

router.get('/', authMiddleware, getUserNotifications);
router.patch('/:id/read', authMiddleware, markAsRead);

module.exports = router;
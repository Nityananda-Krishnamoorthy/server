const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const {
  getUserNotifications,
  markAsRead,
  deleteNotification
} = require('../controllers/notificationControllers');

router.get('/', authMiddleware, getUserNotifications);
router.delete('/:id', authMiddleware, deleteNotification);
router.patch('/:id/read', authMiddleware, markAsRead);

module.exports = router;
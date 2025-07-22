const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const {
  startConversation,
  sendMessage,
  getConversations,
  getMessages,
  startVideoCall,
  updateCallStatus
} = require('../controllers/chatControllers'); // Removed updateMessageStatus
const upload = require('../middleware/multer');

// Conversation routes
router.post('/conversations', authMiddleware, startConversation);
router.get('/conversations', authMiddleware, getConversations);

// Message routes
router.post('/messages', authMiddleware, upload.array('media', 10), sendMessage);
router.get('/conversations/:id/messages', authMiddleware, getMessages);

// Call routes
router.post('/calls', authMiddleware, startVideoCall);
router.patch('/calls/:id', authMiddleware, updateCallStatus);

module.exports = router;
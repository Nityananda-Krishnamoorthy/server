const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const Activity = require('../models/activityModel');

// Get user activities
router.get('/', authMiddleware, async (req, res) => {
  try {
    const activities = await Activity.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .limit(50);
    
    res.json({ activities });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching activities' });
  }
});

module.exports = router;
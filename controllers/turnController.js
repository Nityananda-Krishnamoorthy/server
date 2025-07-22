// controllers/turnController.js
const crypto = require('crypto');

const getTurnCredentials = (req, res) => {
  try {
    const { username } = req.body;
    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    const secret = process.env.TURN_SECRET;
    if (!secret) {
      return res.status(500).json({ error: 'TURN server not configured' });
    }

    // 24-hour validity
    const timestamp = Math.floor(Date.now() / 1000) + 24 * 3600; 
    const hmac = crypto.createHmac('sha1', secret);
    hmac.update(`${timestamp}:${username}`);
    const password = hmac.digest('base64');

    res.json({
      urls: [
        `turn:${process.env.TURN_DOMAIN}:3478?transport=udp`,
        `turn:${process.env.TURN_DOMAIN}:3478?transport=tcp`,
        `turns:${process.env.TURN_DOMAIN}:5349?transport=tcp`
      ],
      username: `${timestamp}:${username}`,
      credential: password
    });
  } catch (error) {
    console.error('TURN Credentials Error:', error);
    res.status(500).json({ error: 'Failed to generate TURN credentials' });
  }
};

module.exports = { getTurnCredentials };
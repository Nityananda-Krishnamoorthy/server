// middlewares/rateLimit.js
const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
  windowMs: 2 * 60 * 1000, 
  max: 10,
  message: {
    status: "fail",
    message: "Too many attempts, please try again after 2 minutes",
  },
  standardHeaders: true, // for better client-side handling
  legacyHeaders: false,
});

module.exports = { authLimiter };

// src/controllers/authController.js
const jwt = require('jsonwebtoken');
const HttpError = require('../models/errorModel');

const refreshToken = async (req, res, next) => {
  try {
    const { token } = req.body;

    if (!token) {
      return next(new HttpError(400, "Refresh token is required"));
    }

    // Verify using refresh token secret
    jwt.verify(token, process.env.REFRESH_TOKEN_SECRET, (err, decoded) => {
      if (err) {
        if (err.name === 'TokenExpiredError') {
          return next(new HttpError(401, "Refresh token expired"));
        }
        return next(new HttpError(401, "Invalid refresh token"));
      }

      // Create new access token
      const newAccessToken = jwt.sign(
        { id: decoded.id },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
      );

      // Create new refresh token (optional: implement refresh token rotation)
      const newRefreshToken = jwt.sign(
        { id: decoded.id },
        process.env.REFRESH_TOKEN_SECRET,
        { expiresIn: '7d' }
      );

      res.status(200).json({ 
        token: newAccessToken,
        refreshToken: newRefreshToken,
        expiresIn: process.env.JWT_EXPIRES_IN || 3600 // in seconds
      });
    });
  } catch (error) {
    console.error("Refresh Token Error:", error);
    return next(new HttpError(500, "Token refresh failed"));
  }
};

module.exports = { refreshToken };
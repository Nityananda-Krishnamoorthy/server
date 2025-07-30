const jwt = require("jsonwebtoken");
const HttpError = require("../models/errorModel");
const User = require("../models/userModel");

const authMiddleware = async (req, res, next) => {
  const authHeader = req?.headers?.authorization || req?.headers?.Authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next(new HttpError(401, "You are not authorized to access this route."));
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded?.id).select("-password");
    if (!user) return next(new HttpError(404, "User not found"));

    req.user = user;
    next();
  } catch (err) {
    console.error("authMiddleware error:", err.message);
    return next(new HttpError(401, "Invalid or expired token."));
  }
};

module.exports = authMiddleware;

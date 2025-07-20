const HttpError = require('../models/errorModel');

// UNSUPPORTED ENDPOINTS
const notFound = (req, res, next) => {
  const error = new HttpError(404, `Cannot find ${req.originalUrl} on this server!`);
  next(error);
};

// ERROR HANDLER
const errorHandler = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  const statusCode = err.statusCode || 500;
  const message = err.message || 'An unexpected error occurred';

  res.status(statusCode).json({
    status: 'error',
    message: message,
  });
};

module.exports = {
  notFound,
  errorHandler,
};

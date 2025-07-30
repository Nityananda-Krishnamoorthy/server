// Activity middleware
const activityLogger = (action) => {
  return async (req, res, next) => {
    res.on('finish', async () => {
      if (res.statusCode < 400) {
        await Activity.create({
          user: req.user.id,
          action,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          details: req.body
        });
      }
    });
    next();
  };
};
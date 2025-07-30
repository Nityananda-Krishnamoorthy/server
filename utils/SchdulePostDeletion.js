// utils/schedulePostDeletion.js
const cron = require('node-cron');
const PostModel = require('../models/postModel');

const scheduledJobs = new Map();

function schedulePostDeletion(postId, deletionTime) {
  const delay = new Date(deletionTime) - Date.now();

  if (delay <= 0) return;

  const timeout = setTimeout(async () => {
    try {
      const post = await PostModel.findById(postId);

      if (post && post.deletedAt && post.deletionDeadline <= new Date()) {
        await post.deleteOne(); // permanently remove
        console.log(`Post ${postId} permanently deleted`);
      }
    } catch (error) {
      console.error(`Failed to delete post ${postId}:`, error);
    } finally {
      scheduledJobs.delete(postId);
    }
  }, delay);

  scheduledJobs.set(postId.toString(), timeout);
}

module.exports = schedulePostDeletion;

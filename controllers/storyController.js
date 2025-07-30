const StoryModel = require('../models/storyModel');
const HttpError = require('../models/errorModel');
const cloudinary = require('../utils/cloudinary');

// CREATE STORY
const createStory = async (req, res, next) => {
  try {
    const { userId } = req.user;
    const { type } = req.body;
    
    if (!req.files?.media) {
      return next(new HttpError(400, 'Media file is required'));
    }
    
    const media = req.files.media;
    let mediaUrl;
    
    // Upload to Cloudinary
    const result = await cloudinary.uploader.upload(media.tempFilePath, {
      folder: 'stories',
      resource_type: type === 'image' ? 'image' : 'video'
    });
    
    mediaUrl = result.secure_url;
    
    // Create story
    const newStory = new StoryModel({
      user: userId,
      media: mediaUrl,
      type
    });
    
    await newStory.save();
    
    res.status(201).json(newStory);
  } catch (error) {
    return next(new HttpError(500, 'Failed to create story'));
  }
};

// GET USER STORIES
const getUserStories = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const stories = await StoryModel.find({ user: userId })
      .sort({ createdAt: -1 })
      .populate('user', 'userName fullName profilePhoto');
      
    res.status(200).json(stories);
  } catch (error) {
    return next(new HttpError(500, 'Failed to fetch stories'));
  }
};

// GET TIMELINE STORIES
const getTimelineStories = async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    // Get following list
    const user = await UserModel.findById(userId).select('following');
    
    // Get stories from followed users and self
    const stories = await StoryModel.find({
      user: { $in: [...user.following, userId] },
      createdAt: { $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours
    })
    .populate('user', 'userName fullName profilePhoto')
    .sort({ createdAt: -1 });
    
    res.status(200).json(stories);
  } catch (error) {
    return next(new HttpError(500, 'Failed to fetch timeline stories'));
  }
};

// MARK STORY AS SEEN
const markStoryAsSeen = async (req, res, next) => {
  try {
    const { storyId } = req.params;
    const userId = req.user.id;
    
    const story = await StoryModel.findById(storyId);
    if (!story) {
      return next(new HttpError(404, 'Story not found'));
    }
    
    // Add viewer if not already seen
    if (!story.viewers.includes(userId)) {
      story.viewers.push(userId);
      await story.save();
    }
    
    res.status(200).json({ message: 'Story marked as seen' });
  } catch (error) {
    return next(new HttpError(500, 'Failed to mark story as seen'));
  }
};

module.exports = {
  createStory,
  getUserStories,
  getTimelineStories,
  markStoryAsSeen
};
const StoryModel = require('../models/storyModel');
const HttpError = require('../models/errorModel');
const cloudinary = require('../utils/cloudinary');

// CREATE STORY
const createStory = async (req, res, next) => {
  try {
    const userId = req.user?.id || req.user?.userId; // support both formats
    if (!userId) return next(new HttpError(401, 'Unauthorized'));
    const { type } = req.body;
    
    if (!req.files?.media) {
      return next(new HttpError(400, 'Media file is required'));
    }
    
    const media = req.files.media;
    let mediaUrl;
    
    // Upload to Cloudinary
    const result = await cloudinary.uploader.upload(media.tempFilePath, {
      folder: 'stories',
      resource_type: type === 'image' ? 'image' : 'video',
      transformation: [
        { width: 1080, height: 1920, crop: "fill" }
      ]
    });
    
    mediaUrl = result.secure_url;
    
    // Create story
    const newStory = new StoryModel({
      user: userId,
      media: mediaUrl,
      type
    });
    
    await newStory.save();
    
    // Populate user info
    const populatedStory = await StoryModel.populate(newStory, {
      path: 'user',
      select: 'userName fullName profilePhoto'
    });
    
    res.status(201).json(populatedStory);
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

// // GET TIMELINE STORIES (mock data for now)
// const getTimelineStories = async (req, res, next) => {
//   try {
//     // Mock stories data
//     const mockStories = [
//       { 
//         _id: '1', 
//         user: { 
//           _id: '2', 
//           userName: 'sloanejoie', 
//           fullName: 'Sloane Joie', 
//           profilePhoto: '' 
//         },
//         media: '',
//         type: 'image',
//         viewers: [],
//         createdAt: new Date()
//       },
//       { 
//         _id: '2', 
//         user: { 
//           _id: '3', 
//           userName: 'bobbydunn', 
//           fullName: 'Bobby Dunn', 
//           profilePhoto: '' 
//         },
//         media: '',
//         type: 'image',
//         viewers: [],
//         createdAt: new Date()
//       },
//       { 
//         _id: '3', 
//         user: { 
//           _id: '4', 
//           userName: 'mgsiegler', 
//           fullName: 'MG Siegler', 
//           profilePhoto: '' 
//         },
//         media: '',
//         type: 'image',
//         viewers: [],
//         createdAt: new Date()
//       },
//       { 
//         _id: '4', 
//         user: { 
//           _id: '5', 
//           userName: 'craigr', 
//           fullName: 'Craig R', 
//           profilePhoto: '' 
//         },
//         media: '',
//         type: 'image',
//         viewers: [],
//         createdAt: new Date()
//       }
//     ];

//     res.status(200).json(mockStories);
//   } catch (error) {
//     return next(new HttpError(500, 'Failed to fetch timeline stories'));
//   }
// };

// MARK STORY AS SEEN
const markStoryAsSeen = async (req, res, next) => {
  try {
    const { storyId } = req.params;
    const userId = req.user.id;
    
    const story = await StoryModel.findById(storyId);
    if (!story) {
      return next(new HttpError(404, 'Story not found'));
    }
    
    // Check if already seen
    const alreadySeen = story.viewers.some(viewer => 
      viewer.user.toString() === userId
    );
    
    if (!alreadySeen) {
      story.viewers.push({
        user: userId,
        viewedAt: new Date()
      });
      await story.save();
    }
    
    res.status(200).json({ message: 'Story marked as seen' });
  } catch (error) {
    return next(new HttpError(500, 'Failed to mark story as seen'));
  }
};

// REACT TO STORY
const reactToStory = async (req, res, next) => {
  try {
    const { storyId } = req.params;
    const userId = req.user.id;
    const { emoji } = req.body;
    
    const story = await StoryModel.findById(storyId);
    if (!story) {
      return next(new HttpError(404, 'Story not found'));
    }
    
    // Add reaction
    story.reactions.push({
      user: userId,
      emoji,
      reactedAt: new Date()
    });
    
    await story.save();
    
    res.status(200).json({ message: 'Reaction added' });
  } catch (error) {
    return next(new HttpError(500, 'Failed to react to story'));
  }
};

module.exports = {
  createStory,
  getUserStories,
  getTimelineStories,
  markStoryAsSeen,
  reactToStory
};
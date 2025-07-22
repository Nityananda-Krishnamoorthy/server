const HttpError = require('../models/errorModel');
const UserModel = require('../models/userModel');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const uuid = require('uuid').v4;
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const cloudinary = require('../utils/cloudinary');
const Activity = require('../models/activityModel');
const ObjectId = require('mongoose').Types.ObjectId;

// Helper function for input sanitization
const sanitizeInput = (input) => {
  if (!input) return '';
  return input.trim().replace(/[<>"'`]/g, '');
};

// Helper function for password validation
const validatePassword = (password) => {
  if (password.length < 8) {
    throw new HttpError(400, 'Password must be at least 8 characters long.');
  }
  
  const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;
  if (!strongPasswordRegex.test(password)) {
    throw new HttpError(400, 'Password must contain uppercase, lowercase, number, and special character.');
  }
};

// ================= REGISTER USER =================
const registerUser = async (req, res, next) => {
  try {
    const { fullName, userName, email, password, confirmPassword } = req.body;

    // Validate required fields
    if (!fullName || !userName || !email || !password || !confirmPassword) {
      return next(new HttpError(400, 'All fields are required.'));
    }

    // Sanitize inputs
    const sanitizedFullName = sanitizeInput(fullName);
    const sanitizedUserName = sanitizeInput(userName);
    const sanitizedEmail = sanitizeInput(email).toLowerCase();

    // Validate full name
    if (sanitizedFullName.length < 3 || sanitizedFullName.length > 50) {
      return next(new HttpError(400, 'Full name must be between 3 and 50 characters.'));
    }
    if (!/^[A-Za-z\s]+$/.test(sanitizedFullName)) {
      return next(new HttpError(400, 'Full name can only contain letters and spaces.'));
    }

    // Validate username
    if (!/^[a-zA-Z0-9_]+$/.test(sanitizedUserName)) {
      return next(new HttpError(400, 'Username can only contain letters, numbers, and underscores.'));
    }

    // Validate email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(sanitizedEmail)) {
      return next(new HttpError(400, 'Invalid email format.'));
    }

    // Validate password
    try {
      validatePassword(password);
    } catch (error) {
      return next(error);
    }

    if (password !== confirmPassword) {
      return next(new HttpError(400, 'Passwords do not match.'));
    }

    // Check for existing user
    const existingUser = await UserModel.findOne({ 
      $or: [
        { userName: sanitizedUserName },
        { email: sanitizedEmail }
      ]
    });

    if (existingUser) {
      const field = existingUser.userName === sanitizedUserName ? 'username' : 'email';
      return next(new HttpError(400, `${field.charAt(0).toUpperCase() + field.slice(1)} already exists.`));
    }

    // Create user
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new UserModel({
      fullName: sanitizedFullName,
      userName: sanitizedUserName,
      email: sanitizedEmail,
      password: hashedPassword,
    });

    const savedUser = await newUser.save();

    // Omit password in response
    const { password: _, ...userInfo } = savedUser.toObject();
    
    // Log registration activity
    await Activity.create({
      user: savedUser._id,
      action: 'register',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    return res.status(201).json({
      message: 'User registered successfully',
      user: userInfo,
    });
  } catch (error) {
    console.error('Registration Error:', error);
    
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return next(new HttpError(400, `${field.charAt(0).toUpperCase() + field.slice(1)} already exists.`));
    }
    
    return next(new HttpError(500, 'An error occurred while registering the user.'));
  }
};

// ================= LOGIN USER =================
const loginUser = async (req, res, next) => {
  try {
    const { userNameOrEmail, password } = req.body;

    if (!userNameOrEmail || !password) {
      return next(new HttpError(400, "Username or email and password are required."));
    }

    // Sanitize input
    const identifier = sanitizeInput(userNameOrEmail);
    const isEmail = identifier.includes('@');

    // Find user
    const user = await UserModel.findOne(
      isEmail 
        ? { email: identifier.toLowerCase() } 
        : { userName: identifier }
    );

    if (!user) {
      return next(new HttpError(404, "User not found."));
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return next(new HttpError(401, "Invalid password."));
    }

    // Generate token
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '1h' });

    res.status(200).json({
      message: "Login successful",
      token,
      id: user._id,
    });

    // Log login activity
    await Activity.create({
      user: user._id,
      action: 'login',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

  } catch (error) {
    console.error("Login Error:", error);
    return next(new HttpError(500, "An error occurred while logging in the user."));
  }
};

// ================= GET CURRENT USER =================
const getCurrentUser = async (req, res, next) => {
  try {
    const user = await UserModel.findById(req.user.id)
      .select("-password -blockedUsers")
      .populate('followers following', 'userName fullName profilePhoto');

    if (!user) {
      return next(new HttpError(404, "User not found."));
    }

    res.status(200).json(user);
  } catch (error) {
    console.error("Error fetching current user:", error);
    return next(new HttpError(500, "An error occurred while fetching your profile."));
  }
};

// ================= GET USER PROFILE =================
const getUserProfile = async (req, res, next) => {
  try {
    const { username } = req.params;
    const currentUserId = req.user.id;

    // Validate username
    if (!username || !/^[a-zA-Z0-9_]+$/.test(username)) {
      return next(new HttpError(400, "Invalid username format."));
    }

    // Fetch user WITHOUT excluding blockedUsers (needed for checks)
    const user = await UserModel.findOne({ userName: username })
      .select("-password")  // Removed blockedUsers exclusion
      .populate('followers following', 'userName fullName profilePhoto');

    if (!user) {
      return next(new HttpError(404, "User not found."));
    }

    // Check block status
    if (user.blockedUsers.includes(currentUserId)) {
      return next(new HttpError(403, "You are blocked by this user"));
    }

    // Optimize: fetch only blockedUsers for current user
    const currentUser = await UserModel.findById(currentUserId).select('blockedUsers');
    if (currentUser.blockedUsers.includes(user._id)) {
      return next(new HttpError(403, "You have blocked this user"));
    }

    // Convert to plain JS object and remove sensitive fields
    const userObject = user.toObject();
    delete userObject.blockedUsers;  // Remove before sending


    
    res.status(200).json(userObject);
  } catch (error) {
    console.error("Error fetching user:", error);
    return next(new HttpError(500, "An error occurred while fetching the user."));
  }
};

// ================= UPDATE USER =================
const updateUser = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { fullName, bio, isPrivate, socialMedia } = req.body;

    // Validate inputs
    if (fullName) {
      const sanitizedFullName = sanitizeInput(fullName);
      
      if (sanitizedFullName.length < 3 || sanitizedFullName.length > 50) {
        return next(new HttpError(400, 'Full name must be between 3 and 50 characters.'));
      }
      
      if (!/^[A-Za-z\s]+$/.test(sanitizedFullName)) {
        return next(new HttpError(400, 'Full name can only contain letters and spaces.'));
      }
    }

    // Validate social media URLs
    if (socialMedia) {
      const validDomains = ['twitter.com', 'instagram.com', 'linkedin.com', 'github.com'];
      
      for (const [platform, url] of Object.entries(socialMedia)) {
        if (url && typeof url === 'string') {
          try {
            const parsedUrl = new URL(url);
            if (!validDomains.includes(parsedUrl.hostname)) {
              return next(new HttpError(400, `Invalid ${platform} URL`));
            }
          } catch (e) {
            return next(new HttpError(400, `Invalid ${platform} URL`));
          }
        }
      }
    }

    // Prepare update data
    const updateData = {};
    if (fullName) updateData.fullName = sanitizeInput(fullName);
    if (bio) updateData.bio = sanitizeInput(bio);
    if (typeof isPrivate !== 'undefined') updateData.isPrivate = isPrivate;
    if (socialMedia) updateData.socialMedia = socialMedia;

    // Update user
    const updatedUser = await UserModel.findByIdAndUpdate(
      userId,
      updateData,
      { new: true, runValidators: true }
    ).select("-password");

    res.status(200).json(updatedUser);
  } catch (error) {
    console.error("Update User Error:", error);
    return next(new HttpError(500, "Profile update failed"));
  }
};

// ================= CHANGE USER PROFILE PHOTO =================
const changeUserProfilePhoto = async (req, res, next) => {
  try {
    if (!req.files?.avatar) {
      return next(new HttpError(422, "No file uploaded."));
    }
    
    const { avatar } = req.files;
    
    // Validate file
    if (avatar.size > 1024 * 1024 * 2) { // 2MB limit
      return next(new HttpError(422, "File size exceeds 2MB limit."));
    }
    
    if (!['image/jpeg', 'image/png', 'image/jpg', 'image/webp'].includes(avatar.mimetype)) {
      return next(new HttpError(422, "Invalid file type. Only JPEG, PNG, JPG, and WEBP are allowed."));
    }
    
    // Upload to Cloudinary
    const tempFilePath = path.join(__dirname, '../uploads', `${uuid()}-${avatar.name}`);
    
    try {
      await avatar.mv(tempFilePath);
      const result = await cloudinary.uploader.upload(tempFilePath, {
        folder: 'avatars',
        transformation: [
          { width: 500, height: 500, crop: "fill" },
          { quality: "auto" }
        ]
      });
      
      // Delete temp file
      fs.unlinkSync(tempFilePath);
      
      if (!result.secure_url) {
        return next(new HttpError(500, "Cloudinary upload failed."));
      }
      
      // Update user
      const updatedUser = await UserModel.findByIdAndUpdate(
        req.user.id,
        { profilePhoto: result.secure_url },
        { new: true }
      ).select("-password");
      
      res.status(200).json(updatedUser);
    } catch (uploadError) {
      console.error("Avatar Upload Error:", uploadError);
      
      // Clean up temp file if exists
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
      
      return next(new HttpError(500, "Failed to upload avatar."));
    }
  } catch (error) {
    console.error("Change Avatar Error:", error);
    return next(new HttpError(500, "An error occurred while changing the user profile photo."));
  }
};

// ================= FOLLOW USER =================
const followUser = async (req, res, next) => {
  try {
    const currentUserId = req.user.id;
    const targetUsername = req.params.username;

    // Find target user
    const targetUser = await UserModel.findOne({ userName: targetUsername });
    if (!targetUser) {
      return next(new HttpError(404, "User not found."));
    }

    const targetUserId = targetUser._id;

    // Validate self-follow
    if (currentUserId === targetUserId.toString()) {
      return next(new HttpError(400, "Cannot follow yourself"));
    }

    const currentUser = await UserModel.findById(currentUserId);
    
    // Check if already following
    if (currentUser.following.includes(targetUserId)) {
      return next(new HttpError(400, "Already following this user"));
    }

    // Check block status
    if (currentUser.blockedUsers.includes(targetUserId)) {
      return next(new HttpError(403, "You have blocked this user"));
    }
    
    if (targetUser.blockedUsers.includes(currentUserId)) {
      return next(new HttpError(403, "You are blocked by this user"));
    }

    // Handle private accounts
    if (targetUser.isPrivate) {
      await UserModel.findByIdAndUpdate(targetUserId, {
        $addToSet: { pendingFollowers: currentUserId }
      });

      return res.status(200).json({
        status: "pending",
        message: "Follow request sent. Waiting for approval.",
      });
    }

    // Public account - follow immediately
    await UserModel.findByIdAndUpdate(currentUserId, {
      $addToSet: { following: targetUserId }
    });

    await UserModel.findByIdAndUpdate(targetUserId, {
      $addToSet: { followers: currentUserId }
    });

    return res.status(200).json({
      status: "success",
      message: "Followed successfully",
    });

  } catch (error) {
    console.error("Follow Error:", error);
    return next(new HttpError(500, "An error occurred while following the user."));
  }
};

// ================= UNFOLLOW USER =================
const unfollowUser = async (req, res, next) => {
  try {
    const currentUserId = req.user.id;
    const targetUsername = req.params.username;

    // Find target user
    const targetUser = await UserModel.findOne({ userName: targetUsername });
    if (!targetUser) {
      return next(new HttpError(404, "User not found."));
    }

    const targetUserId = targetUser._id;

    // Validate self-unfollow
    if (currentUserId === targetUserId.toString()) {
      return next(new HttpError(400, "Cannot unfollow yourself"));
    }

    const currentUser = await UserModel.findById(currentUserId);
    
    // Check if following
    if (!currentUser.following.includes(targetUserId)) {
      return next(new HttpError(400, "Not following this user"));
    }

    // Perform unfollow
    await UserModel.findByIdAndUpdate(currentUserId, {
      $pull: { following: targetUserId }
    });

    await UserModel.findByIdAndUpdate(targetUserId, {
      $pull: { followers: currentUserId }
    });

    return res.status(200).json({
      status: "success",
      message: "Unfollowed successfully",
    });

  } catch (error) {
    console.error("Unfollow Error:", error);
    return next(new HttpError(500, "An error occurred while unfollowing the user."));
  }
};

// ================= BLOCK USER =================
const blockUser = async (req, res, next) => {
  try {
    const currentUserId = req.user.id;
    const targetUsername = req.params.username;

    // Validate currentUserId format
    if (!mongoose.Types.ObjectId.isValid(currentUserId)) {
      return next(new HttpError(400, "Invalid current user ID format"));
    }

    const targetUser = await UserModel.findOne({ userName: targetUsername });
    if (!targetUser) {
      return next(new HttpError(404, "User not found."));
    }

    // Self-block check
    if (currentUserId === targetUser._id.toString()) {
      return next(new HttpError(400, "Cannot block yourself"));
    }

    const currentUser = await UserModel.findById(currentUserId);
    
    // Check if already blocked
    if (currentUser.blockedUsers.some(id => id.equals(targetUser._id))) {
      return next(new HttpError(400, "User already blocked"));
    }

    // Convert to proper ObjectIDs using 'new'
    const currentUserIdObj = new mongoose.Types.ObjectId(currentUserId);
    const targetUserIdObj = targetUser._id;  // Already an ObjectId

    // Update both users in a transaction
    const session = await UserModel.startSession();
    session.startTransaction();
    
    try {
      // Update current user
      await UserModel.findByIdAndUpdate(
        currentUserIdObj,
        {
          $addToSet: { blockedUsers: targetUserIdObj },
          $pull: { 
            following: targetUserIdObj,
            followers: targetUserIdObj,
            pendingFollowers: targetUserIdObj
          }
        },
        { session }
      );
      
      // Update target user
      await UserModel.findByIdAndUpdate(
        targetUserIdObj,
        {
          $pull: { 
            following: currentUserIdObj,
            followers: currentUserIdObj,
            pendingFollowers: currentUserIdObj
          }
        },
        { session }
      );

      await session.commitTransaction();
      session.endSession();
      
      return res.status(200).json({ message: "User blocked successfully" });
    } catch (transactionError) {
      await session.abortTransaction();
      session.endSession();
      throw transactionError;
    }
    
  } catch (error) {
    console.error("Block Error:", error);
    return next(new HttpError(500, "Block operation failed: " + error.message));
  }
};

// ================= UNBLOCK USER =================
const unblockUser = async (req, res, next) => {
  try {
    const currentUserId = req.user.id;
    const targetUsername = req.params.username;

    // Find target user
    const targetUser = await UserModel.findOne({ userName: targetUsername });
    if (!targetUser) {
      return next(new HttpError(404, "User not found."));
    }

    const targetUserId = targetUser._id;

    const currentUser = await UserModel.findById(currentUserId);
    
    // Check if blocked
    if (!currentUser.blockedUsers.includes(targetUserId)) {
      return next(new HttpError(400, "User not blocked"));
    }

    // Unblock the user
    await UserModel.findByIdAndUpdate(currentUserId, {
      $pull: { blockedUsers: targetUserId }
    });
    
    return res.status(200).json({ message: "User unblocked successfully" });
  } catch (error) {
    console.error("Unblock Error:", error);
    return next(new HttpError(500, "Unblock operation failed"));
  }
};

// ================= RESPOND TO FOLLOW REQUEST =================
const respondToFollowRequest = async (req, res, next) => {
  try {
    const currentUserId = req.user.id;
    const requesterUsername = req.params.username;
    const { action } = req.body; // 'accept' or 'reject'

    // Find requester user
    const requesterUser = await UserModel.findOne({ userName: requesterUsername });
    if (!requesterUser) {
      return next(new HttpError(404, "User not found."));
    }
    
    const requesterId = requesterUser._id;
    const currentUser = await UserModel.findById(currentUserId);
    
    // Check for pending request
    if (!currentUser.pendingFollowers.includes(requesterId)) {
      return next(new HttpError(400, "No pending request from this user"));
    }

    // Handle accept/reject
    if (action === 'accept') {
      await UserModel.findByIdAndUpdate(currentUserId, {
        $pull: { pendingFollowers: requesterId },
        $addToSet: { followers: requesterId }
      });
      
      await UserModel.findByIdAndUpdate(requesterId, {
        $addToSet: { following: currentUserId }
      });
      
      return res.status(200).json({ message: "Follow request accepted" });
    } 
    
    if (action === 'reject') {
      await UserModel.findByIdAndUpdate(currentUserId, {
        $pull: { pendingFollowers: requesterId }
      });
      return res.status(200).json({ message: "Follow request rejected" });
    }
    
    return next(new HttpError(400, "Invalid action specified"));
  } catch (error) {
    console.error("Follow Request Error:", error);
    return next(new HttpError(500, "Request processing failed"));
  }
};

// ================= GET SUGGESTED USERS =================
const getSuggestedUsers = async (req, res, next) => {
  try {
    const currentUserId = req.user.id;
    
    const currentUser = await UserModel.findById(currentUserId)
      .select('following blockedUsers')
      .lean();

    // Get users not followed and not blocked
    const suggestedUsers = await UserModel.aggregate([
      { 
        $match: { 
          _id: { 
            $ne: new ObjectId(currentUserId),
            $nin: [
              ...currentUser.following.map(id => new ObjectId(id)),
              ...currentUser.blockedUsers.map(id => new ObjectId(id))
            ]
          }
        } 
      },
      { $sample: { size: 5 } },
      { 
        $project: { 
          fullName: 1,
          userName: 1,
          profilePhoto: 1,
          bio: 1 
        }
      }
    ]);
    
    res.status(200).json(suggestedUsers);
  } catch (error) {
    console.error("Suggestions Error:", error);
    return next(new HttpError(500, "Could not fetch suggestions"));
  }
};

// ================= SEARCH USERS =================
const searchUsers = async (req, res, next) => {
  try {
    const searchQuery = req.query.q;
    const currentUserId = req.user.id;
    
    // Validate query
    if (!searchQuery || searchQuery.trim().length < 3) {
      return next(new HttpError(400, "Minimum 3 characters required"));
    }
    
    const sanitizedQuery = sanitizeInput(searchQuery);
    
    const users = await UserModel.find({
      $and: [
        { 
          $or: [
            { fullName: { $regex: sanitizedQuery, $options: 'i' }},
            { userName: { $regex: sanitizedQuery, $options: 'i' }}
          ]
        },
        { blockedUsers: { $ne: currentUserId }},
        { _id: { $ne: currentUserId }}
      ]
    })
    .select('fullName userName profilePhoto isPrivate')
    .limit(10);
    
    res.status(200).json(users);
  } catch (error) {
    console.error("Search Error:", error);
    return next(new HttpError(500, "Search failed"));
  }
};

// ================= DEACTIVATE ACCOUNT =================
const deactivateAccount = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { password } = req.body;

    if (!password) {
      return next(new HttpError(400, "Password is required"));
    }

    const user = await UserModel.findById(userId);
    if (!user) {
      return next(new HttpError(404, "User not found"));
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return next(new HttpError(401, "Invalid password"));
    }

    // Set deactivation
    user.isActive = false;
    user.deactivatedAt = Date.now();
    await user.save();

    res.status(200).json({ 
      message: "Account deactivated successfully",
      deactivatedUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
    });
  } catch (error) {
    console.error("Deactivation Error:", error);
    return next(new HttpError(500, "Account deactivation failed"));
  }
};

// ================= EXPORTS =================
module.exports = {
  registerUser,
  loginUser,
  getCurrentUser,
  getUserProfile,
  updateUser,
  changeUserProfilePhoto,
  followUser,
  unfollowUser,
  blockUser,
  unblockUser,
  respondToFollowRequest,
  getSuggestedUsers,
  searchUsers,
  deactivateAccount
};
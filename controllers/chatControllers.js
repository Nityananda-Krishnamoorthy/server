// controllers/chatControllers.js
const Conversation = require('../models/conversationModel');
const Message = require('../models/MessageModel');
const Call = require('../models/callModel');
const UserModel = require('../models/userModel');
const Notification = require('../models/NotificationModel');
const HttpError = require('../models/errorModel');
const mongoose = require('mongoose');
const cloudinary = require('../utils/cloudinary');
const path = require('path');
const fs = require('fs');
const uuid = require('uuid').v4;

// ================= HELPER FUNCTIONS =================
const notifyParticipants = async (conversationId, messageId, senderId, type) => {
  try {
    const conversation = await Conversation.findById(conversationId).populate('participants');
    if (!conversation) return;

    const notifications = conversation.participants
      .filter(user => !user._id.equals(senderId))
      .map(user => ({
        user: user._id,
        type: type === 'call' ? 'call' : 'message',
        data: {
          actor: senderId,
          conversation: conversationId,
          message: messageId,
          isGroup: conversation.isGroup,
          groupName: conversation.groupName
        }
      }));

    if (notifications.length > 0) {
      await Notification.insertMany(notifications);
    }
  } catch (error) {
    console.error('Notification Error:', error);
  }
};

// Update message status automatically
const updateMessageStatus = async (messageId, userId, status) => {
  try {
    const message = await Message.findById(messageId);
    if (!message) return null;

    const conversation = await Conversation.findById(message.conversationId);
    if (!conversation) return null;

    // Update status based on action
    switch (status) {
      case 'delivered':
        if (!message.deliveredTo.includes(userId)) {
          message.deliveredTo.push(userId);
          message.status = 'delivered';
        }
        break;
        
      case 'seen':
        if (!message.readBy.includes(userId)) {
          message.readBy.push(userId);
          
          // Check if all participants have seen the message
          const participants = conversation.participants.map(p => p.toString());
          const recipients = participants.filter(id => id !== message.senderId.toString());
          const allSeen = recipients.every(recipientId => 
            message.readBy.some(id => id.toString() === recipientId)
          );
          
          if (allSeen) message.status = 'seen';
        }
        break;
    }

    await message.save();
    return message;
  } catch (error) {
    console.error('Status Update Error:', error);
    return null;
  }
};

// ================= START CONVERSATION =================
const startConversation = async (req, res, next) => {
  try {
    const { isGroup, groupName } = req.body;
    const userId = req.user.id;
    let participants = req.body.participants;

    // If it's a string like '["id1","id2"]', parse it
    if (typeof participants === 'string') {
      try {
        participants = JSON.parse(participants);
      } catch {
        return next(new HttpError(400, 'Participants must be an array'));
      }
    }

    // Validate participants
    if (!participants || !Array.isArray(participants)) {
      return next(new HttpError(400, 'Invalid participants array'));
    }

    // Validate each participant ID
    const validParticipants = participants.filter(id => 
      mongoose.Types.ObjectId.isValid(id)
    );
console.log("Validated participants:", validParticipants);
    if (validParticipants.length !== participants.length) {
      return next(new HttpError(400, 'Contains invalid participant IDs'));
    }
console.log("Checking if users exist...");
    // Verify participants exist
    const usersExist = await UserModel.countDocuments({
      _id: { $in: validParticipants }
    }) === validParticipants.length;
    
    if (!usersExist) {
      return next(new HttpError(404, 'One or more participants not found'));
    }

    // Add current user to participants and remove duplicates
    const allParticipants = [
      ...new Set([userId, ...validParticipants])
    ].map(id => new mongoose.Types.ObjectId(id));
console.log("All participants to be saved:", allParticipants);
console.log("Saving new conversation...");
    // Validate participant count
    if (!isGroup && allParticipants.length !== 2) {
      return next(new HttpError(400, '1:1 conversation requires exactly 2 participants'));
    }

    // Check for existing conversation (only for 1:1 chats)
    if (!isGroup) {
      const existingConv = await Conversation.findOne({
        isGroup: false,
        participants: { 
          $all: allParticipants,
          $size: allParticipants.length
        }
      });

      if (existingConv) {
        return res.status(200).json(existingConv);
      }
    }

    // Create new conversation
    const newConversation = new Conversation({
      participants: allParticipants,
      isGroup: isGroup || false,
      groupName: isGroup ? groupName || 'New Group' : undefined
    });

    await newConversation.save();

    // Populate participants for response
    const populatedConv = await Conversation.populate(newConversation, {
      path: 'participants',
      select: 'userName fullName profilePhoto'
    });

    res.status(201).json(populatedConv);
  } catch (error) {
    console.error('Start Conversation Error:', error);
    
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(val => val.message);
      return next(new HttpError(400, messages.join(', ')));
    }
    
    return next(new HttpError(500, 'Failed to start conversation'));
  }
};

// ================= SEND MESSAGE =================
const sendMessage = async (req, res, next) => {
  try {
    const { conversationId, text } = req.body;
    const userId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return next(new HttpError(400, 'Invalid conversation ID'));
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return next(new HttpError(404, 'Conversation not found'));
    }

    if (!conversation.participants.some(id => id.equals(userId))) {
      return next(new HttpError(403, 'Not a participant in this conversation'));
    }

    const mediaUrls = [];

    if (req.files && req.files.length > 0) {
      const uploadDir = path.join(__dirname, '../uploads');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const allowedTypes = [
        'image/jpeg', 
        'image/png', 
        'image/gif',
        'video/mp4',
        'video/webm',
        'audio/mpeg'
      ];
      for (const file of req.files) {
        if (!allowedTypes.includes(file.mimetype)) {
          return next(new HttpError(400, 'Invalid file type'));
        }

        const tempFilePath = path.join(uploadDir, `${uuid()}-${file.name}`);

        try {
          await file.mv(tempFilePath);

          const result = await cloudinary.uploader.upload(tempFilePath, {
            folder: 'chat_media',
            resource_type: 'auto'
          });

          mediaUrls.push(result.secure_url);
        } catch (uploadError) {
          console.error('Upload error:', uploadError);
          return next(new HttpError(500, 'File upload failed'));
        } finally {
          if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
          }
        }
      }
    }

    const newMessage = new Message({
      conversationId,
      senderId: userId,
      text: text || '',
      media: mediaUrls
    });

    await newMessage.save();

    conversation.lastMessage = newMessage._id;
    await conversation.save();

    const onlineUsers = req.app.locals.onlineUsers || new Map();

    conversation.participants.forEach(participantId => {
      const participantStr = participantId.toString();
      if (participantStr !== userId && onlineUsers.has(participantStr)) {
        updateMessageStatus(newMessage._id, participantId, 'delivered');
      }
    });

    await notifyParticipants(conversationId, newMessage._id, userId, 'message');

    res.status(201).json(newMessage);
  } catch (error) {
    console.error('Send Message Error:', error);
    return next(new HttpError(500, 'Failed to send message'));
  }
};

// ========== DELETE CONVERSATION ==========
const deleteConversation = async (req, res, next) => {
  try {
    const conversationId = req.params.id;
    const userId = req.user.id;

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return next(new HttpError(404, 'Conversation not found'));
    }

    if (!conversation.deletedBy.includes(userId)) {
      conversation.deletedBy.push(userId);
      await conversation.save();
    }

    res.status(200).json({ message: 'Conversation deleted' });
  } catch (error) {
    console.error('Delete Conversation Error:', error);
    return next(new HttpError(500, 'Failed to delete conversation'));
  }
};

// ========== GET CONVERSATIONS ==========
const getConversations = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const conversations = await Conversation.find({
      participants: userId,
      deletedBy: { $ne: userId },
    })
      .populate({
        path: 'participants',
        select: 'userName fullName profilePhoto'
      })
      .populate({
        path: 'lastMessage',
        select: 'text media call createdAt status'
      })
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    for (const conv of conversations) {
      conv.unreadCount = await Message.countDocuments({
        conversationId: conv._id,
        senderId: { $ne: new mongoose.Types.ObjectId(userId) },
        readBy: { $nin: [new mongoose.Types.ObjectId(userId)] }
      });
    }

    const total = await Conversation.countDocuments({
      participants: userId,
      deletedBy: { $ne: userId }
    });

    res.status(200).json({
      page,
      limit,
      total,
      conversations
    });
  } catch (error) {
    console.error('Get Conversations Error:', error);
    return next(new HttpError(500, 'Failed to get conversations'));
  }
};

// ========== GET CONVERSATION BY ID ==========
const getConversation = async (req, res, next) => {
  try {
    const conversationId = req.params.id;
    const userId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return next(new HttpError(400, 'Invalid conversation ID'));
    }

    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: userId,
      deletedBy: { $ne: userId },
    })
      .populate('participants', 'userName fullName profilePhoto isOnline lastSeen')
      .populate('lastMessage');

    if (!conversation) {
      return next(new HttpError(404, 'Conversation not found'));
    }

    res.status(200).json(conversation);
  } catch (error) {
    console.error('Get Conversation Error:', error);
    return next(new HttpError(500, 'Failed to get conversation'));
  }
};




// ================= GET MESSAGES =================
const getMessages = async (req, res, next) => {
  try {
    const conversationId = req.params.id;
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return next(new HttpError(400, 'Invalid conversation ID'));
    }
    // Validate conversation
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return next(new HttpError(404, 'Conversation not found'));
    }

    if (!conversation.participants.some(id => id.equals(userId))) {
      return next(new HttpError(403, 'Not a participant'));
    }

    const messages = await Message.find({ conversationId })
      .populate('senderId', 'userName fullName profilePhoto')
      .populate('call')
      .sort({ createdAt: 1 }) // Ascending order (oldest first)
      .skip(skip)
      .limit(limit)
      .lean();

    // Mark messages as seen
    const markAsSeenPromises = messages
      .filter(msg => 
        !msg.readBy.some(id => id.equals(userId)) && 
        !msg.senderId._id.equals(userId)
      )
      .map(msg => updateMessageStatus(msg._id, userId, 'seen'));

    await Promise.all(markAsSeenPromises);

    const total = await Message.countDocuments({ conversationId });

    res.status(200).json({
      page,
      limit,
      total,
      messages
    });
  } catch (error) {
    console.error('Get Messages Error:', error);
    return next(new HttpError(500, 'Failed to get messages'));
  }
};

// ================= START VIDEO CALL =================
const startVideoCall = async (req, res, next) => {
  try {
    const { conversationId, type } = req.body;
    const userId = req.user.id;
    const redisClient = req.app.locals.redisClient;

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return next(new HttpError(400, 'Invalid conversation ID'));
    }

    // Validate conversation
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return next(new HttpError(404, 'Conversation not found'));
    }

    // Check if user is participant
    if (!conversation.participants.some(id => id.equals(userId))) {
      return next(new HttpError(403, 'Not a participant'));
    }

    // Create properly structured participants array
    const participants = conversation.participants.map(id => ({
      user: id,
      // Add timestamps only when user actually joins
      joinedAt: id.equals(userId) ? new Date() : undefined
    }));

    // Create call record
    const newCall = new Call({
      participants,
      initiator: userId,
      type: type || 'video',
      status: 'initiated',
      // Set startedAt only when call actually begins
      startedAt: undefined
    });

    await newCall.save();

    // Create call message
    const callMessage = new Message({
      conversationId,
      senderId: userId,
      call: newCall._id
    });

    await callMessage.save();

    // Update conversation last message
    conversation.lastMessage = callMessage._id;
    await conversation.save();

    // Store participant IDs in Redis for signaling
    const participantIds = conversation.participants.map(id => id.toString());
    await redisClient.sadd(`call:${newCall._id}:participants`, ...participantIds);

    // Notify participants (implementation not shown)
    await notifyParticipants(conversationId, callMessage._id, userId, 'call');

    res.status(201).json({ 
      callId: newCall._id,
      messageId: callMessage._id,
      signalingRoom: `call-signal-${newCall._id}`
    });
  } catch (error) {
    console.error('Start Call Error:', error);
    return next(new HttpError(500, 'Failed to start call'));
  }
};

// ================= UPDATE CALL STATUS =================
const updateCallStatus = async (req, res, next) => {
  try {
    const callId = req.params.id;
    const { status } = req.body;

    const call = await Call.findById(callId);
    if (!call) {
      return next(new HttpError(404, 'Call not found'));
    }

    // Update status
    call.status = status;
    
    // Set timestamps based on status
    if (status === 'ongoing') {
      call.startedAt = new Date();
    } else if (status === 'ended') {
      call.endedAt = new Date();
      // Cleanup Redis call participants
      const redisClient = req.app.locals.redisClient;
      await redisClient.del(`call:${callId}:participants`);
    }

    await call.save();

    res.status(200).json(call);
  } catch (error) {
    console.error('Update Call Error:', error);
    return next(new HttpError(500, 'Failed to update call'));
  }
};

module.exports = {
  startConversation,
  sendMessage,
  deleteConversation,
  getConversations,
  getConversation,
  getMessages,
  startVideoCall,
  updateCallStatus,
  updateMessageStatus // Export for socket handler
};
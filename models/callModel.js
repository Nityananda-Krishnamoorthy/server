const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const callSchema = new Schema({
  participants: [{
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    joinedAt: { type: Date },
    leftAt: { type: Date }
  },
],

  initiator: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['audio', 'video'], required: true },
  status: { 
    type: String, 
    enum: ['initiated', 'ongoing', 'ended', 'missed'], 
    default: 'initiated'
  },
  startedAt: { type: Date },
  endedAt: { type: Date }
}, { timestamps: true });

// Indexes
callSchema.index({ participants: 1, status: 1 });
callSchema.index({ initiator: 1 });

module.exports = mongoose.model('Call', callSchema);
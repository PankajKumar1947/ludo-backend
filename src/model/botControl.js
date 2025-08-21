import mongoose from 'mongoose';

const botControlSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: 'global_bot_settings'
  },
  temperature: {
    type: Number,
    default: 3,
    min: 1,
    max: 6
  },
  killingMode: {
    type: Boolean,
    default: true
  },
  cleverMove: {
    type: Boolean,
    default: false
  },
  aggressiveness: {
    type: Number,
    default: 5,
    min: 1,
    max: 10
  },
  active: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

botControlSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

botControlSchema.statics.getGlobalSettings = async function() {
  try {
    let settings = await this.findById('global_bot_settings');
    if (!settings) {
      settings = await this.create({
        _id: 'global_bot_settings',
        temperature: 3,
        killingMode: true,
        cleverMove: false,
        aggressiveness: 5,
        active: true
      });
    }
    return settings;
  } catch (error) {
    console.error('Error getting global bot settings:', error);
    throw error;
  }
};

export default mongoose.model('BotControl', botControlSchema);
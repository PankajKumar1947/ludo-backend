import mongoose from 'mongoose';

const playerSchema = new mongoose.Schema({
  id: String,
  playerId: String,
  name: String,
  position: Number, // fixed seat position
  isBot: {
    type: Boolean,
    default: false
  },
  score: {
    type: Number,
    default: 0
  },
  pic_url: String,
  missedTurns: {
    type: Number,
    default: 0
  }
});

const customRoomSchema = new mongoose.Schema({
  roomId: { type: String, unique: true },
  gameType: {
    type: String,
    enum: ['private', 'player-2', 'player-4'],
    default: 'private'
  },
  playerLimit: {
    type: Number,
    required: true
  },
  players: [playerSchema],
  bet: {
    type: Number,
    required: true
  },
  started: {
    type: Boolean,
    default: false
  },
  gameOver: {
    type: Boolean,
    default: false
  },
  currentPlayerIndex: {
    type: Number,
    default: 0
  },
  lastDiceValue: {
    type: Number,
    default: null
  },
  hasRolled: {
    type: Boolean,
    default: false
  },
  hasMoved: {
    type: Boolean,
    default: false
  },
  consecutiveSixes: {
    type: Map,
    of: Number
  }
}, { timestamps: true });

export default mongoose.model('CustomRoom', customRoomSchema);
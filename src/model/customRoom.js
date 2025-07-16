import mongoose from 'mongoose';

const playerSchema = new mongoose.Schema({
  id: String,
  playerId: String,
  name: String,
  isBot: Boolean,
  score: Number,
  pic_url: String
});

const customRoomSchema = new mongoose.Schema({
  roomId: { type: String, unique: true },
  playerLimit: Number,
  players: [playerSchema],
  bet: Number,
  started: Boolean,
  gameOver: Boolean,
  currentPlayerIndex: Number,
  lastDiceValue: Number,
  hasRolled: Boolean,
  hasMoved: Boolean,
  consecutiveSixes: { type: Map, of: Number }
}, { timestamps: true });

export default mongoose.model('CustomRoom', customRoomSchema);

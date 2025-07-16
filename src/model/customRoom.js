import mongoose from 'mongoose';

const playerSchema = new mongoose.Schema({
  playerId: String,
  name: String,
  isBot: Boolean,
  score: Number,
  pic_url: String,
});

const customRoomSchema = new mongoose.Schema({
  roomId: { type: String, unique: true },
  playerLimit: Number,
  players: [playerSchema],
  bet: Number,
  started: { type: Boolean, default: false },
  gameOver: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model('CustomRoom', customRoomSchema);

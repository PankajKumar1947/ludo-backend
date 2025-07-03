import mongoose from "mongoose";

const historySchema = new mongoose.Schema({
  playerid: {
    type: String,
    required: true
  },
  status: {
    type: String,
    required: true
  },
  bid_amount: {
    type: Number,
    required: true
  },
  Win_amount: {
    type: Number,
    required: true
  },
  loss_amount: {
    type: Number,
    required: true
  },
  seat_limit: {
    type: String, // "2" or "4" from Unity code
    required: true
  },
  oppo1: {
    type: String,
    default: ""
  },
  oppo2: {
    type: String,
    default: ""
  },
  oppo3: {
    type: String,
    default: ""
  },
  created_at: {
    type: Date,
    default: Date.now
  }
});

export default mongoose.model("History", historySchema);
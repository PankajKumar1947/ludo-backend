import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  first_name: {
    type: String,
    required: true
  },
  user_id: {
    type: String,
    required: true
  },
  user_token: {
    type: String,
    required: true
  },
  device_token: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true,
    unique: true
  },
  my_token: {
    type: String,
    required: true
  },
  pic_url: {
    type: String,
    required: true
  },
  wallet: {
    type: Number,
    default: 5000,
  },
  wincoin: {
    type: Number,
    default: 0
  },
  twoPlayWin: {
    type: Number,
    default: 0
  },
  fourPlayWin: {
    type: Number,
    default: 0
  },
  
  bidvalues: [
    {
      type: mongoose.Schema.Types.Mixed,
    }
  ],
  shop_coin: [
    {
      type: mongoose.Schema.Types.Mixed
    }
  ],
  
  // Referral system
  referral_code: {
    type: String,
    unique: true,
    sparse: true
  },
  referred_by: {
    type: String,
    default: null
  },
  referrals: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  }],
  rewards: [
    {
      type: mongoose.Schema.Types.Mixed
    }
  ]
});

export default mongoose.model("User", userSchema);
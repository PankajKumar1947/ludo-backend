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
  bidvalues: [
    {
      type: mongoose.Schema.Types.Mixed,
    }
  ],
  shop_coin: [
    {
      type: mongoose.Schema.Types.Mixed
    }
  ]
});

export default mongoose.model("User", userSchema);
import user from "../model/user.js";
import history from "../model/history.js";
import cloudinary from '../config/cloudinaryConfig.js';
import streamifier from 'streamifier';
import { COMISSION_RATE } from "../constants/index.js";

export const playerDetails = async (req, res) => {
  try {
    const { playerid } = req.body;

    if (!playerid) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    const player = await user.findById(playerid);

    if (!player) {
      return res.status(404).json({
        success: false,
        message: "Player not found",
      });
    }

    const playerdata = {
      username: player.first_name,
      photo: player.pic_url,
      wincoin: player.wincoin, //current earning
      GamePlayed: player.bidvalues?.length,
      totalcoin: player.wallet,
      playcoin: "null",
      twoPlayWin: player.twoPlayWin,
      FourPlayWin: player.fourPlayWin,
      refer_code: player.referral_code,
      accountHolder: "John Doe",
      accountNumber: 1234567890,
      ifsc: "ABC0001234",
      refrelCoin: 50* player.referrals?.length
    }

    const gameconfig = {
      "signup_bonus": 50,
      "website_name": "LudoWorld",
      "notification": "Enjoy the game!",
      "min_withdraw": "100",
      "youtube_link": "https://youtube.com/...",
      "whatsapp_link": "https://wa.me/...",
      "telegram_link": "https://t.me/...",
      "website_url": "https://example.com",
      "pemail": "contact@example.com",
      "commission": COMISSION_RATE*100,
      "bot_status": "1"
    };


    const gameBidConstantValue = [
      {
        bid_value: 100,
      },
      {
        bid_value: 200,
      },
      {
        bid_value: 300,
      },
      {
        bid_value: 400,
      },
      {
        bid_value: 500,
      },
      {
        bid_value: 600,
      },
      {
        bid_value: 700,
      },
      {
        bid_value: 800,
      },
      {
        bid_value: 900,
      },
      {
        bid_value: 1000,
      }
    ]

    res.status(200).json({
      success: true,
      message: "All Details Fetched Successfully",
      playerdata,
      gameconfig,
      shop_coin: player.shop_coin,
      bidvalues: gameBidConstantValue,
      playervid_history: player.bidvalues,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch player details",
    });
  }
};

export const playerHistory = async (req, res) => {
  try {
    const {
      playerid,
      status,
      bid_amount,
      Win_amount,
      loss_amount,
      seat_limit,
      oppo1,
      oppo2,
      oppo3
    } = req.body;

    // Check if user exists using user_id field, not _id
    const userExist = await user.findById(playerid);

    if (!userExist) {
      return res.status(404).json({ message: "User not found" });
    }

    // Create a new history entry
    const newHistory = new history({
      playerid,
      status,
      bid_amount,
      Win_amount,
      loss_amount,
      seat_limit,
      oppo1,
      oppo2,
      oppo3
    });

    await newHistory.save();

    res.status(201).json({
      message: "Player history saved successfully",
      data: newHistory
    });

  } catch (error) {
    console.error("Error in playerHistory:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const UpdateProfileImage = async (req, res) => {
  try {
    const file = req.file;
    const playerId = req.body.playerId;

    if (!file || !playerId) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: image or player ID"
      });
    }

    const player = await user.findById(playerId);

    if (!player) {
      return res.status(404).json({
        success: false,
        message: "Player not found"
      });
    }

    // Upload buffer to Cloudinary
    const streamUpload = (fileBuffer) => {
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: 'Ludo', public_id: `profile_${playerId}` },
          (error, result) => {
            if (result) resolve(result);
            else reject(error);
          }
        );
        streamifier.createReadStream(fileBuffer).pipe(stream);
      });
    };

    const result = await streamUpload(file.buffer);

    // Update player's profile image URL
    player.pic_url = result.secure_url;
    await player.save();

    return res.status(200).json({
      success: true,
      imageUrl: result.secure_url,
      public_id: result.public_id,
      message: "Image uploaded successfully"
    });

  } catch (error) {
    console.error("Error in uploading image:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to upload image"
    });
  }
};
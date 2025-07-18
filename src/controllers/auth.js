import User from "../model/user.js";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret";

export const SigningIn = async (req, res) => {
  try {
    const {
      first_name,
      user_id,
      user_token,
      device_token,
      email,
      my_token,
      pic_url
    } = req.body || {}; // Safe fallback

    // Validate the data
    if (
      !first_name ||
      !user_id ||
      !user_token ||
      !device_token ||
      !email ||
      !my_token ||
      !pic_url
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    // Check if user already exists
    let user = await User.findOne({ email });
    let isNewUser = false;

    if (!user) {
      user = await User.create({
        first_name,
        user_id,
        user_token,
        device_token,
        email,
        my_token,
        pic_url
      });
      isNewUser = true;
    }

    // Create JWT token
    const tokenPayload = {
      id: user._id,
      first_name: user.first_name,
      email: user.email,
      role: "user",
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, {
      expiresIn: "30d",
    });


    return res.status(isNewUser ? 201 : 200).json({
      success: true,
      message: isNewUser
        ? "User created and logged in successfully"
        : "User logged in successfully",
      token,
      notice: "User Successfully Created !",
      playerid: user._id,
      username: email,
      pic_url: pic_url
    });

  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({
      success: false,
      message: "User sign-in failed",
    });
  }
};

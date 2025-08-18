import User from '../../model/user.js';
import bcrypt from 'bcrypt';
import jwt from "jsonwebtoken";

// Register
export const register = async (req, res) => {
  try {
    const { first_name, email, password } = req.body;
    if (!first_name || !email || !password)
      return res.status(400).json({
        error: "All fields required"
      });

    const existing = await User.findOne({ email });
    if (existing)
      return res.status(400).json({
        error: "Email already registered"
      });

    const hashed = await bcrypt.hash(password, 10);
    const newUser = new User({
      first_name,
      email,
      role: "admin", // Default role for admin registration
      password: hashed,
      user_id: Date.now().toString(),
      user_token: hashed,
      device_token: "NA",
      my_token: "NA",
      pic_url: "default.png"
    });

    await newUser.save();
    res.json({
      success: true,
      message: "User registered successfully"
    });
  } catch (error) {
    console.error("Error registering user:", error);
    res.status(500).json({
      error: "Internal Server Error"
    });
  }
};

// Login
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({
        error: "Email & Password required"
      });

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({
      error: "User not found"
    });

    const valid = await bcrypt.compare(password, user.user_token);
    if (!valid) return res.status(400).json({
      error: "Invalid credentials"
    });

    const token = jwt.sign({ 
      id: user._id,
      role: user.role
    }, process.env.JWT_SECRET, { expiresIn: "7d" });

    res.json({ success: true, message: "Login successful", token });
  } catch (error) {
    console.error("Error logging in:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Forgot Password
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({
      error: "Email required"
    });

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({
      error: "User not found"
    });

    // In real app, send reset link via email
    res.json({
      success: true,
      message: "Password reset link sent to email"
    });
  } catch (error) {
    console.error("Error in forgot password:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

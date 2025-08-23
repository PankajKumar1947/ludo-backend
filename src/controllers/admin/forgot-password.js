import User from "../../model/user.js";
import bcrypt from "bcrypt";
import nodemailer from "nodemailer";

// Setup nodemailer (use real SMTP or service like Gmail/SendGrid)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER, // your email
    pass: process.env.EMAIL_PASS  // your email app password
  }
});

// Generate random 6-digit OTP
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// Forgot Password - send OTP
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

    const otp = generateOTP();
    const otpExpiry = Date.now() + 5 * 60 * 1000; // 5 minutes

    user.resetOtp = otp;
    user.resetOtpExpiry = otpExpiry;
    await user.save();

    // send mail
    await transporter.sendMail({
      from: `"Support" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Password Reset OTP from Ancient Ludo",
      text: `Your OTP for password reset is ${otp}. It is valid for 5 minutes.`
    });

    res.json({ success: true, message: "OTP sent to email" });
  } catch (error) {
    console.error("Error in forgot password:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Reset password with OTP
export const resetPasswordWithOtp = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ error: "All fields required" });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: "User not found" });

    if (
      !user.resetOtp ||
      !user.resetOtpExpiry ||
      user.resetOtp !== otp ||
      Date.now() > user.resetOtpExpiry
    ) {
      return res.status(400).json({ error: "Invalid or expired OTP" });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    user.password = hashed;
    user.user_token = hashed; // update your extra field too
    user.resetOtp = undefined;
    user.resetOtpExpiry = undefined;
    await user.save();

    res.json({ success: true, message: "Password reset successful" });
  } catch (error) {
    console.error("Error in reset password:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

import User from '../model/user.js';

export const enterReferralCode = async (req, res) => {
  const { playerId, referralCode } = req.body;

  if (!playerId || !referralCode) {
    return res.status(400).json({ message: "playerId and referralCode are required" });
  }

  try {
    const user = await User.findById(playerId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.referred_by) {
      return res.status(400).json({ message: "Referral code already used by this user" });
    }

    const referrer = await User.findOne({ referral_code: referralCode });

    if (!referrer) {
      return res.status(400).json({ message: "Invalid referral code" });
    }

    if (referrer._id.equals(user._id)) {
      return res.status(400).json({ message: "You cannot refer yourself" });
    }

    // Apply referral
    user.referred_by = referralCode;
    user.wallet += 50;

    referrer.referrals.push(user._id);
    referrer.wallet += 100;

    await user.save();
    await referrer.save();

    // Re-fetch user to confirm save worked
    const updatedUser = await User.findById(playerId);

    return res.status(200).json({
      message: "Referral code applied successfully",
      wallet: updatedUser.wallet,
      referred_by: updatedUser.referred_by
    });
  } catch (err) {
    console.error("Referral code error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

import User from '../../model/user.js';


export const getLeaderboard = async (req, res) => {
  try {
    const leaderboard = await User.find({})
      .sort({ wincoin: -1 })  // highest wincoin first
      .select("-user_token -device_token -bidvalues -my_token -__v");

    const formattedLeaderboard = leaderboard.map((user, index) => ({
      rank: index + 1,
      ...user.toObject()   // spread all user fields
    }));

    return res.status(200).json({ 
      success: true,
      message: "Leaderboard fetched successfully",
      leaderboard: formattedLeaderboard 
    });

  } catch (err) {
    console.error("Error generating leaderboard:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

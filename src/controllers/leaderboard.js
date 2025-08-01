import User from '../model/user.js';

export const getLeaderboard = async (req, res) => {
  try {
    const leaderboard = await User.find({})
      .sort({ 
        wincoin: -1 
      })  // Sort by wincoin descending
      .limit(15)              // Top 10 players
      .select('first_name wincoin pic_url'); // Only get necessary fields

    const formattedLeaderboard = leaderboard.map(user => ({
      username: user.first_name,
      wincoin: user.wincoin,
      photo: user.pic_url
    }));

    return res.status(200).json({ 
      leaderboard: formattedLeaderboard 
    });

  } catch (err) {
    console.error("Error generating leaderboard:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

import History from '../model/history.js';
import User from '../model/user.js'; // Adjust if you have user data elsewhere

export const getLeaderboard = async (req, res) => {
  try {
    const leaderboard = await History.aggregate([
      {
        $group: {
          _id: "$playerid",
          totalWinAmount: { $sum: "$Win_amount" },
        }
      },
      {
        $sort: { totalWinAmount: -1 }
      },
      {
        $limit: 10 // top 10 players
      }
    ]);

    const enrichedLeaderboard = await Promise.all(
      leaderboard.map(async (entry) => {
        const user = await User.findOne({ _id: entry._id });

        return {
          username: user?.first_name || "Unknown",
          wincoin: entry.totalWinAmount,
          photo: user?.pic_url || null
        };
      })
    );

    return res.status(200).json({ leaderboard: enrichedLeaderboard });

  } catch (err) {
    console.error("Error generating leaderboard:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

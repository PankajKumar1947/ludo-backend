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

export const getAllAdmins = async (req, res) => {
  try {
    // query params ?page=1&limit=10
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const [admins, total] = await Promise.all([
      User.find({ role: "admin" })
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 }), // optional sorting
      User.countDocuments({ role: "admin" }),
    ]);

    res.json({
      success: true,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      totalAdmins: total,
      admins,
    });
  } catch (error) {
    console.error("Error fetching admins:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

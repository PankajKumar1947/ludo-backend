import User from "../../model/user.js";
import CustomRoom from "../../model/customRoom.js";

export const getDashboardData = async (req, res) => {
  try {
    // Total registered users
    const totalUsers = await User.countDocuments();

    // Count total live players from active rooms
    const liveRooms = await CustomRoom.find({ started: true, gameOver: false });
    let livePlayers = 0;
    liveRooms.forEach(room => {
      livePlayers += room.players.length;
    });

    // Total bid values from all rooms
    const totalBidValues = await CustomRoom.aggregate([
      { $group: { _id: null, total: { $sum: "$bet" } } }
    ]);

    res.json({
      success: true,
      message: "Dashboard data fetched successfully",
      totalUsers,
      livePlayers,
      totalBidValues: totalBidValues[0]?.total || 0
    });
  } catch (error) {
    console.error("Error fetching dashboard data:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

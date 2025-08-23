import User from '../../model/user.js';
import History from "../../model/history.js";

export const getAllPlayers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const [players, total] = await Promise.all([
      User.find({ role: "user" })
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 }),
      User.countDocuments({ role: "user" }),
    ]);

    // fetch history for each player
    const playersWithHistory = await Promise.all(
      players.map(async (player) => {
        const history = await History.find({ playerid: player._id })
          .sort({ createdAt: -1 }) // latest first
          .limit(5); // optional: limit number of records per player

        return {
          ...player.toObject(),
          history,
        };
      })
    );

    res.json({
      success: true,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      totalPlayers: total,
      players: playersWithHistory,
    });
  } catch (error) {
    console.error("Error fetching players with history:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Add Coins
export const addCoins = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount } = req.body;

    if (!amount || amount <= 0)
      return res.status(400).json({
        error: "Amount must be greater than 0"
      });

    const player = await User.findById(id);
    if (!player) return res.status(404).json({
      error: "Player not found"
    });

    player.wallet += amount;
    await player.save();

    res.json({
      success: true,
      message: `${amount} coins added`,
      balance: player.wallet
    });
  } catch (error) {
    console.error("Error adding coins:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Deduct Coins
export const deductCoins = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount } = req.body;

    if (!amount || amount <= 0)
      return res.status(400).json({
        error: "Amount must be greater than 0"
      });

    const player = await User.findById(id);
    if (!player)
      return res.status(404).json({
        error: "Player not found"
      });

    if (player.wallet < amount)
      return res.status(400).json({
        error: "Insufficient balance"
      });

    player.wallet -= amount;
    await player.save();

    res.json({
      success: true,
      message: `${amount} coins deducted`,
      balance: player.wallet
    });
  } catch (error) {
    console.error("Error deducting coins:", error);
    res.status(500).json({
      error: "Internal Server Error"
    });
  }
};

// Delete Profile
export const deletePlayer = async (req, res) => {
  try {
    const { id } = req.params;
    const player = await User.findByIdAndDelete(id);
    if (!player)
      return res.status(404).json({
        error: "Player not found"
      });

    res.json({
      success: true,
      message: "Player profile deleted successfully"
    });
  } catch (error) {
    console.error("Error deleting profile:", error);
    res.status(500).json({
      error: "Internal Server Error"
    });
  }
};

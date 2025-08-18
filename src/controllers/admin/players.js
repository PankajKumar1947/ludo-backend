import User from '../../model/user.js';
import History from '../../model/history.js';
export const getPlayerProfile = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({
      error: "Player ID required"
    });

    const player = await User.findById(id);
    if (!player) return res.status(404).json({
      error: "Player not found"
    });

    res.json({
      success: true,
      profile: {
        joined: player.createdAt,
        lastActive: player.updatedAt,
        balance: player.wallet,
        wincoin: player.wincoin,
        transactions: player.shop_coin,
        gameHistory: await History.find({ playerid: player.user_id }),
        pic_url: player.pic_url
      }
    });
  } catch (error) {
    console.error("Error fetching player profile:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Add Coins
export const addCoins = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount } = req.body;

    if (!amount || amount <= 0) return res.status(400).json({ error: "Amount must be greater than 0" });

    const player = await User.findById(id);
    if (!player) return res.status(404).json({ error: "Player not found" });

    player.wallet += amount;
    await player.save();

    res.json({ success: true, message: `${amount} coins added`, balance: player.wallet });
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

    if (!amount || amount <= 0) return res.status(400).json({ error: "Amount must be greater than 0" });

    const player = await User.findById(id);
    if (!player) return res.status(404).json({ error: "Player not found" });

    if (player.wallet < amount) return res.status(400).json({ error: "Insufficient balance" });

    player.wallet -= amount;
    await player.save();

    res.json({ success: true, message: `${amount} coins deducted`, balance: player.wallet });
  } catch (error) {
    console.error("Error deducting coins:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Delete Profile
export const deletePlayer = async (req, res) => {
  try {
    const { id } = req.params;
    const player = await User.findByIdAndDelete(id);
    if (!player) return res.status(404).json({ error: "Player not found" });

    res.json({ success: true, message: "Player profile deleted successfully" });
  } catch (error) {
    console.error("Error deleting profile:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

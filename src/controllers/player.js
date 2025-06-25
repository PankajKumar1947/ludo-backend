import user from "../model/user.js";

export const playerDetails = async (req, res) => {
  try {
    const { playerid } = req.body;

    if (!playerid) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    const player = await user.findById(playerid);

    if (!player) {
      return res.status(404).json({
        success: false,
        message: "Player not found",
      });
    }

    const playerdata = {
      username: player.first_name,
      photo: player.pic_url,
      wincoin: 500,
      GamePlayed: 120,
      totalcoin: 1500,
      playcoin: "null",
      twoPlayWin: "30",
      FourPlayWin: 15,
      refer_code: 123456,
      accountHolder: "John Doe",
      accountNumber: 1234567890,
      ifsc: "ABC0001234",
      refrelCoin: "100"
    }

    const gameconfig = {
      "signup_bonus": 50,
      "website_name": "LudoWorld",
      "notification": "Enjoy the game!",
      "min_withdraw": "100",
      "youtube_link": "https://youtube.com/...",
      "whatsapp_link": "https://wa.me/...",
      "telegram_link": "https://t.me/...",
      "website_url": "https://example.com",
      "pemail": "contact@example.com",
      "commission": "5.5",
      "bot_status": "1"
    };

    const shop_coin = [
      {
        "shop_coin": "500"
      },
      {
        "shop_coin": "1000"
      }
    ];

    const bidvalues = [
      {
        "bid_value": "10"
      },
      {
        "bid_value": "20"
      },
      {
        "bid_value": "30"
      },
      {
        "bid_value": "40"
      },
      {
        "bid_value": "50"
      },
      {
        "bid_value": "60"
      },
      {
        "bid_value": "70"
      },
      {
        "bid_value": "80"
      },
      {
        "bid_value": "90"
      },
      {
        "bid_value": "100"
      }
    ];


    res.status(200).json({
    success: true,
    message: "All Details Fetched Successfully",
    playerdata,
    gameconfig,
    shop_coin,
    bidvalues
  });
} catch (error) {
  console.log(error);
  res.status(500).json({
    success: false,
    message: "Failed to fetch player details",
  });
}
};
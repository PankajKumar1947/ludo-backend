import express from 'express'
import { playerDetails, playerHistory } from '../controllers/player.js';
import multer from 'multer';
import { getLeaderboard } from '../controllers/leaderboard.js';
const upload = multer();

const router = express.Router()

router.post("/details",upload.none(), playerDetails);
router.post("/history", upload.none(), playerHistory);
router.get("/leaderboard", getLeaderboard);

export default router;
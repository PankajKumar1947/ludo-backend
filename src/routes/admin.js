import express from "express";
import { getDashboardData } from "../controllers/admin/main-dashboard.js";
import { getAllAdmins, getLeaderboard } from "../controllers/admin/leaderboard.js";
import { login, register } from "../controllers/admin/auth.js";
import { addCoins, deductCoins, deletePlayer, getAllPlayers } from "../controllers/admin/players.js";

const router = express.Router();

router.get("/dashboard-live", getDashboardData );
router.get("/leaderboard",getLeaderboard);
router.post("/register", register);
router.post("/login", login);

router.get("/all-players", getAllPlayers);
router.get("/all-admins", getAllAdmins);

router.post("/add-coins/:id", addCoins);
router.post("/deduct-coins/:id", deductCoins);

router.delete("/delete-player/:id", deletePlayer);

export default router;
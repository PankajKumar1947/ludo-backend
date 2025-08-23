import express from "express";
import { getDashboardData } from "../controllers/admin/main-dashboard.js";
import { getAllAdmins, getLeaderboard } from "../controllers/admin/leaderboard.js";
import { login, register } from "../controllers/admin/auth.js";
import { addCoins, deductCoins, deletePlayer, getAllPlayers } from "../controllers/admin/players.js";
import { isAdmin, isAuthenticated } from "../middleware/auth.js";
import { getBotSettings, getBotStatus, resetSettings, setBotSettings } from "../controllers/admin/botControl.js";
import { forgotPassword, resetPasswordWithOtp } from "../controllers/admin/forgot-password.js";

const router = express.Router();

router.get("/dashboard-live", isAuthenticated, isAdmin, getDashboardData );
router.get("/leaderboard", isAuthenticated, isAdmin, getLeaderboard);
router.post("/register", register);
router.post("/login", login);
router.post("/forgot-password", forgotPassword);
router.post('/create-password', resetPasswordWithOtp);

router.get("/all-players", getAllPlayers);
router.get("/all-admins", isAuthenticated, isAdmin, getAllAdmins);

router.post("/add-coins/:id", isAuthenticated, isAdmin, addCoins);
router.post("/deduct-coins/:id", isAuthenticated, isAdmin, deductCoins);

router.delete("/delete-player/:id", isAuthenticated, isAdmin, deletePlayer);

// bot control
router.get("/bot-settings", isAuthenticated, isAdmin, getBotSettings);
router.put("/set-bot-settings", isAuthenticated, isAdmin, setBotSettings);
router.put("/reset-bot-settings", isAuthenticated, isAdmin, resetSettings);
router.get("/bot-status", isAuthenticated, isAdmin, getBotStatus);

export default router;
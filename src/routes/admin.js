import express from "express";
import { getDashboardData } from "../controllers/admin/main-dashboard.js";
import { getLeaderboard } from "../controllers/admin/leaderboard.js";
import { login, register } from "../controllers/admin/auth.js";

const router = express.Router();

router.get("/dashboard-live", getDashboardData );
router.get("/leaderboard",getLeaderboard);
router.post("/register", register);
router.post("/login", login);

export default router;
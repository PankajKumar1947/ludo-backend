import express from 'express';
import {
  submitKYC,
  getMyKYC,
  getAllKYC,
  approveKYC,
  rejectKYC,
} from '../controllers/kycController.js';
import { isAuthenticated, isAdmin } from '../middleware/auth.js';

const router = express.Router();

router.post('/submit', isAuthenticated, submitKYC);
router.get('/me', isAuthenticated, getMyKYC);

// Admin routes
router.get('/all', isAuthenticated, isAdmin, getAllKYC);
router.post('/approve/:kycId', isAuthenticated, isAdmin, approveKYC);
router.post('/reject/:kycId', isAuthenticated, isAdmin, rejectKYC);

export default router;
import express from 'express';
import KYCVerification from '../model/kycDetails.js';

const router = express.Router();

// Admin dashboard UI
router.get('/kyc-dashboard', async (req, res) => {
  try {
    const kycs = await KYCVerification.find().populate('userId', 'name email');
    res.render('admin/kyc-dashboard', { kycs });
  } catch (error) {
    console.error('Error loading dashboard:', error);
    res.status(500).send('Error loading dashboard.');
  }
});

export default router;

import KYCVerification from '../model/kycDetails.js';

// 1. Submit or Update KYC
export const submitKYC = async (req, res) => {
  try {
    const { aadhaarFrontPhotoUrl, aadhaarBackPhotoUrl, panCardPhotoUrl } = req.body;
    const userId = req.user.id; // Make sure `req.user` is populated via auth middleware

    let existingKYC = await KYCVerification.findOne({ userId });

    if (existingKYC) {
      // Update existing KYC
      existingKYC.aadhaarFrontPhotoUrl = aadhaarFrontPhotoUrl;
      existingKYC.aadhaarBackPhotoUrl = aadhaarBackPhotoUrl;
      existingKYC.panCardPhotoUrl = panCardPhotoUrl;
      existingKYC.status = 'pending';
      existingKYC.rejectionReason = '';
      existingKYC.submittedAt = new Date();
      existingKYC.verifiedAt = null;
      await existingKYC.save();
    } else {
      // Create new KYC
      await KYCVerification.create({
        userId,
        aadhaarFrontPhotoUrl, 
        aadhaarBackPhotoUrl,
        panCardPhotoUrl,

      });
    }

    res.status(200).json({ message: 'KYC submitted successfully.' });
  } catch (error) {
    res.status(500).json({ error: 'KYC submission failed.', details: error.message });
  }
};

// 2. Get current user's KYC status
export const getMyKYC = async (req, res) => {
  try {
    const userId = req.user._id;
    const kyc = await KYCVerification.findOne({ userId });
    if (!kyc) return res.status(404).json({ message: 'KYC not submitted.' });
    res.json(kyc);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch KYC.', details: error.message });
  }
};

// 3. Admin: Get all KYC requests
export const getAllKYC = async (req, res) => {
  try {
    const kycList = await KYCVerification.find().populate('userId', 'name email');
    res.json(kycList);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch KYC list.', details: error.message });
  }
};

// 4. Admin: Approve KYC
export const approveKYC = async (req, res) => {
  try {
    const { kycId } = req.params;
    const kyc = await KYCVerification.findById(kycId);
    if (!kyc) return res.status(404).json({ message: 'KYC not found.' });

    kyc.status = 'approved';
    kyc.verifiedAt = new Date();
    kyc.rejectionReason = '';
    await kyc.save();

    res.json({ message: 'KYC approved.' });
  } catch (error) {
    res.status(500).json({ error: 'Approval failed.', details: error.message });
  }
};

// 5. Admin: Reject KYC
export const rejectKYC = async (req, res) => {
  try {
    const { kycId } = req.params;
    const { reason } = req.body;

    const kyc = await KYCVerification.findById(kycId);
    if (!kyc) return res.status(404).json({ message: 'KYC not found.' });

    kyc.status = 'rejected';
    kyc.rejectionReason = reason || 'Not specified';
    kyc.verifiedAt = null;
    await kyc.save();

    res.json({ message: 'KYC rejected.' });
  } catch (error) {
    res.status(500).json({ error: 'Rejection failed.', details: error.message });
  }
};

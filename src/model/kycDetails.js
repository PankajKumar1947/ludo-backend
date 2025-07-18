import mongoose from 'mongoose';

const kycVerificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true, // One KYC per user
  },
  aadhaarFrontPhotoUrl: {
    type: String,
    required: true,
  },
  aadhaarBackPhotoUrl: {
    type: String,
    required: true,
  },
  panCardPhotoUrl: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
  },
  rejectionReason: {
    type: String,
    default: '',
  },
  submittedAt: {
    type: Date,
    default: Date.now,
  },
  verifiedAt: {
    type: Date,
  }
});

const KYCVerification = mongoose.model('KYCVerification', kycVerificationSchema);

export default KYCVerification;

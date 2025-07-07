import express from 'express'
import { uploadImageToCloud } from '../controllers/common.js';
const router = express.Router()
import upload from '../middleware/uploadMiddleware.js';

router.post('/upload-img', upload.single('image'), uploadImageToCloud);

export default router
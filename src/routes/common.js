import express from 'express'
import multer from 'multer';
import { uploadImageToCloud } from '../controllers/common.js';
const router = express.Router()
const upload = multer();

router.post('/upload-img', upload.none(), uploadImageToCloud);

export default router
import express from 'express'
import { SigningIn } from '../controllers/auth.js'
import multer from 'multer';
const router = express.Router()
const upload = multer();

router.post('/signin', upload.none(), SigningIn)

export default router
import express from 'express'
import { playerDetails } from '../controllers/player.js';
import multer from 'multer';
const upload = multer();

const router = express.Router()

router.post("/details",upload.none(), playerDetails);

export default router;
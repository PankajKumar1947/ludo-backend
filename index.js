import express from 'express';
import dotenv from 'dotenv';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';

import dbConnect from './src/database/dbConnect.js';
import authRouter from './src/routes/auth.js';
import playerRouter from './src/routes/player.js';
import commonRouter from './src/routes/common.js';
import adminKycRoutes from './src/routes/adminKycRoutes.js';
import kycRoutes from "./src/routes/kycRoutes.js"

import { Server } from 'socket.io';
import { setupUnifiedGameSocket } from './src/socket/two-four-game.js';
import { enterReferralCode } from './src/controllers/refer.js';

const upload = multer();

dotenv.config();
const app = express();
const server = http.createServer(app);

// Required for ES modules to get __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// DB connection
dbConnect();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: '*',
  methods: ['POST', 'GET', 'PUT', 'DELETE'],
  credentials: true,
}));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src/views'));

// Routes
app.get('/', (req, res) => res.send('Hello World!'));
app.use('/api/v1/', authRouter);
app.use('/api/v1/player', playerRouter);
app.use('/api/v1/common/', commonRouter);
app.use("/api/v1/kyc/", kycRoutes);
app.use("/api/v1/refer/player", upload.none(), enterReferralCode);

// Admin panel (EJS page)
app.use('/admin', adminKycRoutes);

// Test route for automation
app.get('/test', (req, res) => {
  console.log('automated test');
  res.send('hello from test');
});

// Socket.IO setup
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

setupUnifiedGameSocket(io.of('/'));

// Start server
const port = process.env.PORT || 3001;
server.listen(port, () => {
  console.log(`🚀 Server listening on port ${port}`);
});
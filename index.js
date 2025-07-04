import express from 'express';
import dotenv from 'dotenv';
dotenv.config();

import http from 'http';
import dbConnect from './src/database/dbConnect.js';
import cors from 'cors';
import authRouter from './src/routes/auth.js';
import playerRouter from './src/routes/player.js';

import { Server } from 'socket.io';
import { setupSocket } from './src/socket/play-game-socket.js';
import { setupFourPlayerGameSocket } from './src/socket/four-player-game.js';

const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: '*',
  methods: ['POST', 'GET', 'PUT', 'DELETE'],
  credentials: true,
}));

const port = process.env.PORT || 3000;
dbConnect();

// Routes
app.get('/', (req, res) => res.send('Hello World!'));
app.use('/api/v1/', authRouter);
app.use('/api/v1/player', playerRouter);

// Create main io instance
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Default namespace: 1 vs BOT
setupSocket(io.of('/'));

// Custom namespace: /four => 4-player game
setupFourPlayerGameSocket(io.of('/four'));

server.listen(port, () => {
  console.log(`🚀 Server listening on port ${port}`);
});

import express from 'express';
import dotenv from 'dotenv';
dotenv.config();

import http from 'http';
import dbConnect from './src/database/dbConnect.js';
import cors from 'cors';
import authRouter from './src/routes/auth.js';
import playerRouter from './src/routes/player.js';

import { Server } from 'socket.io';
import { setupUnifiedGameSocket } from './src/socket/two-four-game.js';

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
app.get('/', (req, res) => res.send('Hello World!'));

// for automated test
app.get("/test", (req, res) => {
  console.log("automated test");
  res.send("hello form test")
})

// Create main io instance
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

setupUnifiedGameSocket(io.of('/'));

server.listen(port, () => {
  console.log(`🚀 Server listening on port ${port}`);
});
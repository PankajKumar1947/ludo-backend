import express from 'express';
import dotenv from 'dotenv';
dotenv.config();

import http from 'http';
import { getIO, initSocket } from './src/socket/socket.js';

import dbConnect from './src/database/dbConnect.js';
import cors from 'cors';
import authRouter from './src/routes/auth.js';
import playerRouter from './src/routes/player.js';

const app = express();
const server = http.createServer(app); // Create HTTP server for both express & socket.io

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  cors({
    origin: '*',
    methods: ['POST', 'GET', 'PUT', 'DELETE'],
    credentials: true,
  })
);

const port = process.env.PORT || 3000;

dbConnect();

// Routes
app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.use('/api/v1/', authRouter);
app.use('/api/v1/player', playerRouter);
// new api router -> added in routes folder _


// Initialize Socket.IO
initSocket(server);


// faltue -> kaam ka nahi hai
app.post('/emit', (req, res) => {
  const { event, data } = req.body;

  const io = getIO();
  
  io.emit(event, data);

  console.log(`📣 Emitted event: "${event}" with data:`, data);

  res.status(200).json({ success: true, message: `Emitted event "${event}"` });
});


// Start the server
server.listen(port, () => {
  console.log(`🚀 Server listening on port ${port}`);
});

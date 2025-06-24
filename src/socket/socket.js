import { Server } from 'socket.io';

let io = null;  // this will hold the io instance

const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket) => {
    console.log('🔌 New client connected:', socket.id);

    socket.on('disconnect', () => {
      console.log('❌ Client disconnected:', socket.id);
    });
  });
};

const getIO = () => {
  if (!io) {
    throw new Error('❌ Socket.io not initialized! Call initSocket(server) first.');
  }
  return io;
};

export { initSocket, getIO };

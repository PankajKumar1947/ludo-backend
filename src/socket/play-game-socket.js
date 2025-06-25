import { Server } from 'socket.io';

const rooms = {}; // In-memory store, consider persisting in DB later

export const setupSocket = (server) => {
  const io = new Server(server, {
    cors: {
      origin: '*', // Set properly for prod
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket) => {
    console.log(`🔌 New connection: ${socket.id}`);

    // STEP 2 - Create Room
    socket.on('create-room', ({ player_id }) => {
      const roomId = Math.random().toString(36).substr(2, 6);
      rooms[roomId] = {
        players: [{ id: socket.id, name: player_id, bet: 0 }],
        gameStarted: false,
      };
      socket.join(roomId);
      socket.emit('message', `✅ Room ${roomId} created by ${player_id}`);
      console.log(`🆕 Room created: ${roomId} by ${player_id}`);
    });

    // STEP 3 - Join Room
    socket.on('join-room', ({ roomId, player_id, bet_amount }) => {
      const room = rooms[roomId];
      if (!room || room.players.length >= 4) {
        socket.emit('message', '❌ Room not found or full');
        return;
      }

      room.players.push({ id: socket.id, name: player_id, bet_amount });
      socket.join(roomId);
      io.to(roomId).emit('room-update', room.players);
      io.to(roomId).emit('message', `🙋‍♂️ ${player_id} joined with ₹${bet_amount}`);
      console.log(`🎮 ${player_id} joined room ${roomId}`);
    });

    // STEP 4 - Start Game
    socket.on('start-game', ({ roomId }) => {
      const room = rooms[roomId];
      if (!room || room.players.length < 2) {
        socket.emit('message', '❌ Need at least 2 players to start');
        return;
      }

      room.gameStarted = true;
      io.to(roomId).emit('game-started', { players: room.players });
      io.to(roomId).emit('message', '🚀 Game has started!');
      console.log(`🚀 Game started in room ${roomId}`);
    });

    // STEP 5 - Play Turn
    socket.on('play-turn', ({ roomId, playerId, dice }) => {
      io.to(roomId).emit('turn-played', { playerId, dice });
      io.to(roomId).emit('message', `🎲 Player ${playerId} rolled a ${dice}`);
      console.log(`🎲 Player ${playerId} played dice: ${dice}`);
    });

    // STEP 6 - Leave Room
    socket.on('leave-room', ({ roomId }) => {
      const room = rooms[roomId];
      if (!room) return;

      const player = room.players.find(p => p.id === socket.id);
      const name = player?.name || 'Unknown';

      room.players = room.players.filter(p => p.id !== socket.id);
      socket.leave(roomId);
      io.to(roomId).emit('room-update', room.players);
      io.to(roomId).emit('message', `🚪 ${name} left the room`);
      console.log(`🚪 ${name} left room ${roomId}`);
    });

    // Disconnect
    socket.on('disconnect', () => {
      console.log(`❌ Disconnected: ${socket.id}`);
      // Optional: remove player from rooms
    });
  });
};

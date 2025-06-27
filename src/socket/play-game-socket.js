import { Server } from 'socket.io';
import User from '../model/user.js';

function generateRoomId() {
  return Math.random().toString(36).substr(2, 6);
}

const rooms = {};

export const setupSocket = (server) => {
  const io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket) => {
    console.log(`🔌 Connected: ${socket.id}`);

    // Start game vs BOT
    socket.on('start-vs-bot', async ({ playerId, bet_amount }) => {
      try {
        console.log("start-vs-bot");
        const user = await User.findById(playerId);
        if (!user || user.wallet < bet_amount) {
          socket.emit('message', {
            status: 'error',
            message: '❌ Invalid user or insufficient balance'
          });
          return;
        }

        // Deduct wallet immediately
        user.wallet -= bet_amount;
        await user.save();

        const roomId = generateRoomId();
        const botId = `BOT_${roomId}`;

        rooms[roomId] = {
          players: [
            { id: socket.id, name: user.first_name, playerId, isBot: false, bet: bet_amount },
            { id: botId, name: 'BOT', isBot: true, bet: bet_amount }
          ],
          gameStarted: true,
          currentTurnIndex: 0,
          gameOver: false
        };

        socket.join(roomId);

        socket.emit('room-id', { roomId });

        io.to(roomId).emit('game-started', {
          status: 'success',
          players: rooms[roomId].players,
          currentTurn: playerId,
          message: '🚀 Game started vs BOT. Your turn 🎮'
        });

      } catch (err) {
        console.error(err);
        socket.emit('message', {
          status: 'error',
          message: '❌ Server error. Try again later.'
        });
      }
    });

    // Play Turn
    socket.on('play-turn', ({ roomId, playerId }) => {
      console.log("player-turn", roomId, playerId)
      const room = rooms[roomId];
      if (!room || room.gameOver) return;

      const currentPlayer = room.players[room.currentTurnIndex];
      if (currentPlayer.playerId !== playerId) {
        socket.emit('message', {
          status: 'error',
          message: '❌ Not your turn'
        });
        return;
      }

      const dice = Math.floor(Math.random() * 6) + 1;

      io.to(roomId).emit('turn-played', {
        playerId,
        dice,
        message: `🎲 ${currentPlayer.name} rolled a ${dice}`
      });

      room.currentTurnIndex = (room.currentTurnIndex + 1) % 2;

      if (room.players[room.currentTurnIndex].isBot) {
        setTimeout(() => handleBotTurn(io, roomId), 10000);
      }
    });

    // Game Over
    socket.on('game-over', async ({ roomId, winnerPlayerId }) => {
      const room = rooms[roomId];
      if (!room || room.gameOver) return;

      room.gameOver = true;

      const winner = room.players.find(p => p.playerId === winnerPlayerId);
      if (!winner || winner.isBot) return;

      const reward = room.players[0].bet + room.players[1].bet;
      const user = await User.findById(winner.playerId);
      if (user) {
        user.wallet += reward;
        await user.save();
      }

      io.to(roomId).emit('game-over', {
        status: 'success',
        winner: winner.name,
        reward,
        message: `🎉 ${winner.name} wins and earns ₹${reward}`
      });
    });

    // Disconnect
    socket.on('disconnect', () => {
      console.log(`❌ Disconnected: ${socket.id}`);
    });

    // BOT Turn handler
    function handleBotTurn(io, roomId) {
      console.log("Bot Played")
      const room = rooms[roomId];
      if (!room || room.gameOver) return;

      const dice = Math.floor(Math.random() * 6) + 1;
      const bot = room.players[room.currentTurnIndex];

      io.to(roomId).emit('turn-played', {
        playerId: bot.playerId,
        dice,
        message: `🤖 BOT rolled a ${dice}`
      });

      room.currentTurnIndex = 0;

      io.to(roomId).emit('message', {
        message: '🎮 Your turn!',
        turn: 'player'
      });
    }
  });
};

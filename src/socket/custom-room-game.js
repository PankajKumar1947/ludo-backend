import User from '../model/user.js';

const customRooms = {};
const MAX_SCORE_LIMIT = 100;

function generateRoomId() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

export const setupCustomRoomGame = (namespace) => {
  namespace.on('connection', (socket) => {
    console.log(`🔗 [CUSTOM] Connected: ${socket.id}`);

    socket.on('create-custom-room', async ({ playerId, bet_amount }) => {
      try {
        const user = await User.findById(playerId);
        if (!user || user.wallet < bet_amount) {
          return socket.emit('message', {
            status: 'error',
            message: '❌ Invalid user or insufficient balance'
          });
        }

        user.wallet -= bet_amount;
        await user.save();

        const roomId = generateRoomId();
        customRooms[roomId] = {
          roomId,
          players: [{
            id: socket.id,
            playerId,
            name: user.first_name,
            isBot: false,
            tokens: [null, null, null, null],
            kills: 0,
            completed: 0,
            totalPoints: 0
          }],
          bet: bet_amount,
          started: false,
          gameOver: false,
          timeout: null,
          autoStartTimer: null
        };

        socket.join(roomId);
        socket.emit('custom-room-created', { roomId });

        namespace.to(roomId).emit('player-joined', {
          players: customRooms[roomId].players,
          message: `🎉 ${user.first_name} joined the room`
        });
      } catch (err) {
        console.error(err);
        socket.emit('message', {
          status: 'error',
          message: '❌ Server error'
        });
      }
    });

    socket.on('join-custom-room', async ({ roomId, playerId, bet_amount }) => {
      try {
        const room = customRooms[roomId];

        if (!room || room.started) {
          return socket.emit('message', {
            status: 'error',
            message: '❌ Room not found or game already started'
          });
        }

        if (room.players.length >= 4) {
          return socket.emit('message', {
            status: 'error',
            message: '❌ Room is full'
          });
        }

        const user = await User.findById(playerId);
        if (!user || user.wallet < bet_amount) {
          return socket.emit('message', {
            status: 'error',
            message: '❌ Invalid user or insufficient balance'
          });
        }

        user.wallet -= bet_amount;
        await user.save();

        const player = {
          id: socket.id,
          playerId,
          name: user.first_name,
          isBot: false,
          tokens: [null, null, null, null],
          kills: 0,
          completed: 0,
          totalPoints: 0
        };

        room.players.push(player);
        socket.join(roomId);
        socket.emit('joined-custom-room', { roomId });

        namespace.to(roomId).emit('player-joined', {
          players: room.players,
          message: `🎉 ${user.first_name} joined the room`
        });

        if (room.players.length === 4) {
          room.started = true;
          clearTimeout(room.autoStartTimer);
          startCustomRoomGame(namespace, roomId);
        } else if (room.players.length >= 2 && !room.started && !room.autoStartTimer) {
          namespace.to(roomId).emit('ready-to-start', {
            message: `✅ ${room.players.length} players joined. Host can start the game manually.`,
          });

          room.autoStartTimer = setTimeout(() => {
            if (!room.started && room.players.length >= 2) {
              room.started = true;
              startCustomRoomGame(namespace, roomId);
            }
          }, 10000); // 10 seconds for manual start
        }
      } catch (err) {
        console.error(err);
        socket.emit('message', {
          status: 'error',
          message: '❌ Server error'
        });
      }
    });

    socket.on('start-custom-room-game', ({ roomId, playerId }) => {
      const room = customRooms[roomId];
      if (!room || room.started || room.players.length < 2) return;

      const host = room.players[0];
      if (host.playerId !== playerId) {
        return socket.emit('message', {
          status: 'error',
          message: '❌ Only the host can start the game.'
        });
      }

      clearTimeout(room.autoStartTimer);
      room.started = true;
      startCustomRoomGame(namespace, roomId);
    });

    socket.on('update-custom-score', ({ roomId, playerId, totalPoints }) => {
      const room = customRooms[roomId];
      if (!room || room.gameOver) return;

      const player = room.players.find(p => p.playerId === playerId);
      if (player && totalPoints >= 0 && totalPoints <= MAX_SCORE_LIMIT) {
        player.totalPoints = totalPoints;
      }
    });

    socket.on('disconnect', async () => {
      const roomId = Object.keys(customRooms).find(r =>
        customRooms[r].players.some(p => p.id === socket.id)
      );

      if (roomId) {
        const room = customRooms[roomId];
        if (!room || room.gameOver) return;

        room.gameOver = true;
        clearTimeout(room.timeout);
        clearTimeout(room.autoStartTimer);

        const winner = room.players.reduce((a, b) =>
          a.totalPoints >= b.totalPoints ? a : b
        );

        if (!winner.isBot) {
          const user = await User.findById(winner.playerId);
          if (user) {
            user.wallet += room.bet * room.players.length;
            await user.save();
          }
        }

        namespace.to(roomId).emit('game-over-custom', {
          winner: winner.name,
          message: `❌ A player disconnected. ${winner.name} wins by score.`
        });
      }
    });
  });
};

function startCustomRoomGame(namespace, roomId) {
  const room = customRooms[roomId];
  if (!room) return;

  const winning_amount = room.bet * room.players.length - (room.bet * room.players.length / 10);
  const startingPlayer = room.players[0];

  namespace.to(roomId).emit('custom-game-started', {
    players: room.players,
    winning_amount,
    message: `🎮 Game started! ${startingPlayer.name}'s turn.`
  });

  namespace.to(roomId).emit('turn-changed', {
    currentPlayerId: startingPlayer.playerId,
    message: `🎯 ${startingPlayer.name}'s turn`
  });

  namespace.to(roomId).emit('game-timer-started', {
    duration: 8 * 60,
    message: '⏱ Game will auto-end after 8 minutes'
  });

  room.timeout = setTimeout(async () => {
    if (!room || room.gameOver) return;
    room.gameOver = true;

    const winner = room.players.reduce((a, b) =>
      a.totalPoints >= b.totalPoints ? a : b
    );

    if (!winner.isBot) {
      const user = await User.findById(winner.playerId);
      if (user) {
        user.wallet += room.bet * room.players.length;
        await user.save();
      }
    }

    namespace.to(roomId).emit('game-over-custom', {
      winner: winner.name,
      message: `⏰ Time's up! ${winner.name} wins by score.`
    });
  }, 8 * 60 * 1000); // 8 minutes
}

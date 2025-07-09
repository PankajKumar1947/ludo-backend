import User from '../model/user.js';

const customRooms = {};
const MAX_SCORE_LIMIT = 100;

function generateRoomId() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

function getNextPlayerIndex(players, currentIndex) {
  return (currentIndex + 1) % players.length;
}

export const setupCustomRoomGame = (namespace) => {
  namespace.on('connection', (socket) => {
    console.log(`🔗 [CUSTOM] Connected: ${socket.id}`);

    socket.on('create-custom-room', async ({ playerId, bet_amount, playerLimit }) => {
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
          playerLimit, // 2 or 4
          players: [{
            id: socket.id,
            playerId,
            name: user.first_name,
            isBot: false,
            score: 0
          }],
          bet: bet_amount,
          started: false,
          gameOver: false,
          timeout: null,
          autoStartTimer: null,
          destroyTimer: setTimeout(() => {
            if (!customRooms[roomId].started) {
              delete customRooms[roomId];
              namespace.to(roomId).emit('message', {
                status: 'error',
                message: '🕒 Room destroyed due to inactivity.'
              });
            }
          }, 10 * 60 * 1000) // 10 minutes
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

        if (room.players.length >= room.playerLimit) {
          return socket.emit('message', {
            status: 'error',
            message: '❌ Room is full'
          });
        }

        if (room.players.some(p => p.playerId === playerId)) {
          return socket.emit('message', {
            status: 'error',
            message: '❌ Player already in room'
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
          score: 0
        };

        room.players.push(player);
        socket.join(roomId);
        socket.emit('joined-custom-room', { roomId });

        namespace.to(roomId).emit('player-joined', {
          players: room.players,
          message: `🎉 ${user.first_name} joined the room`
        });

        if (room.players.length === room.playerLimit) {
          room.started = true;
          clearTimeout(room.autoStartTimer);
          clearTimeout(room.destroyTimer);
          startCustomRoomGame(namespace, roomId);
        } else if (
          room.playerLimit === 4 &&
          room.players.length >= 3 &&
          !room.started &&
          !room.autoStartTimer
        ) {
          namespace.to(roomId).emit('ready-to-start', {
            message: `✅ ${room.players.length} players joined. Host can start the game manually.`,
          });

          room.autoStartTimer = setTimeout(() => {
            if (!room.started) {
              room.started = true;
              clearTimeout(room.destroyTimer);
              startCustomRoomGame(namespace, roomId);
            }
          }, 10000); // 10 seconds
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
      if (!room || room.started) return;

      const host = room.players[0];
      if (host.playerId !== playerId) {
        return socket.emit('message', {
          status: 'error',
          message: '❌ Only the host can start the game.'
        });
      }

      if (room.playerLimit === 4 && room.players.length < 3) {
        return socket.emit('message', {
          status: 'error',
          message: '❌ Minimum 3 players required to start 4-player game.'
        });
      }

      clearTimeout(room.autoStartTimer);
      clearTimeout(room.destroyTimer);
      room.started = true;
      startCustomRoomGame(namespace, roomId);
    });

    socket.on('update-custom-score', ({ roomId, playerId, score }) => {
      const room = customRooms[roomId];
      if (!room || room.gameOver) return;

      const player = room.players.find(p => p.playerId === playerId);
      if (player && score >= 0 && score <= MAX_SCORE_LIMIT) {
        player.score = score;
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
        clearTimeout(room.destroyTimer);

        const winner = room.players.reduce((a, b) => a.score >= b.score ? a : b);

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
  let currentPlayerIndex = 0;

  namespace.to(roomId).emit('custom-game-started', {
    players: room.players,
    winning_amount,
    message: `🎮 Game started! ${room.players[0].name}'s turn.`
  });

  namespace.to(roomId).emit('game-timer-started', {
    duration: 8 * 60,
    message: '⏱ Game will auto-end after 8 minutes'
  });

  room.timeout = setTimeout(async () => {
    if (!room || room.gameOver) return;
    room.gameOver = true;

    const winner = room.players.reduce((a, b) => a.score >= b.score ? a : b);

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

  // DICE ROLL LOOP
  function handleTurn() {
    if (!room || room.gameOver) return;

    const currentPlayer = room.players[currentPlayerIndex];
    const diceValue = Math.floor(Math.random() * 6) + 1;

    namespace.to(roomId).emit('dice-rolled', {
      playerId: currentPlayer.playerId,
      dice: diceValue,
      message: `🎲 ${currentPlayer.name} rolled a ${diceValue}`
    });

    namespace.to(roomId).emit('turn-changed', {
      currentPlayerId: currentPlayer.playerId,
      message: `🎯 ${currentPlayer.name}'s turn`
    });

    currentPlayerIndex = getNextPlayerIndex(room.players, currentPlayerIndex);

    setTimeout(() => {
      if (!room.gameOver) handleTurn();
    }, 5000); // Next turn in 5 seconds
  }

  handleTurn();
}
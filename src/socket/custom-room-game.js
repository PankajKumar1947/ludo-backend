import User from '../model/user.js';

const customRooms = {};
const playerRoomMap = {}; // Track player -> room
const MAX_SCORE_LIMIT = 100;

function generateRoomId(length = 6) {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const numbers = '0123456789';
  const chars = letters + numbers;
  let roomId = '', hasLetter = false, hasNumber = false;
  while (!hasLetter || !hasNumber || roomId.length < length) {
    const char = chars[Math.floor(Math.random() * chars.length)];
    roomId += char;
    if (letters.includes(char)) hasLetter = true;
    if (numbers.includes(char)) hasNumber = true;
    if (roomId.length > length) roomId = '', hasLetter = false, hasNumber = false;
  }
  return roomId.substring(0, length);
}

function getNextPlayerIndex(players, currentIndex) {
  return (currentIndex + 1) % players.length;
}

export const setupCustomRoomGame = (namespace) => {
  namespace.on('connection', (socket) => {
    console.log(`🔗 [CUSTOM] Connected: ${socket.id}`);

    socket.on('create-custom-room', async ({ playerId, bet_amount, playerLimit }) => {
      try {
        if (playerRoomMap[playerId]) {
          return socket.emit('message', { status: 'error', message: '🚫 Already in a room' });
        }

        if (!playerId || !bet_amount || !playerLimit) {
          return socket.emit('message', { status: 'error', message: "Missing data" });
        }

        const user = await User.findById(playerId);
        if (!user || user.wallet < bet_amount) {
          return socket.emit('message', { status: 'error', message: '❌ Invalid user or insufficient balance' });
        }

        user.wallet -= bet_amount;
        await user.save();

        const roomId = generateRoomId();
        customRooms[roomId] = {
          roomId,
          playerLimit,
          players: [{ id: socket.id, playerId, name: user.first_name, isBot: false, score: 0, pic_url: user.pic_url || '' }],
          bet: bet_amount,
          started: false,
          gameOver: false,
          timeout: null,
          autoStartTimer: null,
          destroyTimer: setTimeout(() => {
            if (!customRooms[roomId].started) {
              delete customRooms[roomId];
              namespace.to(roomId).emit('message', { status: 'error', message: '🕒 Room destroyed due to inactivity.' });
            }
          }, 10 * 60 * 1000)
        };

        playerRoomMap[playerId] = roomId;
        socket.join(roomId);
        socket.emit('custom-room-created', { roomId, bet_amount });
        namespace.to(roomId).emit('player-joined', {
          players: customRooms[roomId].players,
          playerLimit: customRooms[roomId].playerLimit,
          message: `🎉 ${user.first_name} joined the room`
        });
      } catch (err) {
        console.error(err);
        socket.emit('message', { status: 'error', message: '❌ Server error' });
      }
    });

    socket.on('join-custom-room', async ({ roomId, playerId }) => {
      try {
        if (playerRoomMap[playerId]) {
          return socket.emit('message', { status: 'error', message: '🚫 Already in a room' });
        }

        const room = customRooms[roomId];
        if (!room || room.started || room.players.length >= room.playerLimit) {
          return socket.emit('message', { status: 'error', message: '❌ Invalid join attempt' });
        }

        const user = await User.findById(playerId);
        if (!user || user.wallet < room.bet) {
          return socket.emit('message', { status: 'error', message: '❌ Insufficient balance' });
        }

        user.wallet -= room.bet;
        await user.save();

        const player = { id: socket.id, playerId, name: user.first_name, isBot: false, score: 0, pic_url: user.pic_url || '' };
        room.players.push(player);
        playerRoomMap[playerId] = roomId;
        socket.join(roomId);

        socket.emit('joined-custom-room', {
          roomId,
          bet_amount: room.bet,
          playerLimit: room.playerLimit,
          players: room.players
        });

        namespace.to(roomId).emit('player-joined', {
          players: room.players,
          playerLimit: room.playerLimit,
          message: `🎉 ${user.first_name} joined the room`
        });

        if (room.players.length >= 2) {
          clearTimeout(room.autoStartTimer);
          namespace.to(room.players[0].id).emit('ready-to-start', {
            message: '✅ You can start the game now.',
            roomId,
            players: room.players
          });
        }
      } catch (err) {
        console.error(err);
        socket.emit('message', { status: 'error', message: '❌ Server error' });
      }
    });

    socket.on('leave-custom-room', async ({ playerId }) => {
      const roomId = playerRoomMap[playerId];
      if (!roomId || !customRooms[roomId]) return;

      const room = customRooms[roomId];
      room.players = room.players.filter(p => p.playerId !== playerId);

      delete playerRoomMap[playerId];
      socket.leave(roomId);

      namespace.to(roomId).emit('player-left', {
        playerId,
        players: room.players,
        message: `🚪 Player ${playerId} left the room`
      });

      if (room.players.length === 0) {
        clearTimeout(room.timeout);
        clearTimeout(room.autoStartTimer);
        clearTimeout(room.destroyTimer);
        delete customRooms[roomId];
      }
    });

    socket.on('start-custom-room-game', ({ roomId, playerId }) => {
      const room = customRooms[roomId];
      if (!room || room.started || room.players[0].playerId !== playerId) return;
      if (room.playerLimit === 4 && room.players.length < 3) {
        return socket.emit('message', { status: 'error', message: '❌ Minimum 3 players required' });
      }

      clearTimeout(room.autoStartTimer);
      clearTimeout(room.destroyTimer);
      room.started = true;

      namespace.to(roomId).emit('game-will-start', {
        message: '⌛ Game will start in 30 seconds',
        roomId,
        bet_amount: room.bet
      });

      setTimeout(() => startCustomRoomGame(namespace, roomId), 30000);
    });

    socket.on('custom-roll-dice', ({ roomId, playerId }) => {
      const room = customRooms[roomId];
      if (!room || room.gameOver) return;
      const currentPlayer = room.players[room.currentPlayerIndex];
      if (currentPlayer.playerId !== playerId) return;

      const diceValue = Math.floor(Math.random() * 6) + 1;

      namespace.to(roomId).emit('custom-dice-rolled', {
        playerId,
        dice: diceValue,
        message: `🎲 ${currentPlayer.name} rolled a ${diceValue}`
      });

      namespace.to(roomId).emit('turn-changed', {
        currentPlayerId: playerId,
        message: `🎯 ${currentPlayer.name}'s turn`
      });

      namespace.to(roomId).emit('current-turn', {
        playerId: currentPlayer.playerId,
        name: currentPlayer.name,
        playerIndex: room.currentPlayerIndex
      });

      room.currentPlayerIndex = getNextPlayerIndex(room.players, room.currentPlayerIndex);
    });

    socket.on('custom-token-moved', ({ roomId, playerId, tokenIndex, from, to }) => {
      const room = customRooms[roomId];
      if (!room || room.gameOver) return;

      namespace.to(roomId).emit('custom-token-moved', {
        playerId,
        tokenIndex,
        from,
        to,
        message: `🔀 Player ${playerId} moved token ${tokenIndex} from ${from} to ${to}`
      });
    });

    socket.on('disconnect', async () => {
      const roomId = Object.keys(customRooms).find(r => customRooms[r].players.some(p => p.id === socket.id));
      if (!roomId) return;

      const room = customRooms[roomId];
      const player = room.players.find(p => p.id === socket.id);

      if (!room || !player) return;

      // Remove player from room
      room.players = room.players.filter(p => p.id !== socket.id);
      delete playerRoomMap[player.playerId];

      // Notify others in the room
      namespace.to(roomId).emit('player-left', {
        playerId: player.playerId,
        players: room.players,
        message: `❌ ${player.name} disconnected.`
      });

      // If no one is left in the room, destroy it
      if (room.players.length === 0) {
        clearTimeout(room.timeout);
        clearTimeout(room.autoStartTimer);
        clearTimeout(room.destroyTimer);
        delete customRooms[roomId];
        return;
      }

      // If game already started, end it and award winner
      if (room.started && !room.gameOver) {
        room.gameOver = true;

        const winner = room.players.reduce((a, b) => a.score >= b.score ? a : b);
        if (!winner.isBot) {
          const user = await User.findById(winner.playerId);
          if (user) {
            user.wallet += room.bet * (room.players.length + 1); // include disconnected player's bet
            await user.save();
          }
        }

        namespace.to(roomId).emit('game-over-custom', {
          winner: winner.name,
          message: `❌ A player disconnected. ${winner.name} wins by score.`
        });

        delete customRooms[roomId];
      }
    });

  });
};

function startCustomRoomGame(namespace, roomId) {
  const room = customRooms[roomId];
  if (!room) return;

  const winning_amount = room.bet * room.players.length * 0.9;
  room.currentPlayerIndex = 0;

  namespace.to(roomId).emit('custom-game-started', {
    players: room.players,
    winning_amount,
    message: `🎮 Game started! ${room.players[0].name}'s turn.`
  });

  namespace.to(roomId).emit('current-turn', {
    playerId: room.players[0].playerId,
    name: room.players[0].name,
    currentIndex: 0
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

    delete customRooms[roomId];
  }, 8 * 60 * 1000);
}
import User from '../model/user.js';

const customRooms = {};
const playerRoomMap = {};
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

function announceTurn(namespace, roomId) {
  const room = customRooms[roomId];
  if (!room || room.players.length === 0) return;

  const currentPlayer = room.players[room.currentPlayerIndex];
  room.hasRolled = false;
  room.hasMoved = false;

  if (room.actionTimeout) clearTimeout(room.actionTimeout);

  namespace.to(roomId).emit('current-turn', {
    playerId: currentPlayer?.playerId,
    name: currentPlayer?.name,
    playerIndex: room.currentPlayerIndex
  });

  room.actionTimeout = setTimeout(() => {
    const skippedPlayer = room.players[room.currentPlayerIndex];
    room.currentPlayerIndex = getNextPlayerIndex(room.players, room.currentPlayerIndex);
    const nextPlayer = room.players[room.currentPlayerIndex];

    namespace.to(roomId).emit('turn-skipped', {
      skippedPlayerId: skippedPlayer?.playerId,
      nextPlayerId: nextPlayer?.playerId,
      message: `⏱ ${skippedPlayer?.name} did not complete their turn in 60 seconds.`
    });

    announceTurn(namespace, roomId);
  }, 60 * 1000);
}

export const setupCustomRoomGame = (namespace) => {
  namespace.on('connection', (socket) => {
    console.log(`🔗 [CUSTOM] Connected: ${socket.id}`);

    socket.on('create-custom-room', async ({ playerId, bet_amount, playerLimit }) => {
      socket.playerId = playerId;
      if (!playerId || !bet_amount || !playerLimit) {
        return socket.emit('message', { status: 'error', message: 'Missing data' });
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
        players: [{
          id: socket.id,
          playerId,
          name: user.first_name,
          isBot: false,
          score: 0,
          pic_url: user.pic_url || ''
        }],
        bet: bet_amount,
        started: false,
        gameOver: false,
        timeout: null,
        autoStartTimer: null,
        actionTimeout: null,
        hasRolled: false,
        hasMoved: false,
        consecutiveSixes: {},
        destroyTimer: setTimeout(() => {
          if (!customRooms[roomId]?.started) {
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
    });

    socket.on('join-custom-room', async ({ roomId, playerId }) => {
      socket.playerId = playerId;
      const room = customRooms[roomId];
      if (!room) {
        return socket.emit('message', {
          status: 'error',
          message: `❌ Room ID “${roomId}” was not found.`,
        });
      }

      if (room.started || room.players.length >= room.playerLimit) {
        return socket.emit('message', {
          status: 'error',
          message: room.started ? '🚫 Game already started.' : '🚫 Room full.',
        });
      }

      const user = await User.findById(playerId);
      if (!user || user.wallet < room.bet) {
        return socket.emit('message', {
          code: 'INSUFFICIENT_BALANCE',
          message: '❌ Insufficient balance to join this room.',
        });
      }

      user.wallet -= room.bet;
      await user.save();

      const player = {
        id: socket.id,
        playerId,
        name: user.first_name,
        isBot: false,
        score: 0,
        pic_url: user.pic_url || ''
      };
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
    });

    socket.on('start-custom-room-game', ({ roomId, playerId }) => {
      const room = customRooms[roomId];
      if (!room || room.started || room.players[0]?.playerId !== playerId) return;

      if (room.playerLimit === 4 && room.players.length < 3) {
        return socket.emit('message', { status: 'error', message: '❌ Minimum 3 players required' });
      }

      clearTimeout(room.autoStartTimer);
      clearTimeout(room.destroyTimer);
      room.started = true;

      namespace.to(roomId).emit('game-will-start', {
        message: '⌛ Game will start in 1 second',
        roomId,
        bet_amount: room.bet
      });

      setTimeout(() => startCustomRoomGame(namespace, roomId), 1000);
    });

    socket.on('custom-roll-dice', ({ roomId, playerId }) => {
      const room = customRooms[roomId];
      if (!room || room.gameOver) return;

      const currentPlayer = room.players[room.currentPlayerIndex];
      if (currentPlayer?.playerId !== playerId || room.hasRolled) return;

      room.hasRolled = true;
      if (!room.consecutiveSixes[playerId]) room.consecutiveSixes[playerId] = 0;

      let diceValue = Math.floor(Math.random() * 6) + 1;
      if (room.consecutiveSixes[playerId] >= 2 && diceValue === 6) {
        while (diceValue === 6) {
          diceValue = Math.floor(Math.random() * 6) + 1;
        }
      }

      if (diceValue === 6) {
        room.consecutiveSixes[playerId]++;
      } else {
        room.consecutiveSixes[playerId] = 0;
      }

      namespace.to(roomId).emit('custom-dice-rolled', {
        playerId,
        dice: diceValue,
        message: `🎲 ${currentPlayer?.name} rolled a ${diceValue}`
      });

      namespace.to(roomId).emit('current-turn', {
        playerId: currentPlayer?.playerId,
        name: currentPlayer?.name,
        playerIndex: room.currentPlayerIndex
      });
    });

    socket.on('custom-token-moved', ({ roomId, playerId, tokenIndex, from, to }) => {
      const room = customRooms[roomId];
      if (!room || room.gameOver || !room.hasRolled || room.hasMoved) return;

      room.hasMoved = true;

      namespace.to(roomId).emit('custom-token-moved', {
        playerId,
        tokenIndex,
        from,
        to,
        message: `🔀 Player ${playerId} moved token ${tokenIndex} from ${from} to ${to}`
      });

      room.currentPlayerIndex = getNextPlayerIndex(room.players, room.currentPlayerIndex);
      announceTurn(namespace, roomId);
    });

    socket.on('leave-custom-room', async ({ playerId }) => {
      const roomId = playerRoomMap[playerId];
      const room = customRooms[roomId];
      if (!roomId || !room) return;

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
        clearTimeout(room.actionTimeout);
        delete customRooms[roomId];
      }
    });

    socket.on('disconnect', async () => {
      const playerId = socket.playerId;
      const roomId = playerRoomMap[playerId];
      const room = customRooms[roomId];
      if (!playerId || !roomId || !room) return;

      room.players = room.players.filter(p => p.playerId !== playerId);
      delete playerRoomMap[playerId];

      namespace.to(roomId).emit('player-left', {
        playerId,
        players: room.players,
        message: `❌ A player disconnected.`
      });

      if (room.players.length === 0) {
        clearTimeout(room.timeout);
        clearTimeout(room.autoStartTimer);
        clearTimeout(room.destroyTimer);
        clearTimeout(room.actionTimeout);
        delete customRooms[roomId];
        return;
      }

      if (room.started && !room.gameOver) {
        room.gameOver = true;
        const winner = room.players.reduce((a, b) => a.score >= b.score ? a : b);
        if (!winner.isBot) {
          const user = await User.findById(winner.playerId);
          if (user) {
            user.wallet += room.bet * (room.players.length + 1);
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
  room.hasRolled = false;
  room.hasMoved = false;
  room.actionTimeout = null;

  namespace.to(roomId).emit('custom-game-started', {
    players: room.players,
    winning_amount,
    message: `🎮 Game started! ${room.players[0]?.name}'s turn.`
  });

  announceTurn(namespace, roomId);
}
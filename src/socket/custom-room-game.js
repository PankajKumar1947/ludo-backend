import User from '../model/user.js';
import CustomRoom from '../model/customRoom.js';

function generateRoomId(length = 6) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let roomId = '', hasLetter = false, hasNumber = false;
  while (!hasLetter || !hasNumber || roomId.length < length) {
    const char = chars[Math.floor(Math.random() * chars.length)];
    roomId += char;
    if (/[A-Z]/.test(char)) hasLetter = true;
    if (/[0-9]/.test(char)) hasNumber = true;
    if (roomId.length > length) roomId = '', hasLetter = false, hasNumber = false;
  }
  return roomId.substring(0, length);
}

export const setupCustomRoomGame = (namespace) => {
  namespace.on('connection', (socket) => {
    console.log(`🔗 [CUSTOM] Connected: ${socket.id}`);

    socket.on('create-custom-room', async ({ playerId, bet_amount, playerLimit }) => {
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
      const newRoom = new CustomRoom({
        roomId,
        playerLimit,
        players: [{
          playerId,
          name: user.first_name,
          isBot: false,
          score: 0,
          pic_url: user.pic_url || '',
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
        players: newRoom.players,
        playerLimit,
        message: `🎉 ${user.first_name} joined the room`
      });
    });

    socket.on('join-custom-room', async ({ roomId, playerId }) => {
      const room = await CustomRoom.findOne({ roomId });
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

      room.players.push({
        playerId,
        name: user.first_name,
        isBot: false,
        score: 0,
        pic_url: user.pic_url || ''
      });

      await room.save();

      socket.playerId = playerId;
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
        namespace.to(room.players[0].playerId).emit('ready-to-start', {
          message: '✅ You can start the game now.',
          roomId,
          players: room.players
        });
      }
    });

    socket.on('start-custom-room-game', async ({ roomId, playerId }) => {
      const room = await CustomRoom.findOne({ roomId });
      if (!room || room.started || room.players[0]?.playerId !== playerId) return;

      if (room.playerLimit === 4 && room.players.length < 3) {
        return socket.emit('message', { status: 'error', message: '❌ Minimum 3 players required' });
      }

      room.started = true;
      await room.save();

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
      const room = await CustomRoom.findOne({ 'players.playerId': playerId });
      if (!room) return;

      room.players = room.players.filter(p => p.playerId !== playerId);
      await room.save();

      socket.leave(room.roomId);

      namespace.to(room.roomId).emit('player-left', {
        playerId,
        players: room.players,
        message: `🚪 Player ${playerId} left the room`
      });

      if (room.players.length === 0) {
        await CustomRoom.deleteOne({ roomId: room.roomId });
      }
    });

    socket.on('disconnect', async () => {
      const playerId = socket.playerId;
      if (!playerId) return;

      const room = await CustomRoom.findOne({ 'players.playerId': playerId });
      if (!room) return;

      room.players = room.players.filter(p => p.playerId !== playerId);
      await room.save();

      namespace.to(room.roomId).emit('player-left', {
        playerId,
        players: room.players,
        message: `❌ A player disconnected.`
      });

      if (room.players.length === 0) {
        await CustomRoom.deleteOne({ roomId: room.roomId });
      } else if (room.started && !room.gameOver) {
        room.gameOver = true;
        await room.save();

        const winner = room.players.reduce((a, b) => a.score >= b.score ? a : b);
        if (!winner.isBot) {
          const user = await User.findById(winner.playerId);
          if (user) {
            const winning_amount = room.bet * room.players.length * 0.9;
            user.wallet += winning_amount;
            await user.save();
          }
        }

        namespace.to(room.roomId).emit('game-over-custom', {
          winner: winner.name,
          message: `❌ A player disconnected. ${winner.name} wins by score.`
        });

        await CustomRoom.deleteOne({ roomId: room.roomId });
      }
    });
  });
};
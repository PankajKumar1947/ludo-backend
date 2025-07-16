// routes/customRoomSocket.js
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
      });

      await newRoom.save();

      socket.playerId = playerId;
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

      setTimeout(() => {
        const winning_amount = room.bet * room.players.length * 0.9;
        namespace.to(roomId).emit('custom-game-started', {
          players: room.players,
          winning_amount,
          message: `🎮 Game started! ${room.players[0]?.name}'s turn.`
        });
      }, 1000);
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

      // Room is no longer deleted when empty
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

      // Room is not deleted if empty
      if (room.started && !room.gameOver) {
        room.gameOver = true;
        await room.save();

        const winner = room.players.reduce((a, b) => a.score >= b.score ? a : b, {});
        if (!winner.isBot && winner.playerId) {
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

        // Not deleting the room anymore
      }
    });
  });
};
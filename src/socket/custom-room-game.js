import User from '../model/user.js';
import CustomRoom from '../model/customRoom.js';

const playerRoomMap = {};

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

const actionTimeoutMap = {};

async function announceTurn(namespace, roomId) {
  const room = await CustomRoom.findOne({ roomId });
  if (!room || room.players.length === 0) return;

  const currentPlayer = room.players[room.currentPlayerIndex];
  room.hasRolled = false;
  room.hasMoved = false;
  await room.save();

  if (actionTimeoutMap[roomId]) clearTimeout(actionTimeoutMap[roomId]);

  namespace.to(roomId).emit('current-turn', {
    playerId: currentPlayer?.playerId,
    name: currentPlayer?.name,
    playerIndex: room.currentPlayerIndex
  });

  actionTimeoutMap[roomId] = setTimeout(async () => {
    const room = await CustomRoom.findOne({ roomId });
    if (!room) return;

    const skippedPlayer = room.players[room.currentPlayerIndex];
    room.currentPlayerIndex = getNextPlayerIndex(room.players, room.currentPlayerIndex);
    await room.save();

    const nextPlayer = room.players[room.currentPlayerIndex];
    namespace.to(roomId).emit('turn-skipped', {
      skippedPlayerId: skippedPlayer?.playerId,
      nextPlayerId: nextPlayer?.playerId,
      message: `${skippedPlayer?.name} did not complete their turn in 60 seconds.`
    });

    announceTurn(namespace, roomId);
  }, 20000);
}

export const setupCustomRoomGame = (namespace) => {
  namespace.on('connection', (socket) => {
    socket.on('create-custom-room', async ({ playerId, bet_amount, playerLimit }) => {
      socket.playerId = playerId;
      const user = await User.findById(playerId);
      if (!user || user.wallet < bet_amount) {
        return socket.emit('message', { status: 'error', message: 'Invalid user or insufficient balance' });
      }

      user.wallet -= bet_amount;
      await user.save();

      const roomId = generateRoomId();
      const newRoom = new CustomRoom({
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
        hasRolled: false,
        hasMoved: false,
        currentPlayerIndex: 0,
        consecutiveSixes: {},
      });

      await newRoom.save();

      playerRoomMap[playerId] = roomId;
      socket.join(roomId);
      socket.emit('custom-room-created', { roomId, bet_amount });
      namespace.to(roomId).emit('player-joined', {
        players: newRoom.players,
        playerLimit,
        message: `${user.first_name} joined the room`
      });
    });

    socket.on('join-custom-room', async ({ roomId, playerId }) => {
      socket.playerId = playerId;
      const room = await CustomRoom.findOne({ roomId });
      if (!room) {
        return socket.emit('message', {
          status: 'error',
          message: `Room ID “${roomId}” was not found.`,
        });
      }

      if (room.started || room.players.length >= room.playerLimit) {
        return socket.emit('message', {
          status: 'error',
          message: room.started ? 'Game already started.' : 'Room full.',
        });
      }

      const user = await User.findById(playerId);
      if (!user || user.wallet < room.bet) {
        return socket.emit('message', {
          code: 'INSUFFICIENT_BALANCE',
          message: 'Insufficient balance to join this room.',
        });
      }

      user.wallet -= room.bet;
      await user.save();

      room.players.push({
        id: socket.id,
        playerId,
        name: user.first_name,
        isBot: false,
        score: 0,
        pic_url: user.pic_url || ''
      });
      await room.save();

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
        message: `${user.first_name} joined the room`
      });

      if (room.players.length >= 2) {
        namespace.to(room.players[0].id).emit('ready-to-start', {
          message: 'You can start the game now.',
          roomId,
          players: room.players
        });
      }
    });

    socket.on('start-custom-room-game', async ({ roomId, playerId }) => {
      const room = await CustomRoom.findOne({ roomId });
      if (!room || room.started || room.players[0]?.playerId !== playerId) return;

      if (room.playerLimit === 4 && room.players.length < 3) {
        return socket.emit('message', { status: 'error', message: 'Minimum 3 players required' });
      }

      room.started = true;
      await room.save();

      namespace.to(roomId).emit('game-will-start', {
        message: 'Game will start in 1 second',
        roomId,
        bet_amount: room.bet
      });

      setTimeout(() => startCustomRoomGame(namespace, roomId), 1000);
    });

    socket.on('custom-roll-dice', async ({ roomId, playerId }) => {
      const room = await CustomRoom.findOne({ roomId });
      if (!room || room.gameOver || room.hasRolled) return;

      const currentPlayer = room.players[room.currentPlayerIndex];
      if (currentPlayer?.playerId !== playerId) return;

      room.hasRolled = true;
      if (!room.consecutiveSixes.get(playerId)) room.consecutiveSixes.set(playerId, 0);

      let diceValue = Math.floor(Math.random() * 6) + 1;
      if (room.consecutiveSixes.get(playerId) >= 2 && diceValue === 6) {
        while (diceValue === 6) {
          diceValue = Math.floor(Math.random() * 6) + 1;
        }
      }

      if (diceValue === 6) {
        room.consecutiveSixes.set(playerId, room.consecutiveSixes.get(playerId) + 1);
      } else {
        room.consecutiveSixes.set(playerId, 0);
      }

      room.lastDiceValue = diceValue;
      await room.save();

      namespace.to(roomId).emit('custom-dice-rolled', {
        playerId,
        dice: diceValue,
        message: `${currentPlayer?.name} rolled a ${diceValue}`
      });

      namespace.to(roomId).emit('current-turn', {
        playerId,
        name: currentPlayer?.name,
        playerIndex: room.currentPlayerIndex
      });
    });

    socket.on('custom-token-moved', async ({ roomId, playerId, tokenIndex, from, to }) => {
      const room = await CustomRoom.findOne({ roomId });
      if (!room || room.gameOver || !room.hasRolled || room.hasMoved) return;

      room.hasMoved = true;
      await room.save();

      namespace.to(roomId).emit('custom-token-moved', {
        playerId,
        tokenIndex,
        from,
        to,
        message: `Player ${playerId} moved token ${tokenIndex} from ${from} to ${to}`
      });

      const lastDiceValue = room.lastDiceValue || 0;

      if (lastDiceValue !== 6) {
        room.currentPlayerIndex = getNextPlayerIndex(room.players, room.currentPlayerIndex);
        await room.save();
        announceTurn(namespace, roomId);
      } else {
        room.hasRolled = false;
        room.hasMoved = false;
        await room.save();
        announceTurn(namespace, roomId);
      }
    });

    socket.on('custom-token-killed', async ({ roomId, playerId, tokenIndex, from, to, killedPlayerId, killedTokenIndex }) => {
      const room = await CustomRoom.findOne({ roomId });
      if (!room || room.gameOver || !room.hasRolled || room.hasMoved) return;

      room.hasMoved = true;
      await room.save();

      namespace.to(roomId).emit('custom-token-killed', {
        killerId: playerId,
        victimId: killedPlayerId,
        killerTokenIndex: tokenIndex,
        victimTokenIndex: killedTokenIndex,
        from,
        to,
        message: `Player ${playerId} killed token ${killedTokenIndex} of Player ${killedPlayerId}`
      });

      const lastDiceValue = room.lastDiceValue || 0;

      if (lastDiceValue !== 6) {
        room.currentPlayerIndex = getNextPlayerIndex(room.players, room.currentPlayerIndex);
        await room.save();
        announceTurn(namespace, roomId);
      } else {
        room.hasRolled = false;
        room.hasMoved = false;
        await room.save();
        announceTurn(namespace, roomId);
      }
    });

    socket.on('leave-custom-room', async ({ playerId }) => {
      const roomId = playerRoomMap[playerId];
      const room = await CustomRoom.findOne({ roomId });
      if (!room) return;

      room.players = room.players.filter(p => p.playerId !== playerId);
      await room.save();
      delete playerRoomMap[playerId];
      socket.leave(roomId);

      namespace.to(roomId).emit('player-left', {
        playerId,
        players: room.players,
        message: `Player ${playerId} left the room`
      });
    });

    socket.on('disconnect', async () => {
      const playerId = socket.playerId;
      const roomId = playerRoomMap[playerId];
      const room = await CustomRoom.findOne({ roomId });
      if (!room) return;

      room.players = room.players.filter(p => p.playerId !== playerId);
      await room.save();
      delete playerRoomMap[playerId];

      namespace.to(roomId).emit('player-left', {
        playerId,
        players: room.players,
        message: `A player disconnected.`
      });

      if (room.players.length === 0 || room.gameOver) {
        await CustomRoom.deleteOne({ roomId });
      } else if (room.started && !room.gameOver) {
        room.gameOver = true;

        const winner = room.players.reduce((a, b) => a.score >= b.score ? a : b);
        if (!winner.isBot) {
          const user = await User.findById(winner.playerId);
          if (user) {
            const winning_amount = room.bet * room.players.length * 0.9;
            user.wallet += winning_amount;
            user.wincoin += winning_amount;

            if(room.playerLimit === 2)
              user.twoPlayWin += 1;
            else if(room.playerLimit === 4)
              user.fourPlayWin += 1;
            await user.save();
          }
        }

        await room.save();
        namespace.to(roomId).emit('game-over-custom', {
          winner: winner.name,
          playerId: winner.playerId,
          message: `A player disconnected. ${winner.name} wins by score.`
        });

        await CustomRoom.deleteOne({ roomId });
      }
    });
  });
};

async function startCustomRoomGame(namespace, roomId) {
  const room = await CustomRoom.findOne({ roomId });
  if (!room) return;

  const winning_amount = room.bet * room.players.length * 0.9;
  room.currentPlayerIndex = 0;
  room.hasRolled = false;
  room.hasMoved = false;
  await room.save();

  namespace.to(roomId).emit('custom-game-started', {
    players: room.players,
    winning_amount,
    message: `Game started! ${room.players[0]?.name}'s turn.`
  });

  const duration = 8 * 60 * 1000;
  namespace.to(roomId).emit('game-timer-started', {
    duration: 480,
    message: 'Game will automatically end in 8 minutes.'
  });

  setTimeout(async () => {
    const finalRoom = await CustomRoom.findOne({ roomId });
    if (!finalRoom || finalRoom.gameOver) return;

    finalRoom.gameOver = true;

    const winner = finalRoom.players.reduce((a, b) => a.score >= b.score ? a : b);

    if (!winner.isBot) {
      const user = await User.findById(winner.playerId);
      if (user) {
        user.wallet += winning_amount;
        user.wincoin += winning_amount;

        if(finalRoom.playerLimit === 2)
          user.twoPlayWin += 1;
        else if(finalRoom.playerLimit === 4)
          user.fourPlayWin += 1;
        await user.save();
      }
    }

    await finalRoom.save();

    namespace.to(roomId).emit('game-over-custom', {
      winner: winner.name,
      message: `Time's up! ${winner.name} wins with the highest score.`
    });

    await CustomRoom.deleteOne({ roomId });
  }, duration);

  announceTurn(namespace, roomId);
}

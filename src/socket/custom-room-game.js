import User from '../model/user.js';
import CustomRoom from '../model/customRoom.js';
import { COMISSION_RATE } from '../constants/index.js';

const playerRoomMap = {};
const actionTimeoutMap = {};

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

async function announceTurn(namespace, roomId) {
  const room = await CustomRoom.findOne({ roomId });
  if (!room || room.players.length < 2 || room.gameOver) return;

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
    const updatedRoom = await CustomRoom.findOne({ roomId });
    if (!updatedRoom || updatedRoom.players.length < 2 || updatedRoom.gameOver) return;

    const skippedPlayer = updatedRoom.players[updatedRoom.currentPlayerIndex];
    updatedRoom.currentPlayerIndex = getNextPlayerIndex(updatedRoom.players, updatedRoom.currentPlayerIndex);
    await updatedRoom.save();

    const nextPlayer = updatedRoom.players[updatedRoom.currentPlayerIndex];
    namespace.to(roomId).emit('turn-skipped', {
      skippedPlayerId: skippedPlayer?.playerId,
      nextPlayerId: nextPlayer?.playerId,
      message: `${skippedPlayer?.name} did not complete their turn in 20 seconds.`
    });

    announceTurn(namespace, roomId);
  }, 20000);
}

export const setupCustomRoomGame = (namespace) => {
  namespace.on('connection', (socket) => {

    // ✅ Create custom room
    socket.on('create-custom-room', async ({ playerId, bet_amount, playerLimit }) => {
      socket.playerId = playerId;
      const user = await User.findById(playerId);
      if (!user || user.wallet < bet_amount) {
        return socket.emit('message', {
          status: 'error',
          message: 'Invalid user or insufficient balance'
        });
      }

      user.bidvalues.push({ bid_value: bet_amount })
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

    // ✅ Join custom room
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

      user.bidvalues.push({ bid_value: room.bet })
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

    // ✅ Start custom room game
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

    // ✅ Dice roll
    socket.on('custom-roll-dice', async ({ roomId, playerId }) => {
      const room = await CustomRoom.findOne({ roomId });
      if (!room || room.gameOver || room.hasRolled) return;

      const currentPlayer = room.players[room.currentPlayerIndex];
      if (currentPlayer?.playerId !== playerId) return;

      room.hasRolled = true;
      if (!room.consecutiveSixes[playerId]) room.consecutiveSixes[playerId] = 0;

      let diceValue = Math.floor(Math.random() * 6) + 1;
      if (room.consecutiveSixes[playerId] >= 2 && diceValue === 6) {
        while (diceValue === 6) {
          diceValue = Math.floor(Math.random() * 6) + 1;
        }
      }

      if (diceValue === 6) {
        room.consecutiveSixes[playerId] += 1;
      } else {
        room.consecutiveSixes[playerId] = 0;
      }

      room.lastDiceValue = diceValue;
      await room.save();

      namespace.to(roomId).emit('custom-dice-rolled', {
        playerId,
        dice: diceValue,
        message: `${currentPlayer?.name} rolled a ${diceValue}`
      });
    });

    // ✅ Token move
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

    // ✅ Token killed
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

    // ✅ Player leaves room
    socket.on('leave-custom-room', async ({ playerId }) => {
      await handlePlayerLeave(namespace, playerId);
    });

    // ✅ Disconnect
    socket.on('disconnect', async () => {
      await handlePlayerLeave(namespace, socket.playerId);
    });
  });
};

async function handlePlayerLeave(namespace, playerId) {
  const roomId = playerRoomMap[playerId];
  if (!roomId) return;

  const room = await CustomRoom.findOne({ roomId });
  if (!room) return;

  room.players = room.players.filter(p => p.playerId !== playerId);
  await room.save();
  delete playerRoomMap[playerId];

  namespace.to(roomId).emit('player-left', {
    playerId,
    players: room.players,
    message: `Player ${playerId} left the room`
  });

  if (room.players.length === 0) {
    clearTimeout(actionTimeoutMap[roomId]);
    delete actionTimeoutMap[roomId];
    await CustomRoom.deleteOne({ roomId });
    return;
  }

  if (room.players.length === 1 && !room.gameOver) {
    room.gameOver = true;
    await room.save();

    clearTimeout(actionTimeoutMap[roomId]);
    delete actionTimeoutMap[roomId];

    const winner = room.players[0];
    if (!winner.isBot) {
      const user = await User.findById(winner.playerId);
      if (user) {
        const totalPot = room.bet * (room.playerLimit || room.players.length);
        const winning_amount = totalPot * (1 - COMISSION_RATE);
        user.wallet += winning_amount;
        user.wincoin += winning_amount;
        await user.save();
      }
    }

    namespace.to(roomId).emit('game-over-custom', {
      winner: winner.name,
      playerId: winner.playerId,
      message: `${winner.name} wins because all other players left the game.`
    });

    await CustomRoom.deleteOne({ roomId });
  }
}

async function startCustomRoomGame(namespace, roomId) {
  const room = await CustomRoom.findOne({ roomId });
  if (!room) return;

  const totalPot = room.bet * room.players.length;
  const winning_amount = totalPot * (1 - COMISSION_RATE);

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
    await finalRoom.save();

    clearTimeout(actionTimeoutMap[roomId]);
    delete actionTimeoutMap[roomId];

    const winner = finalRoom.players.reduce((a, b) => a.score >= b.score ? a : b);
    if (!winner.isBot) {
      const user = await User.findById(winner.playerId);
      if (user) {
        user.wallet += winning_amount;
        user.wincoin += winning_amount;
        await user.save();
      }
    }

    namespace.to(roomId).emit('game-over-custom', {
      winner: winner.name,
      message: `Time's up! ${winner.name} wins with the highest score.`
    });

    await CustomRoom.deleteOne({ roomId });
  }, duration);

  announceTurn(namespace, roomId);
}

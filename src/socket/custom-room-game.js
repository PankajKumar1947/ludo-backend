import User from '../model/user.js';
import CustomRoom from '../model/customRoom.js';
import { COMISSION_RATE } from '../constants/index.js';

const playerRoomMap = {};
const actionTimeoutMap = {};
const waitingRooms = { 'player-2': null, 'player-4': null };

function generateRoomId(length = 6) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < length; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function getNextPlayerIndex(players, currentIndex) {
  return (currentIndex + 1) % players.length;
}

function getAvatar(name) {
  const firstLetter = name.charAt(0).toUpperCase();
  // return `https://ui-avatars.com/api/?name=${firstLetter}&background=random&color=fff`;
  return "https://lh3.googleusercontent.com/a/ACg8ocIqcrLFPX85Ey-QMhex0hkXlu2LSKTE-2WHdgpcqPqhv2ujgaE=s96-c"
}

const BOT_LIST = [
  { name: "Aarav", pic_url: getAvatar("Aarav") },
  { name: "Ishita", pic_url: getAvatar("Ishita") },
  { name: "Vihaan", pic_url: getAvatar("Vihaan") },
  { name: "Anaya", pic_url: getAvatar("Anaya") },
  { name: "Advait", pic_url: getAvatar("Advait") },
  { name: "Meera", pic_url: getAvatar("Meera") },
  { name: "Arjun", pic_url: getAvatar("Arjun") },
  { name: "Kavya", pic_url: getAvatar("Kavya") }
];

function createBot(position) {
  const bot = BOT_LIST[Math.floor(Math.random() * BOT_LIST.length)];
  return {
    id: `bot-${Date.now()}-${Math.random()}`,
    playerId: `bot-${Math.floor(Math.random() * 1000)}`,
    name: bot.name,
    pic_url: bot.pic_url,
    isBot: true,
    position,
    missedTurns: 0
  };
}

async function announceTurn(namespace, roomId) {
  const room = await CustomRoom.findOne({ roomId });
  if (!room || room.players.length < 2 || room.gameOver) return;

  const currentPlayer = room.players[room.currentPlayerIndex];
  if (!currentPlayer) {
    room.currentPlayerIndex = 0;
    await room.save();
    return announceTurn(namespace, roomId);
  }

  room.hasRolled = false;
  room.hasMoved = false;
  await room.save();

  if (actionTimeoutMap[roomId]) clearTimeout(actionTimeoutMap[roomId]);

  namespace.to(roomId).emit('current-turn', {
    playerId: currentPlayer.playerId,
    name: currentPlayer.name,
    playerIndex: room.currentPlayerIndex
  });

  if (currentPlayer.isBot) {
    setTimeout(async () => {
      const diceValue = Math.floor(Math.random() * 6) + 1;
      room.hasRolled = true;
      room.lastDiceValue = diceValue;
      await room.save();

      namespace.to(roomId).emit('custom-dice-rolled', {
        playerId: currentPlayer.playerId,
        dice: diceValue,
        message: `${currentPlayer.name} rolled a ${diceValue}`
      });

      setTimeout(async () => {
        room.hasMoved = true;
        await room.save();

        namespace.to(roomId).emit('custom-token-moved', {
          playerId: currentPlayer.playerId,
          tokenIndex: 0,
          from: 0,
          to: diceValue,
          message: `${currentPlayer.name} moved a token`
        });

        if (diceValue !== 6) {
          room.currentPlayerIndex = getNextPlayerIndex(room.players, room.currentPlayerIndex);
          await room.save();
        }
        announceTurn(namespace, roomId);
      }, 2000);
    }, 2000);
    return;
  }

  actionTimeoutMap[roomId] = setTimeout(async () => {
    const updatedRoom = await CustomRoom.findOne({ roomId });
    if (!updatedRoom || updatedRoom.players.length < 1 || updatedRoom.gameOver) return;

    const currentPlayer = updatedRoom.players[updatedRoom.currentPlayerIndex];
    if (!currentPlayer) return;

    currentPlayer.missedTurns = (currentPlayer.missedTurns || 0) + 1;
    await updatedRoom.save();

    namespace.to(roomId).emit('turn-skipped', {
      skippedPlayerId: currentPlayer.playerId,
      players: updatedRoom.players,
      message: `${currentPlayer.name} missed their turn (${currentPlayer.missedTurns}/3)`
    });

    if (currentPlayer.missedTurns >= 3 && !currentPlayer.isBot) {
      const loserId = currentPlayer.playerId;
      updatedRoom.players = updatedRoom.players.filter(p => p.playerId !== loserId);
      await updatedRoom.save();

      namespace.to(roomId).emit('player-removed', {
        playerId: loserId,
        message: `${currentPlayer.name} missed 3 turns and was removed`
      });

      if (updatedRoom.players.length === 1) {
        updatedRoom.gameOver = true;
        await updatedRoom.save();
        clearTimeout(actionTimeoutMap[roomId]);
        delete actionTimeoutMap[roomId];

        const winner = updatedRoom.players[0];
        if (!winner.isBot) {
          const user = await User.findById(winner.playerId);
          if (user) {
            const totalPot = updatedRoom.bet * updatedRoom.playerLimit;
            const winning_amount = totalPot * (1 - COMISSION_RATE);
            user.wallet += winning_amount;
            user.wincoin += winning_amount;
            await user.save();
          }
        }

        namespace.to(roomId).emit('game-over-custom', {
          winner: winner.name,
          playerId: winner.playerId,
          message: `${winner.name} wins because all other players lost.`
        });

        for (const p of updatedRoom.players) {
          delete playerRoomMap[p.playerId];
        }

        await CustomRoom.deleteOne({ roomId });
        return;
      }
    }

    updatedRoom.currentPlayerIndex = getNextPlayerIndex(updatedRoom.players, updatedRoom.currentPlayerIndex);
    await updatedRoom.save();
    announceTurn(namespace, roomId);
  }, 20000);
}

export const setupCustomRoomGame = (namespace) => {
  namespace.on('connection', (socket) => {

    socket.on('create-custom-room', async ({ playerId, bet_amount, playerLimit }) => {
      socket.playerId = playerId;
      if (playerRoomMap[playerId]) {
        return socket.emit('message', { status: 'error', message: 'You are already in a game.' });
      }

      const user = await User.findById(playerId);
      if (!user || user.wallet < bet_amount) {
        return socket.emit('message', { status: 'error', message: 'Invalid user or insufficient balance' });
      }

      user.wallet -= bet_amount;
      await user.save();

      const roomId = generateRoomId();
      const newRoom = new CustomRoom({
        roomId,
        gameType: 'private',
        playerLimit,
        players: [{
          id: socket.id,
          playerId,
          name: user.first_name,
          pic_url: user.pic_url || '',
          position: 0,
          missedTurns: 0
        }],
        bet: bet_amount
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
      if (playerRoomMap[playerId]) {
        return socket.emit('message', { status: 'error', message: 'You are already in a game.' });
      }

      const room = await CustomRoom.findOne({ roomId });
      if (!room || room.started || room.players.length >= room.playerLimit) {
        return socket.emit('message', { status: 'error', message: 'Room not available' });
      }

      const user = await User.findById(playerId);
      if (!user || user.wallet < room.bet) {
        return socket.emit('message', { status: 'error', message: 'Insufficient balance' });
      }

      user.wallet -= room.bet;
      await user.save();

      room.players.push({
        id: socket.id,
        playerId,
        name: user.first_name,
        pic_url: user.pic_url || '',
        position: room.players.length,
        missedTurns: 0
      });
      await room.save();

      playerRoomMap[playerId] = roomId;
      socket.join(roomId);

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

      room.started = true;
      await room.save();

      namespace.to(roomId).emit('game-will-start', { message: 'Game will start soon', roomId, bet_amount: room.bet });
      setTimeout(() => startCustomRoomGame(namespace, roomId, room.gameType), 1000);
    });

    socket.on('join-public-game', async ({ playerId, bet_amount, mode }) => {
      socket.playerId = playerId;
      if (playerRoomMap[playerId]) {
        return socket.emit('message', { status: 'error', message: 'You are already in a game.' });
      }

      const user = await User.findById(playerId);
      if (!user || user.wallet < bet_amount) {
        return socket.emit('message', { status: 'error', message: 'Invalid user or insufficient balance' });
      }

      user.wallet -= bet_amount;
      await user.save();

      let room;
      if (waitingRooms[mode]) {
        room = await CustomRoom.findOne({ roomId: waitingRooms[mode] });
        if (room) {
          const position = room.players.length;
          room.players.push({
            id: socket.id,
            playerId,
            name: user.first_name,
            pic_url: user.pic_url || '',
            position,
            missedTurns: 0
          });
          await room.save();
        }
      }

      if (!room) {
        const roomId = generateRoomId();
        const playerLimit = mode === 'player-2' ? 2 : 4;
        room = new CustomRoom({
          roomId,
          gameType: mode,
          playerLimit,
          players: [{
            id: socket.id,
            playerId,
            name: user.first_name,
            pic_url: user.pic_url || '',
            position: 0,
            missedTurns: 0
          }],
          bet: bet_amount
        });
        await room.save();
        waitingRooms[mode] = room.roomId;

        setTimeout(async () => {
          const r = await CustomRoom.findOne({ roomId });
          if (r && r.players.length < r.playerLimit && !r.started) {
            await fillWithBotsAndStart(namespace, r, mode);
          }
        }, 45000);
      }

      playerRoomMap[playerId] = room.roomId;
      socket.join(room.roomId);

      namespace.to(room.roomId).emit('player-joined', {
        players: room.players,
        playerLimit: room.playerLimit,
        message: `${user.first_name} joined the room`
      });

      if (room.players.length === room.playerLimit) {
        waitingRooms[mode] = null;
        namespace.to(room.roomId).emit('game-will-start', { message: 'Game will start soon', roomId: room.roomId, bet_amount: room.bet });
        setTimeout(() => startCustomRoomGame(namespace, room.roomId, mode), 1000);
      }
    });

    socket.on('custom-roll-dice', async ({ roomId, playerId }) => {
      const room = await CustomRoom.findOne({ roomId });
      if (!room || room.gameOver || room.hasRolled) return;
      const currentPlayer = room.players[room.currentPlayerIndex];
      if (currentPlayer?.playerId !== playerId) return;

      room.hasRolled = true;
      if (!room.consecutiveSixes[playerId]) room.consecutiveSixes[playerId] = 0;

      let diceValue = Math.floor(Math.random() * 6) + 1;
      if (room.consecutiveSixes[playerId] >= 2 && diceValue === 6) {
        while (diceValue === 6) diceValue = Math.floor(Math.random() * 6) + 1;
      }

      room.consecutiveSixes[playerId] = diceValue === 6 ? (room.consecutiveSixes[playerId] + 1) : 0;
      room.lastDiceValue = diceValue;
      await room.save();

      namespace.to(roomId).emit('custom-dice-rolled', {
        playerId,
        dice: diceValue,
        message: `${currentPlayer?.name} rolled a ${diceValue}`
      });
    });

    socket.on('custom-token-moved', async ({ roomId, playerId, tokenIndex, from, to }) => {
      const room = await CustomRoom.findOne({ roomId });
      if (!room || room.gameOver || !room.hasRolled || room.hasMoved) return;

      room.hasMoved = true;
      await room.save();

      namespace.to(roomId).emit('custom-token-moved', {
        playerId, tokenIndex, from, to,
        message: `Player ${playerId} moved token ${tokenIndex}`
      });

      const lastDice = room.lastDiceValue || 0;
      if (lastDice !== 6) {
        room.currentPlayerIndex = getNextPlayerIndex(room.players, room.currentPlayerIndex);
        await room.save();
      }
      announceTurn(namespace, roomId);
    });

    socket.on('leave-custom-room', async ({ playerId }) => {
      await handlePlayerLeave(namespace, playerId);
    });

    socket.on('disconnect', async () => {
      if (socket.playerId) {
        await handlePlayerLeave(namespace, socket.playerId, true);
      }
    });
  });
};

async function handlePlayerLeave(namespace, playerId, isDisconnect = false) {
  const roomId = playerRoomMap[playerId];
  if (!roomId) return;

  delete playerRoomMap[playerId];

  const room = await CustomRoom.findOne({ roomId });
  if (!room) return;

  const leavingPlayer = room.players.find(p => p.playerId === playerId);
  if (!leavingPlayer) return;

  const leavingPosition = leavingPlayer.position;

  room.players = room.players.filter(p => p.playerId !== playerId);
  await room.save();

  namespace.to(roomId).emit('player-left', { 
    playerId, 
    players: room.players, 
    message: `${leavingPlayer.name} ${isDisconnect ? 'disconnected' : 'left the game'}` 
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
        const totalPot = room.bet * room.playerLimit;
        const winning_amount = totalPot * (1 - COMISSION_RATE);
        user.wallet += winning_amount;
        user.wincoin += winning_amount;
        await user.save();
      }
    }

    namespace.to(roomId).emit('game-over-custom', {
      winner: winner.name,
      playerId: winner.playerId,
      message: `${winner.name} wins because all other players left/disconnected`
    });

    for (const p of room.players) {
      delete playerRoomMap[p.playerId];
    }

    await CustomRoom.deleteOne({ roomId });
    return;
  }

  if (!room.gameOver) {
    const positions = room.players.map(p => p.position).sort((a, b) => a - b);
    const nextPos = positions.find(pos => pos >= leavingPosition) || positions[0];
    room.currentPlayerIndex = room.players.findIndex(p => p.position === nextPos);
    await room.save();
    announceTurn(namespace, roomId);
  }
}

async function startCustomRoomGame(namespace, roomId, mode) {
  const room = await CustomRoom.findOne({ roomId });
  if (!room) return;

  room.started = true;
  await room.save();

  const totalPot = room.bet * room.players.length;
  const winning_amount = totalPot * (1 - COMISSION_RATE);

  namespace.to(roomId).emit('custom-game-started', {
    players: room.players,
    winning_amount,
    message: `Game started! ${room.players[0]?.name}'s turn.`
  });

  let gameDuration = 8 * 60 * 1000;
  if (mode === 'player-2') gameDuration = 2.5 * 60 * 1000;

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
      playerId: winner.playerId,
      message: `${winner.name} won by highest score!`
    });

    for (const p of finalRoom.players) {
      delete playerRoomMap[p.playerId];
    }

    await CustomRoom.deleteOne({ roomId });
  }, gameDuration);

  announceTurn(namespace, roomId);
}

async function fillWithBotsAndStart(namespace, room, mode) {
  const needed = room.playerLimit - room.players.length;
  for (let i = 0; i < needed; i++) {
    const bot = createBot(room.players.length);
    room.players.push(bot);

    namespace.to(room.roomId).emit('player-joined', {
      players: room.players,
      playerLimit: room.playerLimit,
      message: `${bot.name} (Bot) joined the room`
    });
  }

  await room.save();
  waitingRooms[mode] = null;

  namespace.to(room.roomId).emit('game-will-start', { 
    message: 'Game will start soon', 
    roomId: room.roomId, 
    bet_amount: room.bet 
  });

  setTimeout(() => startCustomRoomGame(namespace, room.roomId, mode), 1000);
}

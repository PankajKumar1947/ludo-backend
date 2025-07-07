import User from '../model/user.js';

const TOTAL_POSITIONS = 52;
const HOME_POSITION = 57;

const rooms4 = {};

function generateRoomId() {
  return Math.random().toString(36).substr(2, 6);
}

export const setupFourPlayerGameSocket = (namespace) => {
  namespace.on('connection', (socket) => {
    console.log(`🔌 Connected to 4-player namespace: ${socket.id}`);

    socket.on('join-4p-game', async ({ playerId, bet_amount }) => {
      try {
        const user = await User.findById(playerId);
        if (!user || user.wallet < bet_amount) {
          return socket.emit('message', {
            status: 'error',
            message: '❌ Invalid user or insufficient balance'
          });
        }

        let openRoom = Object.entries(rooms4).find(([_, r]) => !r.started && r.players.length < 4);
        let roomId;

        if (!openRoom) {
          roomId = generateRoomId();
          rooms4[roomId] = {
            players: [],
            started: false,
            bet: bet_amount,
            timeout: null,
            gameOver: false,
            turnIndex: 0,
          };

          rooms4[roomId].timeout = setTimeout(() => {
            const room = rooms4[roomId];
            if (!room || room.started) return;

            while (room.players.length < 4) {
              room.players.push({
                id: `BOT_${generateRoomId()}`,
                name: `BOT_${room.players.length + 1}`,
                isBot: true,
                tokens: [null, null, null, null],
                kills: 0,
                completed: 0,
                totalPoints: 0
              });
            }

            room.started = true;
            startFourPlayerGame(namespace, roomId);
          }, 30000); // 30s wait

        } else {
          roomId = openRoom[0];
        }

        user.wallet -= bet_amount;
        await user.save();

        const player = {
          id: socket.id,
          name: user.first_name,
          playerId,
          isBot: false,
          tokens: [null, null, null, null],
          kills: 0,
          completed: 0,
          totalPoints: 0
        };

        rooms4[roomId].players.push(player);
        socket.join(roomId);
        socket.emit('room-id', { roomId });

        if (rooms4[roomId].players.length === 4 && !rooms4[roomId].started) {
          clearTimeout(rooms4[roomId].timeout);
          rooms4[roomId].started = true;
          startFourPlayerGame(namespace, roomId);
        }
      } catch (err) {
        console.error(err);
        socket.emit('message', {
          status: 'error',
          message: '❌ Server error. Try again later.'
        });
      }
    });

    socket.on('roll-dice-4p', ({ roomId, playerId }) => {
      const room = rooms4[roomId];
      if (!room || room.gameOver) return;

      const currentPlayer = room.players[room.turnIndex];
      if (currentPlayer.playerId !== playerId && !currentPlayer.isBot) return;

      const dice = Math.floor(Math.random() * 6) + 1;
      namespace.to(roomId).emit('dice-rolled-4p', {
        playerIndex: room.turnIndex,
        dice
      });

      if (currentPlayer.isBot) {
        setTimeout(() => handleBotMove4(namespace, roomId, room.turnIndex, dice), 1500);
      }
    });

    socket.on('move-token-4p', async ({ roomId, playerId, tokenIndex, dice }) => {
      const room = rooms4[roomId];
      if (!room || room.gameOver) return;

      const currentPlayer = room.players[room.turnIndex];
      if (currentPlayer.playerId !== playerId && !currentPlayer.isBot) return;

      let token = currentPlayer.tokens[tokenIndex];
      if (token === null && dice !== 6) {
        return socket.emit('message', {
          status: 'error',
          message: '❌ Roll a 6 to move a token out of base.'
        });
      }

      token = token === null && dice === 6 ? 0 : token + dice;
      if (token > HOME_POSITION) token = HOME_POSITION;
      if (token === HOME_POSITION) currentPlayer.completed++;

      currentPlayer.tokens[tokenIndex] = token;

      // Check kill
      room.players.forEach((p, idx) => {
        if (idx !== room.turnIndex) {
          for (let i = 0; i < 4; i++) {
            if (p.tokens[i] !== null && p.tokens[i] === token && token !== HOME_POSITION) {
              p.tokens[i] = null;
              currentPlayer.kills++;
              namespace.to(roomId).emit('token-killed-4p', {
                killerIndex: room.turnIndex,
                victimIndex: idx,
                position: token
              });
            }
          }
        }
      });

      const active = currentPlayer.tokens.filter(t => t !== null && t !== HOME_POSITION);
      currentPlayer.totalPoints = currentPlayer.completed * 10 + currentPlayer.kills * 2 + active.length;

      namespace.to(roomId).emit('token-moved-4p', {
        playerIndex: room.turnIndex,
        tokenIndex,
        newPosition: token,
        tokens: currentPlayer.tokens,
        totalPoints: currentPlayer.totalPoints
      });

      if (currentPlayer.completed === 4) {
        room.gameOver = true;
        if (!currentPlayer.isBot) {
          const user = await User.findById(currentPlayer.playerId);
          if (user) {
            user.wallet += room.bet * 4;
            await user.save();
          }
        }
        return namespace.to(roomId).emit('game-over-4p', {
          winner: currentPlayer.name,
          message: `🎉 ${currentPlayer.name} wins the game!`
        });
      }

      room.turnIndex = (room.turnIndex + 1) % 4;
      const nextPlayer = room.players[room.turnIndex];
      if (nextPlayer.isBot) {
        const nextDice = Math.floor(Math.random() * 6) + 1;
        namespace.to(roomId).emit('dice-rolled-4p', { playerIndex: room.turnIndex, dice: nextDice });
        setTimeout(() => handleBotMove4(namespace, roomId, room.turnIndex, nextDice), 1500);
      } else {
        namespace.to(roomId).emit('message', { message: `🎮 ${nextPlayer.name}'s turn!` });
      }
    });
  });
};

function startFourPlayerGame(namespace, roomId) {
  const room = rooms4[roomId];
  if (!room) return;

  namespace.to(roomId).emit('game-started-4p', {
    players: room.players,
    winning_amount: 4 * room.bet - 4*room.bet / 10,
    message: `🎮 4-player game started! ${room.players[0].name}'s turn.`
  });
}

function handleBotMove4(namespace, roomId, botIndex, dice) {
  const room = rooms4[roomId];
  const bot = room.players[botIndex];
  if (!bot || !bot.isBot || room.gameOver) return;

  let indexToMove = -1;
  for (let i = 0; i < 4; i++) {
    const token = bot.tokens[i];
    if (token === null && dice === 6) {
      indexToMove = i;
      break;
    } else if (token !== null && token + dice <= HOME_POSITION) {
      indexToMove = i;
      break;
    }
  }

  if (indexToMove === -1) {
    room.turnIndex = (room.turnIndex + 1) % 4;
    return;
  }

  let token = bot.tokens[indexToMove];
  token = token === null && dice === 6 ? 0 : token + dice;
  if (token > HOME_POSITION) token = HOME_POSITION;
  if (token === HOME_POSITION) bot.completed++;

  bot.tokens[indexToMove] = token;

  room.players.forEach((p, idx) => {
    if (idx !== botIndex) {
      for (let i = 0; i < 4; i++) {
        if (p.tokens[i] !== null && p.tokens[i] === token && token !== HOME_POSITION) {
          p.tokens[i] = null;
          bot.kills++;
          namespace.to(roomId).emit('token-killed-4p', {
            killerIndex: botIndex,
            victimIndex: idx,
            position: token
          });
        }
      }
    }
  });

  const active = bot.tokens.filter(t => t !== null && t !== HOME_POSITION);
  bot.totalPoints = bot.completed * 10 + bot.kills * 2 + active.length;

  namespace.to(roomId).emit('token-moved-4p', {
    playerIndex: botIndex,
    tokenIndex: indexToMove,
    newPosition: token,
    tokens: bot.tokens,
    totalPoints: bot.totalPoints
  });

  if (bot.completed === 4) {
    room.gameOver = true;
    return namespace.to(roomId).emit('game-over-4p', {
      winner: bot.name,
      message: `🤖 ${bot.name} wins the game!`
    });
  }

  room.turnIndex = (room.turnIndex + 1) % 4;
  const nextPlayer = room.players[room.turnIndex];
  if (nextPlayer.isBot) {
    const nextDice = Math.floor(Math.random() * 6) + 1;
    namespace.to(roomId).emit('dice-rolled-4p', { playerIndex: room.turnIndex, dice: nextDice });
    setTimeout(() => handleBotMove4(namespace, roomId, room.turnIndex, nextDice), 1500);
  } else {
    namespace.to(roomId).emit('message', { message: `🎮 ${nextPlayer.name}'s turn!` });
  }
}
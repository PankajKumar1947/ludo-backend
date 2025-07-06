import User from '../model/user.js';

const TOTAL_POSITIONS = 52;
const HOME_POSITION = 57;

// Storage for both game types
const rooms = {}; // 1v1 BOT games
const rooms4 = {}; // 4-player games

function generateRoomId() {
  return Math.random().toString(36).substr(2, 6);
}

export const setupUnifiedGameSocket = (namespace) => {
  namespace.on('connection', (socket) => {
    console.log(`🔌 Connected: ${socket.id}`);

    // 1v1 BOT Game Handler
    socket.on('start-vs-bot', async ({ playerId, bet_amount }) => {
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
        const botId = `BOT_${roomId}`;

        rooms[roomId] = {
          gameType: '1v1',
          players: {
            player: {
              id: socket.id,
              name: user.first_name,
              playerId,
              isBot: false,
              tokens: [null, null, null, null],
              kills: 0,
              completed: 0,
              totalPoints: 0
            },
            bot: {
              id: botId,
              name: 'BOT',
              isBot: true,
              tokens: [null, null, null, null],
              kills: 0,
              completed: 0,
              totalPoints: 0
            }
          },
          turn: 'player',
          bet: bet_amount,
          gameOver: false,
        };

        socket.join(roomId);
        socket.emit('room-id', { roomId });

        // Timeout auto-finish
        rooms[roomId].timeout = setTimeout(() => {
          const room = rooms[roomId];
          if (!room || room.gameOver) return;

          const p1 = room.players.player;
          const p2 = room.players.bot;

          const calcScore = (p) =>
            p.completed * 10 +
            p.kills * 2 +
            p.tokens.filter(t => t !== null && t !== HOME_POSITION).length;

          const scorePlayer = calcScore(p1);
          const scoreBot = calcScore(p2);

          const winner = scorePlayer >= scoreBot ? p1 : p2;
          room.gameOver = true;

          if (!winner.isBot) {
            User.findById(winner.playerId).then(user => {
              if (user) {
                user.wallet += room.bet * 2;
                user.save();
              }
            });
          }

          namespace.to(roomId).emit('game-over', {
            winner: winner.name,
            message: `⏰ Time's up! ${winner.name} wins by score (${scorePlayer} vs ${scoreBot})`
          });
        }, 30 * 60 * 1000); // 30 minutes

        namespace.to(roomId).emit('game-started', {
          players: rooms[roomId].players,
          winning_amount: 2 * bet_amount - 2*bet_amount / 10,
          turn: 'player',
          message: '🎮 Game started vs BOT! Your turn.'
        });
      } catch (err) {
        console.error(err);
        socket.emit('message', {
          status: 'error',
          message: '❌ Server error. Try again later.'
        });
      }
    });

    // 4-Player Game Handler
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
            gameType: '4p',
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

    // 1v1 Dice Roll Handler
    socket.on('roll-dice', ({ roomId, player }) => {
      const room = rooms[roomId];
      if (!room || room.gameOver || room.turn !== player) return;

      const dice = Math.floor(Math.random() * 6) + 1;
      namespace.to(roomId).emit('dice-rolled', { player, dice });

      if (player === 'bot') {
        setTimeout(() => handleBotMove(roomId, dice), 1500);
      }
    });

    // 4-Player Dice Roll Handler
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

    // 1v1 Token Move Handler
    socket.on('move-token', async ({ roomId, player, tokenIndex, dice }) => {
      const room = rooms[roomId];
      if (!room || room.gameOver || room.turn !== player) return;

      const currentPlayer = room.players[player];
      const opponent = player === 'player' ? room.players.bot : room.players.player;
      let token = currentPlayer.tokens[tokenIndex];

      if (token === null && dice !== 6) {
        return socket.emit('message', {
          status: 'error',
          message: '❌ Roll a 6 to move a token out of base.'
        });
      }

      if (token === null && dice === 6) token = 0;
      else token += dice;

      if (token > HOME_POSITION) token = HOME_POSITION;
      if (token === HOME_POSITION) currentPlayer.completed++;

      currentPlayer.tokens[tokenIndex] = token;

      // Kill opponent
      for (let i = 0; i < 4; i++) {
        if (
          opponent.tokens[i] !== null &&
          opponent.tokens[i] === token &&
          token !== HOME_POSITION
        ) {
          opponent.tokens[i] = null;
          currentPlayer.kills++;

          namespace.to(roomId).emit('token-killed', {
            killer: player,
            victim: player === 'player' ? 'bot' : 'player',
            position: token,
            message: `💥 ${currentPlayer.name} killed opponent's token at ${token}`
          });
        }
      }

      const activeTokens = currentPlayer.tokens.filter(t => t !== null && t !== HOME_POSITION);
      const totalPoints = currentPlayer.completed * 10 + currentPlayer.kills * 2 + activeTokens.length;

      namespace.to(roomId).emit('token-moved', {
        player,
        tokenIndex,
        newPosition: token,
        tokens: currentPlayer.tokens,
        totalPoints
      });

      // Check win
      if (currentPlayer.completed === 4) {
        clearTimeout(room.timeout);
        room.gameOver = true;

        if (!currentPlayer.isBot) {
          const user = await User.findById(currentPlayer.playerId);
          if (user) {
            user.wallet += room.bet * 2;
            await user.save();
          }
        }

        return namespace.to(roomId).emit('game-over', {
          winner: currentPlayer.name,
          message: `🎉 ${currentPlayer.name} wins the game!`
        });
      }

      if (dice !== 6) room.turn = player === 'player' ? 'bot' : 'player';

      if (room.turn === 'bot') {
        const botDice = Math.floor(Math.random() * 6) + 1;
        namespace.to(roomId).emit('dice-rolled', { player: 'bot', dice: botDice });
        setTimeout(() => handleBotMove(roomId, botDice), 1500);
      }
    });

    // 4-Player Token Move Handler
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

    // Disconnect Handler
    socket.on('disconnect', async () => {
      console.log(`❌ Disconnected: ${socket.id}`);

      // Check 1v1 rooms
      const roomId = Object.keys(rooms).find(r => rooms[r].players.player.id === socket.id);
      const room = rooms[roomId];

      if (room && !room.gameOver) {
        clearTimeout(room.timeout);
        room.gameOver = true;
        namespace.to(roomId).emit('game-over', {
          winner: 'BOT',
          message: `🤖 Player disconnected. BOT wins the game!`
        });
      }

      // Check 4-player rooms
      const roomId4 = Object.keys(rooms4).find(r => 
        rooms4[r].players.some(p => p.id === socket.id)
      );
      const room4 = rooms4[roomId4];

      if (room4 && !room4.gameOver) {
        clearTimeout(room4.timeout);
        room4.gameOver = true;
        namespace.to(roomId4).emit('game-over-4p', {
          winner: 'BOT',
          message: `🤖 Player disconnected. Game ended!`
        });
      }
    });

    // 1v1 Bot Move Handler
    async function handleBotMove(roomId, dice) {
      const room = rooms[roomId];
      if (!room || room.gameOver) return;

      const bot = room.players.bot;
      const player = room.players.player;

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
        room.turn = 'player';
        namespace.to(roomId).emit('message', { message: '🎮 Your turn!' });
        return;
      }

      let token = bot.tokens[indexToMove];
      if (token === null && dice === 6) token = 0;
      else token += dice;

      if (token > HOME_POSITION) token = HOME_POSITION;
      if (token === HOME_POSITION) bot.completed++;

      bot.tokens[indexToMove] = token;

      for (let i = 0; i < 4; i++) {
        if (
          player.tokens[i] !== null &&
          player.tokens[i] === token &&
          token !== HOME_POSITION
        ) {
          player.tokens[i] = null;
          bot.kills++;

          namespace.to(roomId).emit('token-killed', {
            killer: 'bot',
            victim: 'player',
            position: token,
            message: `💥 BOT killed your token at ${token}`
          });
        }
      }

      const activeTokens = bot.tokens.filter(t => t !== null && t !== HOME_POSITION);
      const totalPoints = bot.completed * 10 + bot.kills * 2 + activeTokens.length;

      namespace.to(roomId).emit('token-moved', {
        player: 'bot',
        tokenIndex: indexToMove,
        newPosition: token,
        tokens: bot.tokens,
        totalPoints
      });

      if (bot.completed === 4) {
        clearTimeout(room.timeout);
        room.gameOver = true;

        return namespace.to(roomId).emit('game-over', {
          winner: 'BOT',
          message: `🤖 BOT wins the game!`
        });
      }

      if (dice !== 6) {
        room.turn = 'player';
        namespace.to(roomId).emit('message', { message: '🎮 Your turn!' });
      } else {
        const nextDice = Math.floor(Math.random() * 6) + 1;
        namespace.to(roomId).emit('dice-rolled', { player: 'bot', dice: nextDice });
        setTimeout(() => handleBotMove(roomId, nextDice), 1500);
      }
    }
  });
};

// 4-Player Game Starter
function startFourPlayerGame(namespace, roomId) {
  const room = rooms4[roomId];
  if (!room) return;

  namespace.to(roomId).emit('game-started-4p', {
    players: room.players,
    winning_amount: 4 * room.bet - 4*room.bet / 10,
    message: `🎮 4-player game started! ${room.players[0].name}'s turn.`
  });
}

// 4-Player Bot Move Handler
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
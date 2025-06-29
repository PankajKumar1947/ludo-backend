import { Server } from 'socket.io';
import User from '../model/user.js';

function generateRoomId() {
  return Math.random().toString(36).substr(2, 6);
}

const TOTAL_POSITIONS = 52;
const HOME_POSITION = 57;

const rooms = {};

export const setupSocket = (server) => {
  const io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket) => {
    console.log(`🔌 Connected: ${socket.id}`);

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
          players: {
            player: {
              id: socket.id,
              name: user.first_name,
              playerId,
              isBot: false,
              tokens: [null, null, null, null],
              kills: 0,
              completed: 0
            },
            bot: {
              id: botId,
              name: 'BOT',
              isBot: true,
              tokens: [null, null, null, null],
              kills: 0,
              completed: 0
            }
          },
          turn: 'player',
          bet: bet_amount,
          gameOver: false
        };

        socket.join(roomId);
        socket.emit('room-id', { roomId });

        // Set 8-minute timeout
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

          io.to(roomId).emit('game-over', {
            winner: winner.name,
            message: `⏰ Time's up! ${winner.name} wins by score (${scorePlayer} vs ${scoreBot})`
          });
        }, 8 * 60 * 1000); // 8 minutes

        io.to(roomId).emit('game-started', {
          players: rooms[roomId].players,
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

    socket.on('roll-dice', ({ roomId, player }) => {
      const room = rooms[roomId];
      if (!room || room.gameOver || room.turn !== player) return;

      const dice = Math.floor(Math.random() * 6) + 1;
      io.to(roomId).emit('dice-rolled', { player, dice });

      if (player === 'bot') {
        setTimeout(() => handleBotMove(roomId, dice), 1500);
      }
    });

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

      // Move logic
      if (token === null && dice === 6) token = 0;
      else token += dice;

      if (token > HOME_POSITION) token = HOME_POSITION;
      if (token === HOME_POSITION) currentPlayer.completed++;

      currentPlayer.tokens[tokenIndex] = token;

      // Kill check
      for (let i = 0; i < 4; i++) {
        if (
          opponent.tokens[i] !== null &&
          opponent.tokens[i] === token &&
          token !== HOME_POSITION
        ) {
          opponent.tokens[i] = null;
          currentPlayer.kills++;

          io.to(roomId).emit('token-killed', {
            killer: player,
            victim: player === 'player' ? 'bot' : 'player',
            position: token,
            message: `💥 ${currentPlayer.name} killed opponent's token at ${token}`
          });
        }
      }

      io.to(roomId).emit('token-moved', {
        player,
        tokenIndex,
        newPosition: token,
        tokens: currentPlayer.tokens
      });

      // Win check
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

        return io.to(roomId).emit('game-over', {
          winner: currentPlayer.name,
          message: `🎉 ${currentPlayer.name} wins the game!`
        });
      }

      if (dice !== 6) room.turn = player === 'player' ? 'bot' : 'player';

      if (room.turn === 'bot') {
        const botDice = Math.floor(Math.random() * 6) + 1;
        io.to(roomId).emit('dice-rolled', { player: 'bot', dice: botDice });
        setTimeout(() => handleBotMove(roomId, botDice), 1500);
      }
    });

    socket.on('disconnect', () => {
      console.log(`❌ Disconnected: ${socket.id}`);
    });

    async function handleBotMove(roomId, dice) {
      const room = rooms[roomId];
      if (!room || room.gameOver) return;

      const bot = room.players.bot;

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

      if (indexToMove !== -1) {
        const moveData = {
          roomId,
          player: 'bot',
          tokenIndex: indexToMove,
          dice
        };
        socket.emit('move-token', moveData);
      } else {
        room.turn = 'player';
        io.to(roomId).emit('message', { message: '🎮 Your turn!' });
      }
    }
  });
};
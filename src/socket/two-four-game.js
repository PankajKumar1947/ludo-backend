import User from '../model/user.js';
import { setupCustomRoomGame } from './custom-room-game.js';

const TOTAL_POSITIONS = 52;
const HOME_POSITION = 57;
const MAX_SCORE_LIMIT = 100;

const rooms = {}; // 1v1 BOT games
const rooms4 = {}; // 4-player games

function generateRoomId() {
  return Math.random().toString(36).substr(2, 6);
}

export const setupUnifiedGameSocket = (namespace) => {
  namespace.on('connection', (socket) => {
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
              playerId: botId,
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

        rooms[roomId].timeout = setTimeout(() => {
          const room = rooms[roomId];
          if (!room || room.gameOver) return;

          const p1 = room.players.player;
          const p2 = room.players.bot;

          const winner = p1.totalPoints >= p2.totalPoints ? p1 : p2;
          room.gameOver = true;

          if (!winner.isBot) {
            User.findById(winner.playerId).then(user => {
              if (user) {
                user.wallet += room.bet * 2 - room.bet * 2 / 10;
                user.wincoin += room.bet * 2 - room.bet * 2 / 10;
                user.twoPlayWin += 1;
                user.save();
              }
            });
          }

          namespace.to(roomId).emit('game-over', {
            winner: winner.name,
            message: `⏰ Time's up! ${winner.name} wins by score.`
          });
        }, 8 * 60 * 1000);

        namespace.to(roomId).emit('game-started', {
          players: rooms[roomId].players,
          winning_amount: 2 * bet_amount - 2 * bet_amount / 10,
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
              const botId = `BOT_${generateRoomId()}`;
              room.players.push({
                id: botId,
                name: `BOT_${room.players.length + 1}`,
                playerId: botId,
                isBot: true,
                tokens: [null, null, null, null],
                kills: 0,
                completed: 0,
                totalPoints: 0
              });
            }

            room.started = true;
            startFourPlayerGame(namespace, roomId);
          }, 2000);

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

          rooms4[roomId].timeout = setTimeout(() => {
            const room = rooms4[roomId];
            if (!room || room.gameOver) return;
            room.gameOver = true;

            const winner = room.players.reduce((a, b) => a.totalPoints >= b.totalPoints ? a : b);

            if (!winner.isBot) {
              User.findById(winner.playerId).then(user => {
                if (user) {
                  user.wallet += room.bet * 4 - room.bet * 4 / 10;
                  user.wincoin += room.bet * 4 - room.bet * 4 / 10;
                  user.fourPlayWin += 1;
                  user.save();
                }
              });
            }

            namespace.to(roomId).emit('game-over-4p', {
              winner: winner.name,
              message: `⏰ Time's up! ${winner.name} wins by score.`
            });
          }, 8 * 60 * 1000);
        }
      } catch (err) {
        console.error(err);
        socket.emit('message', {
          status: 'error',
          message: '❌ Server error. Try again later.'
        });
      }
    });

    socket.on('update-score', ({ roomId, playerId, totalPoints }) => {
      const room = rooms[roomId] || rooms4[roomId];
      if (!room || room.gameOver) return;

      const playerList = room.players?.player ? Object.values(room.players) : room.players;
      const player = playerList.find(p => p.playerId === playerId);

      if (player && totalPoints >= 0 && totalPoints <= MAX_SCORE_LIMIT) {
        player.totalPoints = totalPoints;
      }
    });

    socket.on('disconnect', async () => {
      console.log(`❌ Disconnected: ${socket.id}`);

      const roomId = Object.keys(rooms).find(r => rooms[r].players.player.id === socket.id);
      const room = rooms[roomId];

      if (room && !room.gameOver) {
        clearTimeout(room.timeout);
        room.gameOver = true;
        const p1 = room.players.player;
        const p2 = room.players.bot;
        const winner = p1.totalPoints >= p2.totalPoints ? p1 : p2;

        if (!winner.isBot) {
          const user = await User.findById(winner.playerId);
          if (user) {
            user.wallet += room.bet * 2 - room.bet / 10;
            user.wincoin += room.bet * 2 - room.bet / 10;
            user.twoPlayWin += 1;
            await user.save();
          }
        }

        namespace.to(roomId).emit('game-over', {
          winner: winner.name,
          message: `❌ Disconnected. ${winner.name} wins by score.`
        });
      }

      const roomId4 = Object.keys(rooms4).find(r => rooms4[r].players.some(p => p.id === socket.id));
      const room4 = rooms4[roomId4];

      if (room4 && !room4.gameOver) {
        clearTimeout(room4.timeout);
        room4.gameOver = true;
        const winner = room4.players.reduce((a, b) => a.totalPoints >= b.totalPoints ? a : b);

        if (!winner.isBot) {
          const user = await User.findById(winner.playerId);
          if (user) {
            user.wallet += room4.bet * 4 - room4.bet / 10;
            user.wincoin += room4.bet * 4 - room4.bet / 10;
            user.fourPlayWin += 1;
            await user.save();
          }
        }

        namespace.to(roomId4).emit('game-over-4p', {
          winner: winner.name,
          message: `❌ Disconnected. ${winner.name} wins by score.`
        });
      }
    });
  });

  // Add custom room game logic
  setupCustomRoomGame(namespace);
};

function startFourPlayerGame(namespace, roomId) {
  const room = rooms4[roomId];
  if (!room) return;

  namespace.to(roomId).emit('game-started-4p', {
    players: room.players,
    winning_amount: 4 * room.bet - 4 * room.bet / 10,
    message: `🎮 4-player game started! ${room.players[0].name}'s turn.`
  });
}

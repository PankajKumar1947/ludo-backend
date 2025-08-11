import User from '../model/user.js';
import CustomRoom from '../model/customRoom.js';
import { COMISSION_RATE } from '../constants/index.js';
import { generateRoomId, getNextPlayerIndex, createBot, calculateScore, handlePlayerLeave, startCustomRoomGame, fillWithBotsAndStart } from "./game-utility.js"

export const playerRoomMap = {};
export const actionTimeoutMap = {};
export const waitingRoomsByBet = {}; // Structure: { 'player-2': { bet1: roomId, bet2: roomId }, 'player-4': { bet1: roomId, bet2: roomId } }

// function to get or create waiting room key
function getWaitingRoomKey(mode, betAmount) {
  if (!waitingRoomsByBet[mode]) {
    waitingRoomsByBet[mode] = {};
  }
  return waitingRoomsByBet[mode][betAmount] || null;
}

// function to set waiting room
function setWaitingRoom(mode, betAmount, roomId) {
  if (!waitingRoomsByBet[mode]) {
    waitingRoomsByBet[mode] = {};
  }
  waitingRoomsByBet[mode][betAmount] = roomId;
}

//function to clear waiting room
export function clearWaitingRoom(mode, betAmount) {
  if (waitingRoomsByBet[mode]) {
    delete waitingRoomsByBet[mode][betAmount];
  }
}

export async function announceTurn(namespace, roomId) {
  try {
    const room = await CustomRoom.findOne({ roomId });
    if (!room || room.players.length < 2 || room.gameOver) return;

    // Initialize scores for all players if not set
    room.players.forEach(player => {
      if (typeof player.score !== 'number') {
        player.score = 0;
        console.log(`Initialized score for ${player.name}: 0`);
      }
      if (!player.tokens || !Array.isArray(player.tokens)) {
        player.tokens = [0, 0, 0, 0];
        console.log(`Initialized tokens for ${player.name}: [0,0,0,0]`);
      }
    });
    await room.save();

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
      playerIndex: currentPlayer.position
    });

    if (currentPlayer.isBot) {
      setTimeout(async () => {
        try {
          const botRoom = await CustomRoom.findOne({ roomId });
          if (!botRoom || botRoom.gameOver) return;

          const diceValue = Math.floor(Math.random() * 6) + 1;
          botRoom.hasRolled = true;
          botRoom.lastDiceValue = diceValue;
          await botRoom.save();

          namespace.to(roomId).emit('custom-dice-rolled', {
            playerId: currentPlayer.playerId,
            dice: diceValue,
            message: `${currentPlayer.name} rolled a ${diceValue}`
          });

          setTimeout(async () => {
            try {
              const botRoom2 = await CustomRoom.findOne({ roomId });
              if (!botRoom2 || botRoom2.gameOver) return;

              const botPlayer = botRoom2.players.find(p => p.playerId === currentPlayer.playerId);
              if (!botPlayer || !botPlayer.tokens) return;

              // Simple bot logic: move first available token
              const tokenIndex = 0;
              const currentPos = botPlayer.tokens[tokenIndex] || 0;
              const newPos = Math.min(currentPos + diceValue, 56);

              botPlayer.tokens[tokenIndex] = newPos;

              // Award points for bot movement
              const stepsMoved = Math.abs(newPos - currentPos);
              let scoreUpdate = null;
              if (stepsMoved > 0) {
                scoreUpdate = calculateScore(botRoom2, currentPlayer.playerId, 'move', stepsMoved);
              }

              // Additional bonus if token reached home (position 56)
              if (newPos === 56 && currentPos < 56) {
                const homeBonus = calculateScore(botRoom2, currentPlayer.playerId, 'home', 50);
                if (homeBonus) {
                  scoreUpdate = {
                    ...homeBonus,
                    points: (scoreUpdate?.points || 0) + homeBonus.points,
                    action: 'move+home'
                  };
                }
              }

              botRoom2.hasMoved = true;
              await botRoom2.save();

              namespace.to(roomId).emit('custom-token-moved', {
                playerId: currentPlayer.playerId,
                tokenIndex,
                from: currentPos,
                to: newPos,
                message: `${currentPlayer.name} moved a token`,
              });

              // ALWAYS emit score after bot token move (even if no points awarded)
              if (scoreUpdate) {
                namespace.to(roomId).emit('score-updated', scoreUpdate);
                console.log('Bot score updated and emitted:', scoreUpdate);
              }

              // Emit all players scores for sync after every bot move
              const allScores = botRoom2.players.map(p => {
                // Ensure each player has a score field
                if (typeof p.score !== 'number') {
                  p.score = 0;
                }
                return {
                  playerId: p.playerId,
                  name: p.name,
                  score: p.score
                };
              });

              namespace.to(roomId).emit('players-scores', {
                scores: allScores
              });
              console.log('Players scores emitted after bot move:', allScores);

              if (diceValue !== 6) {
                botRoom2.currentPlayerIndex = getNextPlayerIndex(botRoom2.players, botRoom2.currentPlayerIndex);
                await botRoom2.save();
              }
              announceTurn(namespace, roomId);
            } catch (error) {
              console.error('Bot move error:', error);
            }
          }, 2000);
        } catch (error) {
          console.error('Bot dice roll error:', error);
        }
      }, 2000);
      return;
    }

    actionTimeoutMap[roomId] = setTimeout(async () => {
      try {
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

        let dontChangeNextTurn = false;
        if (currentPlayer.missedTurns >= 3 && !currentPlayer.isBot) {
          dontChangeNextTurn = true;
          const loserId = currentPlayer.playerId;
          updatedRoom.players = updatedRoom.players.filter(p => p.playerId !== loserId);
          await updatedRoom.save();

          namespace.to(roomId).emit('player-removed', {
            playerId: loserId,
            message: `${currentPlayer.name} missed 3 turns and was removed`
          });

          // NEW: Check if all remaining humans are inactive
          const humanPlayers = updatedRoom.players.filter(p => !p.isBot);
          const allHumansInactive = humanPlayers.length === 0 ||
            humanPlayers.every(p => (p.missedTurns || 0) >= 3);

          if (allHumansInactive && !updatedRoom.gameOver) {
            updatedRoom.gameOver = true;
            await updatedRoom.save();

            clearTimeout(actionTimeoutMap[roomId]);
            delete actionTimeoutMap[roomId];

            namespace.to(roomId).emit('game-over-custom', {
              winner: null,
              playerId: null,
              message: 'Game ended because all human players were inactive or removed.'
            });

            for (const p of updatedRoom.players) delete playerRoomMap[p.playerId];
            await CustomRoom.deleteOne({ roomId });
            return;
          }

          //  Existing win by last player
          if (updatedRoom.players.length === 1) {
            updatedRoom.gameOver = true;
            await updatedRoom.save();

            clearTimeout(actionTimeoutMap[roomId]);
            delete actionTimeoutMap[roomId];

            const winner = updatedRoom.players[0];
            if (!winner.isBot && !winner.playerId.startsWith('bot-')) {
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

            for (const p of updatedRoom.players) delete playerRoomMap[p.playerId];
            await CustomRoom.deleteOne({ roomId });
            return;
          }
        }

        updatedRoom.currentPlayerIndex = getNextPlayerIndex(updatedRoom.players, updatedRoom.currentPlayerIndex, dontChangeNextTurn);
        await updatedRoom.save();
        announceTurn(namespace, roomId);
      } catch (error) {
        console.error('Turn timeout error:', error);
      }
    }, 20000);
  } catch (error) {
    console.error('Announce turn error:', error);
  }
}

export const setupCustomRoomGame = (namespace) => {
  namespace.on('connection', (socket) => {

    socket.on('create-custom-room', async ({ playerId, bet_amount, playerLimit }) => {
      try {
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
            missedTurns: 0,
            score: 0,
            tokens: [0, 0, 0, 0]
          }],
          bet: bet_amount,
          consecutiveSixes: {}
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
      } catch (error) {
        console.error('Create room error:', error);
        socket.emit('message', { status: 'error', message: 'Server error' });
      }
    });

    socket.on('join-custom-room', async ({ roomId, playerId }) => {
      try {
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
          missedTurns: 0,
          score: 0,
          tokens: [0, 0, 0, 0]
        });
        if (!room.consecutiveSixes) room.consecutiveSixes = {};
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
      } catch (error) {
        console.error('Join room error:', error);
        socket.emit('message', { status: 'error', message: 'Server error' });
      }
    });

    socket.on('start-custom-room-game', async ({ roomId, playerId }) => {
      try {
        const room = await CustomRoom.findOne({ roomId });
        if (!room || room.started || room.players[0]?.playerId !== playerId) return;

        room.started = true;
        if (!room.consecutiveSixes) room.consecutiveSixes = {};
        await room.save();

        namespace.to(roomId).emit('game-will-start', { message: 'Game will start soon', roomId, bet_amount: room.bet });
        setTimeout(() => startCustomRoomGame(namespace, roomId, room.gameType), 1000);
      } catch (error) {
        console.error('Start game error:', error);
      }
    });

    socket.on('join-public-game', async ({ playerId, bet_amount, mode }) => {
      try {
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
        // Check if there's a waiting room for this mode and bet amount
        const existingRoomId = getWaitingRoomKey(mode, bet_amount);

        if (existingRoomId) {
          room = await CustomRoom.findOne({ roomId: existingRoomId });
          if (room && room.bet === bet_amount && !room.started && room.players.length < room.playerLimit) {
            // Join existing room with matching bet amount
            const position = room.players.length;
            room.players.push({
              id: socket.id,
              playerId,
              name: user.first_name,
              pic_url: user.pic_url || '',
              position,
              missedTurns: 0,
              score: 0,
              tokens: [0, 0, 0, 0]
            });
            if (!room.consecutiveSixes) room.consecutiveSixes = {};
            await room.save();
          } else {
            // Room is no longer valid, clear it
            clearWaitingRoom(mode, bet_amount);
            room = null;
          }
        }

        // Create new room if no suitable room found
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
              missedTurns: 0,
              score: 0,
              tokens: [0, 0, 0, 0]
            }],
            bet: bet_amount,
            consecutiveSixes: {}
          });
          await room.save();

          // Set this room as waiting room for this mode and bet amount
          setWaitingRoom(mode, bet_amount, room.roomId);

          // Set timeout to fill with bots if room doesn't fill up
          setTimeout(async () => {
            const r = await CustomRoom.findOne({ roomId: room.roomId });
            if (r && r.players.length < r.playerLimit && !r.started) {
              clearWaitingRoom(mode, bet_amount); // Clear waiting room before starting
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

        // Check if room is now full
        if (room.players.length === room.playerLimit) {
          clearWaitingRoom(mode, bet_amount); // Clear waiting room as it's full
          namespace.to(room.roomId).emit('game-will-start', {
            message: 'Game will start soon',
            roomId: room.roomId,
            bet_amount: room.bet
          });
          setTimeout(() => startCustomRoomGame(namespace, room.roomId, mode), 1000);
        }
      } catch (error) {
        console.error('Join public game error:', error);
        socket.emit('message', { status: 'error', message: 'Server error' });
      }
    });

    socket.on('custom-roll-dice', async ({ roomId, playerId }) => {
      try {
        const room = await CustomRoom.findOne({ roomId });
        if (!room || room.gameOver || room.hasRolled) return;
        const currentPlayer = room.players[room.currentPlayerIndex];
        if (currentPlayer?.playerId !== playerId) return;

        room.hasRolled = true;

        if (!room.consecutiveSixes) room.consecutiveSixes = {};
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
      } catch (error) {
        console.error('Roll dice error:', error);
      }
    });

    socket.on('custom-token-moved', async ({ roomId, playerId, tokenIndex, from, to }) => {
      try {
        const room = await CustomRoom.findOne({ roomId });
        if (!room || room.gameOver || !room.hasRolled || room.hasMoved) return;

        const currentPlayer = room.players.find(p => p.playerId === playerId);
        if (!currentPlayer || !currentPlayer.tokens) return;

        // Update token position
        currentPlayer.tokens[tokenIndex] = to;

        let scoreUpdate = null;
        let keepTurn = false;

        // Award points for movement (1 point per step moved)
        const stepsMoved = Math.abs(to - from);
        if (stepsMoved > 0) {
          scoreUpdate = calculateScore(room, playerId, 'move', stepsMoved);
        }

        // Additional bonus if token reached home (position 56)
        if (to === 56 && from < 56) {
          const homeBonus = calculateScore(room, playerId, 'home', 50);
          if (homeBonus) {
            // Combine the movement points with home bonus
            scoreUpdate = {
              ...homeBonus,
              points: (scoreUpdate?.points || 0) + homeBonus.points,
              action: 'move+home'
            };
          }
        }

        room.hasMoved = true;
        await room.save();

        namespace.to(roomId).emit('custom-token-moved', {
          playerId, tokenIndex, from, to,
          message: `Player ${playerId} moved token ${tokenIndex}`,
          tokens: currentPlayer.tokens
        });

        // ALWAYS emit score after token move
        if (scoreUpdate) {
          namespace.to(roomId).emit('score-updated', scoreUpdate);
          console.log('Player score updated and emitted:', scoreUpdate);
        }

        // Emit all players scores for sync after every move
        const allScores = room.players.map(p => {
          // Ensure each player has a score field
          if (typeof p.score !== 'number') {
            p.score = 0;
          }
          return {
            playerId: p.playerId,
            name: p.name,
            score: p.score
          };
        });

        namespace.to(roomId).emit('players-scores', {
          scores: allScores
        });
        console.log('Players scores emitted after token move:', allScores);

        const lastDice = room.lastDiceValue || 0;
        if (lastDice !== 6 && !keepTurn) {
          room.currentPlayerIndex = getNextPlayerIndex(room.players, room.currentPlayerIndex);
          await room.save();
        }
        announceTurn(namespace, roomId);
      } catch (error) {
        console.error('Token moved error:', error);
      }
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
import { BOT_LIST } from '../constants/index.js';
import { clearWaitingRoom ,playerRoomMap, actionTimeoutMap, announceTurn} from './custom-room-game.js';
import CustomRoom from '../model/customRoom.js';
import User from '../model/user.js';
import { COMISSION_RATE } from '../constants/index.js';

export function generateRoomId(length = 6) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < length; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

export function getNextPlayerIndex(players, currentIndex, dontChangeNextTurn = false) {
  if (dontChangeNextTurn) return currentIndex;
  return (currentIndex + 1) % players.length;
}

export function createBot(position) {
  const bot = BOT_LIST[Math.floor(Math.random() * BOT_LIST.length)];
  return {
    id: `bot-${Date.now()}-${Math.random()}`,
    playerId: `bot-${Math.floor(Math.random() * 1000)}`,
    name: bot.name,
    pic_url: bot.pic_url,
    isBot: true,
    position,
    missedTurns: 0,
    score: 0,
    tokens: [0, 0, 0, 0]
  };
}

export function calculateScore(room, playerId, action, points = 0) {
  try {
    const player = room.players.find(p => p.playerId === playerId);
    if (!player) {
      console.error(`Player not found: ${playerId}`);
      return null;
    }

    // Ensure score field exists and is initialized
    if (typeof player.score !== 'number') {
      player.score = 0;
      console.log(`Initialized score for player ${player.name}: 0`);
    }

    const oldScore = player.score;
    player.score = oldScore + points;

    console.log(`Score update: ${player.name} (${playerId}) - ${action} +${points} = ${player.score} (was ${oldScore})`);

    return {
      playerId,
      playerName: player.name,
      oldScore,
      newScore: player.score,
      action,
      points,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error calculating score:', error);
    return null;
  }
}

export async function handlePlayerLeave(namespace, playerId, isDisconnect = false) {
  try {
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

    const nonBots = room.players.filter(p => !p.isBot);
    if (nonBots.length === 0 && !room.gameOver) {
      room.gameOver = true;
      await room.save();

      clearTimeout(actionTimeoutMap[roomId]);
      delete actionTimeoutMap[roomId];

      namespace.to(roomId).emit('game-over-custom', {
        winner: null,
        playerId: null,
        message: `All human players have left. Game over.`
      });

      for (const p of room.players) {
        delete playerRoomMap[p.playerId];
      }

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
  } catch (error) {
    console.error('Handle player leave error:', error);
  }
}

export async function startCustomRoomGame(namespace, roomId, mode) {
  try {
    const room = await CustomRoom.findOne({ roomId });
    if (!room) return;

    room.started = true;
    if (!room.consecutiveSixes) room.consecutiveSixes = {};
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
      try {
        const finalRoom = await CustomRoom.findOne({ roomId });
        if (!finalRoom || finalRoom.gameOver) return;

        finalRoom.gameOver = true;
        await finalRoom.save();

        clearTimeout(actionTimeoutMap[roomId]);
        delete actionTimeoutMap[roomId];

        const winner = finalRoom.players.reduce((a, b) => (a.score || 0) > (b.score || 0) ? a : b);

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
          message: `Time's up! ${winner.name} wins with highest score`
        });

        for (const p of finalRoom.players) {
          delete playerRoomMap[p.playerId];
        }

        await CustomRoom.deleteOne({ roomId });
      } catch (error) {
        console.error('Game timeout error:', error);
      }
    }, gameDuration);

    announceTurn(namespace, roomId);
  } catch (error) {
    console.error('Start custom room game error:', error);
  }
}

export async function fillWithBotsAndStart(namespace, room, mode) {
  try {
    const initialPlayerCount = room.players.length;

    // Clear the waiting room entry since we're starting the game
    clearWaitingRoom(mode, room.bet);

    while (room.players.length < room.playerLimit) {
      const bot = createBot(room.players.length);
      room.players.push(bot);
    }

    if (!room.consecutiveSixes) room.consecutiveSixes = {};
    await room.save();

    const newBots = room.players.slice(initialPlayerCount);
    for (const bot of newBots) {
      namespace.to(room.roomId).emit('player-joined', {
        players: room.players,
        playerLimit: room.playerLimit,
        message: `${bot.name} (Bot) joined the room`
      });
    }

    namespace.to(room.roomId).emit('game-will-start', {
      message: 'Bots added. Game will start soon',
      roomId: room.roomId,
      bet_amount: room.bet
    });

    setTimeout(() => startCustomRoomGame(namespace, room.roomId, mode), 1000);
  } catch (error) {
    console.error('Fill with bots error:', error);
  }
}
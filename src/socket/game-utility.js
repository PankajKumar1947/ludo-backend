import { BOT_LIST } from '../constants/index.js';

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
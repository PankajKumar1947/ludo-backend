import BotControl from '../model/botControl.js';

export class BotManager {
  static async getBotSettings() {
    try {
      return await BotControl.getGlobalSettings();
    } catch (error) {
      console.error('Error getting bot settings:', error);
      return {
        temperature: 3,
        killingMode: true,
        cleverMove: false,
        aggressiveness: 5,
        active: true
      };
    }
  }

  static async updateBotSettings(updates) {
    try {
      const settings = await BotControl.findByIdAndUpdate(
        'global_bot_settings',
        { ...updates, updatedAt: new Date() },
        { new: true }
      );
      return settings;
    } catch (error) {
      console.error('Error updating bot settings:', error);
      return null;
    }
  }

  static async generateBotDice(baseRoll) {
    try {
      if (isNaN(baseRoll) || baseRoll < 1 || baseRoll > 6) {
        baseRoll = Math.floor(Math.random() * 6) + 1;
      }

      const settings = await this.getBotSettings();
      if (!settings || !settings.active) return baseRoll;

      const temperature = Number(settings.temperature);
      if (isNaN(temperature)) return baseRoll;
      
      if (temperature >= 6) return 6;
      if (temperature <= 1) return 1;
      
      const result = Math.min(baseRoll, temperature);
      return isNaN(result) ? baseRoll : result;
    } catch (error) {
      console.error('Error in generateBotDice:', error);
      return isNaN(baseRoll) ? Math.floor(Math.random() * 6) + 1 : baseRoll;
    }
  }

  static async selectBestToken(botPlayer, diceValue, room) {
    const settings = await this.getBotSettings();
    if (!settings.active || !settings.cleverMove) {
      return this.selectSimpleToken(botPlayer, diceValue);
    }

    const { killingMode, aggressiveness } = settings;
    const tokens = botPlayer.tokens;
    const moves = [];

    for (let i = 0; i < tokens.length; i++) {
      const currentPos = tokens[i];
      const newPos = Math.min(currentPos + diceValue, 56);
      
      if (currentPos === newPos) continue;

      const move = {
        tokenIndex: i,
        from: currentPos,
        to: newPos,
        priority: 0
      };

      if (newPos === 56) {
        move.priority += 100;
      }

      if (currentPos === 0 && diceValue === 6) {
        move.priority += 50;
      }

      if (killingMode) {
        const killInfo = this.checkPotentialKill(room, botPlayer, i, newPos);
        if (killInfo) {
          move.priority += aggressiveness * 10;
          move.killInfo = killInfo;
        }
      }

      const safetyScore = this.calculateSafety(room, botPlayer, newPos);
      move.priority += safetyScore;

      const progressScore = Math.floor(newPos / 5);
      move.priority += progressScore;

      moves.push(move);
    }

    if (moves.length === 0) {
      return this.selectSimpleToken(botPlayer, diceValue);
    }

    moves.sort((a, b) => b.priority - a.priority);
    return moves[0].tokenIndex;
  }

  static selectSimpleToken(botPlayer, diceValue) {
    for (let i = 0; i < botPlayer.tokens.length; i++) {
      if (botPlayer.tokens[i] < 56) {
        return i;
      }
    }
    return 0;
  }

  static checkPotentialKill(room, botPlayer, tokenIndex, newPosition) {
    const universalPos = this.getUniversalPosition(botPlayer.position, newPosition);
    const SAFE_POSITIONS = [1, 9, 14, 22, 27, 35, 40, 48];
    
    if (SAFE_POSITIONS.includes(universalPos) || universalPos === 0 || universalPos >= 51) {
      return null;
    }

    for (let player of room.players) {
      if (player.playerId === botPlayer.playerId) continue;

      for (let i = 0; i < player.tokens.length; i++) {
        const targetTokenPos = player.tokens[i];
        if (targetTokenPos === 0 || targetTokenPos >= 51) continue;

        const targetUniversalPos = this.getUniversalPosition(player.position, targetTokenPos);
        
        if (targetUniversalPos === universalPos) {
          return {
            killedPlayerId: player.playerId,
            killedPlayerName: player.name,
            killedTokenIndex: i,
            killedTokenPosition: targetTokenPos
          };
        }
      }
    }
    return null;
  }

  static getUniversalPosition(playerPosition, tokenPosition) {
    if (tokenPosition === 0) return 0;
    if (tokenPosition >= 51) return tokenPosition;
    
    const startingPositions = [1, 14, 27, 40];
    const playerStartPos = startingPositions[playerPosition];
    let universalPos = (playerStartPos - 1 + tokenPosition - 1) % 52 + 1;
    
    return universalPos;
  }

  static calculateSafety(room, botPlayer, newPosition) {
    const universalPos = this.getUniversalPosition(botPlayer.position, newPosition);
    const SAFE_POSITIONS = [1, 9, 14, 22, 27, 35, 40, 48];
    
    if (SAFE_POSITIONS.includes(universalPos) || universalPos >= 51) {
      return 20;
    }

    let dangerScore = 0;
    for (let player of room.players) {
      if (player.playerId === botPlayer.playerId) continue;

      for (let token of player.tokens) {
        if (token === 0 || token >= 51) continue;
        
        const enemyUniversalPos = this.getUniversalPosition(player.position, token);
        const distance = Math.abs(universalPos - enemyUniversalPos);
        
        if (distance <= 6 && distance > 0) {
          dangerScore -= (7 - distance) * 2;
        }
      }
    }
    
    return dangerScore;
  }
}

export default BotManager;
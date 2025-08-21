import BotManager from '../../services/botManager.js';

export const getBotSettings = async (req, res) => {
  try {
    const settings = await BotManager.getBotSettings();
    res.json({
      success: true,
      data: settings
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

export const setBotSettings = async (req, res) => {
  try {
    const { temperature, killingMode, cleverMove, aggressiveness } = req.body;

    const updates = {};
    if (temperature !== undefined)
      updates.temperature = Math.max(1, Math.min(6, temperature));
    if (killingMode !== undefined)
      updates.killingMode = Boolean(killingMode);
    if (cleverMove !== undefined)
      updates.cleverMove = Boolean(cleverMove);
    if (aggressiveness !== undefined)
      updates.aggressiveness = Math.max(1, Math.min(10, aggressiveness));

    const settings = await BotManager.updateBotSettings(updates);

    if (!settings) {
      return res.status(400).json({
        success: false,
        message: 'Failed to update settings'
      });
    }

    res.json({
      success: true,
      data: settings
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
}


export const resetSettings = async (req, res) => {
  try {
    const defaultSettings = {
      temperature: 3,
      killingMode: true,
      cleverMove: false,
      aggressiveness: 5,
      active: true
    };

    const settings = await BotManager.updateBotSettings(defaultSettings);
    res.json({
      success: true,
      data: settings,
      message: 'Bot settings reset to default'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

export const getBotStatus = async (req, res) => {
  try {
    const settings = await BotManager.getBotSettings();
    res.json({
      success: true,
      data: {
        active: settings.active,
        temperature: settings.temperature,
        mode: settings.cleverMove ? 'Smart' : 'Simple',
        aggressiveness: settings.aggressiveness,
        killing: settings.killingMode
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
}

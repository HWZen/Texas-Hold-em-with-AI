'use strict';

/**
 * Browser compatibility layer.
 * Electron provides window.api through preload.js; a deployed browser build
 * receives the same small API backed by localStorage and the local web server.
 */
(function installBrowserApi() {
  if (window.api) return;

  const SETTINGS_KEY = 'ai-texas-holdem:settings';
  const SAVE_KEY = 'ai-texas-holdem:saved-game';
  const defaultSettings = {
    playerCount: 5,
    initialChips: 10000,
    smallBlind: 10,
    bigBlind: 20,
    players: [
      { id: 'ai_0', name: 'Alice', aiMode: 'local', aiType: 'balanced', aiConfig: null },
      { id: 'ai_1', name: 'Bob', aiMode: 'local', aiType: 'aggressive', aiConfig: null },
      { id: 'ai_2', name: 'Charlie', aiMode: 'local', aiType: 'conservative', aiConfig: null },
      { id: 'ai_3', name: 'Diana', aiMode: 'local', aiType: 'balanced', aiConfig: null },
      { id: 'ai_4', name: 'Eve', aiMode: 'local', aiType: 'aggressive', aiConfig: null },
      { id: 'ai_5', name: 'Frank', aiMode: 'local', aiType: 'conservative', aiConfig: null },
      { id: 'ai_6', name: 'Grace', aiMode: 'local', aiType: 'balanced', aiConfig: null }
    ]
  };

  function read(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  }

  async function callAi(config) {
    const response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'AI 服务请求失败');
    return payload.content;
  }

  window.api = {
    getSettings: () => Promise.resolve(read(SETTINGS_KEY, defaultSettings)),
    saveSettings: settings => Promise.resolve(write(SETTINGS_KEY, settings)),
    saveGame: state => Promise.resolve(write(SAVE_KEY, state)),
    loadGame: () => Promise.resolve(read(SAVE_KEY, null)),
    aiRequest: callAi,
    validateAI: async config => {
      try {
        await callAi({ ...config, messages: [{ role: 'user', content: 'Reply with OK.' }] });
        return { success: true, message: '连接成功' };
      } catch (error) {
        return { success: false, message: error.message };
      }
    }
  };

  window.__WEB_BUILD__ = true;
})();

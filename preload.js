'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSettings:  ()         => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  saveGame:     (state)    => ipcRenderer.invoke('save-game', state),
  loadGame:     ()         => ipcRenderer.invoke('load-game'),
  aiRequest:    (config)   => ipcRenderer.invoke('ai-request', config),
  validateAI:   (config)   => ipcRenderer.invoke('validate-ai', config)
});

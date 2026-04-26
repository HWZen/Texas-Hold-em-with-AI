'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');

let Store;
try {
  Store = require('electron-store');
} catch (e) {
  // fallback stub for dev environments without the module
  Store = class {
    constructor(opts) { this._data = (opts && opts.defaults) ? JSON.parse(JSON.stringify(opts.defaults)) : {}; }
    get(k, d) { return k in this._data ? this._data[k] : d; }
    set(k, v) { this._data[k] = v; }
  };
}

const store = new Store({
  defaults: {
    settings: {
      playerCount: 5,
      initialChips: 10000,
      smallBlind: 10,
      bigBlind: 20,
      players: [
        { id: 'ai_0', name: 'Alice',   aiMode: 'local', aiType: 'balanced',      aiConfig: null },
        { id: 'ai_1', name: 'Bob',     aiMode: 'local', aiType: 'aggressive',    aiConfig: null },
        { id: 'ai_2', name: 'Charlie', aiMode: 'local', aiType: 'conservative',  aiConfig: null },
        { id: 'ai_3', name: 'Diana',   aiMode: 'local', aiType: 'balanced',      aiConfig: null },
        { id: 'ai_4', name: 'Eve',     aiMode: 'local', aiType: 'aggressive',    aiConfig: null },
        { id: 'ai_5', name: 'Frank',   aiMode: 'local', aiType: 'conservative',  aiConfig: null },
        { id: 'ai_6', name: 'Grace',   aiMode: 'local', aiType: 'balanced',      aiConfig: null }
      ]
    }
  }
});

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: 'AI德州扑克',
    backgroundColor: '#1a4a1a'
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── IPC handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('get-settings', () => store.get('settings'));

ipcMain.handle('save-settings', (_e, settings) => {
  store.set('settings', settings);
  return true;
});

ipcMain.handle('save-game', (_e, state) => {
  store.set('savedGame', state);
  return true;
});

ipcMain.handle('load-game', () => store.get('savedGame', null));

function makeApiRequest(url, apiKey, model, messages, timeoutMs) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try { parsedUrl = new URL(url); } catch (e) { return reject(new Error('无效的 URL')); }

    const isHttps = parsedUrl.protocol === 'https:';
    const transport = isHttps ? https : http;
    const body = JSON.stringify({ model, messages, max_tokens: 256, temperature: 0.7 });

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + (parsedUrl.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.choices && parsed.choices[0]) {
            resolve(parsed.choices[0].message.content);
          } else {
            reject(new Error('API 响应无效: ' + data.slice(0, 200)));
          }
        } catch (e) {
          reject(new Error('解析 API 响应失败: ' + data.slice(0, 200)));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs || 30000, () => { req.destroy(); reject(new Error('请求超时')); });
    req.write(body);
    req.end();
  });
}

ipcMain.handle('ai-request', async (_e, { url, apiKey, model, messages }) => {
  return makeApiRequest(url, apiKey, model, messages, 30000);
});

ipcMain.handle('validate-ai', async (_e, config) => {
  try {
    const { url, apiKey, model } = config;
    await makeApiRequest(url, apiKey, model, [{ role: 'user', content: '请回复"OK"' }], 10000);
    return { success: true, message: '连接成功' };
  } catch (e) {
    return { success: false, message: e.message };
  }
});

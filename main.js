'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');

// ── Logging ───────────────────────────────────────────────────────────────────
function log(...args) {
  console.log('[MAIN]', new Date().toISOString(), ...args);
}
function logErr(...args) {
  console.error('[MAIN ERROR]', new Date().toISOString(), ...args);
}

log('main.js starting, Electron version:', process.versions.electron, 'Node:', process.versions.node);

const STORE_DEFAULTS = {
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
};

// Store is initialized lazily inside app.whenReady() to avoid calling
// app.getPath() before the app is ready (required in newer Electron versions).
let store = null;

function getStore() {
  if (store) return store;
  // Should not be called before store is initialized; return memory fallback.
  logErr('getStore() called before initialization! Returning memory fallback.');
  store = makeFallbackStore();
  return store;
}

function makeFallbackStore() {
  log('Using in-memory fallback store');
  return {
    _data: JSON.parse(JSON.stringify(STORE_DEFAULTS)),
    get(k, d) { return k in this._data ? this._data[k] : d; },
    set(k, v) { this._data[k] = v; }
  };
}

let mainWindow;

function createWindow() {
  log('Creating BrowserWindow...');
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

  const htmlPath = path.join(__dirname, 'src', 'renderer', 'index.html');
  log('Loading file:', htmlPath);
  mainWindow.loadFile(htmlPath);

  // Forward renderer console messages to main-process stdout so they appear
  // in the terminal even when DevTools is closed.
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const labels = ['verbose', 'info', 'warn', 'error'];
    console.log(`[RENDERER/${labels[level] || level}] ${message}  (${sourceId}:${line})`);
  });

  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDesc, url) => {
    logErr('Page failed to load:', errorCode, errorDesc, url);
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    logErr('Renderer process gone:', details.reason, details.exitCode);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    log('Page finished loading.');
  });
}

app.whenReady().then(() => {
  log('App ready. Initializing store...');

  // Initialize electron-store AFTER app.ready so app.getPath() is available.
  try {
    const Store = require('electron-store');
    log('electron-store loaded, version:', require('electron-store/package.json').version);
    store = new Store({ defaults: STORE_DEFAULTS });
    log('Store initialized, settings:', JSON.stringify(store.get('settings')).slice(0, 100));
  } catch (e) {
    logErr('electron-store failed to load:', e.message, '— using in-memory fallback');
    store = makeFallbackStore();
  }

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── IPC handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('get-settings', () => {
  const s = getStore().get('settings');
  log('IPC get-settings:', JSON.stringify(s).slice(0, 80));
  return s;
});

ipcMain.handle('save-settings', (_e, settings) => {
  log('IPC save-settings, playerCount:', settings.playerCount);
  getStore().set('settings', settings);
  return true;
});

ipcMain.handle('save-game', (_e, state) => {
  log('IPC save-game, length:', String(state).length);
  getStore().set('savedGame', state);
  return true;
});

ipcMain.handle('load-game', () => {
  const s = getStore().get('savedGame', null);
  log('IPC load-game:', s ? 'found saved game' : 'no saved game');
  return s;
});

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
  log('IPC ai-request, model:', model, 'url:', url.slice(0, 60));
  return makeApiRequest(url, apiKey, model, messages, 30000);
});

ipcMain.handle('validate-ai', async (_e, config) => {
  log('IPC validate-ai, model:', config.model);
  try {
    const { url, apiKey, model } = config;
    await makeApiRequest(url, apiKey, model, [{ role: 'user', content: '请回复"OK"' }], 10000);
    return { success: true, message: '连接成功' };
  } catch (e) {
    logErr('validate-ai failed:', e.message);
    return { success: false, message: e.message };
  }
});

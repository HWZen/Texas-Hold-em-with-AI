'use strict';

/**
 * Lightweight production server for the browser edition.
 * No third-party runtime dependency is required: it serves /src securely and
 * proxies optional OpenAI-compatible requests so server API keys never enter
 * the browser bundle.
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'server.config.json');
let fileConfig = {};
try { fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (error) {
  if (error.code !== 'ENOENT') console.warn('Cannot read server.config.json:', error.message);
}
const PORT = Number(process.env.PORT || fileConfig.port || 8080);
const HOST = process.env.HOST || fileConfig.host || '127.0.0.1';
const PUBLIC_ROOT = path.join(__dirname, 'src');
const MAX_BODY_BYTES = 1024 * 1024;

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    ...headers
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        reject(new Error('请求内容过大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (_) { reject(new Error('请求不是有效的 JSON')); }
    });
    req.on('error', reject);
  });
}

function forwardAi(messages) {
  const url = process.env.AI_API_URL || fileConfig.aiApiUrl;
  const apiKey = process.env.AI_API_KEY || fileConfig.aiApiKey;
  const model = process.env.AI_MODEL || fileConfig.aiModel;
  if (!url || !apiKey || !model) {
    return Promise.reject(new Error('服务器尚未配置云端 AI。请使用本地 AI，或设置 AI_API_URL、AI_API_KEY、AI_MODEL。'));
  }

  let target;
  try { target = new URL(url); }
  catch (_) { return Promise.reject(new Error('服务器 AI_API_URL 配置无效')); }
  if (!['https:', 'http:'].includes(target.protocol)) {
    return Promise.reject(new Error('服务器 AI_API_URL 必须使用 HTTP 或 HTTPS')); }

  const payload = JSON.stringify({ model, messages, max_tokens: 256, temperature: 0.7 });
  const client = target.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const upstream = client.request({
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: target.pathname + target.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        Authorization: `Bearer ${apiKey}`
      },
      timeout: 30000
    }, response => {
      let responseBody = '';
      response.on('data', chunk => { responseBody += chunk; });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          return reject(new Error(`AI 服务响应 ${response.statusCode}`));
        }
        try {
          const parsed = JSON.parse(responseBody);
          const content = parsed?.choices?.[0]?.message?.content;
          if (!content) throw new Error('AI 服务响应格式无效');
          resolve(content);
        } catch (error) { reject(error); }
      });
    });
    upstream.on('timeout', () => upstream.destroy(new Error('AI 服务请求超时')));
    upstream.on('error', reject);
    upstream.write(payload);
    upstream.end();
  });
}

async function serve(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'POST' && url.pathname === '/api/ai') {
    try {
      const { messages } = await readJson(req);
      if (!Array.isArray(messages) || !messages.length) throw new Error('缺少 AI 消息');
      const content = await forwardAi(messages);
      return send(res, 200, JSON.stringify({ content }), { 'Content-Type': 'application/json; charset=utf-8' });
    } catch (error) {
      return send(res, 502, JSON.stringify({ error: error.message }), { 'Content-Type': 'application/json; charset=utf-8' });
    }
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');
  if (url.pathname === '/') {
    // Redirect instead of serving index.html at "/": the page references its
    // assets relatively, so the document URL must be /renderer/index.html.
    return send(res, 302, '', { Location: '/renderer/index.html' });
  }
  const requested = decodeURIComponent(url.pathname);
  const filepath = path.resolve(PUBLIC_ROOT, '.' + requested);
  if (!filepath.startsWith(PUBLIC_ROOT + path.sep)) return send(res, 403, 'Forbidden');

  fs.readFile(filepath, (error, data) => {
    if (error) return send(res, error.code === 'ENOENT' ? 404 : 500, error.code === 'ENOENT' ? 'Not Found' : 'Server Error');
    const type = MIME_TYPES[path.extname(filepath).toLowerCase()] || 'application/octet-stream';
    send(res, 200, req.method === 'HEAD' ? '' : data, { 'Content-Type': type });
  });
}

http.createServer((req, res) => serve(req, res).catch(error => {
  console.error(error);
  send(res, 500, 'Server Error');
})).listen(PORT, HOST, () => {
  console.log(`AI Texas Hold'em is available at http://${HOST}:${PORT}`);
});
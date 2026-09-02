const https = require('https');
const http = require('http');
const config = require('./config');

function getHttpModule(url) {
  return url.startsWith('https') ? https : http;
}

function parseUrl(path) {
  const { apiUrl } = config.load();
  return new URL(path, apiUrl);
}

function makeRequest(method, path, body, opts = {}) {
  return new Promise((resolve, reject) => {
    const url = parseUrl(path);
    const httpModule = getHttpModule(url.href);
    const { apiKey } = config.load();

    const headers = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const payload = body ? JSON.stringify(body) : null;
    if (payload) {
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = httpModule.request(url, {
      method,
      headers,
      timeout: 300000,
    }, (res) => {
      resolve(res);
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout (300s)'));
    });

    if (opts.signal) {
      opts.signal.addEventListener('abort', () => {
        req.destroy();
        reject(new Error('Request aborted'));
      });
    }

    if (payload) req.write(payload);
    req.end();
  });
}

async function readFullResponse(res) {
  return new Promise((resolve, reject) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => resolve(data));
    res.on('error', reject);
  });
}

function checkAuth() {
  const { apiKey } = config.load();
  return Promise.resolve(!!apiKey);
}

function setupApiKey(key) {
  // Cheia intră în ~/.utmai/credentials.json (0600), nu în config.json. Verificarea la server o face
  // lib/auth.js — aici doar scriem.
  config.saveCredentials({ apiKey: key, obtainedAt: new Date().toISOString() });
}

function logout() {
  config.clearApiKey();
}

// Streaming chat — returnează un async generator
async function* streamChat(messages, tools, signal) {
  const body = {
    messages,
    tools,
    tool_choice: 'auto',
    stream: true,
  };

  const res = await makeRequest('POST', '/api/cli/chat', body, { signal });

  if (res.statusCode === 401 || res.statusCode === 403) {
    throw new Error('AUTH_EXPIRED');
  }
  if (res.statusCode !== 200) {
    const responseBody = await readFullResponse(res);
    let msg = `Eroare API: ${res.statusCode}`;
    try {
      const parsed = JSON.parse(responseBody);
      if (parsed.error) msg = parsed.error;
    } catch {}
    throw new Error(msg);
  }

  // Parse SSE stream
  let buffer = '';

  for await (const chunk of res) {
    buffer += chunk.toString();

    const lines = buffer.split('\n');
    // Păstrează ultima linie incompletă în buffer
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) continue;

      if (trimmed === 'data: [DONE]') {
        yield { done: true };
        return;
      }

      if (trimmed.startsWith('data: ')) {
        const jsonStr = trimmed.slice(6);
        try {
          const parsed = JSON.parse(jsonStr);
          yield { done: false, data: parsed };
        } catch {
          // Chunk JSON invalid — ignorăm
        }
      }
    }
  }

  // Procesează ce a mai rămas în buffer
  if (buffer.trim()) {
    const trimmed = buffer.trim();
    if (trimmed === 'data: [DONE]') {
      yield { done: true };
    } else if (trimmed.startsWith('data: ')) {
      try {
        const parsed = JSON.parse(trimmed.slice(6));
        yield { done: false, data: parsed };
      } catch {}
    }
  }
}

module.exports = { checkAuth, setupApiKey, logout, streamChat };

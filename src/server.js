const express = require('express');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const { Client } = require('ssh2');
const { SocksClient } = require('socks');
const net = require('net');
const path = require('path');
const { exec } = require('child_process');
const { URL } = require('url');
const pkg = require('../package.json');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PREVIEW_MAX_BYTES = 1024 * 1024;
const UPLOAD_MAX_BYTES = 500 * 1024 * 1024;
const MAX_SESSIONS = 8;
const APP_MODE = process.env.SUPER_SSH_MODE || '';
const IS_LOCAL_MODE = APP_MODE === 'desktop' || APP_MODE === 'portable';
const AI_BASE_URL = (process.env.AI_BASE_URL || 'http://127.0.0.1:11434/v1').replace(/\/$/, '');
const AI_MODEL = process.env.AI_MODEL || 'llama3.2';
const AI_API_KEY = process.env.AI_API_KEY || '';
const AI_TIMEOUT_MS = 60000;
const AI_CONTEXT_MAX = 4000;

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, version: pkg.version, mode: APP_MODE || 'server' });
});

app.use(express.json({ limit: '100mb' }));

function normalizeAiBaseUrl(url) {
  return String(url || AI_BASE_URL).trim().replace(/\/$/, '');
}

function truncateAiText(text, max) {
  const s = String(text || '');
  if (s.length <= max) return s;
  return `…${s.slice(s.length - max)}`;
}

/** Node 16+ compatible fetch (global fetch on 18+, http(s) fallback otherwise). */
function aiFetch(url, options = {}) {
  if (typeof fetch === 'function') {
    return fetch(url, options);
  }

  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (err) {
      reject(err);
      return;
    }

    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;
    const method = (options.method || 'GET').toUpperCase();
    const headers = Object.assign({}, options.headers || {});
    const body = options.body != null ? String(options.body) : null;
    if (body != null && !headers['Content-Length'] && !headers['content-length']) {
      headers['Content-Length'] = Buffer.byteLength(body);
    }

    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers,
      },
      (resp) => {
        const chunks = [];
        resp.on('data', (c) => chunks.push(c));
        resp.on('end', () => {
          const buf = Buffer.concat(chunks);
          const text = buf.toString('utf8');
          resolve({
            ok: resp.statusCode >= 200 && resp.statusCode < 300,
            status: resp.statusCode,
            async text() { return text; },
            async json() { return JSON.parse(text); },
          });
        });
      }
    );

    req.on('error', reject);

    if (options.signal) {
      if (options.signal.aborted) {
        req.destroy(new Error('AbortError'));
        reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
        return;
      }
      options.signal.addEventListener('abort', () => {
        req.destroy();
        reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
      });
    }

    if (body != null) req.write(body);
    req.end();
  });
}

app.get('/api/ai/config', (_req, res) => {
  res.json({
    baseUrl: AI_BASE_URL,
    model: AI_MODEL,
    hasEnvKey: Boolean(AI_API_KEY),
  });
});

app.get('/api/ai/models', async (req, res) => {
  const baseUrl = normalizeAiBaseUrl(req.query.baseUrl);
  const apiKey = (req.query.apiKey != null && req.query.apiKey !== '')
    ? String(req.query.apiKey)
    : AI_API_KEY;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const headers = { Accept: 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const resp = await aiFetch(`${baseUrl}/models`, { headers, signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) {
      res.json({ models: [], error: `models HTTP ${resp.status}` });
      return;
    }
    const data = await resp.json();
    const models = (data.data || data.models || [])
      .map((m) => (typeof m === 'string' ? m : (m.id || m.name)))
      .filter(Boolean);
    res.json({ models });
  } catch (err) {
    clearTimeout(timer);
    res.json({ models: [], error: err.name === 'AbortError' ? '请求超时' : (err.message || String(err)) });
  }
});

app.post('/api/ai/chat', async (req, res) => {
  const body = req.body || {};
  const baseUrl = normalizeAiBaseUrl(body.baseUrl);
  const model = String(body.model || AI_MODEL).trim() || AI_MODEL;
  const apiKey = (body.apiKey != null && body.apiKey !== '')
    ? String(body.apiKey)
    : AI_API_KEY;
  let messages = Array.isArray(body.messages) ? body.messages : [];
  messages = messages
    .filter((m) => m && m.role && m.content != null)
    .map((m) => ({
      role: String(m.role),
      content: truncateAiText(m.content, m.role === 'system' ? 8000 : AI_CONTEXT_MAX),
    }))
    .slice(-20);

  if (!messages.length) {
    res.status(400).json({ error: 'messages 不能为空' });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const resp = await aiFetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages,
        temperature: body.temperature != null ? body.temperature : 0.2,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const raw = await resp.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch (_) {
      data = null;
    }

    if (!resp.ok) {
      const errMsg = (data && (data.error && data.error.message || data.error))
        || raw.slice(0, 300)
        || `HTTP ${resp.status}`;
      res.status(502).json({ error: String(errMsg) });
      return;
    }

    const content = data
      && data.choices
      && data.choices[0]
      && data.choices[0].message
      && data.choices[0].message.content;

    if (content == null || content === '') {
      res.status(502).json({ error: '模型未返回内容' });
      return;
    }

    res.json({ content: String(content), model });
  } catch (err) {
    clearTimeout(timer);
    const msg = err.name === 'AbortError'
      ? 'AI 请求超时（60s）'
      : (err.message || String(err));
    const hint = /ECONNREFUSED|fetch failed|connect ECONNREFUSED/i.test(msg)
      ? `${msg}。请确认 Ollama 已启动（ollama serve）或检查 Base URL`
      : msg;
    res.status(502).json({ error: hint });
  }
});

app.use(express.static(path.join(__dirname, '..', 'public')));

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function createProxySocket(proxyType, proxyHost, proxyPort, targetHost, targetPort) {
  return new Promise((resolve, reject) => {
    if (proxyType === 'socks5') {
      SocksClient.createConnection({
        proxy: { host: proxyHost, port: proxyPort, type: 5 },
        command: 'connect',
        destination: { host: targetHost, port: targetPort },
      })
        .then((info) => resolve(info.socket))
        .catch(reject);
      return;
    }

    if (proxyType === 'http') {
      const socket = net.connect(proxyPort, proxyHost);
      let settled = false;

      const fail = (err) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(err);
      };

      socket.on('error', fail);
      socket.on('connect', () => {
        socket.write(
          `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n`
          + `Host: ${targetHost}:${targetPort}\r\n`
          + 'Proxy-Connection: keep-alive\r\n\r\n',
        );
      });

      socket.on('data', (chunk) => {
        if (settled) return;
        const header = chunk.toString();
        const statusLine = header.split('\r\n')[0] || '';
        if (!/\s200\s/.test(statusLine)) {
          fail(new Error(`HTTP proxy failed: ${statusLine.trim() || 'unknown error'}`));
          return;
        }
        settled = true;
        socket.removeListener('error', fail);
        resolve(socket);
      });
      return;
    }

    reject(new Error(`Unsupported proxy type: ${proxyType}`));
  });
}

function openBrowser(url) {
  const platform = process.platform;
  if (platform === 'darwin') {
    exec(`open "${url}"`);
  } else if (platform === 'win32') {
    exec(`start "" "${url}"`, { shell: true });
  } else {
    exec(`xdg-open "${url}"`);
  }
}

function formatMode(mode) {
  const types = ['p', 'c', 'd', 'b', '-', 'l', 's'];
  let str = types[((mode >> 12) & 0o17)] || '-';
  const masks = [0o400, 0o200, 0o100, 0o040, 0o020, 0o010, 0o004, 0o002, 0o001];
  const chars = 'rwxrwxrwx';
  for (let i = 0; i < 9; i += 1) {
    str += (mode & masks[i]) ? chars[i] : '-';
  }
  return `${str} ${(mode & 0o777).toString(8).padStart(3, '0')}`;
}

function withSftp(session, ws, sessionId, onReady) {
  if (!session || !session.client) {
    return false;
  }
  session.client.sftp((err, sftp) => {
    if (err) {
      send(ws, { type: 'error', sessionId, data: err.message });
      return;
    }
    onReady(sftp);
  });
  return true;
}

function execCommand(sshClient, command) {
  return new Promise((resolve, reject) => {
    sshClient.exec(command, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }
      let stdout = '';
      let stderr = '';
      stream.on('data', (chunk) => { stdout += chunk.toString('utf-8'); });
      stream.stderr.on('data', (chunk) => { stderr += chunk.toString('utf-8'); });
      stream.on('close', (code) => {
        if (code !== 0 && !stdout.trim()) {
          reject(new Error(stderr.trim() || `Command failed (${code})`));
          return;
        }
        resolve(stdout.trim() || stderr.trim());
      });
    });
  });
}

function endSession(sessions, sessionId, ws, reason) {
  const session = sessions.get(sessionId);
  if (!session) return;
  Object.keys(session.uploads || {}).forEach((id) => {
    try {
      const up = session.uploads[id];
      if (up && up.stream) up.stream.destroy();
    } catch (_) { /* ignore */ }
  });
  try {
    if (session.stream) session.stream.close();
  } catch (_) { /* ignore */ }
  try {
    if (session.client) session.client.end();
  } catch (_) { /* ignore */ }
  sessions.delete(sessionId);
  if (ws) {
    send(ws, { type: 'disconnected', sessionId, data: reason || 'Connection closed' });
  }
}

wss.on('connection', (ws) => {
  const sessions = new Map();

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (e) {
      return;
    }

    const sessionId = msg.sessionId;
    if (!sessionId && msg.type !== 'ping') {
      send(ws, { type: 'error', data: 'Missing sessionId' });
      return;
    }

    if (msg.type === 'connect') {
      if (sessions.has(sessionId)) {
        endSession(sessions, sessionId, ws, 'Reconnecting');
      }
      if (sessions.size >= MAX_SESSIONS) {
        send(ws, { type: 'error', sessionId, data: `最多同时连接 ${MAX_SESSIONS} 个会话` });
        return;
      }

      const {
        host, port, username, password, privateKey, passphrase,
        proxyType, proxyHost, proxyPort,
      } = msg;

      const client = new Client();
      const session = { client, stream: null, uploads: {} };
      sessions.set(sessionId, session);

      client.on('ready', async () => {
        client.shell({ term: 'xterm-256color', cols: 120, rows: 36 }, (err, stream) => {
          if (err) {
            send(ws, { type: 'error', sessionId, data: err.message });
            endSession(sessions, sessionId, null);
            return;
          }
          session.stream = stream;

          stream.on('data', (chunk) => {
            send(ws, { type: 'data', sessionId, data: chunk.toString('utf-8') });
          });

          stream.stderr.on('data', (chunk) => {
            send(ws, { type: 'data', sessionId, data: chunk.toString('utf-8') });
          });

          stream.on('close', () => {
            endSession(sessions, sessionId, ws, 'Shell session closed');
          });

          send(ws, { type: 'connected', sessionId, data: 'SSH connection established' });
        });

        try {
          const home = await execCommand(client, 'printf %s "$HOME"');
          if (home) send(ws, { type: 'home-dir', sessionId, path: home });
        } catch (_) {
          // ignore
        }
      });

      client.on('error', (err) => {
        send(ws, { type: 'error', sessionId, data: `SSH Error: ${err.message}` });
      });

      client.on('close', () => {
        if (sessions.has(sessionId)) {
          endSession(sessions, sessionId, ws, 'Connection closed');
        }
      });

      const connectConfig = {
        host,
        port: port || 22,
        username,
        readyTimeout: 15000,
        keepaliveInterval: 20000,
      };

      if (password) connectConfig.password = password;
      if (privateKey) {
        connectConfig.privateKey = privateKey;
        if (passphrase) connectConfig.passphrase = passphrase;
      }

      const targetPort = port || 22;
      const useProxy = proxyType && proxyHost && proxyPort;

      const doConnect = (sock) => {
        if (sock) connectConfig.sock = sock;
        client.connect(connectConfig);
      };

      if (useProxy) {
        createProxySocket(proxyType, proxyHost, Number(proxyPort), host, targetPort)
          .then(doConnect)
          .catch((err) => {
            send(ws, { type: 'error', sessionId, data: `Proxy Error: ${err.message}` });
            sessions.delete(sessionId);
          });
      } else {
        doConnect();
      }
      return;
    }

    const session = sessions.get(sessionId);

    if (msg.type === 'input') {
      if (session && session.stream) session.stream.write(msg.data);
      return;
    }

    if (msg.type === 'resize') {
      if (session && session.stream) {
        session.stream.setWindow(msg.rows, msg.cols, msg.height || 480, msg.width || 640);
      }
      return;
    }

    if (msg.type === 'disconnect') {
      endSession(sessions, sessionId, ws, 'Disconnected by user');
      return;
    }

    if (msg.type === 'exec') {
      if (!session || !session.client) {
        send(ws, { type: 'exec-result', sessionId, id: msg.id, error: 'Not connected' });
        return;
      }
      execCommand(session.client, msg.command)
        .then((output) => send(ws, { type: 'exec-result', sessionId, id: msg.id, output }))
        .catch((err) => send(ws, { type: 'exec-result', sessionId, id: msg.id, error: err.message }));
      return;
    }

    if (msg.type === 'server-info') {
      if (!session || !session.client) {
        send(ws, { type: 'server-info-result', sessionId, id: msg.id, error: 'Not connected' });
        return;
      }
      const script = [
        'echo "===HOST==="',
        'hostname 2>/dev/null || uname -n',
        'echo "===OS==="',
        'uname -sr 2>/dev/null',
        'echo "===UPTIME==="',
        'uptime 2>/dev/null || cat /proc/uptime 2>/dev/null',
        'echo "===CPU==="',
        'nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo ?',
        'echo "===MEM==="',
        'free -h 2>/dev/null | awk \'NR==1||NR==2{print}\'',
        'echo "===DISK==="',
        'df -h / 2>/dev/null | tail -1',
        'echo "===LOAD==="',
        'cat /proc/loadavg 2>/dev/null || uptime 2>/dev/null',
      ].join('; ');

      execCommand(session.client, script)
        .then((raw) => {
          const sections = {};
          let current = null;
          raw.split('\n').forEach((line) => {
            const m = line.match(/^===(\w+)===$/);
            if (m) {
              current = m[1].toLowerCase();
              sections[current] = [];
              return;
            }
            if (current) sections[current].push(line);
          });
          const info = {
            host: (sections.host || []).join('\n').trim(),
            os: (sections.os || []).join('\n').trim(),
            uptime: (sections.uptime || []).join('\n').trim(),
            cpu: (sections.cpu || []).join('\n').trim(),
            mem: (sections.mem || []).join('\n').trim(),
            disk: (sections.disk || []).join('\n').trim(),
            load: (sections.load || []).join('\n').trim(),
          };
          send(ws, { type: 'server-info-result', sessionId, id: msg.id, info });
        })
        .catch((err) => send(ws, { type: 'server-info-result', sessionId, id: msg.id, error: err.message }));
      return;
    }

    if (msg.type === 'sftp-list') {
      if (!withSftp(session, ws, sessionId, (sftp) => {
        sftp.readdir(msg.path || '/home', (err, list) => {
          if (err) {
            send(ws, { type: 'sftp-list-result', sessionId, id: msg.id, error: err.message });
            return;
          }
          const files = list.map((f) => ({
            filename: f.filename,
            longname: f.longname,
            isDir: (f.attrs.mode & 0o040000) === 0o040000,
            size: f.attrs.size,
            mtime: f.attrs.mtime * 1000,
            mode: f.attrs.mode,
            perm: formatMode(f.attrs.mode),
          }));
          send(ws, { type: 'sftp-list-result', sessionId, id: msg.id, path: msg.path, files });
        });
      })) {
        send(ws, { type: 'sftp-list-result', sessionId, id: msg.id, error: 'Not connected' });
      }
      return;
    }

    if (msg.type === 'sftp-upload') {
      if (!withSftp(session, ws, sessionId, (sftp) => {
        const remoteFile = `${msg.remotePath}/${msg.filename}`.replace(/\/+/g, '/');
        const writeStream = sftp.createWriteStream(remoteFile);
        const fileBuffer = Buffer.from(msg.data, 'base64');

        writeStream.on('close', () => {
          send(ws, { type: 'sftp-upload-result', sessionId, id: msg.id, path: remoteFile, done: true });
        });
        writeStream.on('error', (err) => {
          send(ws, { type: 'sftp-upload-result', sessionId, id: msg.id, error: err.message });
        });
        writeStream.end(fileBuffer);
      })) {
        send(ws, { type: 'sftp-upload-result', sessionId, id: msg.id, error: 'Not connected' });
      }
      return;
    }

    if (msg.type === 'sftp-upload-start') {
      if (!session || !session.client) {
        send(ws, { type: 'sftp-upload-result', sessionId, id: msg.id, error: 'Not connected' });
        return;
      }
      if (msg.size > UPLOAD_MAX_BYTES) {
        send(ws, {
          type: 'sftp-upload-result',
          sessionId,
          id: msg.id,
          error: `文件过大，上限 ${UPLOAD_MAX_BYTES} bytes`,
        });
        return;
      }
      withSftp(session, ws, sessionId, (sftp) => {
        const remoteFile = `${msg.remotePath}/${msg.filename}`.replace(/\/+/g, '/');
        const writeStream = sftp.createWriteStream(remoteFile);
        session.uploads[msg.id] = {
          stream: writeStream,
          path: remoteFile,
          received: 0,
          total: msg.size || 0,
        };
        writeStream.on('error', (err) => {
          delete session.uploads[msg.id];
          send(ws, { type: 'sftp-upload-result', sessionId, id: msg.id, error: err.message });
        });
        send(ws, {
          type: 'sftp-upload-progress',
          sessionId,
          id: msg.id,
          received: 0,
          total: msg.size || 0,
        });
      });
      return;
    }

    if (msg.type === 'sftp-upload-chunk') {
      const up = session && session.uploads && session.uploads[msg.id];
      if (!up || !up.stream) {
        send(ws, { type: 'sftp-upload-result', sessionId, id: msg.id, error: 'Upload not started' });
        return;
      }
      try {
        const buf = Buffer.from(msg.data, 'base64');
        up.stream.write(buf);
        up.received += buf.length;
        send(ws, {
          type: 'sftp-upload-progress',
          sessionId,
          id: msg.id,
          received: up.received,
          total: up.total,
        });
      } catch (err) {
        try { up.stream.destroy(); } catch (_) { /* ignore */ }
        delete session.uploads[msg.id];
        send(ws, { type: 'sftp-upload-result', sessionId, id: msg.id, error: err.message });
      }
      return;
    }

    if (msg.type === 'sftp-upload-end') {
      const up = session && session.uploads && session.uploads[msg.id];
      if (!up || !up.stream) {
        send(ws, { type: 'sftp-upload-result', sessionId, id: msg.id, error: 'Upload not started' });
        return;
      }
      const remotePath = up.path;
      up.stream.on('close', () => {
        delete session.uploads[msg.id];
        send(ws, {
          type: 'sftp-upload-result',
          sessionId,
          id: msg.id,
          path: remotePath,
          done: true,
        });
      });
      up.stream.end();
      return;
    }

    if (msg.type === 'sftp-upload-abort') {
      const up = session && session.uploads && session.uploads[msg.id];
      if (up && up.stream) {
        try { up.stream.destroy(); } catch (_) { /* ignore */ }
        delete session.uploads[msg.id];
      }
      send(ws, { type: 'sftp-upload-result', sessionId, id: msg.id, error: 'Aborted' });
      return;
    }

    if (msg.type === 'sftp-mkdir') {
      if (!withSftp(session, ws, sessionId, (sftp) => {
        sftp.mkdir(msg.path, (err) => {
          send(ws, {
            type: 'sftp-mkdir-result',
            sessionId,
            path: msg.path,
            error: err ? err.message : null,
          });
        });
      })) {
        send(ws, { type: 'sftp-mkdir-result', sessionId, error: 'Not connected' });
      }
      return;
    }

    if (msg.type === 'sftp-rename') {
      if (!withSftp(session, ws, sessionId, (sftp) => {
        sftp.rename(msg.from, msg.to, (err) => {
          send(ws, {
            type: 'sftp-rename-result',
            sessionId,
            from: msg.from,
            to: msg.to,
            error: err ? err.message : null,
          });
        });
      })) {
        send(ws, { type: 'sftp-rename-result', sessionId, error: 'Not connected' });
      }
      return;
    }

    if (msg.type === 'sftp-rm') {
      if (!withSftp(session, ws, sessionId, (sftp) => {
        sftp.unlink(msg.path, (err) => {
          if (!err) {
            send(ws, { type: 'sftp-rm-result', sessionId, path: msg.path });
            return;
          }
          sftp.rmdir(msg.path, (err2) => {
            send(ws, {
              type: 'sftp-rm-result',
              sessionId,
              path: msg.path,
              error: err2 ? err2.message : null,
            });
          });
        });
      })) {
        send(ws, { type: 'sftp-rm-result', sessionId, error: 'Not connected' });
      }
      return;
    }

    if (msg.type === 'sftp-download') {
      if (!withSftp(session, ws, sessionId, (sftp) => {
        sftp.readFile(msg.remotePath, (err, fileData) => {
          if (err) {
            send(ws, { type: 'sftp-download-result', sessionId, id: msg.id, error: err.message });
            return;
          }
          send(ws, {
            type: 'sftp-download-result',
            sessionId,
            id: msg.id,
            filename: msg.remotePath.split('/').pop(),
            data: fileData.toString('base64'),
            done: true,
          });
        });
      })) {
        send(ws, { type: 'sftp-download-result', sessionId, id: msg.id, error: 'Not connected' });
      }
      return;
    }

    if (msg.type === 'sftp-preview') {
      if (!withSftp(session, ws, sessionId, (sftp) => {
        sftp.stat(msg.path, (err, stats) => {
          if (err) {
            send(ws, { type: 'sftp-preview-result', sessionId, id: msg.id, error: err.message });
            return;
          }
          if ((stats.mode & 0o170000) === 0o040000) {
            send(ws, { type: 'sftp-preview-result', sessionId, id: msg.id, error: '目录无法预览' });
            return;
          }
          if (stats.size > PREVIEW_MAX_BYTES) {
            send(ws, {
              type: 'sftp-preview-result',
              sessionId,
              id: msg.id,
              error: `文件过大 (${stats.size} bytes)，编辑上限 1MB，请下载后查看`,
            });
            return;
          }
          sftp.readFile(msg.path, (readErr, fileData) => {
            if (readErr) {
              send(ws, { type: 'sftp-preview-result', sessionId, id: msg.id, error: readErr.message });
              return;
            }
            const text = fileData.toString('utf-8');
            const binary = /[\x00-\x08\x0E-\x1F]/.test(text.slice(0, 8000));
            send(ws, {
              type: 'sftp-preview-result',
              sessionId,
              id: msg.id,
              path: msg.path,
              size: stats.size,
              binary,
              content: binary ? null : text,
              done: true,
            });
          });
        });
      })) {
        send(ws, { type: 'sftp-preview-result', sessionId, id: msg.id, error: 'Not connected' });
      }
      return;
    }

    if (msg.type === 'sftp-write') {
      if (!withSftp(session, ws, sessionId, (sftp) => {
        const content = typeof msg.content === 'string' ? msg.content : '';
        if (Buffer.byteLength(content, 'utf8') > PREVIEW_MAX_BYTES) {
          send(ws, {
            type: 'sftp-write-result',
            sessionId,
            id: msg.id,
            path: msg.path,
            error: '内容超过 1MB 上限',
          });
          return;
        }
        sftp.writeFile(msg.path, Buffer.from(content, 'utf8'), (err) => {
          send(ws, {
            type: 'sftp-write-result',
            sessionId,
            id: msg.id,
            path: msg.path,
            error: err ? err.message : null,
            done: !err,
          });
        });
      })) {
        send(ws, {
          type: 'sftp-write-result',
          sessionId,
          id: msg.id,
          error: 'Not connected',
        });
      }
    }
  });

  ws.on('close', () => {
    Array.from(sessions.keys()).forEach((id) => {
      endSession(sessions, id, null);
    });
  });
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || (IS_LOCAL_MODE ? '127.0.0.1' : '0.0.0.0');
const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;

server.listen(PORT, HOST, () => {
  const url = `http://${displayHost}:${PORT}`;
  console.log(`Super SSH v${pkg.version} running at ${url}`);
  if (process.env.SUPER_SSH_OPEN_BROWSER === '1') {
    openBrowser(url);
  }
});

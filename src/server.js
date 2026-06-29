const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { Client } = require('ssh2');
const { SocksClient } = require('socks');
const net = require('net');
const path = require('path');
const { exec } = require('child_process');
const pkg = require('../package.json');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PREVIEW_MAX_BYTES = 512 * 1024;
const APP_MODE = process.env.SUPER_SSH_MODE || '';
const IS_LOCAL_MODE = APP_MODE === 'desktop' || APP_MODE === 'portable';

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, version: pkg.version, mode: APP_MODE || 'server' });
});

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.json({ limit: '100mb' }));

const connections = new Map();

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

function withSftp(sshClient, ws, onReady) {
  if (!sshClient) {
    return false;
  }
  sshClient.sftp((err, sftp) => {
    if (err) {
      send(ws, { type: 'error', data: err.message });
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

wss.on('connection', (ws) => {
  const connId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  let sshClient = null;
  let sshStream = null;

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (e) {
      return;
    }

    if (msg.type === 'connect') {
      const {
        host, port, username, password, privateKey, passphrase,
        proxyType, proxyHost, proxyPort,
      } = msg;
      sshClient = new Client();

      sshClient.on('ready', async () => {
        sshClient.shell({ term: 'xterm-256color', cols: 120, rows: 36 }, (err, stream) => {
          if (err) {
            send(ws, { type: 'error', data: err.message });
            return;
          }
          sshStream = stream;

          stream.on('data', (chunk) => {
            send(ws, { type: 'data', data: chunk.toString('utf-8') });
          });

          stream.stderr.on('data', (chunk) => {
            send(ws, { type: 'data', data: chunk.toString('utf-8') });
          });

          stream.on('close', () => {
            send(ws, { type: 'disconnected', data: 'Shell session closed' });
            sshClient.end();
            connections.delete(connId);
          });

          send(ws, { type: 'connected', data: 'SSH connection established' });
        });

        try {
          const home = await execCommand(sshClient, 'printf %s "$HOME"');
          if (home) send(ws, { type: 'home-dir', path: home });
        } catch (_) {
          // ignore
        }
      });

      sshClient.on('error', (err) => {
        send(ws, { type: 'error', data: `SSH Error: ${err.message}` });
      });

      sshClient.on('close', () => {
        send(ws, { type: 'disconnected', data: 'Connection closed' });
        connections.delete(connId);
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
        sshClient.connect(connectConfig);
        connections.set(connId, { client: sshClient, stream: null });
      };

      if (useProxy) {
        createProxySocket(proxyType, proxyHost, Number(proxyPort), host, targetPort)
          .then(doConnect)
          .catch((err) => {
            send(ws, { type: 'error', data: `Proxy Error: ${err.message}` });
          });
      } else {
        doConnect();
      }
    }

    if (msg.type === 'input' && sshStream) {
      sshStream.write(msg.data);
    }

    if (msg.type === 'resize' && sshStream) {
      sshStream.setWindow(msg.rows, msg.cols, msg.height || 480, msg.width || 640);
    }

    if (msg.type === 'disconnect') {
      if (sshClient) sshClient.end();
      connections.delete(connId);
    }

    if (msg.type === 'exec') {
      if (!sshClient) {
        send(ws, { type: 'exec-result', id: msg.id, error: 'Not connected' });
        return;
      }
      execCommand(sshClient, msg.command)
        .then((output) => send(ws, { type: 'exec-result', id: msg.id, output }))
        .catch((err) => send(ws, { type: 'exec-result', id: msg.id, error: err.message }));
    }

    if (msg.type === 'server-info') {
      if (!sshClient) {
        send(ws, { type: 'server-info-result', id: msg.id, error: 'Not connected' });
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

      execCommand(sshClient, script)
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
          send(ws, { type: 'server-info-result', id: msg.id, info });
        })
        .catch((err) => send(ws, { type: 'server-info-result', id: msg.id, error: err.message }));
    }

    if (msg.type === 'sftp-list') {
      if (!withSftp(sshClient, ws, (sftp) => {
        sftp.readdir(msg.path || '/home', (err, list) => {
          if (err) {
            send(ws, { type: 'sftp-list-result', id: msg.id, error: err.message });
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
          send(ws, { type: 'sftp-list-result', id: msg.id, path: msg.path, files });
        });
      })) {
        send(ws, { type: 'sftp-list-result', id: msg.id, error: 'Not connected' });
      }
    }

    if (msg.type === 'sftp-upload') {
      if (!withSftp(sshClient, ws, (sftp) => {
        const remoteFile = `${msg.remotePath}/${msg.filename}`.replace(/\/+/g, '/');
        const writeStream = sftp.createWriteStream(remoteFile);
        const fileBuffer = Buffer.from(msg.data, 'base64');

        writeStream.on('close', () => {
          send(ws, { type: 'sftp-upload-result', id: msg.id, path: remoteFile, done: true });
        });
        writeStream.on('error', (err) => {
          send(ws, { type: 'sftp-upload-result', id: msg.id, error: err.message });
        });
        writeStream.end(fileBuffer);
      })) {
        send(ws, { type: 'sftp-upload-result', id: msg.id, error: 'Not connected' });
      }
    }

    if (msg.type === 'sftp-mkdir') {
      if (!withSftp(sshClient, ws, (sftp) => {
        sftp.mkdir(msg.path, (err) => {
          send(ws, { type: 'sftp-mkdir-result', path: msg.path, error: err ? err.message : null });
        });
      })) {
        send(ws, { type: 'sftp-mkdir-result', error: 'Not connected' });
      }
    }

    if (msg.type === 'sftp-rename') {
      if (!withSftp(sshClient, ws, (sftp) => {
        sftp.rename(msg.from, msg.to, (err) => {
          send(ws, { type: 'sftp-rename-result', from: msg.from, to: msg.to, error: err ? err.message : null });
        });
      })) {
        send(ws, { type: 'sftp-rename-result', error: 'Not connected' });
      }
    }

    if (msg.type === 'sftp-rm') {
      if (!withSftp(sshClient, ws, (sftp) => {
        sftp.unlink(msg.path, (err) => {
          if (!err) {
            send(ws, { type: 'sftp-rm-result', path: msg.path });
            return;
          }
          sftp.rmdir(msg.path, (err2) => {
            send(ws, { type: 'sftp-rm-result', path: msg.path, error: err2 ? err2.message : null });
          });
        });
      })) {
        send(ws, { type: 'sftp-rm-result', error: 'Not connected' });
      }
    }

    if (msg.type === 'sftp-download') {
      if (!withSftp(sshClient, ws, (sftp) => {
        sftp.readFile(msg.remotePath, (err, data) => {
          if (err) {
            send(ws, { type: 'sftp-download-result', id: msg.id, error: err.message });
            return;
          }
          send(ws, {
            type: 'sftp-download-result',
            id: msg.id,
            filename: msg.remotePath.split('/').pop(),
            data: data.toString('base64'),
            done: true,
          });
        });
      })) {
        send(ws, { type: 'sftp-download-result', id: msg.id, error: 'Not connected' });
      }
    }

    if (msg.type === 'sftp-preview') {
      if (!withSftp(sshClient, ws, (sftp) => {
        sftp.stat(msg.path, (err, stats) => {
          if (err) {
            send(ws, { type: 'sftp-preview-result', id: msg.id, error: err.message });
            return;
          }
          if ((stats.mode & 0o170000) === 0o040000) {
            send(ws, { type: 'sftp-preview-result', id: msg.id, error: '目录无法预览' });
            return;
          }
          if (stats.size > PREVIEW_MAX_BYTES) {
            send(ws, {
              type: 'sftp-preview-result',
              id: msg.id,
              error: `文件过大 (${stats.size} bytes)，请下载后查看`,
            });
            return;
          }
          sftp.readFile(msg.path, (readErr, data) => {
            if (readErr) {
              send(ws, { type: 'sftp-preview-result', id: msg.id, error: readErr.message });
              return;
            }
            const text = data.toString('utf-8');
            const binary = /[\x00-\x08\x0E-\x1F]/.test(text.slice(0, 8000));
            send(ws, {
              type: 'sftp-preview-result',
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
        send(ws, { type: 'sftp-preview-result', id: msg.id, error: 'Not connected' });
      }
    }
  });

  ws.on('close', () => {
    if (sshClient) sshClient.end();
    connections.delete(connId);
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

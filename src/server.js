const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { Client } = require('ssh2');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.json({ limit: '100mb' }));

// Store active SSH connections
const connections = new Map();

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
      const { host, port, username, password, privateKey } = msg;
      sshClient = new Client();

      sshClient.on('ready', () => {
        sshClient.shell({ term: 'xterm-256color', cols: 120, rows: 36 }, (err, stream) => {
          if (err) {
            ws.send(JSON.stringify({ type: 'error', data: err.message }));
            return;
          }
          sshStream = stream;

          stream.on('data', (chunk) => {
            ws.send(JSON.stringify({ type: 'data', data: chunk.toString('utf-8') }));
          });

          stream.stderr.on('data', (chunk) => {
            ws.send(JSON.stringify({ type: 'data', data: chunk.toString('utf-8') }));
          });

          stream.on('close', () => {
            ws.send(JSON.stringify({ type: 'disconnected', data: 'Shell session closed' }));
            sshClient.end();
            connections.delete(connId);
          });

          ws.send(JSON.stringify({ type: 'connected', data: 'SSH connection established' }));
        });
      });

      sshClient.on('error', (err) => {
        ws.send(JSON.stringify({ type: 'error', data: `SSH Error: ${err.message}` }));
      });

      sshClient.on('close', () => {
        ws.send(JSON.stringify({ type: 'disconnected', data: 'Connection closed' }));
        connections.delete(connId);
      });

      const connectConfig = {
        host: host,
        port: port || 22,
        username: username,
        readyTimeout: 10000,
      };

      if (password) {
        connectConfig.password = password;
      } else if (privateKey) {
        connectConfig.privateKey = privateKey;
      }

      sshClient.connect(connectConfig);
      connections.set(connId, { client: sshClient, stream: null });
    }

    if (msg.type === 'input') {
      if (sshStream) {
        sshStream.write(msg.data);
      }
    }

    if (msg.type === 'resize') {
      if (sshStream) {
        sshStream.setWindow(msg.rows, msg.cols, msg.height || 480, msg.width || 640);
      }
    }

    if (msg.type === 'disconnect') {
      if (sshClient) {
        sshClient.end();
      }
      connections.delete(connId);
    }

    // SFTP: list remote directory
    if (msg.type === 'sftp-list') {
      if (!sshClient) {
        ws.send(JSON.stringify({ type: 'sftp-list-result', id: msg.id, error: 'Not connected' }));
        return;
      }
      sshClient.sftp((err, sftp) => {
        if (err) {
          ws.send(JSON.stringify({ type: 'sftp-list-result', id: msg.id, error: err.message }));
          return;
        }
        sftp.readdir(msg.path || '/home', (err, list) => {
          if (err) {
            ws.send(JSON.stringify({ type: 'sftp-list-result', id: msg.id, error: err.message }));
            return;
          }
          const files = list.map(f => ({
            filename: f.filename,
            longname: f.longname,
            isDir: (f.attrs.mode & 0o040000) === 0o040000,
            size: f.attrs.size,
            mtime: f.attrs.mtime * 1000,
          }));
          ws.send(JSON.stringify({ type: 'sftp-list-result', id: msg.id, path: msg.path, files }));
        });
      });
    }

    // SFTP: upload file
    if (msg.type === 'sftp-upload') {
      if (!sshClient) {
        ws.send(JSON.stringify({ type: 'sftp-upload-result', id: msg.id, error: 'Not connected' }));
        return;
      }
      sshClient.sftp((err, sftp) => {
        if (err) {
          ws.send(JSON.stringify({ type: 'sftp-upload-result', id: msg.id, error: err.message }));
          return;
        }
        const remoteFile = (msg.remotePath + '/' + msg.filename).replace(/\/+/g, '/');
        const writeStream = sftp.createWriteStream(remoteFile);
        const fileBuffer = Buffer.from(msg.data, 'base64');

        writeStream.on('close', () => {
          ws.send(JSON.stringify({ type: 'sftp-upload-result', id: msg.id, path: remoteFile, done: true }));
        });
        writeStream.on('error', (err) => {
          ws.send(JSON.stringify({ type: 'sftp-upload-result', id: msg.id, error: err.message }));
        });
        writeStream.end(fileBuffer);
      });
    }

    // SFTP: create directory
    if (msg.type === 'sftp-mkdir') {
      if (!sshClient) {
        ws.send(JSON.stringify({ type: 'sftp-mkdir-result', error: 'Not connected' }));
        return;
      }
      sshClient.sftp((err, sftp) => {
        if (err) {
          ws.send(JSON.stringify({ type: 'sftp-mkdir-result', error: err.message }));
          return;
        }
        sftp.mkdir(msg.path, (err) => {
          ws.send(JSON.stringify({ type: 'sftp-mkdir-result', path: msg.path, error: err ? err.message : null }));
        });
      });
    }

    // SFTP: remove file or directory
    if (msg.type === 'sftp-rm') {
      if (!sshClient) {
        ws.send(JSON.stringify({ type: 'sftp-rm-result', error: 'Not connected' }));
        return;
      }
      sshClient.sftp((err, sftp) => {
        if (err) {
          ws.send(JSON.stringify({ type: 'sftp-rm-result', error: err.message }));
          return;
        }
        // Try unlink first (file), if fails try rmdir (directory)
        sftp.unlink(msg.path, (err) => {
          if (!err) {
            ws.send(JSON.stringify({ type: 'sftp-rm-result', path: msg.path }));
            return;
          }
          sftp.rmdir(msg.path, (err2) => {
            ws.send(JSON.stringify({ type: 'sftp-rm-result', path: msg.path, error: err2 ? err2.message : null }));
          });
        });
      });
    }

    // SFTP: download file
    if (msg.type === 'sftp-download') {
      if (!sshClient) {
        ws.send(JSON.stringify({ type: 'sftp-download-result', id: msg.id, error: 'Not connected' }));
        return;
      }
      sshClient.sftp((err, sftp) => {
        if (err) {
          ws.send(JSON.stringify({ type: 'sftp-download-result', id: msg.id, error: err.message }));
          return;
        }
        sftp.readFile(msg.remotePath, (err, data) => {
          if (err) {
            ws.send(JSON.stringify({ type: 'sftp-download-result', id: msg.id, error: err.message }));
            return;
          }
          ws.send(JSON.stringify({
            type: 'sftp-download-result',
            id: msg.id,
            filename: msg.remotePath.split('/').pop(),
            data: data.toString('base64'),
            done: true
          }));
        });
      });
    }
  });

  ws.on('close', () => {
    if (sshClient) {
      sshClient.end();
    }
    connections.delete(connId);
  });
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`Super SSH running at http://${HOST}:${PORT}`);
});

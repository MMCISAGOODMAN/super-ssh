const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3000;
const HOST = '127.0.0.1';

let mainWindow = null;
let tray = null;
let serverProcess = null;
let isQuitting = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function getResourcesPath(...parts) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, ...parts);
  }
  return path.join(__dirname, '..', ...parts);
}

function getNodeBinary() {
  if (app.isPackaged) {
    const bin = process.platform === 'win32' ? 'node.exe' : 'node';
    return path.join(process.resourcesPath, 'node', bin);
  }
  return process.platform === 'win32' ? 'node.exe' : 'node';
}

function getServerEntry() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app', 'src', 'server.js');
  }
  return path.join(__dirname, '..', 'src', 'server.js');
}

function getServerCwd() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app');
  }
  return path.join(__dirname, '..');
}

function startServer() {
  const nodeBin = getNodeBinary();
  const serverEntry = getServerEntry();
  const cwd = getServerCwd();

  serverProcess = spawn(nodeBin, [serverEntry], {
    cwd,
    env: {
      ...process.env,
      SUPER_SSH_MODE: 'desktop',
      HOST,
      PORT: String(PORT),
    },
    stdio: 'pipe',
  });

  serverProcess.stdout.on('data', (data) => {
    process.stdout.write(`[server] ${data}`);
  });
  serverProcess.stderr.on('data', (data) => {
    process.stderr.write(`[server] ${data}`);
  });
  serverProcess.on('exit', (code) => {
    if (!isQuitting && code !== 0) {
      console.error(`Server exited with code ${code}`);
    }
  });
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

function waitForServer(timeoutMs = 30000) {
  const started = Date.now();
  const url = `http://${HOST}:${PORT}/api/health`;

  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve();
          return;
        }
        retry();
      });
      req.on('error', retry);
      req.setTimeout(2000, () => {
        req.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error('Server failed to start'));
        return;
      }
      setTimeout(check, 300);
    };

    check();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'Super SSH',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://${HOST}:${PORT}`);

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const iconPath = path.join(__dirname, 'icons', 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Super SSH');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(async () => {
  try {
    startServer();
    await waitForServer();
    createWindow();
    createTray();
  } catch (err) {
    console.error(err);
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  stopServer();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // keep running in tray
  }
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
  }
});

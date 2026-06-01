var ws = null, term = null, fitAddon = null, connected = false;
var currentRemotePath = '/home', showUploadZone = false;
var cmdLog = [];

/* ========== Init ========== */
function init() {
  term = new Terminal({
    cursorBlink: true, fontSize: 14,
    fontFamily: "'SF Mono','Fira Code',Menlo,monospace",
    theme: { background: '#0d1117', foreground: '#c9d1d9', cursor: '#58a6ff', selectionBackground: 'rgba(88,166,255,0.3)' },
    allowProposedApi: true
  });
  fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon.WebLinksAddon());
  term.open(document.getElementById('terminal'));
  fitAddon.fit();
  window.addEventListener('resize', function() {
    fitAddon.fit();
    if (ws && ws.readyState === WebSocket.OPEN) {
      var d = fitAddon.proposeDimensions();
      ws.send(JSON.stringify({ type: 'resize', cols: d.cols, rows: d.rows }));
    }
  });
  renderSavedList();
  setupDragDrop();
  setupCtxMenu();
  loadBg();
}

/* ========== Tabs ========== */
function switchTab(t) {
  document.querySelectorAll('.sidebar-tab').forEach(function(x) { x.classList.toggle('active', x.dataset.tab === t); });
  document.getElementById('tab-connect').classList.toggle('hidden', t !== 'connect');
  document.getElementById('tab-saved').classList.toggle('hidden', t !== 'saved');
  var logTab = document.getElementById('tab-log');
  if (logTab) logTab.classList.toggle('hidden', t !== 'log');
}
function switchAuth(t) {
  document.querySelectorAll('.auth-tab').forEach(function(x) { x.classList.toggle('active', x.dataset.auth === t); });
  document.getElementById('auth-password').classList.toggle('hidden', t !== 'password');
  document.getElementById('auth-key').classList.toggle('hidden', t !== 'key');
}

/* ========== Background ========== */
function toggleBgModal() {
  var modal = document.getElementById('bgModal');
  modal.classList.toggle('hidden');
  if (!modal.classList.contains('hidden')) {
    // Load current settings
    var saved = localStorage.getItem('ssh_bg_url');
    var opacity = localStorage.getItem('ssh_bg_opacity') || '15';
    if (saved) document.getElementById('bgUrlInput').value = saved;
    document.getElementById('bgOpacity').value = opacity;
    document.getElementById('bgOpacityVal').textContent = opacity + '%';
    updateBgPreview();
  }
}

function loadBg() {
  var url = localStorage.getItem('ssh_bg_url');
  var opacity = localStorage.getItem('ssh_bg_opacity') || '15';
  if (url) {
    document.body.style.setProperty('--bg-image', 'url(' + url + ')');
    document.body.classList.add('has-bg');
    document.body.style.setProperty('--bg-opacity', opacity + '%');
    // Make terminal background semi-transparent via CSS custom property
    document.body.style.setProperty('--term-bg', 'rgba(13,17,23,' + (1 - opacity / 100 * 0.6) + ')');
  }
}

function applyBg() {
  var url = document.getElementById('bgUrlInput').value.trim();
  var opacity = document.getElementById('bgOpacity').value;
  if (!url) { clearBg(); return; }
  localStorage.setItem('ssh_bg_url', url);
  localStorage.setItem('ssh_bg_opacity', opacity);
  document.body.style.setProperty('--bg-image', 'url(' + url + ')');
  document.body.classList.add('has-bg');
  document.body.style.setProperty('--bg-opacity', opacity + '%');
  document.body.style.setProperty('--term-bg', 'rgba(13,17,23,' + (1 - opacity / 100 * 0.6) + ')');
  toggleBgModal();
}

function clearBg() {
  localStorage.removeItem('ssh_bg_url');
  localStorage.removeItem('ssh_bg_opacity');
  document.body.style.removeProperty('--bg-image');
  document.body.style.removeProperty('--term-bg');
  document.body.classList.remove('has-bg');
  document.getElementById('bgUrlInput').value = '';
  document.getElementById('bgPreview').style.backgroundImage = '';
}

function updateBgPreview() {
  var url = document.getElementById('bgUrlInput').value.trim();
  document.getElementById('bgPreview').style.backgroundImage = url ? 'url(' + url + ')' : '';
}

// File input for bg
document.addEventListener('DOMContentLoaded', function() {
  var fileInput = document.getElementById('bgFileInput');
  if (fileInput) {
    fileInput.addEventListener('change', function(e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function(ev) {
        document.getElementById('bgUrlInput').value = ev.target.result;
        updateBgPreview();
      };
      reader.readAsDataURL(file);
    });
  }
  var urlInput = document.getElementById('bgUrlInput');
  if (urlInput) urlInput.addEventListener('input', updateBgPreview);
  var opacity = document.getElementById('bgOpacity');
  if (opacity) {
    opacity.addEventListener('input', function() {
      document.getElementById('bgOpacityVal').textContent = this.value + '%';
    });
  }
});

/* ========== Command Log ========== */
function addCmdLog(type, cmd, desc) {
  var time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  cmdLog.push({ type: type, cmd: cmd, desc: desc, time: time });
  renderCmdLog();
}

function renderCmdLog() {
  var list = document.getElementById('cmdLogList');
  var count = document.getElementById('logCount');
  if (!list) return;
  if (count) count.textContent = cmdLog.length + ' 条记录';
  if (cmdLog.length === 0) {
    list.innerHTML = '<div class="cmd-log-empty">暂无操作记录<br>在右侧面板操作文件时，对应的 SSH 命令会显示在这里</div>';
    return;
  }
  list.innerHTML = cmdLog.map(function(item) {
    var cls = 'cmd-item cmd-' + item.type;
    var desc = item.desc || '';
    var cmd = item.cmd || '';
    return '<div class="' + cls + '">' +
      '<span class="cmd-time">' + item.time + '</span>' +
      '<span class="cmd-body">' +
        (desc ? '<span class="cmd-desc">' + esc(desc) + '</span>' : '') +
        (cmd ? '<span class="cmd-cmd" title="点击复制" onclick="copyCmd(this)">' + esc(cmd) + '</span>' : '') +
      '</span></div>';
  }).join('');
  list.scrollTop = list.scrollHeight;
}

function clearCmdLog() {
  cmdLog = [];
  renderCmdLog();
}

/* ========== Connection ========== */
function connect(cfg) {
  if (ws) ws.close();
  var host = (cfg && cfg.host) || document.getElementById('host').value.trim();
  var port = parseInt((cfg && cfg.port) || document.getElementById('port').value) || 22;
  var username = (cfg && cfg.username) || document.getElementById('username').value.trim();
  var password = (cfg && cfg.password) || document.getElementById('password').value;
  var privateKey = (cfg && cfg.privateKey) || document.getElementById('privateKey').value.trim();
  if (!host || !username) { alert('请输入主机地址和用户名'); return; }

  addCmdLog('connect', 'ssh ' + username + '@' + host + ' -p ' + port, '连接 ' + username + '@' + host + ':' + port);

  var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(protocol + '//' + location.host);
  ws.onopen = function() { ws.send(JSON.stringify({ type: 'connect', host: host, port: port, username: username, password: password, privateKey: privateKey })); };
  ws.onmessage = function(ev) {
    var msg = JSON.parse(ev.data);
    if (msg.type === 'connected') {
      connected = true; updateStatus(true);
      document.getElementById('btnDisconnect').style.display = '';
      document.getElementById('connInfo').textContent = username + '@' + host + ':' + port;
      term.focus(); listRemoteFiles();
    } else if (msg.type === 'data') { term.write(msg.data);
    } else if (msg.type === 'error') { term.write('\r\n\x1b[31m' + msg.data + '\x1b[0m\r\n');
    } else if (msg.type === 'disconnected') {
      connected = false; updateStatus(false);
      document.getElementById('btnDisconnect').style.display = 'none';
      document.getElementById('connInfo').textContent = '已断开';
      document.getElementById('fpFileList').innerHTML = '<div class="fp-empty"><div class="empty-icon">🔌</div><div>连接已断开</div></div>';
    } else if (msg.type === 'sftp-list-result') { renderRemoteFiles(msg);
    } else if (msg.type === 'sftp-upload-result') { onUploadResult(msg);
    } else if (msg.type === 'sftp-mkdir-result') { if (msg.error) alert('创建文件夹失败: ' + msg.error); else listRemoteFiles();
    } else if (msg.type === 'sftp-rm-result') { if (msg.error) alert('删除失败: ' + msg.error); else listRemoteFiles();
    } else if (msg.type === 'sftp-download-result') { onDownloadResult(msg); }
  };
  ws.onerror = function() { term.write('\r\n\x1b[31mWebSocket 连接失败\x1b[0m\r\n'); };
  ws.onclose = function() { connected = false; updateStatus(false); document.getElementById('btnDisconnect').style.display = 'none'; };
  term.onData(function(d) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data: d })); });
}

function disconnect() {
  if (ws) { ws.send(JSON.stringify({ type: 'disconnect' })); ws.close(); ws = null; }
  connected = false; updateStatus(false);
  document.getElementById('btnDisconnect').style.display = 'none';
  document.getElementById('connInfo').textContent = '未连接';
  addCmdLog('connect', 'exit', '断开连接');
}
function updateStatus(on) { document.getElementById('statusDot').classList.toggle('connected', on); document.getElementById('statusText').textContent = on ? '已连接' : '未连接'; }
function clearTerminal() { term.clear(); }

/* ========== Saved Connections ========== */
function getSavedConnections() { try { return JSON.parse(localStorage.getItem('ssh_connections') || '[]'); } catch (e) { return []; } }

function saveConnection() {
  var host = document.getElementById('host').value.trim();
  var port = parseInt(document.getElementById('port').value) || 22;
  var username = document.getElementById('username').value.trim();
  var password = document.getElementById('password').value;
  var privateKey = document.getElementById('privateKey').value.trim();
  if (!host || !username) { alert('请至少填写主机地址和用户名'); return; }
  var name = prompt('连接名称:', username + '@' + host);
  if (!name) return;
  var conns = getSavedConnections();
  conns.push({ id: Date.now(), name: name, host: host, port: port, username: username, password: password, privateKey: privateKey });
  localStorage.setItem('ssh_connections', JSON.stringify(conns));
  renderSavedList(); switchTab('saved');
}

function renderSavedList() {
  var conns = getSavedConnections();
  var list = document.getElementById('savedList');
  var empty = document.getElementById('savedEmpty');
  if (conns.length === 0) { list.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  list.innerHTML = conns.map(function(c) {
    return '<div class="saved-item" onclick="quickConnect(' + c.id + ')">' +
      '<div class="si-name">' + esc(c.name) + '</div>' +
      '<div class="si-info">' + esc(c.username) + '@' + esc(c.host) + ':' + c.port + '</div>' +
      '<button class="si-del-btn" onclick="event.stopPropagation();deleteConnection(' + c.id + ')" title="删除">✕</button>' +
      '<button class="si-conn-btn" onclick="event.stopPropagation();quickConnect(' + c.id + ')" title="连接">连接</button>' +
      '</div>';
  }).join('');
}

function quickConnect(id) {
  var c = getSavedConnections().find(function(x) { return x.id === id; });
  if (!c) return;
  // Fill form
  document.getElementById('host').value = c.host;
  document.getElementById('port').value = c.port;
  document.getElementById('username').value = c.username;
  document.getElementById('password').value = c.password || '';
  document.getElementById('privateKey').value = c.privateKey || '';
  switchAuth(c.privateKey ? 'key' : 'password');
  // Switch to connect tab so user sees what's happening
  switchTab('connect');
  // Auto connect
  connect(c);
}

function loadConnection(id) {
  var c = getSavedConnections().find(function(x) { return x.id === id; });
  if (!c) return;
  document.getElementById('host').value = c.host;
  document.getElementById('port').value = c.port;
  document.getElementById('username').value = c.username;
  document.getElementById('password').value = c.password || '';
  document.getElementById('privateKey').value = c.privateKey || '';
  switchAuth(c.privateKey ? 'key' : 'password');
  switchTab('connect');
}

function deleteConnection(id) {
  var c = getSavedConnections().filter(function(x) { return x.id !== id; });
  localStorage.setItem('ssh_connections', JSON.stringify(c)); renderSavedList();
}

/* ========== Remote File Browser ========== */
function listRemoteFiles() {
  if (!connected || !ws) return;
  var p = document.getElementById('remotePath').value.trim() || '/home';
  currentRemotePath = p;
  ws.send(JSON.stringify({ type: 'sftp-list', id: 'list', path: p }));
}

function renderRemoteFiles(msg) {
  var list = document.getElementById('fpFileList');
  var label = document.getElementById('fpCwdLabel');
  var status = document.getElementById('fpStatus');
  var pathInput = document.getElementById('remotePath');
  if (msg.error) {
    list.innerHTML = '<div class="fp-empty"><div class="empty-icon">⚠️</div><div>' + esc(msg.error) + '</div></div>';
    if (label) label.textContent = ''; if (status) status.textContent = '错误'; return;
  }
  currentRemotePath = msg.path;
  pathInput.value = msg.path;
  if (label) label.textContent = msg.path;
  if (status) status.textContent = msg.files ? msg.files.length + ' 个项目' : '0 个项目';
  var utp = document.getElementById('uploadTargetPath');
  if (utp) utp.textContent = msg.path;
  if (!msg.files || msg.files.length === 0) {
    list.innerHTML = '<div class="fp-empty"><div class="empty-icon">📂</div><div>空目录</div></div>'; return;
  }
  var sorted = msg.files.slice().sort(function(a, b) {
    if (a.isDir !== b.isDir) return b.isDir ? 1 : -1;
    return a.filename.localeCompare(b.filename);
  });
  list.innerHTML = sorted.map(function(f) {
    var icon = f.isDir ? '📁' : getFileIcon(f.filename);
    var size = f.isDir ? '' : fmtSize(f.size);
    var fullPath = (msg.path + '/' + f.filename).replace(/\/+/g, '/');
    var escapedPath = fullPath.replace(/'/g, "\\'");
    var dirClass = f.isDir ? ' is-dir' : '';
    var onclick = f.isDir ? 'ondblclick="cdRemote(\'' + escapedPath + '\')" onclick="selectFile(this)"' : 'onclick="selectFile(this)"';
    var onctx = 'oncontextmenu="showCtxMenu(event,\'' + escapedPath + '\',' + f.isDir + ');return false;"';
    var actions = '';
    if (!f.isDir) {
      actions = '<span class="ff-actions"><button onclick="event.stopPropagation();downloadFile(\'' + escapedPath + '\')" title="下载">⬇️</button>' +
        '<button class="danger" onclick="event.stopPropagation();deleteRemote(\'' + escapedPath + '\')" title="删除">🗑️</button></span>';
    } else {
      actions = '<span class="ff-actions"><button onclick="event.stopPropagation();deleteRemote(\'' + escapedPath + '\')" title="删除" class="danger">🗑️</button></span>';
    }
    return '<div class="fp-file-row' + dirClass + '" ' + onclick + ' ' + onctx + '>' +
      '<span class="ff-icon">' + icon + '</span>' +
      '<span class="ff-name" title="' + esc(f.filename) + '">' + esc(f.filename) + '</span>' +
      '<span class="ff-size">' + size + '</span>' + actions + '</div>';
  }).join('');
}

function cdRemote(path) {
  document.getElementById('remotePath').value = path.replace(/\/+/g, '/');
  addCmdLog('nav', 'cd ' + path, '进入目录 ' + path);
  listRemoteFiles();
}

function goParent() {
  var p = document.getElementById('remotePath').value.trim() || '/';
  var parts = p.replace(/\/+$/, '').split('/');
  if (parts.length > 1) parts.pop();
  var parent = parts.join('/') || '/';
  document.getElementById('remotePath').value = parent;
  addCmdLog('nav', 'cd ' + parent, '进入目录 ' + parent);
  listRemoteFiles();
}

function createRemoteDir() {
  if (!connected || !ws) { alert('请先连接服务器'); return; }
  var name = prompt('文件夹名称:');
  if (!name || !name.trim()) return;
  var fullPath = (currentRemotePath + '/' + name.trim()).replace(/\/+/g, '/');
  addCmdLog('mkdir', 'mkdir -p ' + fullPath, '创建文件夹 ' + fullPath);
  ws.send(JSON.stringify({ type: 'sftp-mkdir', path: fullPath }));
}

function selectFile(el) {
  document.querySelectorAll('.fp-file-row.selected').forEach(function(r) { r.classList.remove('selected'); });
  el.classList.add('selected');
}

/* ========== Context Menu ========== */
function showCtxMenu(e, path, isDir) {
  e.preventDefault();
  var menu = document.getElementById('ctxMenu');
  menu.innerHTML = '';
  if (isDir) {
    menu.innerHTML += '<div class="ctx-item" onclick="cdRemote(\'' + path.replace(/'/g, "\\'") + '\')">📂 进入目录</div>';
    menu.innerHTML += '<div class="ctx-sep"></div>';
  } else {
    menu.innerHTML += '<div class="ctx-item" onclick="downloadFile(\'' + path.replace(/'/g, "\\'") + '\')">⬇️ 下载</div>';
    menu.innerHTML += '<div class="ctx-sep"></div>';
  }
  menu.innerHTML += '<div class="ctx-item" onclick="navigator.clipboard.writeText(\'' + path.replace(/'/g, "\\'") + '\')">📋 复制路径</div>';
  menu.innerHTML += '<div class="ctx-sep"></div>';
  menu.innerHTML += '<div class="ctx-item danger" onclick="deleteRemote(\'' + path.replace(/'/g, "\\'") + '\')">🗑️ 删除</div>';
  menu.classList.remove('hidden');
  menu.style.left = Math.min(e.clientX, window.innerWidth - 190) + 'px';
  menu.style.top = Math.min(e.clientY, window.innerHeight - 160) + 'px';
}

function setupCtxMenu() { document.addEventListener('click', function() { document.getElementById('ctxMenu').classList.add('hidden'); }); }

function downloadFile(path) {
  document.getElementById('ctxMenu').classList.add('hidden');
  if (!connected || !ws) return;
  addCmdLog('download', 'scp user@host:' + path + ' ./', '下载文件 ' + path);
  ws.send(JSON.stringify({ type: 'sftp-download', id: 'dl-' + Date.now(), remotePath: path }));
}

function deleteRemote(path) {
  document.getElementById('ctxMenu').classList.add('hidden');
  if (!confirm('确定要删除 "' + path + '" 吗？')) return;
  if (!connected || !ws) return;
  addCmdLog('delete', 'rm -rf ' + path, '删除 ' + path);
  ws.send(JSON.stringify({ type: 'sftp-rm', path: path }));
}

function onDownloadResult(msg) {
  if (msg.done && msg.data) {
    var bytes = Uint8Array.from(atob(msg.data), function(c) { return c.charCodeAt(0); });
    var blob = new Blob([bytes]); var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = msg.filename || 'download'; a.click();
    URL.revokeObjectURL(url);
  } else if (msg.error) { alert('下载失败: ' + msg.error); }
}

/* ========== File Upload ========== */
function toggleUploadZone() {
  showUploadZone = !showUploadZone;
  var wrap = document.getElementById('uploadZoneWrap');
  wrap.classList.toggle('hidden', !showUploadZone);
  if (showUploadZone) { var utp = document.getElementById('uploadTargetPath'); if (utp) utp.textContent = currentRemotePath; }
}

function setupDragDrop() {
  var zone = document.getElementById('uploadZone');
  var input = document.getElementById('fileInput');
  zone.addEventListener('dragover', function(e) { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', function() { zone.classList.remove('drag-over'); });
  zone.addEventListener('drop', function(e) { e.preventDefault(); zone.classList.remove('drag-over'); if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files); });
  input.addEventListener('change', function() { if (input.files.length > 0) { handleFiles(input.files); input.value = ''; } });
}

function handleFiles(files) {
  if (!connected || !ws) { alert('请先连接 SSH 服务器'); return; }
  document.getElementById('fpUploadSection').style.display = '';
  Array.from(files).forEach(function(f) { uploadFile(f, currentRemotePath); });
}

function uploadFile(file, remotePath) {
  var fileId = 'file-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  var list = document.getElementById('fpUploadList');
  var div = document.createElement('div');
  div.className = 'fp-upload-item'; div.id = fileId;
  div.innerHTML = '<div class="fu-name">📄 ' + esc(file.name) + ' <span style="color:var(--text-dim);font-weight:400">(' + fmtSize(file.size) + ')</span></div>' +
    '<div class="fu-progress"><div class="fu-progress-bar" id="' + fileId + '-bar"></div></div>' +
    '<div class="fu-status" id="' + fileId + '-status">⏳ 等待中...</div>';
  list.prepend(div);

  var targetPath = remotePath + '/' + file.name;
  addCmdLog('upload', 'scp "' + file.name + '" user@host:' + targetPath + '', '上传 ' + file.name + ' → ' + targetPath);

  var reader = new FileReader();
  reader.onload = function() {
    var base64 = reader.result.split(',')[1];
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'sftp-upload', id: fileId, filename: file.name, remotePath: remotePath, data: base64 }));
      var s = document.getElementById(fileId + '-status'); if (s) s.textContent = '⬆️ 上传中...';
    }
    var bar = document.getElementById(fileId + '-bar'); if (bar) bar.style.width = '30%';
  };
  reader.readAsDataURL(file);
}

function onUploadResult(msg) {
  var bar = document.getElementById(msg.id + '-bar');
  var status = document.getElementById(msg.id + '-status');
  if (msg.done) {
    if (bar) { bar.style.width = '100%'; bar.style.background = 'var(--green)'; }
    if (status) { status.textContent = '✅ 上传完成'; status.className = 'fu-status done'; }
    listRemoteFiles();
  } else if (msg.error) {
    if (bar) bar.style.background = 'var(--red)';
    if (status) { status.textContent = '❌ ' + msg.error; status.className = 'fu-status error'; }
  }
}

function clearUploaded() {
  var list = document.getElementById('fpUploadList');
  list.querySelectorAll('.fp-upload-item').forEach(function(item) {
    var s = item.querySelector('.fu-status');
    if (s && (s.classList.contains('done') || s.classList.contains('error'))) item.remove();
  });
  if (!list.children.length) document.getElementById('fpUploadSection').style.display = 'none';
}

/* ========== Helpers ========== */
function getFileIcon(name) {
  var ext = name.split('.').pop().toLowerCase();
  var icons = { 'js': '📜', 'ts': '📜', 'py': '🐍', 'sh': '⚙️', 'json': '📋', 'md': '📝', 'txt': '📝', 'zip': '📦', 'tar': '📦', 'gz': '📦', 'jpg': '🖼️', 'png': '🖼️', 'gif': '🖼️', 'mp4': '🎬', 'mp3': '🎵', 'pdf': '📕', 'html': '🌐', 'css': '🎨', 'yml': '⚙️', 'yaml': '⚙️', 'conf': '⚙️', 'cfg': '⚙️', 'log': '📃', 'sql': '🗃️', 'env': '🔒', 'pem': '🔑', 'key': '🔑' };
  return icons[ext] || '📄';
}

function fmtSize(bytes) {
  if (bytes === 0) return '0 B';
  var k = 1024; var sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  var i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function copyCmd(el) {
  var text = el.textContent;
  navigator.clipboard.writeText(text).then(function() {
    var orig = el.textContent;
    el.textContent = '✅ 已复制';
    el.style.color = 'var(--green)';
    setTimeout(function() { el.textContent = orig; el.style.color = ''; }, 1200);
  });
}

function esc(str) { var d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

init();

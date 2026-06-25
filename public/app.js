/* eslint-disable no-var */
var ws = null;
var term = null;
var fitAddon = null;
var searchAddon = null;
var connected = false;
var currentRemotePath = '/home';
var showUploadZone = false;
var cmdLog = [];
var lastFileList = [];
var sessionStart = null;
var sessionTimerId = null;
var termFontSize = 14;
var currentTheme = 'dark';

var THEMES = {
  dark: { background: '#0d1117', foreground: '#c9d1d9', cursor: '#58a6ff', selectionBackground: 'rgba(88,166,255,0.3)' },
  light: { background: '#ffffff', foreground: '#24292f', cursor: '#0969da', selectionBackground: 'rgba(9,105,218,0.25)' },
  dracula: { background: '#282a36', foreground: '#f8f8f2', cursor: '#bd93f9', selectionBackground: 'rgba(189,147,249,0.3)' },
  monokai: { background: '#272822', foreground: '#f8f8f2', cursor: '#a6e22e', selectionBackground: 'rgba(166,226,46,0.25)' },
};

var DEFAULT_SNIPPETS = [
  { name: '查看磁盘', cmd: 'df -h' },
  { name: '查看内存', cmd: 'free -h' },
  { name: '查看进程', cmd: 'top -bn1 | head -20' },
  { name: '查看端口', cmd: 'ss -tlnp || netstat -tlnp' },
  { name: '系统信息', cmd: 'uname -a' },
  { name: '当前目录', cmd: 'pwd && ls -lah' },
  { name: 'Docker 容器', cmd: 'docker ps -a' },
  { name: '日志尾部', cmd: 'tail -n 100 /var/log/syslog 2>/dev/null || journalctl -n 50 --no-pager' },
];

function init() {
  term = new Terminal({
    cursorBlink: true,
    fontSize: termFontSize,
    fontFamily: "'SF Mono','Fira Code',Menlo,monospace",
    theme: THEMES.dark,
    allowProposedApi: true,
  });
  fitAddon = new FitAddon.FitAddon();
  searchAddon = new SearchAddon.SearchAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon.WebLinksAddon());
  term.loadAddon(searchAddon);
  term.open(document.getElementById('terminal'));
  fitAddon.fit();

  var savedTheme = localStorage.getItem('ssh_theme');
  if (savedTheme && THEMES[savedTheme]) applyTheme(savedTheme);

  var savedFont = parseInt(localStorage.getItem('ssh_font_size') || '14', 10);
  if (savedFont >= 10 && savedFont <= 24) {
    termFontSize = savedFont;
    term.options.fontSize = savedFont;
    fitAddon.fit();
  }

  window.addEventListener('resize', onResize);
  document.addEventListener('keydown', onGlobalKeydown);

  renderSavedList();
  renderRecentList();
  renderSnippets();
  setupDragDrop();
  setupCtxMenu();
  setupBgInputs();
  loadBg();
  renderCmdLog();
}

function onResize() {
  fitAddon.fit();
  sendResize();
}

function sendResize() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    var d = fitAddon.proposeDimensions();
    if (d) ws.send(JSON.stringify({ type: 'resize', cols: d.cols, rows: d.rows }));
  }
}

function onGlobalKeydown(e) {
  if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); connect(); }
  if (e.ctrlKey && e.key === 'd') { e.preventDefault(); if (connected) disconnect(); }
  if (e.ctrlKey && e.key === 'l') { e.preventDefault(); clearTerminal(); }
  if (e.ctrlKey && e.key === 'f') { e.preventDefault(); toggleTermSearch(); }
  if (e.ctrlKey && (e.key === '+' || e.key === '=')) { e.preventDefault(); adjustFontSize(1); }
  if (e.ctrlKey && e.key === '-') { e.preventDefault(); adjustFontSize(-1); }
  if (e.key === 'F11') { e.preventDefault(); toggleFullscreen(); }
  if (e.key === 'Escape') {
    closeTermSearch();
    closePreview();
    document.getElementById('shortcutsModal').classList.add('hidden');
    document.getElementById('bgModal').classList.add('hidden');
  }
}

/* ========== Tabs ========== */
function switchTab(t) {
  document.querySelectorAll('.sidebar-tab').forEach(function (x) {
    x.classList.toggle('active', x.dataset.tab === t);
  });
  ['connect', 'saved', 'snippets', 'server', 'log'].forEach(function (name) {
    var el = document.getElementById('tab-' + name);
    if (el) el.classList.toggle('hidden', t !== name);
  });
  if (t === 'server' && connected) refreshServerInfo();
}

function switchAuth(t) {
  document.querySelectorAll('.auth-tab').forEach(function (x) {
    x.classList.toggle('active', x.dataset.auth === t);
  });
  document.getElementById('auth-password').classList.toggle('hidden', t !== 'password');
  document.getElementById('auth-key').classList.toggle('hidden', t !== 'key');
}

/* ========== Theme & Terminal UI ========== */
function applyTheme(name) {
  currentTheme = name;
  term.options.theme = THEMES[name];
  localStorage.setItem('ssh_theme', name);
  document.getElementById('themeBtn').textContent = name === 'light' ? '☀️' : '🌙';
}

function cycleTheme() {
  var keys = Object.keys(THEMES);
  var idx = (keys.indexOf(currentTheme) + 1) % keys.length;
  applyTheme(keys[idx]);
}

function adjustFontSize(delta) {
  termFontSize = Math.min(24, Math.max(10, termFontSize + delta));
  term.options.fontSize = termFontSize;
  localStorage.setItem('ssh_font_size', String(termFontSize));
  fitAddon.fit();
  sendResize();
}

function toggleTermSearch() {
  var bar = document.getElementById('termSearchBar');
  bar.classList.toggle('hidden');
  if (!bar.classList.contains('hidden')) document.getElementById('termSearchInput').focus();
}

function closeTermSearch() {
  document.getElementById('termSearchBar').classList.add('hidden');
  searchAddon.clearDecorations();
}

function findNext() {
  var q = document.getElementById('termSearchInput').value;
  if (q) searchAddon.findNext(q, { caseSensitive: false });
}

function findPrev() {
  var q = document.getElementById('termSearchInput').value;
  if (q) searchAddon.findPrevious(q, { caseSensitive: false });
}

function copyTerminalSelection() {
  var sel = term.getSelection();
  if (sel) navigator.clipboard.writeText(sel);
}

function toggleFullscreen() {
  var area = document.getElementById('terminalArea');
  area.classList.toggle('fullscreen');
  setTimeout(function () { fitAddon.fit(); sendResize(); }, 100);
}

function toggleShortcuts() {
  document.getElementById('shortcutsModal').classList.toggle('hidden');
}

function toggleFilePanel() {
  var panel = document.getElementById('filePanel');
  var btn = document.getElementById('fpShowBtn');
  panel.classList.toggle('collapsed');
  btn.classList.toggle('hidden', !panel.classList.contains('collapsed'));
  setTimeout(function () { fitAddon.fit(); sendResize(); }, 200);
}

/* ========== Background ========== */
function setupBgInputs() {
  var fileInput = document.getElementById('bgFileInput');
  if (fileInput) {
    fileInput.addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (ev) {
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
    opacity.addEventListener('input', function () {
      document.getElementById('bgOpacityVal').textContent = this.value + '%';
    });
  }
}

function toggleBgModal() {
  var modal = document.getElementById('bgModal');
  modal.classList.toggle('hidden');
  if (!modal.classList.contains('hidden')) {
    var saved = localStorage.getItem('ssh_bg_url');
    var op = localStorage.getItem('ssh_bg_opacity') || '15';
    if (saved) document.getElementById('bgUrlInput').value = saved;
    document.getElementById('bgOpacity').value = op;
    document.getElementById('bgOpacityVal').textContent = op + '%';
    updateBgPreview();
  }
}

function loadBg() {
  var url = localStorage.getItem('ssh_bg_url');
  var opacity = localStorage.getItem('ssh_bg_opacity') || '15';
  if (!url) return;
  document.body.style.setProperty('--bg-image', 'url(' + url + ')');
  document.body.classList.add('has-bg');
  document.body.style.setProperty('--bg-opacity', opacity + '%');
  document.body.style.setProperty('--term-bg', 'rgba(13,17,23,' + (1 - opacity / 100 * 0.6) + ')');
}

function applyBg() {
  var url = document.getElementById('bgUrlInput').value.trim();
  var opacity = document.getElementById('bgOpacity').value;
  if (!url) { clearBg(); return; }
  localStorage.setItem('ssh_bg_url', url);
  localStorage.setItem('ssh_bg_opacity', opacity);
  loadBg();
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

/* ========== Command Log ========== */
function addCmdLog(type, cmd, desc) {
  cmdLog.push({
    type: type,
    cmd: cmd,
    desc: desc,
    time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  });
  renderCmdLog();
}

function renderCmdLog() {
  var list = document.getElementById('cmdLogList');
  var count = document.getElementById('logCount');
  if (!list) return;
  if (count) count.textContent = cmdLog.length + ' 条';
  if (cmdLog.length === 0) {
    list.innerHTML = '<div class="cmd-log-empty">暂无操作记录</div>';
    return;
  }
  list.innerHTML = cmdLog.map(function (item) {
    return '<div class="cmd-item cmd-' + item.type + '">' +
      '<span class="cmd-time">' + item.time + '</span>' +
      '<span class="cmd-body">' +
      (item.desc ? '<span class="cmd-desc">' + esc(item.desc) + '</span>' : '') +
      (item.cmd ? '<span class="cmd-cmd" title="点击复制" onclick="copyCmd(this)">' + esc(item.cmd) + '</span>' : '') +
      '</span></div>';
  }).join('');
  list.scrollTop = list.scrollHeight;
}

function clearCmdLog() { cmdLog = []; renderCmdLog(); }

function exportCmdLog() {
  var text = cmdLog.map(function (i) { return '[' + i.time + '] ' + (i.desc || '') + '\n' + (i.cmd || ''); }).join('\n\n');
  downloadText('ssh-cmd-log.txt', text);
}

/* ========== Snippets ========== */
function getSnippets() {
  try {
    var s = JSON.parse(localStorage.getItem('ssh_snippets') || 'null');
    return s && s.length ? s : DEFAULT_SNIPPETS.slice();
  } catch (e) {
    return DEFAULT_SNIPPETS.slice();
  }
}

function saveSnippets(list) {
  localStorage.setItem('ssh_snippets', JSON.stringify(list));
  renderSnippets();
}

function renderSnippets() {
  var list = document.getElementById('snippetList');
  if (!list) return;
  var snippets = getSnippets();
  list.innerHTML = snippets.map(function (s, i) {
    return '<div class="snippet-item">' +
      '<div class="snippet-name">' + esc(s.name) + '</div>' +
      '<div class="snippet-cmd">' + esc(s.cmd) + '</div>' +
      '<div class="snippet-actions">' +
      '<button class="btn btn-ghost btn-sm" onclick="runSnippet(' + i + ')">运行</button>' +
      '<button class="btn btn-ghost btn-sm" onclick="sendSnippet(' + i + ')">发送</button>' +
      '<button class="btn btn-ghost btn-sm" onclick="editSnippet(' + i + ')">编辑</button>' +
      '</div></div>';
  }).join('');
}

function addSnippet() {
  var name = prompt('片段名称:');
  if (!name) return;
  var cmd = prompt('命令:');
  if (!cmd) return;
  var list = getSnippets();
  list.push({ name: name, cmd: cmd });
  saveSnippets(list);
}

function editSnippet(i) {
  var list = getSnippets();
  var s = list[i];
  if (!s) return;
  var name = prompt('片段名称:', s.name);
  if (!name) return;
  var cmd = prompt('命令:', s.cmd);
  if (!cmd) return;
  list[i] = { name: name, cmd: cmd };
  saveSnippets(list);
}

function resetSnippets() {
  if (confirm('恢复默认命令片段？')) saveSnippets(DEFAULT_SNIPPETS.slice());
}

function sendSnippet(i) {
  var s = getSnippets()[i];
  if (!s || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'input', data: s.cmd + '\n' }));
  addCmdLog('connect', s.cmd, '发送片段: ' + s.name);
}

function runSnippet(i) {
  var s = getSnippets()[i];
  if (!s) return;
  if (!connected || !ws) { alert('请先连接服务器'); return; }
  ws.send(JSON.stringify({ type: 'exec', id: 'snippet-' + i, command: s.cmd }));
  addCmdLog('connect', s.cmd, '执行片段: ' + s.name);
}

/* ========== Server Info ========== */
function refreshServerInfo() {
  if (!connected || !ws) return;
  var box = document.getElementById('serverInfo');
  box.innerHTML = '<div class="server-loading">加载中...</div>';
  ws.send(JSON.stringify({ type: 'server-info', id: 'info' }));
}

function renderServerInfo(info) {
  var box = document.getElementById('serverInfo');
  if (!info) return;
  box.innerHTML =
    '<div class="si-card"><span class="si-label">主机</span><span class="si-value">' + esc(info.host || '-') + '</span></div>' +
    '<div class="si-card"><span class="si-label">系统</span><span class="si-value">' + esc(info.os || '-') + '</span></div>' +
    '<div class="si-card"><span class="si-label">运行时间</span><span class="si-value">' + esc(info.uptime || '-') + '</span></div>' +
    '<div class="si-card"><span class="si-label">CPU 核心</span><span class="si-value">' + esc(info.cpu || '-') + '</span></div>' +
    '<div class="si-card"><span class="si-label">内存</span><span class="si-value mono">' + esc(info.mem || '-') + '</span></div>' +
    '<div class="si-card"><span class="si-label">磁盘 /</span><span class="si-value mono">' + esc(info.disk || '-') + '</span></div>' +
    '<div class="si-card"><span class="si-label">负载</span><span class="si-value mono">' + esc(info.load || '-') + '</span></div>';
}

/* ========== Session Timer ========== */
function startSessionTimer() {
  sessionStart = Date.now();
  var el = document.getElementById('sessionTimer');
  el.classList.remove('hidden');
  if (sessionTimerId) clearInterval(sessionTimerId);
  sessionTimerId = setInterval(function () {
    var sec = Math.floor((Date.now() - sessionStart) / 1000);
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    el.textContent = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }, 1000);
}

function stopSessionTimer() {
  if (sessionTimerId) clearInterval(sessionTimerId);
  sessionTimerId = null;
  sessionStart = null;
  document.getElementById('sessionTimer').classList.add('hidden');
}

/* ========== Connection ========== */
function connect(cfg) {
  if (ws) ws.close();
  var host = (cfg && cfg.host) || document.getElementById('host').value.trim();
  var port = parseInt((cfg && cfg.port) || document.getElementById('port').value, 10) || 22;
  var username = (cfg && cfg.username) || document.getElementById('username').value.trim();
  var password = (cfg && cfg.password) || document.getElementById('password').value;
  var privateKey = (cfg && cfg.privateKey) || document.getElementById('privateKey').value.trim();
  var passphrase = (cfg && cfg.passphrase) || document.getElementById('passphrase').value;
  if (!host || !username) { alert('请输入主机地址和用户名'); return; }

  addRecent({ host: host, port: port, username: username });
  addCmdLog('connect', 'ssh ' + username + '@' + host + ' -p ' + port, '连接 ' + username + '@' + host + ':' + port);

  var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(protocol + '//' + location.host);
  ws.onopen = function () {
    ws.send(JSON.stringify({
      type: 'connect', host: host, port: port, username: username,
      password: password, privateKey: privateKey, passphrase: passphrase,
    }));
  };
  ws.onmessage = onWsMessage;
  ws.onerror = function () { term.write('\r\n\x1b[31mWebSocket 连接失败\x1b[0m\r\n'); };
  ws.onclose = function () {
    connected = false;
    updateStatus(false);
    document.getElementById('btnDisconnect').classList.add('hidden');
    stopSessionTimer();
  };
  term.onData(function (d) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data: d }));
  });
}

function onWsMessage(ev) {
  var msg = JSON.parse(ev.data);
  if (msg.type === 'connected') {
    connected = true;
    updateStatus(true);
    document.getElementById('btnDisconnect').classList.remove('hidden');
    var host = document.getElementById('host').value.trim();
    var port = document.getElementById('port').value;
    var user = document.getElementById('username').value.trim();
    document.getElementById('connInfo').textContent = user + '@' + host + ':' + port;
    startSessionTimer();
    term.focus();
    listRemoteFiles();
  } else if (msg.type === 'home-dir' && msg.path) {
    currentRemotePath = msg.path;
    document.getElementById('remotePath').value = msg.path;
  } else if (msg.type === 'data') {
    term.write(msg.data);
  } else if (msg.type === 'error') {
    term.write('\r\n\x1b[31m' + msg.data + '\x1b[0m\r\n');
  } else if (msg.type === 'disconnected') {
    connected = false;
    updateStatus(false);
    document.getElementById('btnDisconnect').classList.add('hidden');
    document.getElementById('connInfo').textContent = '已断开';
    document.getElementById('fpFileList').innerHTML = '<div class="fp-empty"><div class="empty-icon">🔌</div><div>连接已断开</div></div>';
    stopSessionTimer();
  } else if (msg.type === 'sftp-list-result') {
    renderRemoteFiles(msg);
  } else if (msg.type === 'sftp-upload-result') {
    onUploadResult(msg);
  } else if (msg.type === 'sftp-mkdir-result') {
    if (msg.error) alert('创建失败: ' + msg.error); else listRemoteFiles();
  } else if (msg.type === 'sftp-rename-result') {
    if (msg.error) alert('重命名失败: ' + msg.error); else listRemoteFiles();
  } else if (msg.type === 'sftp-rm-result') {
    if (msg.error) alert('删除失败: ' + msg.error); else listRemoteFiles();
  } else if (msg.type === 'sftp-download-result') {
    onDownloadResult(msg);
  } else if (msg.type === 'sftp-preview-result') {
    onPreviewResult(msg);
  } else if (msg.type === 'server-info-result') {
    if (msg.error) {
      document.getElementById('serverInfo').innerHTML = '<div class="fp-empty"><div>' + esc(msg.error) + '</div></div>';
    } else {
      renderServerInfo(msg.info);
    }
  } else if (msg.type === 'exec-result') {
    if (msg.error) term.write('\r\n\x1b[31m' + msg.error + '\x1b[0m\r\n');
    else if (msg.output) term.write('\r\n' + msg.output + '\r\n');
  }
}

function disconnect() {
  if (ws) { ws.send(JSON.stringify({ type: 'disconnect' })); ws.close(); ws = null; }
  connected = false;
  updateStatus(false);
  document.getElementById('btnDisconnect').classList.add('hidden');
  document.getElementById('connInfo').textContent = '未连接';
  stopSessionTimer();
  addCmdLog('connect', 'exit', '断开连接');
}

function updateStatus(on) {
  document.getElementById('statusDot').classList.toggle('connected', on);
  document.getElementById('statusText').textContent = on ? '已连接' : '未连接';
}

function clearTerminal() { term.clear(); }

/* ========== Recent ========== */
function getRecent() {
  try { return JSON.parse(localStorage.getItem('ssh_recent') || '[]'); } catch (e) { return []; }
}

function addRecent(c) {
  var list = getRecent().filter(function (x) {
    return !(x.host === c.host && x.port === c.port && x.username === c.username);
  });
  list.unshift({ host: c.host, port: c.port, username: c.username, time: Date.now() });
  localStorage.setItem('ssh_recent', JSON.stringify(list.slice(0, 8)));
  renderRecentList();
}

function renderRecentList() {
  var el = document.getElementById('recentList');
  if (!el) return;
  var list = getRecent();
  if (!list.length) { el.innerHTML = ''; return; }
  el.innerHTML = '<div class="recent-title">最近连接</div>' + list.map(function (r) {
    return '<div class="recent-item" onclick="fillAndConnect(\'' + escAttr(r.host) + '\',' + r.port + ',\'' + escAttr(r.username) + '\')">' +
      esc(r.username) + '@' + esc(r.host) + ':' + r.port + '</div>';
  }).join('');
}

function fillAndConnect(host, port, username) {
  document.getElementById('host').value = host;
  document.getElementById('port').value = port;
  document.getElementById('username').value = username;
  connect();
}

/* ========== Saved Connections ========== */
function getSavedConnections() {
  try { return JSON.parse(localStorage.getItem('ssh_connections') || '[]'); } catch (e) { return []; }
}

function saveConnection() {
  var host = document.getElementById('host').value.trim();
  var port = parseInt(document.getElementById('port').value, 10) || 22;
  var username = document.getElementById('username').value.trim();
  var password = document.getElementById('password').value;
  var privateKey = document.getElementById('privateKey').value.trim();
  var passphrase = document.getElementById('passphrase').value;
  if (!host || !username) { alert('请至少填写主机地址和用户名'); return; }
  var name = prompt('连接名称:', username + '@' + host);
  if (!name) return;
  var conns = getSavedConnections();
  conns.push({ id: Date.now(), name: name, host: host, port: port, username: username, password: password, privateKey: privateKey, passphrase: passphrase });
  localStorage.setItem('ssh_connections', JSON.stringify(conns));
  renderSavedList();
  switchTab('saved');
}

function renderSavedList() {
  var conns = getSavedConnections();
  var list = document.getElementById('savedList');
  var empty = document.getElementById('savedEmpty');
  if (conns.length === 0) { list.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  list.innerHTML = conns.map(function (c) {
    return '<div class="saved-item" onclick="quickConnect(' + c.id + ')">' +
      '<div class="si-name">' + esc(c.name) + '</div>' +
      '<div class="si-info">' + esc(c.username) + '@' + esc(c.host) + ':' + c.port + '</div>' +
      '<button class="si-edit-btn" onclick="event.stopPropagation();editConnection(' + c.id + ')" title="编辑">✎</button>' +
      '<button class="si-del-btn" onclick="event.stopPropagation();deleteConnection(' + c.id + ')" title="删除">✕</button>' +
      '<button class="si-conn-btn" onclick="event.stopPropagation();quickConnect(' + c.id + ')">连接</button></div>';
  }).join('');
}

function quickConnect(id) {
  var c = getSavedConnections().find(function (x) { return x.id === id; });
  if (!c) return;
  document.getElementById('host').value = c.host;
  document.getElementById('port').value = c.port;
  document.getElementById('username').value = c.username;
  document.getElementById('password').value = c.password || '';
  document.getElementById('privateKey').value = c.privateKey || '';
  document.getElementById('passphrase').value = c.passphrase || '';
  switchAuth(c.privateKey ? 'key' : 'password');
  switchTab('connect');
  connect(c);
}

function editConnection(id) {
  var conns = getSavedConnections();
  var c = conns.find(function (x) { return x.id === id; });
  if (!c) return;
  var name = prompt('连接名称:', c.name);
  if (!name) return;
  c.name = name;
  c.host = prompt('主机:', c.host) || c.host;
  c.port = parseInt(prompt('端口:', c.port), 10) || c.port;
  c.username = prompt('用户名:', c.username) || c.username;
  localStorage.setItem('ssh_connections', JSON.stringify(conns));
  renderSavedList();
}

function deleteConnection(id) {
  var c = getSavedConnections().filter(function (x) { return x.id !== id; });
  localStorage.setItem('ssh_connections', JSON.stringify(c));
  renderSavedList();
}

function exportConnections() {
  downloadText('ssh-connections.json', JSON.stringify(getSavedConnections(), null, 2));
}

function importConnections() {
  var input = document.getElementById('importFile');
  input.onchange = function () {
    var file = input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (!Array.isArray(data)) throw new Error('invalid');
        var merged = getSavedConnections().concat(data.map(function (c) {
          return Object.assign({}, c, { id: c.id || Date.now() + Math.random() });
        }));
        localStorage.setItem('ssh_connections', JSON.stringify(merged));
        renderSavedList();
        alert('已导入 ' + data.length + ' 条连接');
      } catch (e) {
        alert('导入失败: 文件格式错误');
      }
      input.value = '';
    };
    reader.readAsText(file);
  };
  input.click();
}

/* ========== Remote Files ========== */
function listRemoteFiles() {
  if (!connected || !ws) return;
  var p = document.getElementById('remotePath').value.trim() || '/home';
  currentRemotePath = p;
  ws.send(JSON.stringify({ type: 'sftp-list', id: 'list', path: p }));
}

function renderRemoteFiles(msg) {
  if (msg.error) {
    document.getElementById('fpFileList').innerHTML = '<div class="fp-empty"><div class="empty-icon">⚠️</div><div>' + esc(msg.error) + '</div></div>';
    document.getElementById('fpStatus').textContent = '错误';
    return;
  }
  currentRemotePath = msg.path;
  document.getElementById('remotePath').value = msg.path;
  lastFileList = msg.files || [];
  renderBreadcrumb(msg.path);
  var utp = document.getElementById('uploadTargetPath');
  if (utp) utp.textContent = msg.path;
  renderFilteredFiles();
}

function renderBreadcrumb(path) {
  var el = document.getElementById('fpBreadcrumb');
  if (!el) return;
  var parts = path.split('/').filter(Boolean);
  var html = '<span class="bc-item" onclick="cdRemote(\'/\')">/</span>';
  var acc = '';
  parts.forEach(function (p) {
    acc += '/' + p;
    var ap = acc;
    html += '<span class="bc-sep">/</span><span class="bc-item" onclick="cdRemote(\'' + escAttr(ap) + '\')">' + esc(p) + '</span>';
  });
  el.innerHTML = html;
}

function renderFilteredFiles() {
  var list = document.getElementById('fpFileList');
  var status = document.getElementById('fpStatus');
  var filter = (document.getElementById('fileFilter').value || '').toLowerCase();
  var sortBy = document.getElementById('fileSort').value;
  var showHidden = document.getElementById('showHidden').checked;

  var files = lastFileList.filter(function (f) {
    if (!showHidden && f.filename.startsWith('.')) return false;
    if (filter && f.filename.toLowerCase().indexOf(filter) === -1) return false;
    return true;
  });

  files.sort(function (a, b) {
    if (a.isDir !== b.isDir) return b.isDir ? 1 : -1;
    if (sortBy === 'size') return (b.size || 0) - (a.size || 0);
    if (sortBy === 'mtime') return (b.mtime || 0) - (a.mtime || 0);
    return a.filename.localeCompare(b.filename);
  });

  if (status) status.textContent = files.length + ' 项';

  if (!files.length) {
    list.innerHTML = '<div class="fp-empty"><div class="empty-icon">📂</div><div>空目录或无匹配</div></div>';
    return;
  }

  list.innerHTML = files.map(function (f) {
    var icon = f.isDir ? '📁' : getFileIcon(f.filename);
    var size = f.isDir ? '' : fmtSize(f.size);
    var mtime = f.mtime ? fmtTime(f.mtime) : '';
    var fullPath = (currentRemotePath + '/' + f.filename).replace(/\/+/g, '/');
    var ep = escAttr(fullPath);
    var dirClass = f.isDir ? ' is-dir' : '';
    var onclick = f.isDir
      ? 'ondblclick="cdRemote(\'' + ep + '\')" onclick="selectFile(this)"'
      : 'onclick="selectFile(this)"';
    var perm = f.perm ? '<span class="ff-perm" title="' + esc(f.perm) + '">' + esc((f.perm || '').split(' ')[1] || '') + '</span>' : '';
    var actions = f.isDir
      ? '<span class="ff-actions"><button class="danger" onclick="event.stopPropagation();deleteRemote(\'' + ep + '\')" title="删除">🗑️</button></span>'
      : '<span class="ff-actions">' +
        '<button onclick="event.stopPropagation();previewFile(\'' + ep + '\')" title="预览">👁️</button>' +
        '<button onclick="event.stopPropagation();downloadFile(\'' + ep + '\')" title="下载">⬇️</button>' +
        '<button onclick="event.stopPropagation();renameRemote(\'' + ep + '\',\'' + escAttr(f.filename) + '\')" title="重命名">✎</button>' +
        '<button class="danger" onclick="event.stopPropagation();deleteRemote(\'' + ep + '\')" title="删除">🗑️</button></span>';
    return '<div class="fp-file-row' + dirClass + '" ' + onclick + ' oncontextmenu="showCtxMenu(event,\'' + ep + '\',' + f.isDir + ');return false;">' +
      '<span class="ff-icon">' + icon + '</span>' +
      '<span class="ff-name" title="' + esc(f.filename) + '">' + esc(f.filename) + '</span>' +
      perm +
      '<span class="ff-meta">' + size + (mtime ? ' · ' + mtime : '') + '</span>' +
      actions + '</div>';
  }).join('');
}

function filterFileList() { renderFilteredFiles(); }

function cdRemote(path) {
  document.getElementById('remotePath').value = path.replace(/\/+/g, '/');
  addCmdLog('nav', 'cd ' + path, '进入 ' + path);
  listRemoteFiles();
}

function goParent() {
  var p = document.getElementById('remotePath').value.trim() || '/';
  var parts = p.replace(/\/+$/, '').split('/');
  if (parts.length > 1) parts.pop();
  cdRemote(parts.join('/') || '/');
}

function createRemoteDir() {
  if (!connected || !ws) { alert('请先连接'); return; }
  var name = prompt('文件夹名称:');
  if (!name || !name.trim()) return;
  var fullPath = (currentRemotePath + '/' + name.trim()).replace(/\/+/g, '/');
  addCmdLog('mkdir', 'mkdir -p ' + fullPath, '创建目录 ' + fullPath);
  ws.send(JSON.stringify({ type: 'sftp-mkdir', path: fullPath }));
}

function createRemoteFile() {
  if (!connected || !ws) { alert('请先连接'); return; }
  var name = prompt('文件名:');
  if (!name || !name.trim()) return;
  var fullPath = (currentRemotePath + '/' + name.trim()).replace(/\/+/g, '/');
  addCmdLog('upload', 'touch ' + fullPath, '创建文件 ' + fullPath);
  ws.send(JSON.stringify({ type: 'sftp-upload', id: 'new-' + Date.now(), filename: name.trim(), remotePath: currentRemotePath, data: btoa('') }));
}

function renameRemote(path, oldName) {
  var newName = prompt('新名称:', oldName);
  if (!newName || newName === oldName) return;
  var parent = path.substring(0, path.lastIndexOf('/')) || '/';
  var newPath = (parent + '/' + newName).replace(/\/+/g, '/');
  addCmdLog('nav', 'mv ' + path + ' ' + newPath, '重命名');
  ws.send(JSON.stringify({ type: 'sftp-rename', from: path, to: newPath }));
}

function selectFile(el) {
  document.querySelectorAll('.fp-file-row.selected').forEach(function (r) { r.classList.remove('selected'); });
  el.classList.add('selected');
}

function previewFile(path) {
  if (!connected || !ws) return;
  document.getElementById('previewTitle').textContent = '加载中...';
  document.getElementById('previewContent').textContent = '';
  document.getElementById('previewModal').classList.remove('hidden');
  ws.send(JSON.stringify({ type: 'sftp-preview', id: 'preview', path: path }));
}

function onPreviewResult(msg) {
  if (msg.error) {
    document.getElementById('previewTitle').textContent = '预览失败';
    document.getElementById('previewContent').textContent = msg.error;
    return;
  }
  document.getElementById('previewTitle').textContent = msg.path + ' (' + fmtSize(msg.size) + ')';
  if (msg.binary) {
    document.getElementById('previewContent').textContent = '二进制文件，请下载后查看';
  } else {
    document.getElementById('previewContent').textContent = msg.content || '';
  }
}

function closePreview() {
  document.getElementById('previewModal').classList.add('hidden');
}

/* ========== Context Menu ========== */
function showCtxMenu(e, path, isDir) {
  e.preventDefault();
  var menu = document.getElementById('ctxMenu');
  var ep = escAttr(path);
  var name = path.split('/').pop();
  menu.innerHTML = '';
  if (isDir) {
    menu.innerHTML += '<div class="ctx-item" onclick="cdRemote(\'' + ep + '\')">📂 进入</div><div class="ctx-sep"></div>';
  } else {
    menu.innerHTML += '<div class="ctx-item" onclick="previewFile(\'' + ep + '\')">👁️ 预览</div>';
    menu.innerHTML += '<div class="ctx-item" onclick="downloadFile(\'' + ep + '\')">⬇️ 下载</div>';
    menu.innerHTML += '<div class="ctx-item" onclick="renameRemote(\'' + ep + '\',\'' + escAttr(name) + '\')">✎ 重命名</div><div class="ctx-sep"></div>';
  }
  menu.innerHTML += '<div class="ctx-item" onclick="navigator.clipboard.writeText(\'' + ep + '\')">📋 复制路径</div>';
  menu.innerHTML += '<div class="ctx-sep"></div><div class="ctx-item danger" onclick="deleteRemote(\'' + ep + '\')">🗑️ 删除</div>';
  menu.classList.remove('hidden');
  menu.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px';
  menu.style.top = Math.min(e.clientY, window.innerHeight - 200) + 'px';
}

function setupCtxMenu() {
  document.addEventListener('click', function () { document.getElementById('ctxMenu').classList.add('hidden'); });
}

function downloadFile(path) {
  document.getElementById('ctxMenu').classList.add('hidden');
  if (!connected || !ws) return;
  addCmdLog('download', 'scp user@host:' + path + ' ./', '下载 ' + path);
  ws.send(JSON.stringify({ type: 'sftp-download', id: 'dl-' + Date.now(), remotePath: path }));
}

function deleteRemote(path) {
  document.getElementById('ctxMenu').classList.add('hidden');
  if (!confirm('确定删除 "' + path + '"？')) return;
  if (!connected || !ws) return;
  addCmdLog('delete', 'rm -rf ' + path, '删除 ' + path);
  ws.send(JSON.stringify({ type: 'sftp-rm', path: path }));
}

function onDownloadResult(msg) {
  if (msg.done && msg.data) {
    var bytes = Uint8Array.from(atob(msg.data), function (c) { return c.charCodeAt(0); });
    var blob = new Blob([bytes]);
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = msg.filename || 'download';
    a.click();
    URL.revokeObjectURL(url);
  } else if (msg.error) alert('下载失败: ' + msg.error);
}

/* ========== Upload ========== */
function toggleUploadZone() {
  showUploadZone = !showUploadZone;
  document.getElementById('uploadZoneWrap').classList.toggle('hidden', !showUploadZone);
  if (showUploadZone) document.getElementById('uploadTargetPath').textContent = currentRemotePath;
}

function setupDragDrop() {
  var zone = document.getElementById('uploadZone');
  var input = document.getElementById('fileInput');
  zone.addEventListener('dragover', function (e) { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', function () { zone.classList.remove('drag-over'); });
  zone.addEventListener('drop', function (e) {
    e.preventDefault();
    zone.classList.remove('drag-over');
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });
  input.addEventListener('change', function () {
    if (input.files.length) { handleFiles(input.files); input.value = ''; }
  });
}

function handleFiles(files) {
  if (!connected || !ws) { alert('请先连接'); return; }
  document.getElementById('fpUploadSection').classList.remove('hidden');
  Array.from(files).forEach(function (f) { uploadFile(f, currentRemotePath); });
}

function uploadFile(file, remotePath) {
  var fileId = 'file-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  var list = document.getElementById('fpUploadList');
  var div = document.createElement('div');
  div.className = 'fp-upload-item';
  div.id = fileId;
  div.innerHTML = '<div class="fu-name">📄 ' + esc(file.name) + ' <span class="dim">(' + fmtSize(file.size) + ')</span></div>' +
    '<div class="fu-progress"><div class="fu-progress-bar" id="' + fileId + '-bar"></div></div>' +
    '<div class="fu-status" id="' + fileId + '-status">⏳ 等待...</div>';
  list.prepend(div);
  addCmdLog('upload', 'scp "' + file.name + '" user@host:' + remotePath, '上传 ' + file.name);
  var reader = new FileReader();
  reader.onload = function () {
    var base64 = reader.result.split(',')[1];
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'sftp-upload', id: fileId, filename: file.name, remotePath: remotePath, data: base64 }));
      var s = document.getElementById(fileId + '-status');
      if (s) s.textContent = '⬆️ 上传中...';
    }
    var bar = document.getElementById(fileId + '-bar');
    if (bar) bar.style.width = '30%';
  };
  reader.readAsDataURL(file);
}

function onUploadResult(msg) {
  var bar = document.getElementById(msg.id + '-bar');
  var status = document.getElementById(msg.id + '-status');
  if (msg.done) {
    if (bar) { bar.style.width = '100%'; bar.style.background = 'var(--green)'; }
    if (status) { status.textContent = '✅ 完成'; status.className = 'fu-status done'; }
    listRemoteFiles();
  } else if (msg.error) {
    if (bar) bar.style.background = 'var(--red)';
    if (status) { status.textContent = '❌ ' + msg.error; status.className = 'fu-status error'; }
  }
}

function clearUploaded() {
  var list = document.getElementById('fpUploadList');
  list.querySelectorAll('.fp-upload-item').forEach(function (item) {
    var s = item.querySelector('.fu-status');
    if (s && (s.classList.contains('done') || s.classList.contains('error'))) item.remove();
  });
  if (!list.children.length) document.getElementById('fpUploadSection').classList.add('hidden');
}

/* ========== Helpers ========== */
function getFileIcon(name) {
  var ext = name.split('.').pop().toLowerCase();
  var icons = { js: '📜', ts: '📜', py: '🐍', sh: '⚙️', json: '📋', md: '📝', txt: '📝', zip: '📦', tar: '📦', gz: '📦', jpg: '🖼️', png: '🖼️', gif: '🖼️', mp4: '🎬', mp3: '🎵', pdf: '📕', html: '🌐', css: '🎨', yml: '⚙️', yaml: '⚙️', conf: '⚙️', log: '📃', sql: '🗃️', env: '🔒', pem: '🔑', key: '🔑' };
  return icons[ext] || '📄';
}

function fmtSize(bytes) {
  if (!bytes) return '0 B';
  var k = 1024;
  var sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  var i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function fmtTime(ts) {
  var d = new Date(ts);
  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
}

function copyCmd(el) {
  navigator.clipboard.writeText(el.textContent).then(function () {
    var orig = el.textContent;
    el.textContent = '✅ 已复制';
    setTimeout(function () { el.textContent = orig; }, 1200);
  });
}

function downloadText(filename, text) {
  var blob = new Blob([text], { type: 'text/plain' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function esc(str) { var d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
function escAttr(str) { return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

init();

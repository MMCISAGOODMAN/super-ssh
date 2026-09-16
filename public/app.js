/* eslint-disable no-var */
var ws = null;
var sessions = {};
var activeSessionId = null;
var cmdLog = [];
var showUploadZone = false;
var sessionTimerId = null;
var termFontSize = 14;
var currentTheme = 'dark';
var editorPath = null;
var editorDirty = false;
var editorReadonly = false;
var CHUNK_SIZE = 256 * 1024;
var SMALL_UPLOAD = 1024 * 1024;
var MAX_SESSIONS = 8;

/* ========== Line icons (SVG) ========== */
var ICONS = {
  bolt: '<path d="M13 2L3 14h8l-1 8 10-12h-8z"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
  moon: '<path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="1.5"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>',
  upload: '<path d="M12 16V5M8 9l4-4 4 4"/><path d="M4 19h16"/>',
  download: '<path d="M12 5v11M8 12l4 4 4-4"/><path d="M4 19h16"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  plug: '<path d="M12 22v-6M9 8V2M15 8V2M9 8h6v5a3 3 0 0 1-6 0V8z"/>',
  server: '<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01"/>',
  warn: '<path d="M12 3l10 18H2L12 3z"/><path d="M12 10v4M12 17h.01"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  archive: '<path d="M3 7h18v2H3zM5 9v11h14V9M10 13h4"/>',
  filePlus: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M12 18v-6M9 15h6"/>',
  folderPlus: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/><path d="M12 11v6M9 14h6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l1.42-1.42a5 5 0 0 0-7.07-7.07L10.5 6.4"/><path d="M14 11a5 5 0 0 0-7.54-.54L5.04 11.88a5 5 0 0 0 7.07 7.07L13.5 17.6"/>',
  bookmark: '<path d="M7 3h10a2 2 0 0 1 2 2v16l-7-4-7 4V5a2 2 0 0 1 2-2z"/>',
  snippet: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4"/>',
  spark: '<path d="M12 3l1.5 6.5L20 11l-6.5 1.5L12 19l-1.5-6.5L4 11l6.5-1.5L12 3z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  more: '<circle cx="6" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
};

function icon(name, extraClass) {
  var paths = ICONS[name];
  if (!paths) return '';
  var cls = 'icon icon-' + name + (extraClass ? ' ' + extraClass : '');
  return '<span class="' + cls + '" aria-hidden="true">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' +
    paths + '</svg></span>';
}

function hydrateIcons(root) {
  var scope = root || document;
  var nodes = scope.querySelectorAll('[data-icon]');
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    var name = el.getAttribute('data-icon');
    var extra = el.getAttribute('data-icon-class') || '';
    var html = icon(name, extra);
    if (!html) continue;
    var wrap = document.createElement('span');
    wrap.innerHTML = html;
    var node = wrap.firstChild;
    if (el.tagName === 'SPAN' || el.tagName === 'DIV') {
      el.className = (el.className + ' ' + (node.className || '')).trim();
      el.removeAttribute('data-icon');
      el.removeAttribute('data-icon-class');
      el.setAttribute('aria-hidden', 'true');
      el.innerHTML = node.innerHTML;
    } else {
      el.replaceWith(node);
    }
  }
}

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

function genSessionId() {
  return 's-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function getActive() {
  return activeSessionId ? sessions[activeSessionId] : null;
}

function isActiveConnected() {
  var s = getActive();
  return !!(s && s.connected);
}

function wsSend(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function ensureWs() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return Promise.resolve(ws);
  }
  return new Promise(function (resolve, reject) {
    var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(protocol + '//' + location.host);
    ws.onmessage = onWsMessage;
    ws.onerror = function () {
      reject(new Error('WebSocket 连接失败'));
    };
    ws.onclose = function () {
      Object.keys(sessions).forEach(function (id) {
        if (sessions[id]) sessions[id].connected = false;
      });
      syncActiveChrome();
    };
    ws.onopen = function () { resolve(ws); };
  });
}

function createTerminalSession(id, label) {
  var host = document.getElementById('terminalHost');
  var pane = document.createElement('div');
  pane.className = 'term-pane';
  pane.id = 'term-' + id;
  host.appendChild(pane);

  var term = new Terminal({
    cursorBlink: true,
    fontSize: termFontSize,
    fontFamily: "'SF Mono','Fira Code',Menlo,monospace",
    theme: THEMES[currentTheme] || THEMES.dark,
    allowProposedApi: true,
  });
  var fitAddon = new FitAddon.FitAddon();
  var searchAddon = new SearchAddon.SearchAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon.WebLinksAddon());
  term.loadAddon(searchAddon);
  term.open(pane);
  fitAddon.fit();

  term.onData(function (d) {
    if (sessions[id] && sessions[id].connected) {
      wsSend({ type: 'input', sessionId: id, data: d });
    }
  });

  sessions[id] = {
    id: id,
    label: label || '新会话',
    term: term,
    fitAddon: fitAddon,
    searchAddon: searchAddon,
    pane: pane,
    connected: false,
    host: '',
    port: 22,
    username: '',
    path: '/home',
    lastFileList: [],
    startedAt: null,
  };
  return sessions[id];
}

function destroySession(id) {
  var s = sessions[id];
  if (!s) return;
  try { s.term.dispose(); } catch (e) { /* ignore */ }
  if (s.pane && s.pane.parentNode) s.pane.parentNode.removeChild(s.pane);
  delete sessions[id];
}

function renderSessionTabs() {
  var list = document.getElementById('sessionTabsList');
  if (!list) return;
  var ids = Object.keys(sessions);
  if (!ids.length) {
    list.innerHTML = '<div class="session-tab" style="cursor:default;color:var(--text-dim)">点击 + 或连接服务器</div>';
    return;
  }
  list.innerHTML = ids.map(function (id) {
    var s = sessions[id];
    var label = s.connected
      ? (s.username + '@' + s.host)
      : (s.label || '连接中…');
    var active = id === activeSessionId ? ' active' : '';
    return '<div class="session-tab' + active + '" onclick="switchSession(\'' + id + '\')">' +
      '<span class="session-tab-label" title="' + esc(label) + '">' + esc(label) + '</span>' +
      '<button class="session-tab-close" onclick="event.stopPropagation();closeSessionTab(\'' + id + '\')" title="关闭">✕</button>' +
      '</div>';
  }).join('');
}

function switchSession(id) {
  if (!sessions[id]) return;
  activeSessionId = id;
  Object.keys(sessions).forEach(function (sid) {
    sessions[sid].pane.classList.toggle('active', sid === id);
  });
  renderSessionTabs();
  syncActiveChrome();
  var s = sessions[id];
  setTimeout(function () {
    s.fitAddon.fit();
    sendResize();
    s.term.focus();
  }, 50);
  if (s.connected) {
    document.getElementById('remotePath').value = s.path || '/home';
    lastFileListForActive();
    listRemoteFiles();
  }
}

function lastFileListForActive() {
  var s = getActive();
  if (!s) return;
  if (s.lastFileList && s.lastFileList.length) {
    renderRemoteFiles({ path: s.path, files: s.lastFileList });
  }
}

function newSessionTab() {
  if (Object.keys(sessions).length >= MAX_SESSIONS) {
    alert('最多同时 ' + MAX_SESSIONS + ' 个会话');
    return;
  }
  switchTab('connect');
  document.getElementById('host').focus();
}

function closeSessionTab(id) {
  var s = sessions[id];
  if (!s) return;
  if (s.connected) {
    wsSend({ type: 'disconnect', sessionId: id });
  }
  destroySession(id);
  var ids = Object.keys(sessions);
  if (activeSessionId === id) {
    activeSessionId = ids[0] || null;
    if (activeSessionId) switchSession(activeSessionId);
    else {
      renderSessionTabs();
      syncActiveChrome();
      document.getElementById('fpFileList').innerHTML =
        '<div class="fp-empty"><div class="empty-icon">' + icon('plug') + '</div><div>连接服务器后浏览文件</div></div>';
    }
  } else {
    renderSessionTabs();
  }
}

function syncActiveChrome() {
  var s = getActive();
  var on = !!(s && s.connected);
  document.getElementById('statusDot').classList.toggle('connected', on);
  document.getElementById('statusText').textContent = on ? '已连接' : '未连接';
  document.getElementById('btnDisconnect').classList.toggle('hidden', !on);
  if (s && s.connected) {
    document.getElementById('connInfo').textContent = s.username + '@' + s.host + ':' + s.port;
  } else if (s) {
    document.getElementById('connInfo').textContent = s.label || '未连接';
  } else {
    document.getElementById('connInfo').textContent = '未连接';
  }
  updateSessionTimerDisplay();
}

function updateSessionTimerDisplay() {
  var el = document.getElementById('sessionTimer');
  var s = getActive();
  if (!s || !s.connected || !s.startedAt) {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  var sec = Math.floor((Date.now() - s.startedAt) / 1000);
  var m = Math.floor(sec / 60);
  var ss = sec % 60;
  el.textContent = (m < 10 ? '0' : '') + m + ':' + (ss < 10 ? '0' : '') + ss;
}

function init() {
  var savedTheme = localStorage.getItem('ssh_theme');
  if (savedTheme && THEMES[savedTheme]) currentTheme = savedTheme;

  var savedFont = parseInt(localStorage.getItem('ssh_font_size') || '14', 10);
  if (savedFont >= 10 && savedFont <= 24) termFontSize = savedFont;

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
  renderSessionTabs();
  syncActiveChrome();
  applyTheme(currentTheme);
  hydrateIcons();
  restoreLayoutWidths();
  setupSplitters();
  setupTermMore();
  syncFilePanelForConnection(false);

  if (sessionTimerId) clearInterval(sessionTimerId);
  sessionTimerId = setInterval(updateSessionTimerDisplay, 1000);

  var editor = document.getElementById('editorContent');
  if (editor) {
    editor.addEventListener('input', function () {
      if (editorReadonly) return;
      editorDirty = true;
      setEditorStatus('未保存的更改', 'dirty');
    });
  }
}

function onResize() {
  Object.keys(sessions).forEach(function (id) {
    try { sessions[id].fitAddon.fit(); } catch (e) { /* ignore */ }
  });
  sendResize();
}

function sendResize() {
  var s = getActive();
  if (!s || !ws || ws.readyState !== WebSocket.OPEN) return;
  var d = s.fitAddon.proposeDimensions();
  if (d) wsSend({ type: 'resize', sessionId: s.id, cols: d.cols, rows: d.rows });
}

function onGlobalKeydown(e) {
  if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); connect(); }
  if (e.ctrlKey && e.key === 'd') { e.preventDefault(); if (isActiveConnected()) disconnect(); }
  if (e.ctrlKey && e.key === 'l') { e.preventDefault(); clearTerminal(); }
  if (e.ctrlKey && e.key === 'f') { e.preventDefault(); toggleTermSearch(); }
  if (e.ctrlKey && (e.key === '+' || e.key === '=')) { e.preventDefault(); adjustFontSize(1); }
  if (e.ctrlKey && e.key === '-') { e.preventDefault(); adjustFontSize(-1); }
  if (e.key === 'F11') { e.preventDefault(); toggleFullscreen(); }
  if (e.key === 'Escape') {
    closeTermSearch();
    closePreview();
    hideTermMore();
    closeSidebarDrawer();
    document.getElementById('shortcutsModal').classList.add('hidden');
    document.getElementById('bgModal').classList.add('hidden');
  }
}

function switchTab(t) {
  document.querySelectorAll('.sidebar-tab').forEach(function (x) {
    x.classList.toggle('active', x.dataset.tab === t);
  });
  ['connect', 'saved', 'snippets', 'ai', 'server', 'log'].forEach(function (name) {
    var el = document.getElementById('tab-' + name);
    if (el) el.classList.toggle('hidden', t !== name);
  });
  if (t === 'server' && isActiveConnected()) refreshServerInfo();
  if (t === 'ai') initAiPanel();
  if (window.matchMedia && window.matchMedia('(max-width: 900px)').matches) {
    closeSidebarDrawer();
  }
}

function switchAuth(t) {
  document.querySelectorAll('.auth-tab').forEach(function (x) {
    x.classList.toggle('active', x.dataset.auth === t);
  });
  document.getElementById('auth-password').classList.toggle('hidden', t !== 'password');
  document.getElementById('auth-key').classList.toggle('hidden', t !== 'key');
}

var THEME_VARS = {
  dark: {
    '--bg': '#0d1117', '--bg-panel': '#161b22', '--bg-input': '#0d1117', '--bg-term': '#010409',
    '--border': '#30363d', '--text': '#c9d1d9', '--text-dim': '#8b949e',
    '--accent': '#58a6ff', '--accent-hover': '#388bfd',
    '--green': '#3fb950', '--red': '#f85149', '--yellow': '#d29922',
    '--focus': '#58a6ff', '--bg-hover': 'rgba(88,166,255,0.12)',
  },
  light: {
    '--bg': '#f6f8fa', '--bg-panel': '#ffffff', '--bg-input': '#f6f8fa', '--bg-term': '#ffffff',
    '--border': '#d0d7de', '--text': '#1f2328', '--text-dim': '#656d76',
    '--accent': '#0969da', '--accent-hover': '#0550ae',
    '--green': '#1a7f37', '--red': '#cf222e', '--yellow': '#9a6700',
    '--focus': '#0969da', '--bg-hover': 'rgba(9,105,218,0.1)',
  },
  dracula: {
    '--bg': '#21222c', '--bg-panel': '#282a36', '--bg-input': '#191a21', '--bg-term': '#1e1f29',
    '--border': '#44475a', '--text': '#f8f8f2', '--text-dim': '#9ca0b0',
    '--accent': '#bd93f9', '--accent-hover': '#a77bf3',
    '--green': '#50fa7b', '--red': '#ff5555', '--yellow': '#f1fa8c',
    '--focus': '#bd93f9', '--bg-hover': 'rgba(189,147,249,0.14)',
  },
  monokai: {
    '--bg': '#1e1f1c', '--bg-panel': '#272822', '--bg-input': '#1e1f1c', '--bg-term': '#151613',
    '--border': '#3e3d32', '--text': '#f8f8f2', '--text-dim': '#a6a89a',
    '--accent': '#a6e22e', '--accent-hover': '#8ec925',
    '--green': '#a6e22e', '--red': '#f92672', '--yellow': '#e6db74',
    '--focus': '#a6e22e', '--bg-hover': 'rgba(166,226,46,0.12)',
  },
};

function applyThemeBtnIcon() {
  var btn = document.getElementById('themeBtn');
  if (!btn) return;
  btn.innerHTML = icon(currentTheme === 'light' ? 'sun' : 'moon');
}

function applyTheme(name) {
  if (!THEMES[name]) name = 'dark';
  currentTheme = name;
  localStorage.setItem('ssh_theme', name);
  document.documentElement.setAttribute('data-theme', name);
  var vars = THEME_VARS[name] || THEME_VARS.dark;
  Object.keys(vars).forEach(function (k) {
    document.documentElement.style.setProperty(k, vars[k]);
  });
  applyThemeBtnIcon();
  Object.keys(sessions).forEach(function (id) {
    sessions[id].term.options.theme = THEMES[name];
  });
}

function cycleTheme() {
  var keys = Object.keys(THEMES);
  var idx = (keys.indexOf(currentTheme) + 1) % keys.length;
  applyTheme(keys[idx]);
}

function adjustFontSize(delta) {
  termFontSize = Math.min(24, Math.max(10, termFontSize + delta));
  localStorage.setItem('ssh_font_size', String(termFontSize));
  Object.keys(sessions).forEach(function (id) {
    sessions[id].term.options.fontSize = termFontSize;
    sessions[id].fitAddon.fit();
  });
  sendResize();
}

function toggleTermSearch() {
  var bar = document.getElementById('termSearchBar');
  bar.classList.toggle('hidden');
  if (!bar.classList.contains('hidden')) document.getElementById('termSearchInput').focus();
}

function closeTermSearch() {
  document.getElementById('termSearchBar').classList.add('hidden');
  var s = getActive();
  if (s) s.searchAddon.clearDecorations();
}

function findNext() {
  var s = getActive();
  var q = document.getElementById('termSearchInput').value;
  if (s && q) s.searchAddon.findNext(q, { caseSensitive: false });
}

function findPrev() {
  var s = getActive();
  var q = document.getElementById('termSearchInput').value;
  if (s && q) s.searchAddon.findPrevious(q, { caseSensitive: false });
}

function copyTerminalSelection() {
  var s = getActive();
  if (!s) return;
  var sel = s.term.getSelection();
  if (sel) navigator.clipboard.writeText(sel);
}

function toggleFullscreen() {
  var area = document.getElementById('terminalArea');
  area.classList.toggle('fullscreen');
  setTimeout(function () {
    var s = getActive();
    if (s) { s.fitAddon.fit(); sendResize(); }
  }, 100);
}

function toggleShortcuts() {
  document.getElementById('shortcutsModal').classList.toggle('hidden');
}

function fitActiveTerminal() {
  setTimeout(function () {
    var s = getActive();
    if (s) { s.fitAddon.fit(); sendResize(); }
  }, 80);
}

function setFilePanelCollapsed(collapsed, fromUser) {
  var panel = document.getElementById('filePanel');
  var btn = document.getElementById('fpShowBtn');
  panel.classList.toggle('collapsed', collapsed);
  btn.classList.toggle('hidden', !collapsed);
  document.getElementById('splitFiles').classList.toggle('hidden', collapsed);
  if (fromUser) localStorage.setItem('ssh_files_collapsed', collapsed ? '1' : '0');
  fitActiveTerminal();
}

function toggleFilePanel() {
  var panel = document.getElementById('filePanel');
  setFilePanelCollapsed(!panel.classList.contains('collapsed'), true);
}

function syncFilePanelForConnection(connected) {
  if (!connected) return;
  if (localStorage.getItem('ssh_files_collapsed') === '1') return;
  setFilePanelCollapsed(false, false);
}

function restoreLayoutWidths() {
  var sideW = parseInt(localStorage.getItem('ssh_layout_sidebar_w') || '', 10);
  var fileW = parseInt(localStorage.getItem('ssh_layout_files_w') || '', 10);
  if (sideW >= 200 && sideW <= 420) document.getElementById('sidebar').style.width = sideW + 'px';
  if (fileW >= 260 && fileW <= 520) document.getElementById('filePanel').style.width = fileW + 'px';
}

function setupSplitters() {
  bindSplitter('splitSidebar', function (dx, start) {
    var next = Math.min(420, Math.max(200, start + dx));
    var mainW = document.querySelector('.main').clientWidth;
    var files = document.getElementById('filePanel');
    var filesW = files.classList.contains('collapsed') ? 0 : files.getBoundingClientRect().width;
    if (mainW - next - filesW < 280) next = mainW - filesW - 280;
    next = Math.max(200, next);
    document.getElementById('sidebar').style.width = next + 'px';
    return next;
  }, function (w) {
    localStorage.setItem('ssh_layout_sidebar_w', String(Math.round(w)));
  });
  bindSplitter('splitFiles', function (dx, start) {
    var next = Math.min(520, Math.max(260, start - dx));
    var mainW = document.querySelector('.main').clientWidth;
    var sideW = document.getElementById('sidebar').getBoundingClientRect().width;
    if (mainW - sideW - next < 280) next = mainW - sideW - 280;
    next = Math.max(260, next);
    document.getElementById('filePanel').style.width = next + 'px';
    return next;
  }, function (w) {
    localStorage.setItem('ssh_layout_files_w', String(Math.round(w)));
  });
}

function bindSplitter(id, onMove, onEnd) {
  var el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('mousedown', function (e) {
    e.preventDefault();
    var startX = e.clientX;
    var target = id === 'splitSidebar' ? document.getElementById('sidebar') : document.getElementById('filePanel');
    var startW = target.getBoundingClientRect().width;
    el.classList.add('dragging');
    document.body.classList.add('is-resizing');
    function move(ev) {
      onMove(ev.clientX - startX, startW);
    }
    function up() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      el.classList.remove('dragging');
      document.body.classList.remove('is-resizing');
      onEnd(target.getBoundingClientRect().width);
      fitActiveTerminal();
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

function toggleSidebarDrawer() {
  if (!(window.matchMedia && window.matchMedia('(max-width: 900px)').matches)) return;
  document.body.classList.toggle('sidebar-open');
}

function closeSidebarDrawer() {
  document.body.classList.remove('sidebar-open');
}

function toggleTermMore(e) {
  if (e) e.stopPropagation();
  var menu = document.getElementById('termMoreMenu');
  menu.classList.toggle('hidden');
}

function hideTermMore() {
  var menu = document.getElementById('termMoreMenu');
  if (menu) menu.classList.add('hidden');
}

function setupTermMore() {
  document.addEventListener('click', function () { hideTermMore(); });
  var menu = document.getElementById('termMoreMenu');
  if (menu) menu.addEventListener('click', function (e) { e.stopPropagation(); });
}

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
  var sn = getSnippets()[i];
  var s = getActive();
  if (!sn || !s || !s.connected) return;
  wsSend({ type: 'input', sessionId: s.id, data: sn.cmd + '\n' });
  addCmdLog('connect', sn.cmd, '发送片段: ' + sn.name);
}

function runSnippet(i) {
  var sn = getSnippets()[i];
  var s = getActive();
  if (!sn) return;
  if (!s || !s.connected) { alert('请先连接服务器'); return; }
  wsSend({ type: 'exec', sessionId: s.id, id: 'snippet-' + i, command: sn.cmd });
  addCmdLog('connect', sn.cmd, '执行片段: ' + sn.name);
}

function refreshServerInfo() {
  var s = getActive();
  if (!s || !s.connected) return;
  var box = document.getElementById('serverInfo');
  box.innerHTML = '<div class="server-loading">加载中...</div>';
  wsSend({ type: 'server-info', sessionId: s.id, id: 'info' });
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

function getProxyFromForm() {
  return {
    proxyType: document.getElementById('proxyType').value,
    proxyHost: document.getElementById('proxyHost').value.trim(),
    proxyPort: parseInt(document.getElementById('proxyPort').value, 10) || 0,
  };
}

function fillProxyFields(cfg) {
  document.getElementById('proxyType').value = (cfg && cfg.proxyType) || '';
  document.getElementById('proxyHost').value = (cfg && cfg.proxyHost) || '';
  document.getElementById('proxyPort').value = (cfg && cfg.proxyPort) || '';
}

function connect(cfg) {
  var host = (cfg && cfg.host) || document.getElementById('host').value.trim();
  var port = parseInt((cfg && cfg.port) || document.getElementById('port').value, 10) || 22;
  var username = (cfg && cfg.username) || document.getElementById('username').value.trim();
  var password = (cfg && cfg.password) || document.getElementById('password').value;
  var privateKey = (cfg && cfg.privateKey) || document.getElementById('privateKey').value.trim();
  var passphrase = (cfg && cfg.passphrase) || document.getElementById('passphrase').value;
  var proxy = cfg && cfg.proxyType !== undefined
    ? { proxyType: cfg.proxyType || '', proxyHost: cfg.proxyHost || '', proxyPort: cfg.proxyPort || 0 }
    : getProxyFromForm();
  if (!host || !username) { alert('请输入主机地址和用户名'); return; }
  if (Object.keys(sessions).length >= MAX_SESSIONS) {
    alert('最多同时 ' + MAX_SESSIONS + ' 个会话');
    return;
  }

  var sessionId = genSessionId();
  var label = username + '@' + host;
  createTerminalSession(sessionId, '连接中…');
  var s = sessions[sessionId];
  s.host = host;
  s.port = port;
  s.username = username;
  switchSession(sessionId);

  addRecent({ host: host, port: port, username: username });
  addCmdLog('connect', 'ssh ' + username + '@' + host + ' -p ' + port, '连接 ' + username + '@' + host + ':' + port);

  ensureWs().then(function () {
    wsSend({
      type: 'connect',
      sessionId: sessionId,
      host: host,
      port: port,
      username: username,
      password: password,
      privateKey: privateKey,
      passphrase: passphrase,
      proxyType: proxy.proxyType,
      proxyHost: proxy.proxyHost,
      proxyPort: proxy.proxyPort,
    });
  }).catch(function (err) {
    s.term.write('\r\n\x1b[31m' + (err.message || 'WebSocket 连接失败') + '\x1b[0m\r\n');
  });
}

function onWsMessage(ev) {
  var msg = JSON.parse(ev.data);
  var sid = msg.sessionId;
  var s = sid ? sessions[sid] : null;

  if (msg.type === 'connected') {
    if (!s) return;
    s.connected = true;
    s.startedAt = Date.now();
    s.label = s.username + '@' + s.host;
    renderSessionTabs();
    if (sid === activeSessionId) {
      syncActiveChrome();
      syncFilePanelForConnection(true);
      s.term.focus();
      listRemoteFiles();
    }
  } else if (msg.type === 'home-dir' && msg.path && s) {
    s.path = msg.path;
    if (sid === activeSessionId) {
      document.getElementById('remotePath').value = msg.path;
    }
  } else if (msg.type === 'data' && s) {
    s.term.write(msg.data);
  } else if (msg.type === 'error') {
    if (s) s.term.write('\r\n\x1b[31m' + msg.data + '\x1b[0m\r\n');
    else if (getActive()) getActive().term.write('\r\n\x1b[31m' + msg.data + '\x1b[0m\r\n');
  } else if (msg.type === 'disconnected') {
    if (!s) return;
    s.connected = false;
    s.startedAt = null;
    renderSessionTabs();
    if (sid === activeSessionId) {
      syncActiveChrome();
      document.getElementById('fpFileList').innerHTML =
        '<div class="fp-empty"><div class="empty-icon">' + icon('plug') + '</div><div>连接已断开</div></div>';
    }
  } else if (msg.type === 'sftp-list-result') {
    if (sid === activeSessionId) renderRemoteFiles(msg);
    if (s && !msg.error) {
      s.path = msg.path;
      s.lastFileList = msg.files || [];
    }
  } else if (msg.type === 'sftp-upload-result') {
    onUploadResult(msg);
  } else if (msg.type === 'sftp-upload-progress') {
    onUploadProgress(msg);
  } else if (msg.type === 'sftp-mkdir-result') {
    if (sid !== activeSessionId) return;
    if (msg.error) alert('创建失败: ' + msg.error); else listRemoteFiles();
  } else if (msg.type === 'sftp-rename-result') {
    if (sid !== activeSessionId) return;
    if (msg.error) alert('重命名失败: ' + msg.error); else listRemoteFiles();
  } else if (msg.type === 'sftp-rm-result') {
    if (sid !== activeSessionId) return;
    if (msg.error) alert('删除失败: ' + msg.error); else listRemoteFiles();
  } else if (msg.type === 'sftp-download-result') {
    onDownloadResult(msg);
  } else if (msg.type === 'sftp-preview-result') {
    onPreviewResult(msg);
  } else if (msg.type === 'sftp-write-result') {
    onWriteResult(msg);
  } else if (msg.type === 'server-info-result') {
    if (sid !== activeSessionId) return;
    if (msg.error) {
      document.getElementById('serverInfo').innerHTML = '<div class="fp-empty"><div>' + esc(msg.error) + '</div></div>';
    } else {
      renderServerInfo(msg.info);
    }
  } else if (msg.type === 'exec-result') {
    if (!s) return;
    if (msg.error) s.term.write('\r\n\x1b[31m' + msg.error + '\x1b[0m\r\n');
    else if (msg.output) s.term.write('\r\n' + msg.output + '\r\n');
  }
}

function disconnect() {
  var s = getActive();
  if (!s) return;
  wsSend({ type: 'disconnect', sessionId: s.id });
  s.connected = false;
  s.startedAt = null;
  syncActiveChrome();
  addCmdLog('connect', 'exit', '断开连接');
}

function clearTerminal() {
  var s = getActive();
  if (s) s.term.clear();
}

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
  var proxy = getProxyFromForm();
  if (!host || !username) { alert('请至少填写主机地址和用户名'); return; }
  var name = prompt('连接名称:', username + '@' + host);
  if (!name) return;
  var conns = getSavedConnections();
  conns.push({
    id: Date.now(), name: name, host: host, port: port, username: username,
    password: password, privateKey: privateKey, passphrase: passphrase,
    proxyType: proxy.proxyType, proxyHost: proxy.proxyHost, proxyPort: proxy.proxyPort,
  });
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
      '<button class="si-edit-btn" onclick="event.stopPropagation();editConnection(' + c.id + ')" title="编辑">' + icon('edit') + '</button>' +
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
  fillProxyFields(c);
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

function activePath() {
  var s = getActive();
  return (s && s.path) || document.getElementById('remotePath').value.trim() || '/home';
}

function listRemoteFiles() {
  var s = getActive();
  if (!s || !s.connected) return;
  var p = document.getElementById('remotePath').value.trim() || '/home';
  s.path = p;
  wsSend({ type: 'sftp-list', sessionId: s.id, id: 'list', path: p });
}

function renderRemoteFiles(msg) {
  if (msg.error) {
    document.getElementById('fpFileList').innerHTML = '<div class="fp-empty"><div class="empty-icon">' + icon('warn') + '</div><div>' + esc(msg.error) + '</div></div>';
    document.getElementById('fpStatus').textContent = '错误';
    return;
  }
  var s = getActive();
  if (s) {
    s.path = msg.path;
    s.lastFileList = msg.files || [];
  }
  document.getElementById('remotePath').value = msg.path;
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
  var s = getActive();
  var lastFileList = (s && s.lastFileList) || [];
  var currentRemotePath = activePath();

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
    list.innerHTML = '<div class="fp-empty"><div class="empty-icon">' + icon('folder') + '</div><div>空目录或无匹配</div></div>';
    return;
  }

  list.innerHTML = files.map(function (f) {
    var fileIcon = f.isDir ? icon('folder') : getFileIcon(f.filename);
    var size = f.isDir ? '' : fmtSize(f.size);
    var mtime = f.mtime ? fmtTime(f.mtime) : '';
    var fullPath = (currentRemotePath + '/' + f.filename).replace(/\/+/g, '/');
    var ep = escAttr(fullPath);
    var dirClass = f.isDir ? ' is-dir' : '';
    var onclick = f.isDir
      ? 'ondblclick="cdRemote(\'' + ep + '\')" onclick="selectFile(this)"'
      : 'onclick="selectFile(this)"';
    var perm = f.perm ? '<span class="ff-perm" title="' + esc(f.perm) + '">' + esc((f.perm || '').split(' ')[1] || '') + '</span>' : '';
    var actions = '<span class="ff-actions"><button class="ff-more" onclick="event.stopPropagation();showCtxMenu(event,\'' + ep + '\',' + f.isDir + ')" title="更多">' + icon('more') + '</button></span>';
    return '<div class="fp-file-row' + dirClass + '" ' + onclick + ' oncontextmenu="showCtxMenu(event,\'' + ep + '\',' + f.isDir + ');return false;">' +
      '<span class="ff-icon">' + fileIcon + '</span>' +
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
  var s = getActive();
  if (!s || !s.connected) { alert('请先连接'); return; }
  var name = prompt('文件夹名称:');
  if (!name || !name.trim()) return;
  var fullPath = (activePath() + '/' + name.trim()).replace(/\/+/g, '/');
  addCmdLog('mkdir', 'mkdir -p ' + fullPath, '创建目录 ' + fullPath);
  wsSend({ type: 'sftp-mkdir', sessionId: s.id, path: fullPath });
}

function createRemoteFile() {
  var s = getActive();
  if (!s || !s.connected) { alert('请先连接'); return; }
  var name = prompt('文件名:');
  if (!name || !name.trim()) return;
  var fullPath = (activePath() + '/' + name.trim()).replace(/\/+/g, '/');
  addCmdLog('upload', 'touch ' + fullPath, '创建文件 ' + fullPath);
  wsSend({
    type: 'sftp-upload',
    sessionId: s.id,
    id: 'new-' + Date.now(),
    filename: name.trim(),
    remotePath: activePath(),
    data: btoa(''),
  });
}

function renameRemote(path, oldName) {
  var s = getActive();
  if (!s || !s.connected) return;
  var newName = prompt('新名称:', oldName);
  if (!newName || newName === oldName) return;
  var parent = path.substring(0, path.lastIndexOf('/')) || '/';
  var newPath = (parent + '/' + newName).replace(/\/+/g, '/');
  addCmdLog('nav', 'mv ' + path + ' ' + newPath, '重命名');
  wsSend({ type: 'sftp-rename', sessionId: s.id, from: path, to: newPath });
}

function selectFile(el) {
  document.querySelectorAll('.fp-file-row.selected').forEach(function (r) { r.classList.remove('selected'); });
  el.classList.add('selected');
}

function setEditorStatus(text, cls) {
  var el = document.getElementById('editorStatus');
  el.textContent = text || '';
  el.className = 'editor-status' + (cls ? ' ' + cls : '');
}

function previewFile(path) {
  var s = getActive();
  if (!s || !s.connected) return;
  editorPath = path;
  editorDirty = false;
  editorReadonly = false;
  document.getElementById('previewTitle').textContent = '加载中...';
  document.getElementById('editorContent').value = '';
  document.getElementById('editorContent').readOnly = true;
  document.getElementById('btnSaveFile').classList.add('hidden');
  setEditorStatus('');
  document.getElementById('previewModal').classList.remove('hidden');
  wsSend({ type: 'sftp-preview', sessionId: s.id, id: 'preview', path: path });
}

function onPreviewResult(msg) {
  if (msg.error) {
    document.getElementById('previewTitle').textContent = '打开失败';
    document.getElementById('editorContent').value = msg.error;
    document.getElementById('editorContent').readOnly = true;
    document.getElementById('btnSaveFile').classList.add('hidden');
    setEditorStatus(msg.error, 'err');
    return;
  }
  document.getElementById('previewTitle').textContent = msg.path + ' (' + fmtSize(msg.size) + ')';
  if (msg.binary) {
    editorReadonly = true;
    document.getElementById('editorContent').value = '二进制文件，请下载后查看';
    document.getElementById('editorContent').readOnly = true;
    document.getElementById('btnSaveFile').classList.add('hidden');
    setEditorStatus('二进制文件不可编辑', 'err');
  } else {
    editorReadonly = false;
    document.getElementById('editorContent').value = msg.content || '';
    document.getElementById('editorContent').readOnly = false;
    document.getElementById('btnSaveFile').classList.remove('hidden');
    editorDirty = false;
    setEditorStatus('可编辑，Ctrl+S 或点击保存', '');
  }
}

function saveRemoteFile() {
  var s = getActive();
  if (!s || !s.connected || !editorPath || editorReadonly) return;
  var content = document.getElementById('editorContent').value;
  setEditorStatus('保存中…', '');
  wsSend({
    type: 'sftp-write',
    sessionId: s.id,
    id: 'write-' + Date.now(),
    path: editorPath,
    content: content,
  });
  addCmdLog('upload', 'cat > ' + editorPath, '保存 ' + editorPath);
}

function onWriteResult(msg) {
  if (msg.error) {
    setEditorStatus('保存失败: ' + msg.error, 'err');
    alert('保存失败: ' + msg.error);
    return;
  }
  editorDirty = false;
  setEditorStatus('已保存', 'ok');
  if (msg.sessionId === activeSessionId) listRemoteFiles();
}

function downloadEditorContent() {
  if (!editorPath) return;
  var content = document.getElementById('editorContent').value;
  var name = editorPath.split('/').pop() || 'file.txt';
  downloadText(name, content);
}

function closePreview() {
  if (editorDirty && !editorReadonly) {
    if (!confirm('有未保存的更改，确定关闭？')) return;
  }
  document.getElementById('previewModal').classList.add('hidden');
  editorPath = null;
  editorDirty = false;
}

function showCtxMenu(e, path, isDir) {
  e.preventDefault();
  var menu = document.getElementById('ctxMenu');
  var ep = escAttr(path);
  var name = path.split('/').pop();
  menu.innerHTML = '';
  if (isDir) {
    menu.innerHTML += '<div class="ctx-item" onclick="cdRemote(\'' + ep + '\')">' + icon('folder') + '进入</div><div class="ctx-sep"></div>';
  } else {
    menu.innerHTML += '<div class="ctx-item" onclick="previewFile(\'' + ep + '\')">' + icon('edit') + '打开/编辑</div>';
    menu.innerHTML += '<div class="ctx-item" onclick="downloadFile(\'' + ep + '\')">' + icon('download') + '下载</div>';
    menu.innerHTML += '<div class="ctx-item" onclick="renameRemote(\'' + ep + '\',\'' + escAttr(name) + '\')">↻ 重命名</div><div class="ctx-sep"></div>';
  }
  menu.innerHTML += '<div class="ctx-item" onclick="navigator.clipboard.writeText(\'' + ep + '\')">' + icon('copy') + '复制路径</div>';
  menu.innerHTML += '<div class="ctx-sep"></div><div class="ctx-item danger" onclick="deleteRemote(\'' + ep + '\')">' + icon('trash') + '删除</div>';
  menu.classList.remove('hidden');
  menu.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px';
  menu.style.top = Math.min(e.clientY, window.innerHeight - 200) + 'px';
}

function setupCtxMenu() {
  document.addEventListener('click', function () { document.getElementById('ctxMenu').classList.add('hidden'); });
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      var modal = document.getElementById('previewModal');
      if (!modal.classList.contains('hidden')) {
        e.preventDefault();
        saveRemoteFile();
      }
    }
  });
}

function downloadFile(path) {
  document.getElementById('ctxMenu').classList.add('hidden');
  var s = getActive();
  if (!s || !s.connected) return;
  addCmdLog('download', 'scp user@host:' + path + ' ./', '下载 ' + path);
  wsSend({ type: 'sftp-download', sessionId: s.id, id: 'dl-' + Date.now(), remotePath: path });
}

function deleteRemote(path) {
  document.getElementById('ctxMenu').classList.add('hidden');
  if (!confirm('确定删除 "' + path + '"？')) return;
  var s = getActive();
  if (!s || !s.connected) return;
  addCmdLog('delete', 'rm -rf ' + path, '删除 ' + path);
  wsSend({ type: 'sftp-rm', sessionId: s.id, path: path });
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

function toggleUploadZone() {
  showUploadZone = !showUploadZone;
  document.getElementById('uploadZoneWrap').classList.toggle('hidden', !showUploadZone);
  if (showUploadZone) document.getElementById('uploadTargetPath').textContent = activePath();
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
  var s = getActive();
  if (!s || !s.connected) { alert('请先连接'); return; }
  document.getElementById('fpUploadSection').classList.remove('hidden');
  Array.from(files).forEach(function (f) { uploadFile(f, activePath()); });
}

function uploadFile(file, remotePath) {
  var s = getActive();
  if (!s || !s.connected) return;
  var fileId = 'file-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  var list = document.getElementById('fpUploadList');
  var div = document.createElement('div');
  div.className = 'fp-upload-item';
  div.id = fileId;
  div.innerHTML = '<div class="fu-name">' + icon('file') + ' ' + esc(file.name) + ' <span class="dim">(' + fmtSize(file.size) + ')</span></div>' +
    '<div class="fu-progress"><div class="fu-progress-bar" id="' + fileId + '-bar"></div></div>' +
    '<div class="fu-status" id="' + fileId + '-status">等待...</div>';
  list.prepend(div);
  addCmdLog('upload', 'scp "' + file.name + '" user@host:' + remotePath, '上传 ' + file.name);

  if (file.size < SMALL_UPLOAD) {
    var reader = new FileReader();
    reader.onload = function () {
      var base64 = reader.result.split(',')[1];
      wsSend({
        type: 'sftp-upload',
        sessionId: s.id,
        id: fileId,
        filename: file.name,
        remotePath: remotePath,
        data: base64,
      });
      var st = document.getElementById(fileId + '-status');
      if (st) st.textContent = '上传中...';
      var bar = document.getElementById(fileId + '-bar');
      if (bar) bar.style.width = '40%';
    };
    reader.readAsDataURL(file);
    return;
  }

  uploadFileChunked(s.id, file, remotePath, fileId);
}

function readBlobAsBase64(blob) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () {
      var result = reader.result || '';
      var base64 = String(result).split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function uploadFileChunked(sessionId, file, remotePath, fileId) {
  var status = document.getElementById(fileId + '-status');
  if (status) status.textContent = '分片上传中...';

  wsSend({
    type: 'sftp-upload-start',
    sessionId: sessionId,
    id: fileId,
    filename: file.name,
    remotePath: remotePath,
    size: file.size,
  });

  var offset = 0;
  var index = 0;

  function next() {
    if (offset >= file.size) {
      wsSend({ type: 'sftp-upload-end', sessionId: sessionId, id: fileId });
      return;
    }
    var end = Math.min(offset + CHUNK_SIZE, file.size);
    var slice = file.slice(offset, end);
    readBlobAsBase64(slice).then(function (base64) {
      wsSend({
        type: 'sftp-upload-chunk',
        sessionId: sessionId,
        id: fileId,
        index: index,
        data: base64,
      });
      offset = end;
      index += 1;
      setTimeout(next, 0);
    }).catch(function (err) {
      wsSend({ type: 'sftp-upload-abort', sessionId: sessionId, id: fileId });
      var st = document.getElementById(fileId + '-status');
      if (st) { st.textContent = err.message; st.className = 'fu-status error'; }
    });
  }

  setTimeout(next, 50);
}

function onUploadProgress(msg) {
  var bar = document.getElementById(msg.id + '-bar');
  var status = document.getElementById(msg.id + '-status');
  if (msg.total > 0 && bar) {
    var pct = Math.min(99, Math.round((msg.received / msg.total) * 100));
    bar.style.width = pct + '%';
    if (status) status.textContent = pct + '%';
  }
}

function onUploadResult(msg) {
  var bar = document.getElementById(msg.id + '-bar');
  var status = document.getElementById(msg.id + '-status');
  if (msg.done) {
    if (bar) { bar.style.width = '100%'; bar.style.background = 'var(--green)'; }
    if (status) { status.textContent = '完成'; status.className = 'fu-status done'; }
    if (msg.sessionId === activeSessionId) listRemoteFiles();
  } else if (msg.error) {
    if (bar) bar.style.background = 'var(--red)';
    if (status) { status.textContent = msg.error; status.className = 'fu-status error'; }
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

function getFileIcon(name) {
  var ext = (name.split('.').pop() || '').toLowerCase();
  var images = { jpg: 1, jpeg: 1, png: 1, gif: 1, webp: 1, svg: 1, bmp: 1, ico: 1 };
  var archives = { zip: 1, tar: 1, gz: 1, tgz: 1, rar: 1, '7z': 1, bz2: 1, xz: 1 };
  if (images[ext]) return icon('image');
  if (archives[ext]) return icon('archive');
  return icon('file');
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
    el.textContent = '已复制';
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

/* ========== AI Assistant ========== */
var AI_PRESETS = {
  ollama: { baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama3.2', apiKey: '' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: '' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: '' },
  qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', apiKey: '' },
  custom: { baseUrl: '', model: '', apiKey: '' },
};

var aiPanelReady = false;
var lastAiCommands = [];

var DANGEROUS_CMD_RE = /\b(rm\s+-[^\s]*f[^\s]*\s+\/|mkfs(\.|$|\s)|dd\s+.*\bof=|shutdown\b|reboot\b|poweroff\b|wipefs\b)\b/i;

function getAiSettings() {
  try {
    var s = JSON.parse(localStorage.getItem('ssh_ai_settings') || 'null');
    if (s && s.baseUrl) return s;
  } catch (e) { /* ignore */ }
  return {
    preset: 'ollama',
    baseUrl: AI_PRESETS.ollama.baseUrl,
    model: AI_PRESETS.ollama.model,
    apiKey: '',
  };
}

function saveAiSettingsToStorage(s) {
  localStorage.setItem('ssh_ai_settings', JSON.stringify(s));
}

function fillAiSettingsForm(s) {
  document.getElementById('aiPreset').value = s.preset || 'ollama';
  document.getElementById('aiBaseUrl').value = s.baseUrl || '';
  document.getElementById('aiModel').value = s.model || '';
  document.getElementById('aiApiKey').value = s.apiKey || '';
}

function readAiSettingsForm() {
  return {
    preset: document.getElementById('aiPreset').value || 'custom',
    baseUrl: document.getElementById('aiBaseUrl').value.trim(),
    model: document.getElementById('aiModel').value.trim(),
    apiKey: document.getElementById('aiApiKey').value,
  };
}

function onAiPresetChange() {
  var key = document.getElementById('aiPreset').value;
  var p = AI_PRESETS[key];
  if (!p || key === 'custom') return;
  document.getElementById('aiBaseUrl').value = p.baseUrl;
  document.getElementById('aiModel').value = p.model;
}

function saveAiSettings() {
  var s = readAiSettingsForm();
  if (!s.baseUrl) { alert('请填写 Base URL'); return; }
  if (!s.model) { alert('请填写模型名'); return; }
  saveAiSettingsToStorage(s);
  setAiStatus('设置已保存', 'ok');
}

function initAiPanel() {
  if (aiPanelReady) return;
  aiPanelReady = true;
  var local = getAiSettings();
  fillAiSettingsForm(local);
  fetch('/api/ai/config')
    .then(function (r) { return r.json(); })
    .then(function (cfg) {
      var s = getAiSettings();
      var onlyDefault = !localStorage.getItem('ssh_ai_settings');
      if (onlyDefault && cfg) {
        s.baseUrl = cfg.baseUrl || s.baseUrl;
        s.model = cfg.model || s.model;
        fillAiSettingsForm(s);
      }
      if (cfg && cfg.hasEnvKey) {
        setAiStatus('服务端已配置 AI_API_KEY（页面 Key 可留空）', '');
      }
    })
    .catch(function () { /* ignore */ });
}

function setAiStatus(text, cls) {
  var el = document.getElementById('aiStatus');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'ai-status' + (cls ? ' ' + cls : '');
}

function loadAiModels() {
  var s = readAiSettingsForm();
  setAiStatus('拉取模型列表…', '');
  var q = '?baseUrl=' + encodeURIComponent(s.baseUrl);
  if (s.apiKey) q += '&apiKey=' + encodeURIComponent(s.apiKey);
  fetch('/api/ai/models' + q)
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var hint = document.getElementById('aiModelsHint');
      if (!data.models || !data.models.length) {
        hint.textContent = data.error ? ('无法拉取: ' + data.error) : '无可用模型';
        setAiStatus(data.error || '无可用模型', 'err');
        return;
      }
      hint.textContent = '可用: ' + data.models.slice(0, 12).join(', ')
        + (data.models.length > 12 ? '…' : '');
      if (data.models.indexOf(s.model) === -1) {
        document.getElementById('aiModel').value = data.models[0];
      }
      setAiStatus('已加载 ' + data.models.length + ' 个模型', 'ok');
    })
    .catch(function (e) {
      setAiStatus(e.message || '拉取失败', 'err');
    });
}

function aiChat(messages) {
  var s = readAiSettingsForm();
  return fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: messages,
      baseUrl: s.baseUrl,
      model: s.model,
      apiKey: s.apiKey,
    }),
  }).then(function (r) {
    return r.json().then(function (data) {
      if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
      return data;
    });
  });
}

function parseAiCommands(content) {
  var text = String(content || '').trim();
  var fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  try {
    var parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map(function (item) {
        if (typeof item === 'string') return { cmd: item, explain: '' };
        return { cmd: item.cmd || item.command || '', explain: item.explain || item.reason || '' };
      }).filter(function (x) { return x.cmd; }).slice(0, 3);
    }
  } catch (e) { /* fallthrough */ }
  var lines = text.split('\n').map(function (l) { return l.replace(/^[-*\d.)\s]+/, '').trim(); }).filter(Boolean);
  return lines.slice(0, 3).map(function (l) { return { cmd: l, explain: '' }; });
}

function isDangerousCmd(cmd) {
  return DANGEROUS_CMD_RE.test(cmd || '');
}

function renderAiCommands(list) {
  lastAiCommands = list || [];
  var box = document.getElementById('aiResults');
  if (!list.length) {
    box.innerHTML = '<div class="ai-empty">未解析到命令，可重试或换模型</div>';
    return;
  }
  box.innerHTML = list.map(function (item, i) {
    var danger = isDangerousCmd(item.cmd);
    return '<div class="ai-cmd-card' + (danger ? ' danger' : '') + '">' +
      (danger ? '<div class="ai-danger-tag">高危 · 需确认</div>' : '') +
      '<code class="ai-cmd">' + esc(item.cmd) + '</code>' +
      (item.explain ? '<div class="ai-explain">' + esc(item.explain) + '</div>' : '') +
      '<div class="ai-cmd-actions">' +
      '<button class="btn btn-ghost btn-sm" onclick="copyAiCmd(' + i + ')">复制</button>' +
      '<button class="btn btn-primary btn-sm" onclick="sendAiCmd(' + i + ')">发送到终端</button>' +
      '<button class="btn btn-ghost btn-sm" onclick="saveAiCmdAsSnippet(' + i + ')">存片段</button>' +
      '</div></div>';
  }).join('');
}

function renderAiExplain(text) {
  document.getElementById('aiResults').innerHTML =
    '<div class="ai-explain-card"><div class="ai-explain-title">解释</div><div class="ai-explain-body">' +
    esc(text) + '</div></div>';
}

function copyAiCmd(i) {
  var item = lastAiCommands[i];
  if (!item) return;
  navigator.clipboard.writeText(item.cmd).then(function () {
    setAiStatus('已复制', 'ok');
  });
}

function sendAiCmd(i) {
  var item = lastAiCommands[i];
  var s = getActive();
  if (!item) return;
  if (!s || !s.connected) { alert('请先连接服务器'); return; }
  if (isDangerousCmd(item.cmd)) {
    if (!confirm('该命令可能高危：\n\n' + item.cmd + '\n\n确定发送到终端？')) return;
  }
  wsSend({ type: 'input', sessionId: s.id, data: item.cmd + '\n' });
  addCmdLog('connect', item.cmd, 'AI 发送命令');
  setAiStatus('已发送到当前会话', 'ok');
  s.term.focus();
}

function saveAiCmdAsSnippet(i) {
  var item = lastAiCommands[i];
  if (!item) return;
  var name = prompt('片段名称:', item.cmd.slice(0, 24));
  if (!name) return;
  var list = getSnippets();
  list.push({ name: name, cmd: item.cmd });
  saveSnippets(list);
  setAiStatus('已存为片段', 'ok');
}

function aiGenerateCommands() {
  var prompt = document.getElementById('aiPrompt').value.trim();
  if (!prompt) { alert('请输入需求描述'); return; }
  setAiStatus('生成中…', '');
  document.getElementById('aiResults').innerHTML = '';
  var system = [
    '你是 Linux/运维命令助手。根据用户需求给出 1～3 条可直接在 bash 中执行的命令。',
    '只输出 JSON 数组，格式：[{"cmd":"...","explain":"简短说明"}]，不要 Markdown 其它文字。',
    '除非用户明确要求破坏性操作，否则不要给出 rm -rf /、mkfs、dd 写盘、shutdown 等危险命令。',
    '优先用常见、可逆、只读的排查命令。',
  ].join('');
  aiChat([
    { role: 'system', content: system },
    { role: 'user', content: prompt },
  ]).then(function (data) {
    var cmds = parseAiCommands(data.content);
    renderAiCommands(cmds);
    setAiStatus(cmds.length ? ('已生成 ' + cmds.length + ' 条建议') : '解析失败', cmds.length ? 'ok' : 'err');
  }).catch(function (e) {
    setAiStatus(e.message || '请求失败', 'err');
  });
}

function getTerminalContextForAi() {
  var s = getActive();
  if (!s || !s.term) return '';
  var sel = s.term.getSelection();
  if (sel && sel.trim()) return sel.trim();
  try {
    var buf = s.term.buffer.active;
    var lines = [];
    var end = buf.baseY + buf.cursorY;
    var start = Math.max(0, end - 40);
    for (var y = start; y <= end; y += 1) {
      var line = buf.getLine(y);
      if (line) lines.push(line.translateToString(true));
    }
    return lines.join('\n').trim();
  } catch (e) {
    return '';
  }
}

function aiExplainSelection() {
  var ctx = getTerminalContextForAi();
  if (!ctx) {
    alert('请先在终端中选中一段输出，或确保当前会话有终端内容');
    return;
  }
  setAiStatus('解释中…', '');
  document.getElementById('aiResults').innerHTML = '';
  var userExtra = document.getElementById('aiPrompt').value.trim();
  aiChat([
    {
      role: 'system',
      content: '你是资深运维助手。用简洁中文解释终端输出含义、可能原因与建议下一步（不要编造未出现的事实）。',
    },
    {
      role: 'user',
      content: (userExtra ? ('补充问题：' + userExtra + '\n\n') : '') + '终端内容：\n' + ctx.slice(-4000),
    },
  ]).then(function (data) {
    renderAiExplain(data.content);
    setAiStatus('解释完成', 'ok');
  }).catch(function (e) {
    setAiStatus(e.message || '请求失败', 'err');
  });
}

init();

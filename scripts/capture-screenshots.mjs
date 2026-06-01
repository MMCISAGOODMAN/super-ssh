import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '../docs/wechat-images');
const BASE = 'http://localhost:3000';

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, name), fullPage: false });
  console.log('Saved:', name);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // 1. Main overview - connect tab
  await shot(page, '01-main-connect.png');

  // 2. Fill connection form
  await page.fill('#host', '192.168.1.100');
  await page.fill('#username', 'root');
  await page.fill('#password', '••••••••');
  await shot(page, '02-connect-form.png');

  // 3. Key auth tab
  await page.click('[data-auth="key"]');
  await shot(page, '03-key-auth.png');
  await page.click('[data-auth="password"]');

  // 4. Proxy settings expanded
  await page.locator('details summary').click();
  await shot(page, '04-proxy-settings.png');

  // 5. Saved connections tab
  await page.evaluate(() => {
    const conns = [
      { id: 1, name: '生产服务器', host: 'prod.example.com', port: 22, username: 'deploy', password: 'xxx' },
      { id: 2, name: '开发机', host: '192.168.1.100', port: 2222, username: 'dev', password: 'xxx' },
      { id: 3, name: '测试环境', host: 'test.example.com', port: 22, username: 'root', privateKey: 'key' },
    ];
    localStorage.setItem('ssh_connections', JSON.stringify(conns));
    renderSavedList();
    switchTab('saved');
  });
  await page.waitForTimeout(300);
  await shot(page, '05-saved-connections.png');

  // 6. Command log tab
  await page.evaluate(() => {
    cmdLog = [
      { type: 'connect', cmd: 'ssh root@192.168.1.100 -p 22', desc: '连接 root@192.168.1.100:22', time: '14:32:01' },
      { type: 'nav', cmd: 'cd /var/www/html', desc: '进入目录 /var/www/html', time: '14:32:15' },
      { type: 'upload', cmd: 'scp "index.html" user@host:/var/www/html/index.html', desc: '上传 index.html → /var/www/html/index.html', time: '14:33:02' },
      { type: 'download', cmd: 'scp user@host:/var/log/nginx/access.log ./', desc: '下载文件 /var/log/nginx/access.log', time: '14:34:18' },
      { type: 'mkdir', cmd: 'mkdir -p /var/www/html/assets', desc: '创建文件夹 /var/www/html/assets', time: '14:35:44' },
      { type: 'delete', cmd: 'rm -rf /tmp/old-backup.tar.gz', desc: '删除 /tmp/old-backup.tar.gz', time: '14:36:10' },
    ];
    renderCmdLog();
    switchTab('log');
  });
  await page.waitForTimeout(300);
  await shot(page, '06-command-log.png');

  // 7. Terminal with mock content + file panel
  await page.evaluate(() => {
    switchTab('connect');
    term.clear();
    term.write('\x1b[1;36mWelcome to Ubuntu 22.04.3 LTS (GNU/Linux 5.15.0-91-generic x86_64)\x1b[0m\r\n\r\n');
    term.write(' * Documentation:  https://help.ubuntu.com\r\n');
    term.write(' * Management:     https://landscape.canonical.com\r\n\r\n');
    term.write('\x1b[32mroot\x1b[0m@\x1b[34mprod-server\x1b[0m:\x1b[33m~\x1b[0m# ls -la\r\n');
    term.write('total 48\r\n');
    term.write('drwx------  5 root root 4096 Jun  1 14:30 .\r\n');
    term.write('drwxr-xr-x 19 root root 4096 May 28 09:15 ..\r\n');
    term.write('-rw-r--r--  1 root root 3106 Apr 22  2024 .bashrc\r\n');
    term.write('drwxr-xr-x  3 root root 4096 Jun  1 10:00 projects\r\n\r\n');
    term.write('\x1b[32mroot\x1b[0m@\x1b[34mprod-server\x1b[0m:\x1b[33m~\x1b[0m# ');
    updateStatus(true);
    document.getElementById('statusDot').classList.add('connected');
    document.getElementById('statusText').textContent = '已连接';
    document.getElementById('btnDisconnect').style.display = '';
    document.getElementById('connInfo').textContent = 'root@192.168.1.100:22';

    const files = [
      { filename: 'projects', isDir: true, size: 0 },
      { filename: 'deploy.sh', isDir: false, size: 2048 },
      { filename: 'config.yml', isDir: false, size: 512 },
      { filename: 'README.md', isDir: false, size: 1536 },
      { filename: 'nginx.conf', isDir: false, size: 4096 },
      { filename: 'app.log', isDir: false, size: 1048576 },
    ];
    renderRemoteFiles({ path: '/home/root', files });
    document.getElementById('remotePath').value = '/home/root';
    document.getElementById('fpCwdLabel').textContent = '/home/root';
  });
  await page.waitForTimeout(500);
  await shot(page, '07-terminal-files.png');

  // 8. Upload zone
  await page.evaluate(() => {
    showUploadZone = true;
    document.getElementById('uploadZoneWrap').classList.remove('hidden');
    document.getElementById('uploadTargetPath').textContent = '/home/root';
  });
  await shot(page, '08-upload-zone.png');

  // 9. Upload progress
  await page.evaluate(() => {
    document.getElementById('uploadZoneWrap').classList.add('hidden');
    document.getElementById('fpUploadSection').style.display = '';
    document.getElementById('fpUploadList').innerHTML = `
      <div class="fp-upload-item">
        <div class="fu-name">📄 deploy.sh <span style="color:var(--text-dim);font-weight:400">(2.0 KB)</span></div>
        <div class="fu-progress"><div class="fu-progress-bar" style="width:100%;background:var(--green)"></div></div>
        <div class="fu-status done">✅ 上传完成</div>
      </div>
      <div class="fp-upload-item">
        <div class="fu-name">📄 app-bundle.zip <span style="color:var(--text-dim);font-weight:400">(12.5 MB)</span></div>
        <div class="fu-progress"><div class="fu-progress-bar" style="width:65%"></div></div>
        <div class="fu-status">⬆️ 上传中...</div>
      </div>`;
  });
  await shot(page, '09-upload-progress.png');

  // 10. Context menu
  await page.evaluate(() => {
    const menu = document.getElementById('ctxMenu');
    menu.innerHTML = `
      <div class="ctx-item">⬇️ 下载</div>
      <div class="ctx-sep"></div>
      <div class="ctx-item">📋 复制路径</div>
      <div class="ctx-sep"></div>
      <div class="ctx-item danger">🗑️ 删除</div>`;
    menu.classList.remove('hidden');
    menu.style.left = '980px';
    menu.style.top = '420px';
  });
  await shot(page, '10-context-menu.png');
  await page.evaluate(() => document.getElementById('ctxMenu').classList.add('hidden'));

  // 11. Background settings modal
  await page.evaluate(() => {
    document.getElementById('bgUrlInput').value = 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1920';
    updateBgPreview();
    toggleBgModal();
  });
  await shot(page, '11-background-settings.png');

  // 12. Background applied
  await page.evaluate(() => {
    toggleBgModal();
    applyBg();
  });
  await page.waitForTimeout(500);
  await shot(page, '12-custom-background.png');

  await browser.close();
  console.log('\nAll screenshots saved to', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

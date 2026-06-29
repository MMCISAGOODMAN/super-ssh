import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import archiver from 'archiver';
import { prepareAppBundle } from './prepare-app-bundle.mjs';
import { prepareNodeRuntime } from './prepare-node-runtime.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;

const platformMap = { darwin: 'macos', linux: 'linux', win32: 'win' };
const osName = platformMap[process.platform] || process.platform;
const arch = process.arch === 'x64' ? 'x64' : process.arch;

function copyRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyRecursive(from, to);
    else fs.copyFileSync(from, to);
  }
}

function createStartScript(bundleDir) {
  const isWin = process.platform === 'win32';
  if (isWin) {
    const bat = `@echo off\r\nset SUPER_SSH_MODE=portable\r\nset SUPER_SSH_OPEN_BROWSER=1\r\nset HOST=127.0.0.1\r\nset PORT=3000\r\ncd /d "%~dp0"\r\nstart "" "http://localhost:3000"\r\nruntime\\node.exe app\\src\\server.js\r\n`;
    fs.writeFileSync(path.join(bundleDir, 'Super SSH.bat'), bat);
  } else {
    const sh = `#!/bin/bash\nset -e\ncd "$(dirname "$0")"\nexport SUPER_SSH_MODE=portable\nexport SUPER_SSH_OPEN_BROWSER=1\nexport HOST=127.0.0.1\nexport PORT=3000\n(sleep 1 && (command -v open >/dev/null && open "http://localhost:3000" || xdg-open "http://localhost:3000" 2>/dev/null || true)) &\n./runtime/node app/src/server.js\n`;
    const scriptPath = path.join(bundleDir, 'super-ssh.sh');
    fs.writeFileSync(scriptPath, sh, { mode: 0o755 });
  }
}

async function zipDirectory(sourceDir, outPath) {
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

async function tarDirectory(sourceDir, outPath) {
  execSync(`tar -czf "${outPath}" -C "${sourceDir}" .`, { stdio: 'inherit' });
}

async function main() {
  prepareAppBundle();
  const nodePath = await prepareNodeRuntime(path.join(root, 'build', 'portable-runtime'));

  const bundleDir = path.join(root, 'build', 'portable-bundle');
  if (fs.existsSync(bundleDir)) fs.rmSync(bundleDir, { recursive: true, force: true });
  fs.mkdirSync(bundleDir, { recursive: true });

  copyRecursive(path.join(root, 'build', 'app'), path.join(bundleDir, 'app'));
  fs.mkdirSync(path.join(bundleDir, 'runtime'), { recursive: true });
  fs.copyFileSync(nodePath, path.join(bundleDir, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node'));
  createStartScript(bundleDir);

  const outDir = path.join(root, 'dist', 'portable');
  fs.mkdirSync(outDir, { recursive: true });
  const baseName = `super-ssh-${version}-${osName}-${arch}-portable`;

  if (process.platform === 'win32') {
    await zipDirectory(bundleDir, path.join(outDir, `${baseName}.zip`));
  } else {
    await tarDirectory(bundleDir, path.join(outDir, `${baseName}.tar.gz`));
  }

  console.log(`Portable package created in ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

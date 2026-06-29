/**
 * Download Node.js runtime for the current platform into build/node/
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import https from 'https';
import { createWriteStream } from 'fs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const NODE_VERSION = '20.18.1';

const platformMap = {
  darwin: 'darwin',
  linux: 'linux',
  win32: 'win',
};

function getArch() {
  const arch = process.arch;
  if (arch === 'x64') return 'x64';
  if (arch === 'arm64') return 'arm64';
  throw new Error(`Unsupported arch: ${arch}`);
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    const request = (targetUrl) => {
      https.get(targetUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          request(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed (${res.statusCode}): ${targetUrl}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
      }).on('error', reject);
    };
    request(url);
  });
}

export async function prepareNodeRuntime(targetDir) {
  const os = platformMap[process.platform];
  if (!os) throw new Error(`Unsupported platform: ${process.platform}`);
  const arch = getArch();
  const ext = os === 'win' ? 'zip' : 'tar.gz';
  const folder = `node-v${NODE_VERSION}-${os}-${arch}`;
  const filename = `${folder}.${ext}`;
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${filename}`;
  const cacheDir = path.join(root, 'build', 'cache');
  const outDir = targetDir || path.join(root, 'build', 'node');
  const archivePath = path.join(cacheDir, filename);

  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  if (!fs.existsSync(archivePath)) {
    console.log(`Downloading ${url}`);
    await download(url, archivePath);
  }

  const extractDir = path.join(cacheDir, folder);
  if (!fs.existsSync(extractDir)) {
    console.log(`Extracting ${filename}`);
    fs.mkdirSync(extractDir, { recursive: true });
    if (ext === 'zip') {
      if (process.platform === 'win32') {
        execSync(`powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${cacheDir}' -Force"`, { stdio: 'inherit' });
      } else {
        execSync(`unzip -q -o "${archivePath}" -d "${cacheDir}"`, { stdio: 'inherit' });
      }
    } else {
      execSync(`tar -xzf "${archivePath}" -C "${cacheDir}"`, { stdio: 'inherit' });
    }
  }

  const nodeDest = path.join(outDir, os === 'win' ? 'node.exe' : 'node');

  if (os === 'win') {
    fs.copyFileSync(path.join(extractDir, 'node.exe'), nodeDest);
  } else {
    fs.copyFileSync(path.join(extractDir, 'bin', 'node'), nodeDest);
    fs.chmodSync(nodeDest, 0o755);
  }

  console.log(`Node runtime ready: ${nodeDest}`);
  return nodeDest;
}

if (process.argv[1] && process.argv[1].endsWith('prepare-node-runtime.mjs')) {
  prepareNodeRuntime().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

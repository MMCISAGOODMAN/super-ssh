import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'build', 'app');

const copyDirs = ['src', 'public'];
const copyFiles = ['package.json', 'package-lock.json'];

function copyRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

export function prepareAppBundle() {
  execSync('node scripts/prepare-vendor.mjs', { cwd: root, stdio: 'inherit' });

  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outDir, { recursive: true });

  for (const dir of copyDirs) {
    copyRecursive(path.join(root, dir), path.join(outDir, dir));
  }
  for (const file of copyFiles) {
    fs.copyFileSync(path.join(root, file), path.join(outDir, file));
  }

  const bundlePkgPath = path.join(outDir, 'package.json');
  const bundlePkg = JSON.parse(fs.readFileSync(bundlePkgPath, 'utf8'));
  delete bundlePkg.devDependencies;
  delete bundlePkg.scripts.postinstall;
  delete bundlePkg.build;
  bundlePkg.main = 'src/server.js';
  fs.writeFileSync(bundlePkgPath, `${JSON.stringify(bundlePkg, null, 2)}\n`);

  console.log('Installing production dependencies...');
  execSync('npm ci --omit=dev', { cwd: outDir, stdio: 'inherit' });

  console.log(`App bundle ready: ${outDir}`);
  return outDir;
}

if (process.argv[1] && process.argv[1].endsWith('prepare-app-bundle.mjs')) {
  prepareAppBundle();
}

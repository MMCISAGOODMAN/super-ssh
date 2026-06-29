import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendorDir = path.join(root, 'public', 'vendor', 'xterm');

const copies = [
  ['node_modules/xterm/css/xterm.css', 'xterm.css'],
  ['node_modules/xterm/lib/xterm.js', 'xterm.js'],
  ['node_modules/xterm-addon-fit/lib/xterm-addon-fit.js', 'xterm-addon-fit.js'],
  ['node_modules/xterm-addon-web-links/lib/xterm-addon-web-links.js', 'xterm-addon-web-links.js'],
  ['node_modules/xterm-addon-search/lib/xterm-addon-search.js', 'xterm-addon-search.js'],
];

fs.mkdirSync(vendorDir, { recursive: true });

for (const [src, dest] of copies) {
  const from = path.join(root, src);
  const to = path.join(vendorDir, dest);
  if (!fs.existsSync(from)) {
    console.error(`Missing: ${src}`);
    process.exit(1);
  }
  fs.copyFileSync(from, to);
  console.log(`Copied ${dest}`);
}

console.log('Vendor assets ready at public/vendor/xterm/');

/**
 * Assemble the release folder: Next.js static export + PHP backend.
 * Run: npm run build:next && npm run pack:next
 * Upload the contents of release/ to your server; then open install.php in the browser.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const releaseDir = path.join(root, 'release');
const outDir = path.join(root, 'out');

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyRecursive(path.join(src, name), path.join(dest, name));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

if (!fs.existsSync(outDir)) {
  console.error('Run npm run build:next first.');
  process.exit(1);
}

if (fs.existsSync(releaseDir)) {
  fs.rmSync(releaseDir, { recursive: true });
}
fs.mkdirSync(releaseDir, { recursive: true });

// Next.js static export
copyRecursive(outDir, releaseDir);

// PHP backend (overwrite or add)
for (const dir of ['api', 'lib', 'migrations', 'migrations_master', 'migrations_ai', 'cron']) {
  const src = path.join(root, dir);
  if (fs.existsSync(src)) copyRecursive(src, path.join(releaseDir, dir));
}
for (const file of ['install.php', 'config.example.php', '.htaccess']) {
  const src = path.join(root, file);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(releaseDir, file));
}

// Favicon if Next didn't include it
const releaseFavicon = path.join(releaseDir, 'favicon.ico');
if (!fs.existsSync(releaseFavicon)) {
  const favicon = path.join(root, 'public', 'favicon.ico') || path.join(root, 'dist', 'favicon.ico');
  if (fs.existsSync(favicon)) fs.copyFileSync(favicon, releaseFavicon);
}

// Rewrite root-relative asset paths to relative so the same build works at root or in a subdirectory
function rewriteAssetPaths(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      rewriteAssetPaths(full);
    } else if (e.isFile() && (e.name.endsWith('.html') || e.name.endsWith('.js'))) {
      let s = fs.readFileSync(full, 'utf8');
      const before = s;
      s = s.replace(/"\/_next\//g, '"./_next/');
      s = s.replace(/\\"\/_next\//g, '\\"./_next/');
      s = s.replace(/"\/favicon\.ico/g, '"./favicon.ico');
      s = s.replace(/\\"\/favicon\.ico/g, '\\"./favicon.ico');
      if (s !== before) fs.writeFileSync(full, s, 'utf8');
    }
  }
}
rewriteAssetPaths(releaseDir);

console.log('Release folder ready at ./release/');
console.log('Upload the contents of release/ to your server, then open install.php in the browser.');

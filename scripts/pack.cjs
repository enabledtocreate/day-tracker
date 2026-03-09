/**
 * Assemble the release folder: built frontend + PHP backend.
 * Upload the contents of release/ to your server; then run install.php in the browser.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const releaseDir = path.join(root, 'release');

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

if (fs.existsSync(releaseDir)) {
  fs.rmSync(releaseDir, { recursive: true });
}
fs.mkdirSync(releaseDir, { recursive: true });

// Built frontend (index.html + assets)
const distIndex = path.join(root, 'dist', 'index.html');
const distAssets = path.join(root, 'dist', 'assets');
if (!fs.existsSync(distIndex)) {
  console.error('Run npm run build first.');
  process.exit(1);
}
fs.copyFileSync(distIndex, path.join(releaseDir, 'index.html'));
if (fs.existsSync(distAssets)) {
  copyRecursive(distAssets, path.join(releaseDir, 'assets'));
}
const distFavicon = path.join(root, 'dist', 'favicon.ico');
if (fs.existsSync(distFavicon)) {
  fs.copyFileSync(distFavicon, path.join(releaseDir, 'favicon.ico'));
}

// PHP backend
for (const dir of ['api', 'lib', 'migrations', 'migrations_master']) {
  const src = path.join(root, dir);
  if (fs.existsSync(src)) copyRecursive(src, path.join(releaseDir, dir));
}
for (const file of ['install.php', 'config.example.php', '.htaccess']) {
  const src = path.join(root, file);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(releaseDir, file));
}

console.log('Release folder ready at ./release/');
console.log('Upload the contents of release/ to your server, then open install.php in the browser.');

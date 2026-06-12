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

/** Pack runs after `next build`; Next reads .env.local but Node does not — mirror basePath for rewrites. */
function loadNextPublicBasePathFromEnvFiles() {
  if (process.env.NEXT_PUBLIC_BASE_PATH) return;
  for (const name of ['.env.local', '.env']) {
    const p = path.join(root, name);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq < 1) continue;
      const key = t.slice(0, eq).trim();
      if (key !== 'NEXT_PUBLIC_BASE_PATH') continue;
      let v = t.slice(eq + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (v) process.env.NEXT_PUBLIC_BASE_PATH = v;
      return;
    }
  }
}

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

loadNextPublicBasePathFromEnvFiles();

const baseRaw = (process.env.NEXT_PUBLIC_BASE_PATH || '').trim();
const baseSeg = baseRaw.replace(/^\/+/, '').replace(/\/+$/, '');
const basePrefixFromEnv = baseSeg ? `/${baseSeg}` : '';

/**
 * Next may emit href="/YourSubdir/_next/..." when NEXT_PUBLIC_BASE_PATH was set at build time.
 * The pack script often runs without that var in process.env (e.g. CI without .env.local).
 * Scan shipped HTML for "/<segment>/_next/" (excluding site-root "/_next/") and rewrite those too.
 */
function discoverBasePathPrefixesFromHtml(dir) {
  const found = new Set();
  const scanFiles = [path.join(dir, 'index.html'), path.join(dir, '404', 'index.html')];
  for (const fp of scanFiles) {
    if (!fs.existsSync(fp)) continue;
    const html = fs.readFileSync(fp, 'utf8');
    const re = /href="(\/[A-Za-z0-9][A-Za-z0-9._-]{0,62})\/_next\//g;
    let m;
    while ((m = re.exec(html)) !== null) found.add(m[1]);
  }
  return [...found];
}

const discoveredPrefixes = discoverBasePathPrefixesFromHtml(releaseDir);
const assetPrefixes = new Set();
if (basePrefixFromEnv) assetPrefixes.add(basePrefixFromEnv);
for (const p of discoveredPrefixes) assetPrefixes.add(p);
const sortedPrefixes = [...assetPrefixes].sort((a, b) => b.length - a.length);

function rewriteOneFileContent(s, prefixes) {
  let out = s;
  for (const p of prefixes) {
    const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`"${esc}/_next/`, 'g'), '"./_next/');
    out = out.replace(new RegExp(`\\\\"${esc}/_next/`, 'g'), '\\"./_next/');
    out = out.replace(new RegExp(`'${esc}/_next/`, 'g'), `'./_next/`);
    out = out.replace(new RegExp(`"${esc}/favicon\\.ico`, 'g'), '"./favicon.ico');
    out = out.replace(new RegExp(`\\\\"${esc}/favicon\\.ico`, 'g'), '\\"./favicon.ico');
    out = out.replace(new RegExp(`'${esc}/favicon\\.ico`, 'g'), `'./favicon.ico`);
  }
  out = out.replace(/"\/_next\//g, '"./_next/');
  out = out.replace(/\\"\/_next\//g, '\\"./_next/');
  out = out.replace(/'\/_next\//g, `'./_next/`);
  out = out.replace(/"\/favicon\.ico/g, '"./favicon.ico');
  out = out.replace(/\\"\/favicon\.ico/g, '\\"./favicon.ico');
  out = out.replace(/'\/favicon\.ico/g, `'./favicon.ico`);
  return out;
}

/**
 * Rewrite Next asset URLs to ./ so the static export works when served from a subdirectory
 * (e.g. https://example.com/DayTracker/) without relying on the server mapping /_next at site root.
 */
function rewriteAssetPaths(dir, prefixes) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      rewriteAssetPaths(full, prefixes);
    } else if (e.isFile() && (e.name.endsWith('.html') || e.name.endsWith('.js'))) {
      let s = fs.readFileSync(full, 'utf8');
      const before = s;
      s = rewriteOneFileContent(s, prefixes);
      if (s !== before) fs.writeFileSync(full, s, 'utf8');
    }
  }
}
rewriteAssetPaths(releaseDir, sortedPrefixes);

if (sortedPrefixes.length) {
  console.log('Asset URL rewrite: ' + sortedPrefixes.join(', ') + ' -> ./_next/ (and favicon)');
} else {
  console.log('Asset URL rewrite: /_next/ -> ./_next/ (site root export)');
}
console.log('Release folder ready at ./release/');
console.log('Upload the entire release/ folder (index.html and _next/ side by side). Do not upload out/ alone.');

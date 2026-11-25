'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const shaCache = new Map(); // "filePath|mtimeMs|size" -> sha256Hex
const DEFAULT_USER_AGENT = 'Esteban-Cloud-Desktop';

function parseSemver(v) {
  const m = String(v || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return [0, 0, 0];
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

function extractVersionFromSetupName(fileName) {
  const m = String(fileName || '').match(/^Esteban-Mesh-Office-Setup-(\d+\.\d+\.\d+)\.exe$/i);
  return m ? m[1] : null;
}

function computeFileSha256(filePath) {
  const st = fs.statSync(filePath);
  const key = `${filePath}|${st.mtimeMs}|${st.size}`;
  if (shaCache.has(key)) return shaCache.get(key);
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(1024 * 1024);
  try {
    let bytesRead = 0;
    while ((bytesRead = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  const hex = hash.digest('hex').toUpperCase();
  shaCache.set(key, hex);
  return hex;
}

function findLatestLocalRelease(candidateDirs) {
  const dirs = (candidateDirs || []).filter(Boolean);
  let best = null;

  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
      for (const name of fs.readdirSync(dir)) {
        const version = extractVersionFromSetupName(name);
        if (!version) continue;
        const fullPath = path.join(dir, name);
        const st = fs.statSync(fullPath);
        if (!st.isFile()) continue;
        if (!best || compareSemver(version, best.version) > 0 || (compareSemver(version, best.version) === 0 && st.mtimeMs > best.mtimeMs)) {
          best = {
            version,
            fileName: name,
            fullPath,
            size: st.size,
            mtimeMs: st.mtimeMs,
            releaseDate: st.mtime.toISOString(),
            sourceDir: dir
          };
        }
      }
    } catch {
      // Ignore unreadable directory
    }
  }

  if (!best) return null;
  return {
    ...best,
    sha256: computeFileSha256(best.fullPath)
  };
}

function getDefaultUpdateDirs(configuredDir, appRootDir) {
  const list = [];
  if (configuredDir) {
    list.push(configuredDir);
    list.push(path.join(configuredDir, 'release'));
  }
  list.push('E:\\CODE\\ESTEBAN MESH OFFICE\\release');
  list.push('E:\\CODE\\ESTEBAN MESH OFFICE');
  if (appRootDir) list.push(path.join(appRootDir, 'release'));
  list.push(path.join(os.homedir(), 'Esteban Nicola', 'Apps', 'MY APPS', 'Esteban Mesh Office', 'release'));
  return Array.from(new Set(list));
}

function requestWithRedirects(targetUrl, { headers = {}, timeout = 30000, maxRedirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const attempt = (currentUrl, redirectsLeft) => {
      let u;
      try {
        u = new URL(currentUrl);
      } catch (err) {
        return reject(new Error(`URL de actualización inválida: ${currentUrl}`));
      }
      const lib = u.protocol === 'https:' ? https : http;
      const reqHeaders = { 'User-Agent': DEFAULT_USER_AGENT, ...headers };
      const req = lib.request(u, { method: 'GET', headers: reqHeaders, timeout }, (res) => {
        const status = res.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) {
            return reject(new Error('Demasiadas redirecciones al descargar la actualización.'));
          }
          const nextUrl = new URL(res.headers.location, u).toString();
          return attempt(nextUrl, redirectsLeft - 1);
        }
        resolve({ res, finalUrl: u.toString() });
      });
      req.on('timeout', () => req.destroy(new Error('Tiempo agotado descargando la actualización.')));
      req.on('error', reject);
      req.end();
    };
    attempt(targetUrl, maxRedirects);
  });
}

async function fetchTextWithRedirects(targetUrl, { headers = {}, timeout = 8000, maxRedirects = 5 } = {}) {
  const { res } = await requestWithRedirects(targetUrl, { headers, timeout, maxRedirects });
  return new Promise((resolve, reject) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('error', reject);
    res.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (res.statusCode >= 200 && res.statusCode < 300) {
        resolve({ status: res.statusCode, text, headers: res.headers });
      } else {
        reject(new Error(`HTTP ${res.statusCode}`));
      }
    });
  });
}

function extractSha256FromText(text, fileName) {
  const raw = String(text || '');
  if (!raw) return '';
  if (fileName) {
    const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const lineRe = new RegExp(`([A-Fa-f0-9]{64})\\s+\\*?${escaped}`, 'i');
    const mLine = raw.match(lineRe);
    if (mLine) return mLine[1].toUpperCase();
  }
  const labeled = raw.match(/SHA-?256[^A-Fa-f0-9]{0,12}([A-Fa-f0-9]{64})/i);
  if (labeled) return labeled[1].toUpperCase();
  const bare = raw.trim().match(/^([A-Fa-f0-9]{64})(?:\s|$)/);
  return bare ? bare[1].toUpperCase() : '';
}

function parseGitHubReleaseAsset(releaseJson) {
  if (!releaseJson || typeof releaseJson !== 'object') return null;
  const assets = Array.isArray(releaseJson.assets) ? releaseJson.assets : [];

  let installerAsset = assets.find((a) => extractVersionFromSetupName(a && a.name));
  if (!installerAsset) {
    installerAsset = assets.find((a) => a && /\.exe$/i.test(String(a.name || '')) && a.browser_download_url);
  }

  const tagVersion = String(releaseJson.tag_name || '').trim().replace(/^v/i, '');
  const assetVersion = installerAsset ? extractVersionFromSetupName(installerAsset.name) : null;
  const version = assetVersion || tagVersion;
  if (!version) return null;

  let sha256 = '';
  if (installerAsset && typeof installerAsset.digest === 'string') {
    const dm = installerAsset.digest.match(/^sha256:([A-Fa-f0-9]{64})$/i);
    if (dm) sha256 = dm[1].toUpperCase();
  }
  if (!sha256 && releaseJson.body) {
    sha256 = extractSha256FromText(releaseJson.body, installerAsset ? installerAsset.name : '');
  }

  const checksumAsset = assets.find((a) =>
    a && a.browser_download_url && /(sha256sums?\.txt|\.sha256)$/i.test(String(a.name || ''))
  );

  return {
    version,
    fileName: installerAsset ? installerAsset.name : `Esteban-Cloud-Setup-${version}.exe`,
    size: installerAsset ? Number(installerAsset.size || 0) : 0,
    downloadUrl: installerAsset ? String(installerAsset.browser_download_url || '') : '',
    sha256,
    sha256AssetUrl: checksumAsset ? String(checksumAsset.browser_download_url || '') : '',
    htmlUrl: String(releaseJson.html_url || ''),
    releaseDate: String(releaseJson.published_at || releaseJson.created_at || ''),
    notes: String(releaseJson.body || '')
  };
}

async function fetchGitHubLatestRelease(repo, { apiBaseUrl = 'https://api.github.com', timeout = 7000 } = {}) {
  const cleanRepo = String(repo || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(cleanRepo)) {
    throw new Error(`Repositorio GitHub inválido: ${repo}`);
  }
  const base = String(apiBaseUrl || 'https://api.github.com').replace(/\/+$/, '');
  const { text } = await fetchTextWithRedirects(`${base}/repos/${cleanRepo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
    timeout
  });
  const parsedJson = JSON.parse(text);
  const parsed = parseGitHubReleaseAsset(parsedJson);
  if (!parsed) return null;

  if (!parsed.sha256 && parsed.sha256AssetUrl) {
    try {
      const sumRes = await fetchTextWithRedirects(parsed.sha256AssetUrl, { timeout: 5000 });
      parsed.sha256 = extractSha256FromText(sumRes.text, parsed.fileName);
    } catch {
      // Checksum file optional
    }
  }
  return { ...parsed, repo: cleanRepo };
}

function selectBestUpdateCandidate(candidates) {
  const priority = { local: 3, peer: 2, github: 1 };
  let best = null;
  for (const c of (candidates || [])) {
    if (!c || !c.version) continue;
    if (!best) {
      best = c;
      continue;
    }
    const cmp = compareSemver(c.version, best.version);
    if (cmp > 0) {
      best = c;
    } else if (cmp === 0 && (priority[c.sourceType] || 0) > (priority[best.sourceType] || 0)) {
      best = c;
    }
  }
  return best;
}

async function downloadFileWithProgress(targetUrl, destPath, { expectedSha256, onProgress, headers = {}, maxRedirects = 5 } = {}) {
  const { res } = await requestWithRedirects(targetUrl, { headers, timeout: 120000, maxRedirects });
  if (res.statusCode !== 200) {
    res.resume();
    throw new Error(`Error descargando actualización: HTTP ${res.statusCode}`);
  }

  return new Promise((resolve, reject) => {
    const totalBytes = Number(res.headers['content-length'] || 0);
    const headerSha = String(res.headers['x-update-sha256'] || '').trim().toUpperCase();
    const shaExpected = String(expectedSha256 || headerSha || '').trim().toUpperCase();

    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const ws = fs.createWriteStream(destPath);
    const hash = crypto.createHash('sha256');
    let received = 0;

    res.on('data', (chunk) => {
      received += chunk.length;
      hash.update(chunk);
      if (onProgress) {
        onProgress({
          received,
          total: totalBytes,
          percent: totalBytes > 0 ? Math.min(100, Math.round((received / totalBytes) * 100)) : 0
        });
      }
    });

    res.on('error', (err) => {
      try { ws.destroy(); } catch {}
      reject(err);
    });

    res.pipe(ws);
    ws.on('finish', () => {
      const actualSha = hash.digest('hex').toUpperCase();
      if (shaExpected && actualSha !== shaExpected) {
        try { fs.unlinkSync(destPath); } catch {}
        return reject(new Error(`Verificación SHA-256 fallida. Esperado ${shaExpected.slice(0, 12)}..., recibido ${actualSha.slice(0, 12)}...`));
      }
      resolve({ destPath, size: received, sha256: actualSha });
    });
    ws.on('error', reject);
  });
}

function buildSelfUpdateLauncherCmd(installerExePath, appExePath) {
  return `@echo off
setlocal
timeout /t 2 /nobreak >nul
"${installerExePath}" /S
if exist "${appExePath}" (
  start "" "${appExePath}"
)
del "%~f0" >nul 2>&1
`;
}

module.exports = {
  parseSemver,
  compareSemver,
  extractVersionFromSetupName,
  computeFileSha256,
  findLatestLocalRelease,
  getDefaultUpdateDirs,
  extractSha256FromText,
  parseGitHubReleaseAsset,
  fetchGitHubLatestRelease,
  selectBestUpdateCandidate,
  downloadFileWithProgress,
  buildSelfUpdateLauncherCmd
};

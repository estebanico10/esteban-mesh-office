'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const net = require('net');
const dgram = require('dgram');
const http = require('http');
const { execFile, execFileSync, spawn } = require('child_process');
const { KEY_PREFIX, parseKeyBundle } = require('./crypto-keys.cjs');

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '$RECYCLE.BIN',
  'System Volume Information'
]);

/**
 * Scans USB drives, extra directories, keyVault, and authorizedKeys
 * to return a unified list of available .ecloudkey bundles and local keys.
 */
function scanAllAvailableKeys({
  usbDrives = [],
  extraDirs = [],
  keyVault = {},
  authorizedKeys = []
} = {}) {
  const byKeyId = new Map();
  const authMap = new Map();

  if (Array.isArray(authorizedKeys)) {
    for (const ak of authorizedKeys) {
      if (ak && ak.keyId) {
        authMap.set(ak.keyId, ak);
      }
    }
  }

  const candidateDirs = [];
  const seenCandidateDirs = new Set();

  if (Array.isArray(usbDrives)) {
    for (const u of usbDrives) {
      if (!u || !u.root) continue;
      const driveName = u.drive || u.root;
      const roots = [u.root, path.join(u.root, 'Esteban-Cloud-Kit')];
      for (const dir of roots) {
        const norm = path.resolve(dir);
        const tagKey = `usb::${driveName}::${norm}`;
        if (!seenCandidateDirs.has(tagKey)) {
          seenCandidateDirs.add(tagKey);
          candidateDirs.push({ dir: norm, isUsb: true, drive: driveName });
        }
      }
    }
  }

  if (Array.isArray(extraDirs)) {
    for (const dir of extraDirs) {
      if (!dir || typeof dir !== 'string') continue;
      const norm = path.resolve(dir);
      const tagKey = `dir::${norm}`;
      if (!seenCandidateDirs.has(tagKey)) {
        seenCandidateDirs.add(tagKey);
        candidateDirs.push({ dir: norm, isUsb: false, drive: null });
      }
    }
  }

  for (const candidate of candidateDirs) {
    let entries;
    try {
      if (!fs.existsSync(candidate.dir)) continue;
      const st = fs.statSync(candidate.dir);
      if (!st.isDirectory()) continue;
      entries = fs.readdirSync(candidate.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.toLowerCase().endsWith('.ecloudkey')) continue;

      const fullPath = path.join(candidate.dir, entry.name);
      let rawText;
      let bundle;
      try {
        rawText = fs.readFileSync(fullPath, 'utf8');
        bundle = parseKeyBundle(rawText);
      } catch {
        continue;
      }

      const meta = bundle.meta || {};
      const keyId = meta.keyId || entry.name;

      let record = byKeyId.get(keyId);
      if (!record) {
        record = {
          keyId,
          bundle,
          fileName: entry.name,
          locations: [],
          usbLocations: []
        };
        byKeyId.set(keyId, record);
      }

      if (!record.locations.includes(fullPath)) {
        record.locations.push(fullPath);
      }

      if (candidate.isUsb) {
        const existsUsb = record.usbLocations.some((ul) => ul.filePath === fullPath);
        if (!existsUsb) {
          record.usbLocations.push({
            drive: candidate.drive,
            filePath: fullPath,
            fileName: entry.name
          });
        }
      }
    }
  }

  const results = [];

  for (const [keyId, record] of byKeyId.entries()) {
    const bundle = record.bundle;
    const meta = bundle.meta || {};
    const vaultEntry = keyVault && keyVault[keyId] ? keyVault[keyId] : null;
    const authEntry = authMap.get(keyId) || null;
    const primaryPath = record.locations[0] || '';
    const fileName = primaryPath ? path.basename(primaryPath) : record.fileName;

    const shareIds =
      (Array.isArray(vaultEntry?.shareIds) && vaultEntry.shareIds.length > 0
        ? vaultEntry.shareIds
        : null) ||
      (Array.isArray(authEntry?.shareIds) && authEntry.shareIds.length > 0
        ? authEntry.shareIds
        : null) ||
      ['*'];

    const isTotal = shareIds.includes('*');
    const bundleJson = JSON.stringify(bundle, null, 2);
    const clipboardString =
      KEY_PREFIX + Buffer.from(JSON.stringify(bundle), 'utf8').toString('base64');

    results.push({
      keyId,
      label: vaultEntry?.label || authEntry?.label || meta.label || fileName,
      nodeName: meta.nodeName || vaultEntry?.nodeName || '',
      tailscaleIp: meta.tailscaleIp || '',
      lanIp: meta.lanIp || '',
      port: Number(meta.port) || 4789,
      permissions: meta.permissions || authEntry?.permissions || 'rw',
      shareIds,
      isTotal,
      createdAt: meta.createdAt || authEntry?.createdAt || '',
      passphrase: vaultEntry?.passphrase || '',
      primaryPath,
      fileName,
      locations: record.locations,
      usbLocations: record.usbLocations,
      bundleJson,
      clipboardString,
      isLocalHostKey: Boolean(authEntry && !authEntry.revoked),
      revoked: Boolean(authEntry && authEntry.revoked)
    });
  }

  // Include any key in authorizedKeys that didn't have a .ecloudkey file on disk yet
  for (const [keyId, authEntry] of authMap.entries()) {
    if (byKeyId.has(keyId)) continue;
    const vaultEntry = keyVault && keyVault[keyId] ? keyVault[keyId] : null;
    const shareIds =
      (Array.isArray(vaultEntry?.shareIds) && vaultEntry.shareIds.length > 0
        ? vaultEntry.shareIds
        : null) ||
      (Array.isArray(authEntry?.shareIds) && authEntry.shareIds.length > 0
        ? authEntry.shareIds
        : null) ||
      ['*'];

    const isTotal = shareIds.includes('*');
    let bundleJson = vaultEntry?.bundleJson || '';
    let clipboardString = vaultEntry?.clipboardString || '';
    if (!clipboardString && vaultEntry?.bundle) {
      try {
        bundleJson = bundleJson || JSON.stringify(vaultEntry.bundle, null, 2);
        clipboardString =
          KEY_PREFIX + Buffer.from(JSON.stringify(vaultEntry.bundle), 'utf8').toString('base64');
      } catch {
        // ignore
      }
    }

    results.push({
      keyId,
      label: vaultEntry?.label || authEntry.label || keyId,
      nodeName: vaultEntry?.nodeName || authEntry.nodeName || '',
      tailscaleIp: vaultEntry?.tailscaleIp || '',
      lanIp: vaultEntry?.lanIp || '',
      port: Number(vaultEntry?.port) || 4789,
      permissions: authEntry.permissions || vaultEntry?.permissions || 'rw',
      shareIds,
      isTotal,
      createdAt: authEntry.createdAt || vaultEntry?.createdAt || '',
      passphrase: vaultEntry?.passphrase || '',
      primaryPath: '',
      fileName: '',
      locations: [],
      usbLocations: [],
      bundleJson,
      clipboardString,
      isLocalHostKey: Boolean(!authEntry.revoked),
      revoked: Boolean(authEntry.revoked)
    });
  }

  results.sort((a, b) => {
    if (a.isLocalHostKey !== b.isLocalHostKey) {
      return a.isLocalHostKey ? -1 : 1;
    }
    if (a.revoked !== b.revoked) {
      return a.revoked ? 1 : -1;
    }
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });

  return results;
}

/**
 * Tests TCP connectivity to host:port within timeoutMs.
 */
function checkTcpPort(host, port, timeoutMs = 1800) {
  return new Promise((resolve) => {
    const numericPort = Number(port);
    const startTime = Date.now();
    const socket = new net.Socket();
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      resolve(result);
    };

    socket.setTimeout(timeoutMs);

    socket.once('connect', () => {
      const latencyMs = Math.max(0, Date.now() - startTime);
      finish({ port: numericPort, open: true, latencyMs });
    });

    socket.once('timeout', () => {
      finish({ port: numericPort, open: false, latencyMs: null, error: 'TIMEOUT' });
    });

    socket.once('error', (err) => {
      finish({
        port: numericPort,
        open: false,
        latencyMs: null,
        error: err && (err.code || err.message) ? String(err.code || err.message) : 'ERROR'
      });
    });

    try {
      socket.connect(numericPort, host);
    } catch (err) {
      finish({
        port: numericPort,
        open: false,
        latencyMs: null,
        error: err && err.message ? err.message : 'CONNECT_ERROR'
      });
    }
  });
}

function fetchPeerAppInfo(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };

    const req = http.get(
      {
        hostname: host,
        port: Number(port) || 4789,
        path: '/api/info',
        timeout: timeoutMs
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return finish(null);
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            finish({
              app: parsed.app,
              version: parsed.version,
              nodeName: parsed.nodeName
            });
          } catch {
            finish(null);
          }
        });
      }
    );

    req.once('timeout', () => {
      req.destroy();
      finish(null);
    });

    req.once('error', () => {
      finish(null);
    });
  });
}

/**
 * Probes key services on a peer (Esteban Cloud HTTP, SMB, RDP, SSH) and queries /api/info.
 */
async function diagnosePeerConnection({ host, port = 4789, timeoutMs = 2000 } = {}) {
  if (!host || typeof host !== 'string' || !host.trim()) {
    throw new Error('Se requiere un host o dirección IP válida.');
  }
  const cleanHost = host.trim();
  const cloudPort = Number(port) || 4789;

  const targets = [
    { port: cloudPort, service: 'Esteban Cloud (HTTP/WebDAV/Chat)' },
    { port: 445, service: 'Compartición Windows SMB (\\\\IP\\)' },
    { port: 3389, service: 'Escritorio Remoto Windows (RDP)' },
    { port: 22, service: 'OpenSSH Server (SFTP/SSH)' }
  ];

  const [probeResults, appInfo] = await Promise.all([
    Promise.all(
      targets.map(async (t) => {
        const res = await checkTcpPort(cleanHost, t.port, timeoutMs);
        return {
          ...res,
          service: t.service
        };
      })
    ),
    fetchPeerAppInfo(cleanHost, cloudPort, timeoutMs)
  ]);

  return {
    host: cleanHost,
    timestamp: new Date().toISOString(),
    online: Boolean(probeResults.some((p) => p.open)),
    appInfo,
    ports: probeResults
  };
}

/**
 * Walks shared folders to provide fast search, largest file rankings, and duplicate detection.
 */
function scanSharedStorage({
  shares = [],
  query = '',
  maxFiles = 1500,
  topLimit = 25
} = {}) {
  const allFiles = [];
  let totalScannedBytes = 0;

  const walkShareDir = (share, currentDir, depth) => {
    if (depth > 5 || allFiles.length >= maxFiles) return;
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (allFiles.length >= maxFiles) break;
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        walkShareDir(share, path.join(currentDir, entry.name), depth + 1);
      } else if (entry.isFile()) {
        const fullPath = path.join(currentDir, entry.name);
        let st;
        try {
          st = fs.statSync(fullPath);
        } catch {
          continue;
        }
        const relPath = path.relative(share.path, fullPath);
        totalScannedBytes += st.size;
        allFiles.push({
          name: entry.name,
          relPath,
          fullPath,
          shareId: share.id,
          shareName: share.name,
          size: st.size,
          mtime: st.mtime.toISOString(),
          ext: path.extname(entry.name).toLowerCase()
        });
      }
    }
  };

  if (Array.isArray(shares)) {
    for (const share of shares) {
      if (!share || !share.path || share.enabled === false) continue;
      if (allFiles.length >= maxFiles) break;
      try {
        if (fs.existsSync(share.path) && fs.statSync(share.path).isDirectory()) {
          walkShareDir(share, share.path, 0);
        }
      } catch {
        continue;
      }
    }
  }

  const cleanQuery = String(query || '').trim().toLowerCase();
  let matches;
  if (cleanQuery) {
    matches = allFiles
      .filter(
        (f) =>
          f.name.toLowerCase().includes(cleanQuery) ||
          f.relPath.toLowerCase().includes(cleanQuery)
      )
      .slice(0, 100);
  } else {
    matches = [...allFiles]
      .sort((a, b) => String(b.mtime).localeCompare(String(a.mtime)))
      .slice(0, 50);
  }

  const largestFiles = [...allFiles]
    .sort((a, b) => b.size - a.size)
    .slice(0, topLimit);

  const dupGroups = new Map();
  for (const file of allFiles) {
    if (file.size <= 1024) continue;
    const key = `${file.name.toLowerCase()}::${file.size}`;
    let group = dupGroups.get(key);
    if (!group) {
      group = [];
      dupGroups.set(key, group);
    }
    group.push(file);
  }

  const potentialDuplicates = [];
  for (const [key, files] of dupGroups.entries()) {
    if (files.length >= 2) {
      const size = files[0].size;
      const count = files.length;
      potentialDuplicates.push({
        key,
        name: files[0].name,
        size,
        count,
        wastedBytes: size * (count - 1),
        files
      });
    }
  }
  potentialDuplicates.sort((a, b) => b.wastedBytes - a.wastedBytes);

  return {
    totalScannedFiles: allFiles.length,
    totalScannedBytes,
    matches,
    largestFiles,
    potentialDuplicates
  };
}

/**
 * Streams a file and computes both SHA-256 and MD5 in uppercase hex.
 */
function computeFileHashSummary(filePath) {
  return new Promise((resolve, reject) => {
    if (!filePath || typeof filePath !== 'string') {
      return reject(new Error('Ruta de archivo inválida.'));
    }
    let st;
    try {
      st = fs.statSync(filePath);
      if (!st.isFile()) {
        return reject(new Error('La ruta especificada no es un archivo.'));
      }
    } catch (err) {
      return reject(err);
    }

    const sha256 = crypto.createHash('sha256');
    const md5 = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (chunk) => {
      sha256.update(chunk);
      md5.update(chunk);
    });

    stream.on('error', (err) => {
      reject(err);
    });

    stream.on('end', () => {
      resolve({
        filePath,
        fileName: path.basename(filePath),
        size: st.size,
        sha256: sha256.digest('hex').toUpperCase(),
        md5: md5.digest('hex').toUpperCase(),
        mtime: st.mtime.toISOString()
      });
    });
  });
}

/**
 * Pure Node fast recursive folder sync with optional mirror deletion.
 */
function runFolderSync({ sourceDir, targetDir, mirror = false } = {}) {
  if (!sourceDir || typeof sourceDir !== 'string' || !fs.existsSync(sourceDir)) {
    throw new Error('La carpeta de origen no existe.');
  }
  const srcStatRoot = fs.statSync(sourceDir);
  if (!srcStatRoot.isDirectory()) {
    throw new Error('La ruta de origen no es un directorio.');
  }
  if (!targetDir || typeof targetDir !== 'string' || !targetDir.trim()) {
    throw new Error('Debes especificar una carpeta de destino válida.');
  }

  const resolvedSource = path.resolve(sourceDir);
  const resolvedTarget = path.resolve(targetDir);
  if (resolvedSource.toLowerCase() === resolvedTarget.toLowerCase()) {
    throw new Error('La carpeta de origen y destino no pueden ser la misma.');
  }

  const startTime = Date.now();
  fs.mkdirSync(resolvedTarget, { recursive: true });

  let filesCopied = 0;
  let filesSkipped = 0;
  let filesDeleted = 0;
  let bytesCopied = 0;

  const SKIP_SYNC_DIRS = new Set(['.git', 'node_modules']);

  const countAndRemoveTargetTree = (dirPath) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        countAndRemoveTargetTree(full);
      } else {
        try {
          fs.unlinkSync(full);
          filesDeleted += 1;
        } catch {
          // ignore
        }
      }
    }
    try {
      fs.rmdirSync(dirPath);
    } catch {
      // ignore
    }
  };

  const syncRecursive = (srcCurrent, dstCurrent) => {
    fs.mkdirSync(dstCurrent, { recursive: true });
    const srcEntries = fs.readdirSync(srcCurrent, { withFileTypes: true });
    const srcNames = new Set();

    for (const entry of srcEntries) {
      if (SKIP_SYNC_DIRS.has(entry.name)) continue;
      srcNames.add(entry.name);

      const srcPath = path.join(srcCurrent, entry.name);
      const dstPath = path.join(dstCurrent, entry.name);

      if (entry.isDirectory()) {
        syncRecursive(srcPath, dstPath);
      } else if (entry.isFile()) {
        const srcStat = fs.statSync(srcPath);
        let shouldCopy = true;
        if (fs.existsSync(dstPath)) {
          try {
            const dstStat = fs.statSync(dstPath);
            if (
              dstStat.isFile() &&
              dstStat.size === srcStat.size &&
              Math.abs(srcStat.mtimeMs - dstStat.mtimeMs) <= 1000
            ) {
              shouldCopy = false;
            }
          } catch {
            shouldCopy = true;
          }
        }

        if (shouldCopy) {
          fs.copyFileSync(srcPath, dstPath);
          try {
            fs.utimesSync(dstPath, srcStat.atime, srcStat.mtime);
          } catch {
            // ignore utimes issues on restricted FS
          }
          filesCopied += 1;
          bytesCopied += srcStat.size;
        } else {
          filesSkipped += 1;
        }
      }
    }

    if (mirror) {
      let dstEntries = [];
      try {
        dstEntries = fs.readdirSync(dstCurrent, { withFileTypes: true });
      } catch {
        dstEntries = [];
      }
      for (const dstEntry of dstEntries) {
        if (SKIP_SYNC_DIRS.has(dstEntry.name)) continue;
        if (!srcNames.has(dstEntry.name)) {
          const orphanPath = path.join(dstCurrent, dstEntry.name);
          if (dstEntry.isDirectory()) {
            countAndRemoveTargetTree(orphanPath);
          } else {
            try {
              fs.unlinkSync(orphanPath);
              filesDeleted += 1;
            } catch {
              // ignore
            }
          }
        }
      }
    }
  };

  syncRecursive(resolvedSource, resolvedTarget);

  return {
    ok: true,
    sourceDir,
    targetDir,
    mirror: Boolean(mirror),
    filesCopied,
    filesSkipped,
    filesDeleted,
    bytesCopied,
    durationMs: Math.max(0, Date.now() - startTime),
    completedAt: new Date().toISOString()
  };
}

/**
 * Persistent or in-memory clipboard history store (max 30 items).
 */
class ClipboardHistoryStore {
  constructor(filePath = null, maxItems = 30) {
    this.filePath = filePath;
    this.maxItems = maxItems;
    this.items = [];
    this._load();
  }

  _load() {
    if (!this.filePath) return;
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.items = parsed.slice(0, this.maxItems);
        }
      }
    } catch {
      this.items = [];
    }
  }

  _save() {
    if (!this.filePath) return;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.items, null, 2), 'utf8');
    } catch {
      // ignore disk write error
    }
  }

  addItem({ text, senderNode = 'Local', pinned = false } = {}) {
    const cleanText = String(text ?? '').trim();
    if (!cleanText) return null;

    if (this.items.length > 0 && this.items[0].text === cleanText) {
      this.items[0].createdAt = new Date().toISOString();
      this.items[0].senderNode = senderNode || this.items[0].senderNode || 'Local';
      if (pinned) {
        this.items[0].pinned = true;
      }
      this._save();
      return this.items[0];
    }

    const item = {
      id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(8).toString('hex'),
      text: cleanText,
      senderNode: String(senderNode || 'Local'),
      createdAt: new Date().toISOString(),
      pinned: Boolean(pinned)
    };

    this.items.unshift(item);
    if (this.items.length > this.maxItems) {
      this.items = this.items.slice(0, this.maxItems);
    }
    this._save();
    return item;
  }

  listItems() {
    return [...this.items];
  }

  removeItem(id) {
    const before = this.items.length;
    this.items = this.items.filter((item) => item.id !== id);
    if (this.items.length !== before) {
      this._save();
    }
    return this.items;
  }

  clear() {
    this.items = this.items.filter((item) => Boolean(item.pinned));
    this._save();
    return this.items;
  }
}

const FALLBACK_DARK_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC';

function runPowerShell(script, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(String(script), 'utf16le').toString('base64');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { timeout: timeoutMs, maxBuffer: 25 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          const msg = (stderr && String(stderr).trim()) || err.message || 'PowerShell execution failed';
          return reject(new Error(msg));
        }
        resolve(String(stdout || '').trim());
      }
    );
  });
}

/**
 * Captures the primary local screen as a resized JPEG data URL using PowerShell.
 * Falls back gracefully to a 1x1 dark PNG if running in a headless session.
 */
async function captureLocalScreenJpeg({ maxWidth = 1280, quality = 72 } = {}) {
  const safeMaxWidth = Math.max(320, Math.min(3840, Number(maxWidth) || 1280));
  const safeQuality = Math.max(20, Math.min(100, Number(quality) || 72));

  const psScript = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$srcW = [Math]::Max(1, [int]$bounds.Width)
$srcH = [Math]::Max(1, [int]$bounds.Height)

$bmp = New-Object System.Drawing.Bitmap($srcW, $srcH)
$g = [System.Drawing.Graphics]::FromImage($bmp)
try {
  $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
} catch {
  $g.Clear([System.Drawing.Color]::FromArgb(13, 17, 23))
}
$g.Dispose()

$targetW = $srcW
$targetH = $srcH
if ($srcW -gt ${safeMaxWidth}) {
  $targetW = ${safeMaxWidth}
  $targetH = [Math]::Max(1, [int][Math]::Round(($srcH * ${safeMaxWidth}) / [double]$srcW))
}

$finalBmp = $bmp
if ($targetW -ne $srcW) {
  $finalBmp = New-Object System.Drawing.Bitmap($targetW, $targetH)
  $g2 = [System.Drawing.Graphics]::FromImage($finalBmp)
  $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g2.DrawImage($bmp, 0, 0, $targetW, $targetH)
  $g2.Dispose()
  $bmp.Dispose()
}

$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
$encParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
$encParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]${safeQuality})

$ms = New-Object System.IO.MemoryStream
$finalBmp.Save($ms, $jpegCodec, $encParams)
$finalBmp.Dispose()
$bytes = $ms.ToArray()
$ms.Dispose()
[Convert]::ToBase64String($bytes)
`;

  try {
    const base64 = (await runPowerShell(psScript, 12000)).replace(/\s+/g, '');
    if (base64 && base64.length > 16) {
      return {
        ok: true,
        mime: 'image/jpeg',
        dataUrl: `data:image/jpeg;base64,${base64}`,
        capturedAt: new Date().toISOString()
      };
    }
  } catch {
    // Fallback below for headless environments
  }

  return {
    ok: true,
    mime: 'image/jpeg',
    dataUrl: `data:image/png;base64,${FALLBACK_DARK_PNG_BASE64}`,
    capturedAt: new Date().toISOString(),
    fallback: true
  };
}

/**
 * Lists top local processes sorted by WorkingSet64 (memory usage) descending.
 */
async function listTopProcesses({ limit = 15 } = {}) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 15));
  const psScript = `Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First ${safeLimit} Id, ProcessName, CPU, WorkingSet64, MainWindowTitle | ConvertTo-Json -Compress`;

  try {
    const raw = await runPowerShell(psScript, 10000);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list
      .filter(Boolean)
      .map((p) => ({
        pid: Number(p.Id) || 0,
        name: String(p.ProcessName || ''),
        cpuSeconds: p.CPU != null && Number.isFinite(Number(p.CPU)) ? Math.round(Number(p.CPU) * 10) / 10 : 0,
        memoryMB:
          p.WorkingSet64 != null && Number.isFinite(Number(p.WorkingSet64))
            ? Math.round((Number(p.WorkingSet64) / (1024 * 1024)) * 10) / 10
            : 0,
        windowTitle: String(p.MainWindowTitle || '')
      }));
  } catch {
    return [];
  }
}

/**
 * Terminates a local process by numeric PID, refusing to terminate the current process.
 */
function killLocalProcess(pid) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) {
    throw new Error('PID de proceso inválido.');
  }
  if (numericPid === process.pid) {
    throw new Error('No se permite terminar el proceso actual de Esteban Cloud.');
  }

  try {
    process.kill(numericPid);
    return { ok: true, pid: numericPid };
  } catch (err) {
    try {
      execFileSync('taskkill.exe', ['/PID', String(numericPid), '/F'], {
        stdio: 'ignore',
        windowsHide: true,
        timeout: 6000
      });
      return { ok: true, pid: numericPid };
    } catch {
      throw new Error(
        `No se pudo terminar el proceso ${numericPid}: ${err && err.message ? err.message : 'Acceso denegado'}`
      );
    }
  }
}

/**
 * Pure helper that builds a 102-byte UDP Wake-on-LAN Magic Packet (6x 0xFF + 16x MAC bytes).
 */
function buildWakeOnLanPacket(mac) {
  if (!mac || typeof mac !== 'string') {
    throw new Error('Se requiere una dirección MAC válida.');
  }
  const cleanHex = mac.trim().replace(/[:\-.\s]/g, '');
  if (!/^[0-9a-fA-F]{12}$/.test(cleanHex)) {
    throw new Error(`Formato de dirección MAC inválido: ${mac}`);
  }

  const macBytes = Buffer.from(cleanHex, 'hex');
  const packet = Buffer.alloc(102);
  packet.fill(0xff, 0, 6);
  for (let i = 0; i < 16; i += 1) {
    macBytes.copy(packet, 6 + i * 6);
  }
  return packet;
}

/**
 * Executes quick system maintenance or power actions.
 */
async function executeQuickSystemAction(action, payload = {}) {
  const cleanAction = String(action || '').trim().toLowerCase();

  if (cleanAction === 'lock-screen') {
    const child = spawn('rundll32.exe', ['user32.dll,LockWorkStation'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.unref();
    return { ok: true, action: 'lock-screen', message: 'Pantalla bloqueada.' };
  }

  if (cleanAction === 'empty-recycle-bin') {
    await runPowerShell('Clear-RecycleBin -Force -ErrorAction SilentlyContinue', 12000).catch(() => {});
    return { ok: true, action: 'empty-recycle-bin', message: 'Papelera de reciclaje vaciada.' };
  }

  if (cleanAction === 'clear-temp') {
    const tmpRoot = os.tmpdir();
    let deletedCount = 0;
    try {
      const entries = fs.readdirSync(tmpRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (
          entry.name.startsWith('esteban-cloud-') ||
          entry.name.startsWith('ecloud-')
        ) {
          const fullPath = path.join(tmpRoot, entry.name);
          try {
            fs.rmSync(fullPath, { recursive: true, force: true });
            deletedCount += 1;
          } catch {
            // ignore locked temp file
          }
        }
      }
    } catch {
      // ignore
    }
    return {
      ok: true,
      action: 'clear-temp',
      deletedCount,
      message: `Archivos temporales limpiados (${deletedCount}).`
    };
  }

  if (cleanAction === 'restart-explorer') {
    await runPowerShell('Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue', 8000).catch(() => {});
    return { ok: true, action: 'restart-explorer', message: 'Explorador de Windows reiniciado.' };
  }

  if (cleanAction === 'wake-on-lan') {
    const packet = buildWakeOnLanPacket(payload.mac);
    const broadcastAddr = String(payload.broadcastAddress || payload.ip || '255.255.255.255').trim();
    const port = Number(payload.port) || 9;

    await new Promise((resolve, reject) => {
      const socket = dgram.createSocket('udp4');
      socket.once('error', (err) => {
        try {
          socket.close();
        } catch {}
        reject(err);
      });
      socket.bind(0, () => {
        try {
          socket.setBroadcast(true);
        } catch {}
        socket.send(packet, 0, packet.length, port, broadcastAddr, (err) => {
          try {
            socket.close();
          } catch {}
          if (err) return reject(err);
          resolve();
        });
      });
    });

    return {
      ok: true,
      action: 'wake-on-lan',
      mac: payload.mac,
      bytesSent: packet.length,
      message: `Paquete mágico Wake-on-LAN enviado a ${payload.mac}.`
    };
  }

  throw new Error(`Acción del sistema no soportada: ${action}`);
}

/**
 * Saves an incoming AirDrop file (base64) to Downloads\EstebanCloud-AirDrop with collision-safe naming.
 */
function saveAirDropFile({ fileName, dataBase64, senderNode = 'Remoto', targetDir } = {}) {
  if (!fileName || typeof fileName !== 'string') {
    throw new Error('Se requiere un nombre de archivo válido para AirDrop.');
  }
  if (typeof dataBase64 !== 'string') {
    throw new Error('Se requieren datos en base64 para guardar el archivo AirDrop.');
  }

  const resolvedDir = targetDir
    ? path.resolve(targetDir)
    : path.join(os.homedir(), 'Downloads', 'EstebanCloud-AirDrop');
  fs.mkdirSync(resolvedDir, { recursive: true });

  const rawBase = path.basename(fileName.trim()).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_') || 'archivo.bin';
  const ext = path.extname(rawBase);
  const stem = ext ? rawBase.slice(0, -ext.length) : rawBase;

  let finalName = rawBase;
  let savedPath = path.join(resolvedDir, finalName);
  let counter = 1;
  while (fs.existsSync(savedPath)) {
    finalName = `${stem}-(${counter})${ext}`;
    savedPath = path.join(resolvedDir, finalName);
    counter += 1;
  }

  const cleanBase64 = dataBase64.includes(';base64,')
    ? dataBase64.split(';base64,').pop()
    : dataBase64;
  const buf = Buffer.from(cleanBase64, 'base64');
  fs.writeFileSync(savedPath, buf);

  return {
    ok: true,
    savedPath,
    fileName: finalName,
    size: buf.length,
    senderNode: String(senderNode || 'Remoto'),
    receivedAt: new Date().toISOString()
  };
}

const DEFAULT_VAULT_MASTER_KEY = 'esteban-cloud-default-vault-key';
const VAULT_ENC_PREFIX = 'ECVAULT1:';

function encryptVaultText(plainText, masterKey) {
  const effectiveKey = String(masterKey || DEFAULT_VAULT_MASTER_KEY);
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(effectiveKey, salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plainText ?? ''), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VAULT_ENC_PREFIX}${salt.toString('hex')}:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function decryptVaultText(cipherText, masterKey) {
  if (!cipherText || typeof cipherText !== 'string') return '';
  if (!cipherText.startsWith(VAULT_ENC_PREFIX)) return cipherText;
  const parts = cipherText.slice(VAULT_ENC_PREFIX.length).split(':');
  if (parts.length !== 4) {
    throw new Error('Formato de campo cifrado inválido en la bóveda.');
  }
  const [saltHex, ivHex, tagHex, dataHex] = parts;
  const salt = Buffer.from(saltHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const data = Buffer.from(dataHex, 'hex');
  const effectiveKey = String(masterKey || DEFAULT_VAULT_MASTER_KEY);
  const key = crypto.scryptSync(effectiveKey, salt, 32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString('utf8');
}

/**
 * Encrypted secret vault store backed by JSON on disk with AES-256-GCM encryption at rest for secret and notes.
 */
class EncryptedVaultStore {
  constructor(filePath = null, defaultMasterKey = DEFAULT_VAULT_MASTER_KEY) {
    this.filePath = filePath;
    this.defaultMasterKey = defaultMasterKey || DEFAULT_VAULT_MASTER_KEY;
    this.items = [];
    this._load();
  }

  _load() {
    if (!this.filePath) return;
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.items = parsed;
        } else if (parsed && Array.isArray(parsed.items)) {
          this.items = parsed.items;
        }
      }
    } catch {
      this.items = [];
    }
  }

  _save() {
    if (!this.filePath) return;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.items, null, 2), 'utf8');
    } catch {
      // ignore write errors
    }
  }

  listItems(masterKey) {
    const keyToUse = masterKey || this.defaultMasterKey;
    return this.items.map((item) => ({
      id: item.id,
      title: item.title || '',
      category: item.category || 'general',
      username: item.username || '',
      secret: decryptVaultText(item.secret, keyToUse),
      notes: decryptVaultText(item.notes, keyToUse),
      updatedAt: item.updatedAt || ''
    }));
  }

  upsertItem(
    { id, title, category = 'general', username = '', secret = '', notes = '' } = {},
    masterKey
  ) {
    const cleanTitle = String(title ?? '').trim();
    if (!cleanTitle) {
      throw new Error('El título del elemento de la bóveda es obligatorio.');
    }
    const keyToUse = masterKey || this.defaultMasterKey;
    const itemId =
      id && String(id).trim()
        ? String(id).trim()
        : crypto.randomUUID
          ? crypto.randomUUID()
          : crypto.randomBytes(8).toString('hex');
    const updatedAt = new Date().toISOString();

    const encryptedRecord = {
      id: itemId,
      title: cleanTitle,
      category: String(category || 'general').trim(),
      username: String(username ?? '').trim(),
      secret: encryptVaultText(String(secret ?? ''), keyToUse),
      notes: encryptVaultText(String(notes ?? ''), keyToUse),
      updatedAt
    };

    const existingIdx = this.items.findIndex((it) => it.id === itemId);
    if (existingIdx >= 0) {
      this.items[existingIdx] = encryptedRecord;
    } else {
      this.items.unshift(encryptedRecord);
    }

    this._save();

    return {
      id: itemId,
      title: encryptedRecord.title,
      category: encryptedRecord.category,
      username: encryptedRecord.username,
      secret: String(secret ?? ''),
      notes: String(notes ?? ''),
      updatedAt
    };
  }

  deleteItem(id) {
    const before = this.items.length;
    this.items = this.items.filter((it) => it.id !== id);
    if (this.items.length !== before) {
      this._save();
    }
    return { ok: true, id, count: this.items.length };
  }

  exportEncryptedJson() {
    return JSON.stringify(this.items, null, 2);
  }

  importEncryptedJson(rawJson) {
    let incoming = [];
    if (typeof rawJson === 'string') {
      const parsed = JSON.parse(rawJson);
      incoming = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : [];
    } else if (Array.isArray(rawJson)) {
      incoming = rawJson;
    } else if (rawJson && Array.isArray(rawJson.items)) {
      incoming = rawJson.items;
    }

    let mergedCount = 0;
    const byId = new Map(this.items.map((it) => [it.id, it]));

    for (const item of incoming) {
      if (!item || !item.id || !item.title) continue;
      const current = byId.get(item.id);
      if (!current || String(item.updatedAt || '') > String(current.updatedAt || '')) {
        byId.set(item.id, {
          id: String(item.id),
          title: String(item.title),
          category: String(item.category || 'general'),
          username: String(item.username || ''),
          secret: String(item.secret || ''),
          notes: String(item.notes || ''),
          updatedAt: item.updatedAt || new Date().toISOString()
        });
        mergedCount += 1;
      }
    }

    this.items = Array.from(byId.values()).sort((a, b) =>
      String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
    );
    this._save();
    return { ok: true, mergedCount, totalItems: this.items.length };
  }
}

const USB_FILE_MAGIC = Buffer.from('ECENC1', 'ascii'); // 6 bytes
const USB_PBKDF2_ITERATIONS = 100000;

/**
 * Encrypts a file for USB transport using PBKDF2-SHA256 (100,000 iterations) + AES-256-GCM.
 * Binary format: Magic "ECENC1" (6B) + Salt (16B) + IV (12B) + AuthTag (16B) + Ciphertext.
 */
function encryptFileForUsb({ filePath, passphrase, outputPath } = {}) {
  if (!filePath || typeof filePath !== 'string' || !fs.existsSync(filePath)) {
    throw new Error('El archivo a cifrar no existe.');
  }
  const cleanPass = String(passphrase ?? '');
  if (!cleanPass) {
    throw new Error('Se requiere una contraseña para cifrar el archivo.');
  }

  const resolvedInput = path.resolve(filePath);
  const resolvedOutput = outputPath ? path.resolve(outputPath) : `${resolvedInput}.ecloudenc`;
  const plainBuf = fs.readFileSync(resolvedInput);

  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(cleanPass, salt, USB_PBKDF2_ITERATIONS, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainBuf), cipher.final()]);
  const tag = cipher.getAuthTag();

  const outBuf = Buffer.concat([USB_FILE_MAGIC, salt, iv, tag, encrypted]);
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  fs.writeFileSync(resolvedOutput, outBuf);

  return {
    ok: true,
    outputPath: resolvedOutput,
    size: outBuf.length
  };
}

/**
 * Decrypts a .ecloudenc file encrypted by encryptFileForUsb using PBKDF2-SHA256 + AES-256-GCM.
 */
function decryptFileFromUsb({ filePath, passphrase, outputPath } = {}) {
  if (!filePath || typeof filePath !== 'string' || !fs.existsSync(filePath)) {
    throw new Error('El archivo cifrado no existe.');
  }
  const cleanPass = String(passphrase ?? '');
  if (!cleanPass) {
    throw new Error('Se requiere la contraseña para descifrar el archivo.');
  }

  const resolvedInput = path.resolve(filePath);
  const inBuf = fs.readFileSync(resolvedInput);
  const minHeaderSize = USB_FILE_MAGIC.length + 16 + 12 + 16; // 50 bytes
  if (inBuf.length < minHeaderSize) {
    throw new Error('El archivo cifrado es inválido o está truncado.');
  }

  const magic = inBuf.subarray(0, 6);
  if (!magic.equals(USB_FILE_MAGIC)) {
    throw new Error('El archivo no tiene una cabecera ECENC1 válida.');
  }

  const salt = inBuf.subarray(6, 22);
  const iv = inBuf.subarray(22, 34);
  const tag = inBuf.subarray(34, 50);
  const ciphertext = inBuf.subarray(50);

  const key = crypto.pbkdf2Sync(cleanPass, salt, USB_PBKDF2_ITERATIONS, 32, 'sha256');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  let plainBuf;
  try {
    plainBuf = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error('Contraseña incorrecta o archivo cifrado alterado.');
  }

  let resolvedOutput;
  if (outputPath) {
    resolvedOutput = path.resolve(outputPath);
  } else if (resolvedInput.toLowerCase().endsWith('.ecloudenc')) {
    resolvedOutput = resolvedInput.slice(0, -'.ecloudenc'.length);
  } else {
    resolvedOutput = `${resolvedInput}.decrypted`;
  }

  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  fs.writeFileSync(resolvedOutput, plainBuf);

  return {
    ok: true,
    outputPath: resolvedOutput,
    size: plainBuf.length
  };
}

/**
 * Converts an image file to png, jpg, bmp, or ico and optionally resizes proportionally to maxWidth.
 */
async function convertImageFile({ inputPath, outputFormat = 'png', maxWidth = 0 } = {}) {
  if (!inputPath || typeof inputPath !== 'string' || !fs.existsSync(inputPath)) {
    throw new Error('El archivo de imagen de entrada no existe.');
  }

  const resolvedInput = path.resolve(inputPath);
  const fmt = String(outputFormat || 'png').trim().toLowerCase().replace(/^\./, '');
  const allowed = new Set(['png', 'jpg', 'jpeg', 'bmp', 'ico']);
  if (!allowed.has(fmt)) {
    throw new Error(`Formato de imagen no soportado: ${outputFormat}`);
  }

  const ext = fmt === 'jpeg' ? 'jpg' : fmt;
  const dir = path.dirname(resolvedInput);
  const origExt = path.extname(resolvedInput);
  const stem = origExt ? path.basename(resolvedInput, origExt) : path.basename(resolvedInput);
  const resolvedOutput = path.join(dir, `${stem}-converted.${ext}`);
  const numericMaxW = Math.max(0, Number(maxWidth) || 0);

  const escapedIn = resolvedInput.replace(/'/g, "''");
  const escapedOut = resolvedOutput.replace(/'/g, "''");

  const psScript = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$src = [System.Drawing.Bitmap]::new('${escapedIn}')
$targetW = $src.Width
$targetH = $src.Height
$maxW = ${numericMaxW}

if ($maxW -gt 0 -and $src.Width -gt $maxW) {
  $targetW = $maxW
  $targetH = [Math]::Max(1, [int][Math]::Round(($src.Height * $maxW) / [double]$src.Width))
}

if ('${ext}' -eq 'ico') {
  $icoSize = if ($maxW -gt 0 -and $maxW -le 256) { $maxW } else { 256 }
  $targetW = [Math]::Min($src.Width, $icoSize)
  $targetH = [Math]::Min($src.Height, $icoSize)
}

$dst = New-Object System.Drawing.Bitmap($targetW, $targetH)
$g = [System.Drawing.Graphics]::FromImage($dst)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($src, 0, 0, $targetW, $targetH)
$g.Dispose()
$src.Dispose()

if ('${ext}' -eq 'jpg') {
  $dst.Save('${escapedOut}', [System.Drawing.Imaging.ImageFormat]::Jpeg)
} elseif ('${ext}' -eq 'bmp') {
  $dst.Save('${escapedOut}', [System.Drawing.Imaging.ImageFormat]::Bmp)
} elseif ('${ext}' -eq 'ico') {
  $ms = New-Object System.IO.MemoryStream
  $dst.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngBytes = $ms.ToArray()
  $ms.Dispose()
  $fs = [System.IO.File]::OpenWrite('${escapedOut}')
  $bw = New-Object System.IO.BinaryWriter($fs)
  $bw.Write([uint16]0)
  $bw.Write([uint16]1)
  $bw.Write([uint16]1)
  $wByte = if ($targetW -ge 256) { [byte]0 } else { [byte]$targetW }
  $hByte = if ($targetH -ge 256) { [byte]0 } else { [byte]$targetH }
  $bw.Write($wByte)
  $bw.Write($hByte)
  $bw.Write([byte]0)
  $bw.Write([byte]0)
  $bw.Write([uint16]1)
  $bw.Write([uint16]32)
  $bw.Write([uint32]$pngBytes.Length)
  $bw.Write([uint32]22)
  $bw.Write($pngBytes)
  $bw.Flush()
  $bw.Close()
  $fs.Close()
} else {
  $dst.Save('${escapedOut}', [System.Drawing.Imaging.ImageFormat]::Png)
}
$dst.Dispose()
`;

  await runPowerShell(psScript, 15000);
  const st = fs.statSync(resolvedOutput);
  return {
    ok: true,
    outputPath: resolvedOutput,
    size: st.size
  };
}

function runGitCommand(repoDir, args, timeoutMs = 8000) {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd: repoDir, timeout: timeoutMs, windowsHide: true },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          stdout: String(stdout || '').trim(),
          stderr: String(stderr || '').trim(),
          error: err ? err.message : null
        });
      }
    );
  });
}

/**
 * Scans immediate subfolders of rootDirs for Git repositories and returns status summary.
 */
async function scanGitProjects({ rootDirs = [] } = {}) {
  const defaultRoots = [
    'C:\\Users\\Nicola\\Esteban Nicola\\Apps\\MY APPS',
    'E:\\CODE'
  ];
  const roots = Array.isArray(rootDirs) && rootDirs.length > 0 ? rootDirs : defaultRoots;
  const repoPaths = [];
  const seen = new Set();

  for (const rootDir of roots) {
    if (!rootDir || typeof rootDir !== 'string') continue;
    let resolvedRoot;
    try {
      resolvedRoot = path.resolve(rootDir);
      if (!fs.existsSync(resolvedRoot) || !fs.statSync(resolvedRoot).isDirectory()) continue;
    } catch {
      continue;
    }

    if (fs.existsSync(path.join(resolvedRoot, '.git'))) {
      const key = resolvedRoot.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        repoPaths.push(resolvedRoot);
      }
    }

    let entries = [];
    try {
      entries = fs.readdirSync(resolvedRoot, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || IGNORED_DIRS.has(entry.name)) continue;
      const subPath = path.join(resolvedRoot, entry.name);
      try {
        if (fs.existsSync(path.join(subPath, '.git'))) {
          const key = subPath.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            repoPaths.push(subPath);
          }
        }
      } catch {
        continue;
      }
    }
  }

  const results = await Promise.all(
    repoPaths.map(async (repoPath) => {
      const [statusRes, branchRes, remoteRes] = await Promise.all([
        runGitCommand(repoPath, ['status', '--porcelain']),
        runGitCommand(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']),
        runGitCommand(repoPath, ['remote', 'get-url', 'origin'])
      ]);

      const statusLines = statusRes.stdout
        ? statusRes.stdout
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean)
        : [];

      return {
        name: path.basename(repoPath),
        path: repoPath,
        branch: branchRes.stdout || 'main',
        dirtyCount: statusLines.length,
        statusLines: statusLines.slice(0, 30),
        remoteUrl: remoteRes.ok ? remoteRes.stdout : ''
      };
    })
  );

  results.sort((a, b) => {
    if ((a.dirtyCount > 0) !== (b.dirtyCount > 0)) {
      return a.dirtyCount > 0 ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return results;
}

/**
 * Stages all changes, commits if dirty, and pushes to remote origin.
 */
async function gitQuickCommitPush({
  repoDir,
  message = 'chore: actualizacion rapida desde Esteban Cloud'
} = {}) {
  if (!repoDir || typeof repoDir !== 'string' || !fs.existsSync(repoDir)) {
    throw new Error('El directorio del repositorio Git no existe.');
  }

  const resolvedRepo = path.resolve(repoDir);
  const cleanMsg = String(message || 'chore: actualizacion rapida desde Esteban Cloud').trim();
  const outputs = [];

  const addRes = await runGitCommand(resolvedRepo, ['add', '-A'], 12000);
  if (addRes.stdout || addRes.stderr) {
    outputs.push(addRes.stdout || addRes.stderr);
  }

  const statusRes = await runGitCommand(resolvedRepo, ['status', '--porcelain'], 8000);
  const isDirty = Boolean(statusRes.stdout && statusRes.stdout.trim());

  if (isDirty) {
    const commitRes = await runGitCommand(resolvedRepo, ['commit', '-m', cleanMsg], 15000);
    outputs.push(commitRes.stdout || commitRes.stderr);
    if (!commitRes.ok) {
      return {
        ok: false,
        output: outputs.filter(Boolean).join('\n')
      };
    }
  } else {
    outputs.push('Working tree clean (sin cambios locales nuevos por confirmar).');
  }

  const pushRes = await runGitCommand(resolvedRepo, ['push'], 25000);
  outputs.push(pushRes.stdout || pushRes.stderr);

  return {
    ok: pushRes.ok,
    output: outputs.filter(Boolean).join('\n')
  };
}

module.exports = {
  scanAllAvailableKeys,
  checkTcpPort,
  diagnosePeerConnection,
  scanSharedStorage,
  computeFileHashSummary,
  runFolderSync,
  ClipboardHistoryStore,
  captureLocalScreenJpeg,
  listTopProcesses,
  killLocalProcess,
  buildWakeOnLanPacket,
  executeQuickSystemAction,
  saveAirDropFile,
  EncryptedVaultStore,
  encryptFileForUsb,
  decryptFileFromUsb,
  convertImageFile,
  scanGitProjects,
  gitQuickCommitPush
};

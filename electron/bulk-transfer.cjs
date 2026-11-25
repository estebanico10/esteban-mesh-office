'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dgram = require('dgram');
const http = require('http');
const https = require('https');
const { execFile } = require('child_process');
const { buildWakeOnLanPacket } = require('./tools.cjs');

function round2(val) {
  const n = Number(val);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function round1(val) {
  const n = Number(val);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}

function safeHeaderValue(val) {
  const str = String(val ?? '').replace(/[\r\n]+/g, ' ').trim();
  if (/^[\x20-\x7E]*$/.test(str)) {
    return str;
  }
  return encodeURIComponent(str);
}

function runPowerShellJson(script, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const encoded = Buffer.from(String(script), 'utf16le').toString('base64');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err || !stdout || !String(stdout).trim()) {
          return resolve(null);
        }
        try {
          resolve(JSON.parse(String(stdout).trim()));
        } catch {
          resolve(null);
        }
      }
    );
  });
}

function fallbackListFixedDisks() {
  if (process.platform !== 'win32') return [];
  const disks = [];
  for (let code = 67; code <= 90; code += 1) {
    const letter = String.fromCharCode(code);
    const drive = `${letter}:`;
    const root = `${drive}\\`;
    try {
      if (!fs.existsSync(root)) continue;
      let totalBytes = 0;
      let freeBytes = 0;
      if (typeof fs.statfsSync === 'function') {
        try {
          const st = fs.statfsSync(root);
          const total = Number(st.bsize) * Number(st.blocks);
          const free = Number(st.bsize) * Number(st.bavail);
          if (Number.isFinite(total) && total >= 0) totalBytes = total;
          if (Number.isFinite(free) && free >= 0) freeBytes = Math.min(totalBytes || free, free);
        } catch {
          // ignore statfs error
        }
      }
      disks.push({
        drive,
        root,
        label: 'Disco Local',
        totalBytes,
        freeBytes,
        fs: ''
      });
    } catch {
      // ignore inaccessible drive
    }
  }
  return disks;
}

/**
 * Lists fixed Windows disks (DriveType=3) via PowerShell CIM, with C:-Z: fallback.
 */
async function listFixedWindowsDisks() {
  if (process.platform !== 'win32') {
    return [];
  }

  const psScript =
    '@(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ' +
    'Select-Object DeviceID, VolumeName, FileSystem, Size, FreeSpace) | ' +
    'ConvertTo-Json -Compress';

  const parsed = await runPowerShellJson(psScript, 8000);
  if (parsed) {
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const disks = list
      .filter((d) => d && d.DeviceID)
      .map((d) => {
        const drive = String(d.DeviceID).trim().toUpperCase().replace(/\\+$/, '');
        const normalizedDrive = drive.endsWith(':') ? drive : `${drive}:`;
        const totalBytes = Math.max(0, Number(d.Size) || 0);
        const freeBytes = Math.max(0, Math.min(totalBytes || Infinity, Number(d.FreeSpace) || 0));
        return {
          drive: normalizedDrive,
          root: `${normalizedDrive}\\`,
          label: d.VolumeName ? String(d.VolumeName).trim() : 'Disco Local',
          totalBytes,
          freeBytes,
          fs: d.FileSystem ? String(d.FileSystem).trim() : ''
        };
      });
    if (disks.length > 0) {
      return disks;
    }
  }

  return fallbackListFixedDisks();
}

function normalizeDriveKey(drive) {
  const clean = String(drive || '').trim().toUpperCase().replace(/[\\/]+$/g, '');
  if (!clean) return '';
  if (/^[A-Z]$/.test(clean)) return `${clean}:`;
  if (/^[A-Z]:$/.test(clean)) return clean;
  return clean;
}

function getConfigStoreShares(configStore) {
  if (!configStore) return [];
  if (typeof configStore.getPublicConfig === 'function') {
    const cfg = configStore.getPublicConfig();
    if (cfg && Array.isArray(cfg.shares)) return cfg.shares;
  }
  if (configStore.data && Array.isArray(configStore.data.shares)) {
    return configStore.data.shares;
  }
  if (Array.isArray(configStore.shares)) {
    return configStore.shares;
  }
  return [];
}

/**
 * Shares every non-excluded fixed Windows disk via configStore, skipping already-shared paths.
 */
async function shareAllFixedDisks(configStore, { mode = 'rw', excludeDrives = [] } = {}) {
  if (!configStore) {
    throw new Error('Se requiere una instancia válida de configStore.');
  }

  const disks = await listFixedWindowsDisks();
  const excludedSet = new Set(
    (Array.isArray(excludeDrives) ? excludeDrives : [])
      .map(normalizeDriveKey)
      .filter(Boolean)
  );

  const existingShares = getConfigStoreShares(configStore);
  const existingPaths = new Set(
    existingShares
      .filter((s) => s && s.path)
      .map((s) => path.resolve(s.path).toLowerCase())
  );

  const added = [];
  const skipped = [];
  const shareMode = mode === 'ro' ? 'ro' : 'rw';

  for (const disk of disks) {
    const driveKey = normalizeDriveKey(disk.drive);
    if (excludedSet.has(driveKey)) {
      skipped.push({ drive: disk.drive, root: disk.root, reason: 'excluded' });
      continue;
    }

    const resolvedRoot = path.resolve(disk.root);
    if (existingPaths.has(resolvedRoot.toLowerCase())) {
      skipped.push({ drive: disk.drive, root: disk.root, reason: 'already_shared' });
      continue;
    }

    const letter = driveKey.replace(':', '');
    const shareName = disk.label && disk.label !== 'Disco Local'
      ? `Disco ${letter} (${disk.label})`
      : `Disco ${letter}`;

    try {
      let created;
      if (typeof configStore.addShare === 'function') {
        created = configStore.addShare({
          name: shareName,
          folderPath: resolvedRoot,
          mode: shareMode
        });
      } else {
        created = {
          id: `disk-${letter.toLowerCase()}-${crypto.randomBytes(2).toString('hex')}`,
          name: shareName,
          path: resolvedRoot,
          mode: shareMode,
          enabled: true
        };
        if (configStore.data && Array.isArray(configStore.data.shares)) {
          configStore.data.shares.push(created);
          if (typeof configStore.save === 'function') configStore.save();
        } else if (Array.isArray(configStore.shares)) {
          configStore.shares.push(created);
        }
      }
      existingPaths.add(resolvedRoot.toLowerCase());
      added.push(created);
    } catch (err) {
      skipped.push({
        drive: disk.drive,
        root: disk.root,
        reason: err && err.message ? err.message : 'add_failed'
      });
    }
  }

  return {
    added,
    skipped,
    shares: getConfigStoreShares(configStore)
  };
}

function computeFileSha256Streaming(filePath) {
  return new Promise((resolve, reject) => {
    let st;
    try {
      st = fs.statSync(filePath);
      if (!st.isFile()) {
        return reject(new Error(`La ruta no es un archivo: ${filePath}`));
      }
    } catch (err) {
      return reject(err);
    }

    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => {
      resolve({
        filePath: path.resolve(filePath),
        fileName: path.basename(filePath),
        size: st.size,
        sha256: hash.digest('hex')
      });
    });
  });
}

function resolvePeerBaseUrl(peer) {
  if (!peer) return '';
  if (peer.baseUrl && typeof peer.baseUrl === 'string' && peer.baseUrl.trim()) {
    return peer.baseUrl.trim().replace(/\/+$/, '');
  }
  const host = peer.lanIp || peer.tailscaleIp || peer.host || '';
  if (!host) return '';
  const port = Number(peer.port) || 4890;
  return `http://${host}:${port}`;
}

function resolvePeerName(peer, baseUrl) {
  return String(peer?.peerName || peer?.nodeName || peer?.label || peer?.name || baseUrl || 'Equipo').trim();
}

function buildEndpointUrl(baseUrl, endpointPath) {
  const cleanBase = String(baseUrl || '').replace(/\/+$/, '');
  return new URL(`${cleanBase}${endpointPath}`);
}

function streamFileToPeer({
  fileMeta,
  peer,
  destinationSubfolder,
  senderNode,
  onProgress,
  timeoutMs = 300000
}) {
  return new Promise((resolve) => {
    const baseUrl = resolvePeerBaseUrl(peer);
    const peerName = resolvePeerName(peer, baseUrl);
    const startMs = Date.now();

    const emitProgress = (sentBytes, status) => {
      if (typeof onProgress !== 'function') return;
      const elapsedSec = Math.max(0.001, (Date.now() - startMs) / 1000);
      const percent = fileMeta.size > 0
        ? Math.min(100, round1((sentBytes / fileMeta.size) * 100))
        : (status === 'completed' ? 100 : 0);
      const speedMBs = round2((sentBytes / (1024 * 1024)) / elapsedSec);
      try {
        onProgress({
          peerName,
          fileName: fileMeta.fileName,
          sentBytes,
          totalBytes: fileMeta.size,
          percent,
          speedMBs,
          status
        });
      } catch {
        // ignore callback errors
      }
    };

    if (!baseUrl) {
      emitProgress(0, 'error');
      return resolve({
        peerName,
        baseUrl: '',
        fileName: fileMeta.fileName,
        ok: false,
        sha256: fileMeta.sha256,
        bytes: 0,
        durationMs: 0,
        error: 'URL del equipo destino inválida.'
      });
    }

    let url;
    try {
      url = buildEndpointUrl(baseUrl, '/api/office/bulk-receive');
    } catch (err) {
      emitProgress(0, 'error');
      return resolve({
        peerName,
        baseUrl,
        fileName: fileMeta.fileName,
        ok: false,
        sha256: fileMeta.sha256,
        bytes: 0,
        durationMs: 0,
        error: err.message
      });
    }

    const transport = url.protocol === 'https:' ? https : http;
    const headers = {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(fileMeta.size),
      'X-File-Name': safeHeaderValue(fileMeta.fileName),
      'X-Subfolder': safeHeaderValue(destinationSubfolder),
      'X-Sender-Node': safeHeaderValue(senderNode),
      'X-File-Sha256': fileMeta.sha256
    };

    if (peer && (peer.token || peer.authToken)) {
      headers.Authorization = `Bearer ${peer.token || peer.authToken}`;
    }
    if (peer && peer.headers && typeof peer.headers === 'object') {
      Object.assign(headers, peer.headers);
    }

    let settled = false;
    let sentBytes = 0;
    let lastProgressAt = 0;
    let readStream = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (readStream && !readStream.destroyed) {
        try {
          readStream.destroy();
        } catch {
          // ignore
        }
      }
      resolve(result);
    };

    const req = transport.request(
      url,
      {
        method: 'POST',
        headers,
        timeout: timeoutMs,
        rejectUnauthorized: false
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const durationMs = Math.max(0, Date.now() - startMs);
          const bodyText = Buffer.concat(chunks).toString('utf8');
          const ok = res.statusCode >= 200 && res.statusCode < 300;
          if (ok) {
            emitProgress(fileMeta.size, 'completed');
            finish({
              peerName,
              baseUrl,
              fileName: fileMeta.fileName,
              ok: true,
              sha256: fileMeta.sha256,
              bytes: fileMeta.size,
              durationMs,
              error: null
            });
          } else {
            let errMsg = `HTTP ${res.statusCode}`;
            try {
              const parsed = JSON.parse(bodyText);
              if (parsed && parsed.error) errMsg = String(parsed.error);
            } catch {
              if (bodyText.trim()) errMsg = `${errMsg}: ${bodyText.trim().slice(0, 200)}`;
            }
            emitProgress(sentBytes, 'error');
            finish({
              peerName,
              baseUrl,
              fileName: fileMeta.fileName,
              ok: false,
              sha256: fileMeta.sha256,
              bytes: sentBytes,
              durationMs,
              error: errMsg
            });
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('Tiempo de espera agotado al transferir el archivo.'));
    });

    req.on('error', (err) => {
      const durationMs = Math.max(0, Date.now() - startMs);
      emitProgress(sentBytes, 'error');
      finish({
        peerName,
        baseUrl,
        fileName: fileMeta.fileName,
        ok: false,
        sha256: fileMeta.sha256,
        bytes: sentBytes,
        durationMs,
        error: err && err.message ? err.message : 'Error de red'
      });
    });

    emitProgress(0, 'sending');

    readStream = fs.createReadStream(fileMeta.filePath, { highWaterMark: 256 * 1024 });
    readStream.on('data', (chunk) => {
      sentBytes += chunk.length;
      const now = Date.now();
      if (now - lastProgressAt >= 100 || sentBytes >= fileMeta.size) {
        lastProgressAt = now;
        emitProgress(sentBytes, 'sending');
      }
    });

    readStream.on('error', (err) => {
      req.destroy(err);
    });

    readStream.pipe(req);
  });
}

/**
 * Distributes one or more local files to multiple office peers simultaneously via streaming HTTP POST,
 * hashing each file once and limiting concurrent outbound streams.
 */
async function distributeFilesToFleet({
  filePaths = [],
  targetPeers = [],
  destinationSubfolder = 'Entregas-Oficina',
  senderNode = 'Servidor',
  concurrency = 4,
  onProgress
} = {}) {
  const startMs = Date.now();
  const validFilePaths = Array.isArray(filePaths) ? filePaths.filter((p) => typeof p === 'string' && p.trim()) : [];
  const validPeers = Array.isArray(targetPeers) ? targetPeers.filter(Boolean) : [];

  if (validFilePaths.length === 0 || validPeers.length === 0) {
    return {
      totalFiles: validFilePaths.length,
      totalPeers: validPeers.length,
      totalBytes: 0,
      durationMs: 0,
      avgSpeedMBs: 0,
      results: []
    };
  }

  // Compute SHA-256 of each source file exactly once
  const fileMetas = [];
  for (const fp of validFilePaths) {
    const meta = await computeFileSha256Streaming(fp);
    fileMetas.push(meta);
  }

  // Build transfer tasks (file x peer)
  const tasks = [];
  for (const fileMeta of fileMetas) {
    for (const peer of validPeers) {
      tasks.push({ fileMeta, peer });
    }
  }

  const maxWorkers = Math.max(1, Math.min(tasks.length, Number(concurrency) || 4));
  const results = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const idx = nextIndex;
      nextIndex += 1;
      if (idx >= tasks.length) return;

      const { fileMeta, peer } = tasks[idx];
      results[idx] = await streamFileToPeer({
        fileMeta,
        peer,
        destinationSubfolder,
        senderNode,
        onProgress
      });
    }
  }

  await Promise.all(Array.from({ length: maxWorkers }, () => worker()));

  const durationMs = Math.max(1, Date.now() - startMs);
  const totalBytes = results.reduce((acc, r) => acc + (r && r.ok ? Number(r.bytes) || 0 : 0), 0);
  const avgSpeedMBs = round2((totalBytes / (1024 * 1024)) / (durationMs / 1000));

  return {
    totalFiles: fileMetas.length,
    totalPeers: validPeers.length,
    totalBytes,
    durationMs,
    avgSpeedMBs,
    results
  };
}

function sendAnnouncementToPeer(peer, payload, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const baseUrl = resolvePeerBaseUrl(peer);
    const peerName = resolvePeerName(peer, baseUrl);

    if (!baseUrl) {
      return resolve({
        peerName,
        baseUrl: '',
        ok: false,
        statusCode: 0,
        error: 'URL del equipo destino inválida.'
      });
    }

    let url;
    try {
      url = buildEndpointUrl(baseUrl, '/api/office/announcement');
    } catch (err) {
      return resolve({
        peerName,
        baseUrl,
        ok: false,
        statusCode: 0,
        error: err.message
      });
    }

    const bodyBuf = Buffer.from(JSON.stringify(payload), 'utf8');
    const transport = url.protocol === 'https:' ? https : http;
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': String(bodyBuf.length)
    };
    if (peer && (peer.token || peer.authToken)) {
      headers.Authorization = `Bearer ${peer.token || peer.authToken}`;
    }
    if (peer && peer.headers && typeof peer.headers === 'object') {
      Object.assign(headers, peer.headers);
    }

    let settled = false;
    const finish = (resObj) => {
      if (settled) return;
      settled = true;
      resolve(resObj);
    };

    const req = transport.request(
      url,
      {
        method: 'POST',
        headers,
        timeout: timeoutMs,
        rejectUnauthorized: false
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const ok = res.statusCode >= 200 && res.statusCode < 300;
          const text = Buffer.concat(chunks).toString('utf8').trim();
          finish({
            peerName,
            baseUrl,
            ok,
            statusCode: res.statusCode || 0,
            error: ok ? null : (text.slice(0, 200) || `HTTP ${res.statusCode}`)
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('Tiempo de espera agotado.'));
    });

    req.on('error', (err) => {
      finish({
        peerName,
        baseUrl,
        ok: false,
        statusCode: 0,
        error: err && err.message ? err.message : 'Error de red'
      });
    });

    req.end(bodyBuf);
  });
}

/**
 * Broadcasts an office-wide announcement in parallel to all targetPeers.
 */
async function broadcastOfficeAnnouncement({
  title = '',
  message = '',
  priority = 'normal',
  targetPeers = [],
  senderNode = 'Administración'
} = {}) {
  const validPeers = Array.isArray(targetPeers) ? targetPeers.filter(Boolean) : [];
  const payload = {
    title: String(title || '').trim(),
    message: String(message || '').trim(),
    priority: String(priority || 'normal').trim().toLowerCase(),
    senderNode: String(senderNode || 'Administración').trim(),
    sentAt: new Date().toISOString()
  };

  const results = await Promise.all(
    validPeers.map((peer) => sendAnnouncementToPeer(peer, payload))
  );

  const delivered = results.filter((r) => r.ok).length;
  const failed = results.length - delivered;

  return {
    delivered,
    failed,
    results
  };
}

function normalizeValidMac(mac) {
  if (!mac || typeof mac !== 'string') return null;
  const hex = mac.trim().replace(/[:\-.\s]/g, '').toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(hex)) return null;
  if (hex === '000000000000') return null;
  return hex.match(/.{2}/g).join(':');
}

/**
 * Sends Wake-on-LAN UDP magic packets to 255.255.255.255:9 for every unique valid MAC across nodes.
 */
async function wakeAllOfficePcs(nodes = []) {
  const macSet = new Set();

  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node) continue;
    const candidates = [];
    if (Array.isArray(node.macAddresses)) candidates.push(...node.macAddresses);
    if (typeof node.mac === 'string') candidates.push(node.mac);
    if (typeof node.macAddress === 'string') candidates.push(node.macAddress);

    for (const raw of candidates) {
      const normalized = normalizeValidMac(raw);
      if (normalized) macSet.add(normalized);
    }
  }

  const macs = Array.from(macSet);
  if (macs.length === 0) {
    return { packetsSent: 0, macs: [] };
  }

  const packets = macs.map((mac) => ({
    mac,
    buffer: buildWakeOnLanPacket(mac)
  }));

  let packetsSent = 0;

  await new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    socket.once('error', (err) => {
      try {
        socket.close();
      } catch {}
      reject(err);
    });

    socket.bind(0, async () => {
      try {
        socket.setBroadcast(true);
      } catch {
        // ignore if unsupported
      }

      try {
        for (const item of packets) {
          await new Promise((resSend, rejSend) => {
            socket.send(item.buffer, 0, item.buffer.length, 9, '255.255.255.255', (err) => {
              if (err) return rejSend(err);
              packetsSent += 1;
              resSend();
            });
          });
        }
        try {
          socket.close();
        } catch {}
        resolve();
      } catch (err) {
        try {
          socket.close();
        } catch {}
        reject(err);
      }
    });
  });

  return {
    packetsSent,
    macs
  };
}

module.exports = {
  listFixedWindowsDisks,
  shareAllFixedDisks,
  distributeFilesToFleet,
  broadcastOfficeAnnouncement,
  wakeAllOfficePcs
};

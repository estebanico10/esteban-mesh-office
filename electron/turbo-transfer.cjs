'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { URL } = require('url');
const { execFile } = require('child_process');

const STREAM_HIGH_WATER_MARK = os.totalmem() <= 8 * 1024 ** 3 ? 1024 * 1024 : 2 * 1024 * 1024; // Adaptive Eco I/O buffer

const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 15000,
  maxSockets: 32,
  maxFreeSockets: 16,
  timeout: 60000
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 15000,
  maxSockets: 32,
  maxFreeSockets: 16,
  timeout: 60000
});

function getAgentForUrl(u) {
  return u.protocol === 'https:' ? httpsAgent : httpAgent;
}

function getLibForUrl(u) {
  return u.protocol === 'https:' ? https : http;
}

function extractHostname(ipOrUrl) {
  const s = String(ipOrUrl || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) {
    try {
      return new URL(s).hostname;
    } catch {
      return '';
    }
  }
  return s.replace(/^\[|\]$/g, '').split(':')[0];
}

function isPrivateLanHost(hostOrUrl) {
  const host = extractHostname(hostOrUrl).toLowerCase();
  if (!host) return false;
  if (host === 'localhost' || host === '::1') return true;
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  if (parts[0] === 127) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  return false;
}

function isTailscaleIp(hostOrUrl) {
  const host = extractHostname(hostOrUrl);
  const parts = host.split('.').map(Number);
  return parts.length === 4 && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

function findTailscaleExe() {
  const candidates = [
    'C:\\Program Files\\Tailscale\\tailscale.exe',
    'C:\\Program Files (x86)\\Tailscale\\tailscale.exe'
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'tailscale';
}

function execFileAsync(cmd, args, timeout = 3000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: String(stdout || '').trim(),
        stderr: String(stderr || '').trim()
      });
    });
  });
}

/**
 * Inspects how Tailscale is routing traffic to a peer (direct UDP P2P vs public DERP relay).
 */
async function inspectTailscaleRoute(targetIpOrHost) {
  const host = extractHostname(targetIpOrHost);
  if (!host) {
    return { isTailscale: false, isDirect: false, curAddr: '', relay: '', routeType: 'unknown' };
  }
  if (isPrivateLanHost(host)) {
    return { isTailscale: false, isDirect: true, curAddr: host, relay: '', routeType: 'lan' };
  }

  const exe = findTailscaleExe();
  const status = await execFileAsync(exe, ['status', '--json'], 2500);
  if (!status.ok || !status.stdout) {
    return {
      isTailscale: isTailscaleIp(host),
      isDirect: false,
      curAddr: '',
      relay: '',
      routeType: isTailscaleIp(host) ? 'tailscale-unknown' : 'unknown'
    };
  }

  try {
    const data = JSON.parse(status.stdout);
    const needle = host.toLowerCase().replace(/\.$/, '');
    const peers = Object.values(data.Peer || {});
    const peer = peers.find((p) => {
      const ips = (p.TailscaleIPs || []).map((ip) => String(ip).toLowerCase());
      const dns = String(p.DNSName || '').replace(/\.$/, '').toLowerCase();
      const hn = String(p.HostName || '').toLowerCase();
      return ips.includes(needle) || dns === needle || hn === needle || dns.split('.')[0] === needle;
    });

    if (!peer) {
      return {
        isTailscale: isTailscaleIp(host),
        isDirect: false,
        curAddr: '',
        relay: '',
        routeType: isTailscaleIp(host) ? 'tailscale-unknown' : 'unknown'
      };
    }

    const curAddr = peer.CurAddr || '';
    const relay = peer.Relay || '';
    const isDirect = Boolean(curAddr);
    return {
      isTailscale: true,
      isDirect,
      curAddr,
      relay,
      routeType: isDirect ? 'tailscale-direct' : (relay ? 'tailscale-relay' : 'tailscale-unknown')
    };
  } catch {
    return {
      isTailscale: isTailscaleIp(host),
      isDirect: false,
      curAddr: '',
      relay: '',
      routeType: 'unknown'
    };
  }
}

/**
 * Triggers Tailscale DISCO/STUN UDP hole-punching (`tailscale ping`) to upgrade a slow DERP
 * relay connection into a direct peer-to-peer UDP path when possible.
 */
async function optimizeTailscaleDirectPath(targetIpOrUrl) {
  const host = extractHostname(targetIpOrUrl);
  if (!host) {
    return { isTailscale: false, isDirect: false, curAddr: '', relay: '', routeType: 'unknown' };
  }
  if (isPrivateLanHost(host)) {
    return { isTailscale: false, isDirect: true, curAddr: host, relay: '', routeType: 'lan' };
  }

  const exe = findTailscaleExe();
  await execFileAsync(exe, ['ping', '--c', '3', '--timeout', '2s', host], 5000);
  return inspectTailscaleRoute(host);
}

function probeCandidateUrl(baseUrl, token, kind, timeout = 3500) {
  return new Promise((resolve, reject) => {
    const clean = String(baseUrl || '').trim().replace(/\/$/, '');
    const u = new URL(`${clean}/api/shares`);
    const lib = getLibForUrl(u);
    const t0 = process.hrtime.bigint();

    const req = lib.request(u, {
      method: 'GET',
      agent: getAgentForUrl(u),
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      timeout
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const latencyMs = Math.max(1, Math.round(Number(process.hrtime.bigint() - t0) / 1e6));
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = raw ? JSON.parse(raw) : {}; } catch {}
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({
            baseUrl: clean,
            kind,
            hostname: u.hostname,
            latencyMs,
            sharesResponse: json !== null ? json : {}
          });
        } else {
          reject(new Error((json && json.error) || `HTTP ${res.statusCode} (${clean})`));
        }
      });
    });

    req.on('socket', (sock) => {
      try { sock.setNoDelay(true); } catch {}
    });
    req.on('timeout', () => req.destroy(new Error(`Timeout probando ${clean}`)));
    req.on('error', reject);
    req.end();
  });
}

function scoreCandidate(c) {
  // Strongly prefer local LAN / explicit override over Tailscale TUN or loopback fallback
  let bonus = 0;
  if (c.kind === 'override') bonus = -100;
  else if (c.kind === 'lan') bonus = -50;
  else if (c.kind === 'loopback-fallback') bonus = 500;
  return c.latencyMs + bonus;
}

/**
 * Probes all candidate routes (LAN IPs, Tailscale IP, Tailscale DNS) in parallel and picks the
 * lowest-latency path (preferring direct LAN whenever reachable to avoid DERP/TUN overhead).
 */
async function selectFastestBaseUrl(hostInfo = {}, token, overrideBaseUrl = '', defaultPort = 4890) {
  const candidates = [];
  const seenUrls = new Set();
  const pushCandidate = (urlStr, kind) => {
    const clean = String(urlStr || '').trim().replace(/\/$/, '');
    if (!clean || seenUrls.has(clean)) return;
    seenUrls.add(clean);
    candidates.push({ url: clean, kind });
  };

  if (overrideBaseUrl && String(overrideBaseUrl).trim()) {
    const trimmed = String(overrideBaseUrl).trim().replace(/\/$/, '');
    if (!/^https?:\/\/.+/i.test(trimmed)) {
      throw new Error('La URL manual debe comenzar con http:// o https:// (o déjala vacía para selección Turbo automática).');
    }
    pushCandidate(trimmed, 'override');
  } else {
    const port = Number(hostInfo.port) || defaultPort;
    if (hostInfo.lanIp) {
      pushCandidate(`http://${hostInfo.lanIp}:${port}`, 'lan');
    }
    if (Array.isArray(hostInfo.lanIps)) {
      for (const ip of hostInfo.lanIps) {
        if (ip) pushCandidate(`http://${ip}:${port}`, 'lan');
      }
    }
    if (hostInfo.tailscaleIp) {
      pushCandidate(`http://${hostInfo.tailscaleIp}:${port}`, 'tailscale');
    }
    if (hostInfo.tailscaleDns) {
      pushCandidate(`http://${hostInfo.tailscaleDns}:${port}`, 'dns');
    }
    pushCandidate(`http://127.0.0.1:${port}`, 'loopback-fallback');
  }

  const settled = await Promise.allSettled(
    candidates.map((c) => probeCandidateUrl(c.url, token, c.kind, 3500))
  );

  const succeeded = [];
  const errors = [];
  for (const s of settled) {
    if (s.status === 'fulfilled') succeeded.push(s.value);
    else errors.push(s.reason);
  }

  if (succeeded.length === 0) {
    throw errors[0] || new Error('No se encontró dirección alcanzable en la llave.');
  }

  succeeded.sort((a, b) => scoreCandidate(a) - scoreCandidate(b));
  const winner = succeeded[0];

  let routeInfo;
  if (winner.kind === 'lan' || isPrivateLanHost(winner.hostname)) {
    routeInfo = { isTailscale: false, isDirect: true, curAddr: winner.hostname, relay: '', routeType: 'lan' };
  } else {
    routeInfo = await inspectTailscaleRoute(winner.hostname);
    if (routeInfo.routeType === 'tailscale-relay' || routeInfo.routeType === 'tailscale-unknown') {
      routeInfo = await optimizeTailscaleDirectPath(winner.hostname).catch(() => routeInfo);
    }
  }

  return {
    baseUrl: winner.baseUrl,
    sharesResponse: winner.sharesResponse,
    shares: (winner.sharesResponse && winner.sharesResponse.shares) || [],
    latencyMs: winner.latencyMs,
    routeType: routeInfo.routeType,
    relay: routeInfo.relay || '',
    curAddr: routeInfo.curAddr || '',
    candidates: succeeded.map((c) => ({
      baseUrl: c.baseUrl,
      kind: c.kind,
      latencyMs: c.latencyMs
    }))
  };
}

function buildDownloadUrl(baseUrl, shareId, relPath, directUrl) {
  if (directUrl) return new URL(directUrl);
  const clean = String(baseUrl || '').replace(/\/$/, '');
  return new URL(`${clean}/api/download?share=${encodeURIComponent(shareId)}&path=${encodeURIComponent(relPath || '')}`);
}

async function probeRemoteFileSize(urlObj, token) {
  const lib = getLibForUrl(urlObj);
  const agent = getAgentForUrl(urlObj);
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

  const headSize = await new Promise((resolve) => {
    const req = lib.request(urlObj, { method: 'HEAD', agent, headers: authHeaders, timeout: 4000 }, (res) => {
      res.resume();
      if (res.statusCode >= 200 && res.statusCode < 300 && res.headers['content-length']) {
        resolve(Number(res.headers['content-length']) || 0);
      } else {
        resolve(0);
      }
    });
    req.on('error', () => resolve(0));
    req.on('timeout', () => { req.destroy(); resolve(0); });
    req.end();
  });
  if (headSize > 0) return headSize;

  return new Promise((resolve) => {
    const req = lib.request(urlObj, {
      method: 'GET',
      agent,
      headers: { ...authHeaders, Range: 'bytes=0-0' },
      timeout: 4000
    }, (res) => {
      const cr = String(res.headers['content-range'] || '');
      const match = /\/(\d+)$/.exec(cr);
      res.resume();
      if (match) {
        resolve(Number(match[1]) || 0);
      } else if (res.statusCode === 200 && res.headers['content-length']) {
        resolve(Number(res.headers['content-length']) || 0);
      } else {
        resolve(0);
      }
    });
    req.on('error', () => resolve(0));
    req.on('timeout', () => { req.destroy(); resolve(0); });
    req.end();
  });
}

function downloadSingleStream({ urlObj, token, destPath, knownSize = 0, onChunk, onProgress, fileName }) {
  return new Promise((resolve, reject) => {
    const lib = getLibForUrl(urlObj);
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const startedAt = Date.now();
    let received = 0;

    const req = lib.request(urlObj, { method: 'GET', agent: getAgentForUrl(urlObj), headers }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const total = Number(res.headers['content-length']) || knownSize || 0;
      const ws = fs.createWriteStream(destPath, { highWaterMark: STREAM_HIGH_WATER_MARK });

      let lastTick = 0;
      res.on('data', (chunk) => {
        received += chunk.length;
        if (onChunk) onChunk(chunk.length);
        const now = Date.now();
        if (onProgress && now - lastTick >= 140) {
          lastTick = now;
          const elapsedSec = Math.max(0.05, (now - startedAt) / 1000);
          onProgress({
            mode: 'download',
            fileName: fileName || path.basename(destPath),
            transferredBytes: received,
            totalBytes: total,
            percent: total > 0 ? Math.min(99, Math.round((received / total) * 100)) : 0,
            speedMBs: Number(((received / (1024 * 1024)) / elapsedSec).toFixed(2)),
            parallelStreams: 1,
            status: 'downloading'
          });
        }
      });

      res.pipe(ws);
      ws.on('finish', () => {
        const durationMs = Math.max(1, Date.now() - startedAt);
        const speedMBs = Number(((received / (1024 * 1024)) / (durationMs / 1000)).toFixed(2));
        if (onProgress) {
          onProgress({
            mode: 'download',
            fileName: fileName || path.basename(destPath),
            transferredBytes: received,
            totalBytes: total || received,
            percent: 100,
            speedMBs,
            parallelStreams: 1,
            status: 'completed'
          });
        }
        resolve({ ok: true, destPath, bytes: received, durationMs, speedMBs, parallelStreams: 1 });
      });
      ws.on('error', reject);
      res.on('error', reject);
    });

    req.on('socket', (sock) => {
      try { sock.setNoDelay(true); } catch {}
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Downloads a file using up to 8 concurrent HTTP Range streams when fileSize >= minParallelBytes,
 * writing chunks cleanly to their exact file offsets with bounded memory.
 */
async function turboDownloadFile({
  baseUrl,
  downloadUrl = '',
  token = '',
  shareId = '',
  relPath = '',
  destPath,
  fileSize = 0,
  concurrency = 8,
  minParallelBytes = 16 * 1024 * 1024,
  onProgress = null
}) {
  const urlObj = buildDownloadUrl(baseUrl, shareId, relPath, downloadUrl);
  const fileName = path.basename(destPath);
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });

  let totalBytes = Number(fileSize) || 0;
  if (totalBytes <= 0) {
    totalBytes = await probeRemoteFileSize(urlObj, token);
  }

  if (totalBytes < minParallelBytes || concurrency <= 1) {
    return downloadSingleStream({ urlObj, token, destPath, knownSize: totalBytes, onProgress, fileName });
  }

  const numStreams = Math.min(Math.max(2, Number(concurrency) || 8), Math.max(2, Math.floor(totalBytes / (512 * 1024))));
  const chunkSpan = Math.ceil(totalBytes / numStreams);
  const ranges = [];
  for (let i = 0; i < numStreams; i++) {
    const start = i * chunkSpan;
    if (start >= totalBytes) break;
    const end = Math.min(totalBytes - 1, (i + 1) * chunkSpan - 1);
    ranges.push({ idx: i, start, end });
  }

  const startedAt = Date.now();
  let transferredBytes = 0;
  let lastEmit = 0;
  const emitProgress = (status = 'downloading', force = false) => {
    if (!onProgress) return;
    const now = Date.now();
    if (!force && now - lastEmit < 140) return;
    lastEmit = now;
    const elapsedSec = Math.max(0.05, (now - startedAt) / 1000);
    const speedMBs = Number(((transferredBytes / (1024 * 1024)) / elapsedSec).toFixed(2));
    const percent = status === 'completed'
      ? 100
      : Math.min(99, Math.round((transferredBytes / totalBytes) * 100));
    onProgress({
      mode: 'download',
      fileName,
      transferredBytes,
      totalBytes,
      percent,
      speedMBs,
      parallelStreams: ranges.length,
      status
    });
  };

  let handle = null;
  let writeChain = Promise.resolve();
  let fallbackSingleNeeded = false;
  const activeRequests = new Set();

  const enqueueWrite = (buf, offset) => {
    const p = writeChain.then(async () => {
      if (!handle) return;
      let written = 0;
      while (written < buf.length) {
        const res = await handle.write(buf, written, buf.length - written, offset + written);
        written += res.bytesWritten;
      }
    });
    writeChain = p.catch(() => {});
    return p;
  };

  try {
    handle = await fs.promises.open(destPath, 'w');
    await handle.truncate(totalBytes);
    emitProgress('downloading', true);

    await Promise.all(
      ranges.map(({ start, end }) => new Promise((resolve, reject) => {
        const lib = getLibForUrl(urlObj);
        const headers = {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          Range: `bytes=${start}-${end}`
        };
        const expectedLen = (end - start) + 1;
        let offset = start;
        let receivedForRange = 0;

        const req = lib.request(urlObj, { method: 'GET', agent: getAgentForUrl(urlObj), headers }, (res) => {
          if (res.statusCode === 200) {
            fallbackSingleNeeded = true;
            res.resume();
            for (const r of activeRequests) {
              if (r !== req) {
                try { r.destroy(); } catch {}
              }
            }
            return resolve();
          }
          if (res.statusCode !== 206) {
            res.resume();
            return reject(new Error(`HTTP ${res.statusCode} en rango ${start}-${end}`));
          }

          let pendingWrites = 0;
          let ended = false;
          const finishIfDone = () => {
            if (ended && pendingWrites === 0) {
              if (receivedForRange !== expectedLen) {
                return reject(new Error(`Rango incompleto (${receivedForRange}/${expectedLen} bytes)`));
              }
              resolve();
            }
          };

          res.on('data', (chunk) => {
            const writeOffset = offset;
            offset += chunk.length;
            receivedForRange += chunk.length;
            transferredBytes += chunk.length;
            pendingWrites += 1;
            if (pendingWrites >= 4) res.pause();
            emitProgress('downloading', false);
            enqueueWrite(chunk, writeOffset)
              .then(() => {
                pendingWrites -= 1;
                if (pendingWrites < 4) res.resume();
                finishIfDone();
              })
              .catch(reject);
          });

          res.on('end', () => {
            ended = true;
            finishIfDone();
          });
          res.on('error', reject);
        });

        activeRequests.add(req);
        req.on('socket', (sock) => {
          try { sock.setNoDelay(true); } catch {}
        });
        req.on('close', () => activeRequests.delete(req));
        req.on('error', (err) => {
          if (fallbackSingleNeeded) return resolve();
          reject(err);
        });
        req.end();
      }))
    );

    await writeChain;
  } finally {
    if (handle) {
      await handle.close().catch(() => {});
      handle = null;
    }
  }

  if (fallbackSingleNeeded) {
    return downloadSingleStream({ urlObj, token, destPath, knownSize: totalBytes, onProgress, fileName });
  }

  const durationMs = Math.max(1, Date.now() - startedAt);
  const speedMBs = Number(((transferredBytes / (1024 * 1024)) / (durationMs / 1000)).toFixed(2));
  emitProgress('completed', true);

  return {
    ok: true,
    destPath,
    bytes: transferredBytes,
    durationMs,
    speedMBs,
    parallelStreams: ranges.length
  };
}

function turboUploadFile({ baseUrl, token, shareId, remoteDir = '', localFilePath, onChunk }) {
  return new Promise((resolve, reject) => {
    const name = path.basename(localFilePath);
    const clean = String(baseUrl || '').replace(/\/$/, '');
    const u = new URL(`${clean}/api/upload?share=${encodeURIComponent(shareId)}&path=${encodeURIComponent(remoteDir || '')}&name=${encodeURIComponent(name)}`);
    const st = fs.statSync(localFilePath);
    const lib = getLibForUrl(u);

    const req = lib.request(u, {
      method: 'POST',
      agent: getAgentForUrl(u),
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Length': st.size
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ name, bytes: st.size });
        } else {
          reject(new Error(`Error subiendo ${name}: HTTP ${res.statusCode}`));
        }
      });
    });

    req.on('socket', (sock) => {
      try { sock.setNoDelay(true); } catch {}
    });
    req.on('error', reject);

    const rs = fs.createReadStream(localFilePath, { highWaterMark: STREAM_HIGH_WATER_MARK });
    if (onChunk) {
      rs.on('data', (c) => onChunk(c.length));
    }
    rs.on('error', reject);
    rs.pipe(req);
  });
}

/**
 * Uploads multiple files concurrently (default concurrency = 4) using large 4 MB stream buffers
 * and live aggregate MB/s telemetry.
 */
async function turboUploadBatch({ baseUrl, token, shareId, remoteDir = '', filePaths = [], concurrency = 4, onProgress = null }) {
  const list = Array.from(filePaths || []).filter(Boolean);
  if (list.length === 0) return { uploaded: [], totalBytes: 0, durationMs: 0, speedMBs: 0 };

  const totalBytes = list.reduce((sum, fp) => {
    try { return sum + fs.statSync(fp).size; } catch { return sum; }
  }, 0);

  const startedAt = Date.now();
  let transferredBytes = 0;
  let lastEmit = 0;
  let currentFile = path.basename(list[0]);

  const emit = (status = 'uploading', force = false) => {
    if (!onProgress) return;
    const now = Date.now();
    if (!force && now - lastEmit < 140) return;
    lastEmit = now;
    const elapsedSec = Math.max(0.05, (now - startedAt) / 1000);
    const speedMBs = Number(((transferredBytes / (1024 * 1024)) / elapsedSec).toFixed(2));
    const percent = status === 'completed'
      ? 100
      : (totalBytes > 0 ? Math.min(99, Math.round((transferredBytes / totalBytes) * 100)) : 0);
    onProgress({
      mode: 'upload',
      fileName: list.length > 1 ? `${currentFile} (${list.length} archivos)` : currentFile,
      transferredBytes,
      totalBytes,
      percent,
      speedMBs,
      parallelStreams: Math.min(concurrency, list.length),
      status
    });
  };

  emit('uploading', true);
  const uploaded = [];
  let cursor = 0;
  const workerCount = Math.min(Math.max(1, Number(concurrency) || 4), list.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < list.length) {
        const idx = cursor++;
        const fp = list[idx];
        currentFile = path.basename(fp);
        const res = await turboUploadFile({
          baseUrl,
          token,
          shareId,
          remoteDir,
          localFilePath: fp,
          onChunk: (n) => {
            transferredBytes += n;
            emit('uploading', false);
          }
        });
        uploaded.push(res.name);
      }
    })
  );

  const durationMs = Math.max(1, Date.now() - startedAt);
  const speedMBs = Number(((transferredBytes / (1024 * 1024)) / (durationMs / 1000)).toFixed(2));
  emit('completed', true);

  return { uploaded, totalBytes, durationMs, speedMBs };
}

module.exports = {
  STREAM_HIGH_WATER_MARK,
  httpAgent,
  httpsAgent,
  isPrivateLanHost,
  isTailscaleIp,
  inspectTailscaleRoute,
  optimizeTailscaleDirectPath,
  selectFastestBaseUrl,
  probeRemoteFileSize,
  turboDownloadFile,
  turboUploadFile,
  turboUploadBatch
};

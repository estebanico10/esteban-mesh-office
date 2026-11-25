'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const { verifyTokenHash, decryptKeyBundle } = require('./crypto-keys.cjs');
const { getIconSvg, getManifestJson, getServiceWorkerJs, getMobileHtml } = require('./mobile-pwa.cjs');
const { findLatestLocalRelease, getDefaultUpdateDirs } = require('./updater.cjs');
const PKG_VERSION = (() => {
  try { return require('../package.json').version || '0.1.5'; } catch { return '0.1.5'; }
})();
const STREAM_HIGH_WATER_MARK = os.totalmem() <= 8 * 1024 ** 3 ? 1024 * 1024 : 2 * 1024 * 1024; // Adaptive Eco I/O buffer

const MIME_MAP = {
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.zip': 'application/zip'
};

function getMime(filePath) {
  return MIME_MAP[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function safeResolvePath(rootDir, relPath) {
  const root = path.resolve(rootDir);
  const cleaned = String(relPath || '')
    .replace(/\0/g, '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  const target = path.resolve(root, cleaned);
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    const err = new Error('Ruta fuera de la carpeta compartida (acceso bloqueado).');
    err.statusCode = 403;
    throw err;
  }
  return target;
}

function xmlEscape(str) {
  return String(str).replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;'
  }[c]));
}

function encodeUriPath(p) {
  return p.split('/').map((seg) => encodeURIComponent(seg)).join('/');
}

function readJsonBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        const err = new Error('Cuerpo de solicitud demasiado grande.');
        err.statusCode = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        const err = new Error('JSON inválido.');
        err.statusCode = 400;
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function sendJson(res, status, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...(extraHeaders || {})
  });
  res.end(body);
}

function isTrustedMeshIp(rawIp) {
  const ip = String(rawIp || '').replace(/^::ffff:/, '');
  if (ip === '127.0.0.1' || ip === '::1') return true;
  const parts = ip.split('.').map(Number);
  if (parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true; // Tailscale WireGuard CGNAT
    if (parts[0] === 192 && parts[1] === 168) return true; // Private LAN
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  }
  return false;
}

class EstebanCloudServer {
  constructor(configStore, {
    onLog,
    onUpdateNotice,
    chatStore,
    onChatEvent,
    getMetricsFn,
    onClipboardPush,
    getClipboardItemsFn,
    onAirDropReceive,
    onScreenCapture,
    onListProcesses,
    onKillProcess,
    onSystemAction,
    onVaultList,
    onVaultUpsert,
    onVaultDelete,
    onFleetCheckin,
    getFleetNodesFn,
    onBulkReceive,
    onOfficeAnnouncement,
    resumableStore,
    onResumableComplete,
    onRemotePresetExec,
    pairingManager,
    miniInternetStore,
    onPackageExecute
  } = {}) {
    this.store = configStore;
    this.onLog = onLog || (() => {});
    this.onUpdateNotice = onUpdateNotice || null;
    this.chatStore = chatStore || null;
    this.onChatEvent = onChatEvent || null;
    this.getMetricsFn = getMetricsFn || null;
    this.onClipboardPush = onClipboardPush || null;
    this.getClipboardItemsFn = getClipboardItemsFn || null;
    this.onAirDropReceive = onAirDropReceive || null;
    this.onScreenCapture = onScreenCapture || null;
    this.onListProcesses = onListProcesses || null;
    this.onKillProcess = onKillProcess || null;
    this.onSystemAction = onSystemAction || null;
    this.onVaultList = onVaultList || null;
    this.onVaultUpsert = onVaultUpsert || null;
    this.onVaultDelete = onVaultDelete || null;
    this.onFleetCheckin = onFleetCheckin || null;
    this.getFleetNodesFn = getFleetNodesFn || null;
    this.onBulkReceive = onBulkReceive || null;
    this.onOfficeAnnouncement = onOfficeAnnouncement || null;
    this.resumableStore = resumableStore || null;
    this.onResumableComplete = onResumableComplete || null;
    this.onRemotePresetExec = onRemotePresetExec || null;
    this.pairingManager = pairingManager || null;
    this.miniInternetStore = miniInternetStore || null;
    this.onPackageExecute = onPackageExecute || null;
    this.server = null;
    this.running = false;
    this.boundHost = null;
    this.boundPort = null;
    this.failedAttempts = new Map(); // ip -> { count, resetAt }
    this.activeSessions = new Map(); // sessionId -> { keyId, expiresAt }
    this.authCache = new Map(); // authHeader -> { keyId, ts }
    this.recentActivity = [];
  }

  log(level, message) {
    const entry = { ts: new Date().toISOString(), level, message };
    this.recentActivity.unshift(entry);
    if (this.recentActivity.length > 80) this.recentActivity.length = 80;
    this.onLog(entry);
  }

  checkRateLimit(ip) {
    const now = Date.now();
    const rec = this.failedAttempts.get(ip);
    if (!rec || now > rec.resetAt) return true;
    return rec.count < 12;
  }

  recordFailure(ip) {
    const now = Date.now();
    const rec = this.failedAttempts.get(ip);
    if (!rec || now > rec.resetAt) {
      this.failedAttempts.set(ip, { count: 1, resetAt: now + 5 * 60 * 1000 });
    } else {
      rec.count += 1;
    }
  }

  clearFailure(ip) {
    this.failedAttempts.delete(ip);
  }

  findKeyByToken(token) {
    if (!token) return null;
    for (const k of this.store.data.keys) {
      if (!k.revoked && verifyTokenHash(token, k.tokenHash)) {
        return k;
      }
    }
    return null;
  }

  authenticateRequest(req) {
    const auth = req.headers.authorization || '';
    if (auth) {
      const cached = this.authCache.get(auth);
      if (cached && (Date.now() - cached.ts) < 30000) {
        const liveKey = this.store.data.keys.find((k) => k.keyId === cached.keyId && !k.revoked);
        if (liveKey) return liveKey;
        this.authCache.delete(auth);
      }
    }
    const cacheKey = (key) => {
      if (auth && key) {
        if (this.authCache.size > 200) this.authCache.clear();
        this.authCache.set(auth, { keyId: key.keyId, ts: Date.now() });
      }
      return key;
    };
    if (auth.startsWith('Bearer ')) {
      const token = auth.slice(7).trim();
      const key = this.findKeyByToken(token);
      if (key) return cacheKey(key);
    }
    if (auth.startsWith('Basic ')) {
      try {
        const decoded = Buffer.from(auth.slice(6).trim(), 'base64').toString('utf8');
        const idx = decoded.indexOf(':');
        if (idx >= 0) {
          const pass = decoded.slice(idx + 1);
          const key = this.findKeyByToken(pass);
          if (key) return cacheKey(key);
        }
      } catch {
        // ignore malformed basic header
      }
    }
    const cookies = parseCookies(req.headers.cookie);
    const sid = cookies.ec_session;
    if (sid && this.activeSessions.has(sid)) {
      const sess = this.activeSessions.get(sid);
      if (Date.now() < sess.expiresAt) {
        const key = this.store.data.keys.find((k) => k.keyId === sess.keyId && !k.revoked);
        if (key) return key;
      }
      this.activeSessions.delete(sid);
    }
    return null;
  }

  getAuthorizedShares(keyRecord) {
    const allowedAll = keyRecord.shareIds.includes('*');
    return this.store.data.shares
      .filter((s) => s.enabled && (allowedAll || keyRecord.shareIds.includes(s.id)))
      .map((s) => ({
        id: s.id,
        name: s.name,
        mode: s.mode,
        effectiveMode: (s.mode === 'rw' && keyRecord.permissions === 'rw') ? 'rw' : 'ro'
      }));
  }

  resolveShareForKey(keyRecord, shareId, requireWrite = false) {
    const allowedAll = keyRecord.shareIds.includes('*');
    const share = this.store.data.shares.find((s) => s.id === shareId && s.enabled);
    if (!share || (!allowedAll && !keyRecord.shareIds.includes(share.id))) {
      const err = new Error('Carpeta compartida no autorizada o inexistente.');
      err.statusCode = 404;
      throw err;
    }
    const canWrite = share.mode === 'rw' && keyRecord.permissions === 'rw';
    if (requireWrite && !canWrite) {
      const err = new Error('Esta llave o carpeta es de solo lectura.');
      err.statusCode = 403;
      throw err;
    }
    return { share, canWrite };
  }

  createSessionCookie(keyRecord) {
    const sid = crypto.randomBytes(24).toString('base64url');
    this.activeSessions.set(sid, {
      keyId: keyRecord.keyId,
      expiresAt: Date.now() + 12 * 60 * 60 * 1000
    });
    return `ec_session=${encodeURIComponent(sid)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`;
  }

  async handleRequest(req, res) {
    const ip = req.socket.remoteAddress || 'unknown';
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = urlObj.pathname;

    try {
      // Static PWA assets & public handshake
      if (req.method === 'GET' && pathname === '/') {
        const html = getMobileHtml(this.store.data.nodeName);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(html);
      }
      if (req.method === 'GET' && pathname === '/icon.svg') {
        res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
        return res.end(getIconSvg());
      }
      if (req.method === 'GET' && pathname === '/manifest.webmanifest') {
        res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8' });
        return res.end(getManifestJson(this.store.data.nodeName));
      }
      if (req.method === 'GET' && pathname === '/sw.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        return res.end(getServiceWorkerJs());
      }
      if (req.method === 'GET' && pathname === '/api/info') {
        return sendJson(res, 200, {
          app: 'Esteban Mesh Office',
          version: PKG_VERSION,
          nodeName: this.store.data.nodeName,
          workspaceName: this.store.data.workspaceName || 'Espacio de Trabajo',
          workspaceId: this.store.data.workspaceId || '',
          department: this.store.data.department || 'General',
          role: this.store.data.role || 'Estación de Trabajo',
          authRequired: true
        });
      }

      if (req.method === 'GET' && (pathname === '/net' || pathname.startsWith('/net/')) && this.miniInternetStore) {
        const netId = pathname.replace(/^\/net\/?/, '').split('/')[0] || 'net-global';
        const visibleShares = isTrustedMeshIp(ip)
          ? (this.store.data.shares || []).filter((s) => s.enabled).map((s) => ({ name: s.name, mode: s.mode }))
          : [];
        const html = this.miniInternetStore.renderMiniInternetPortalHtml({
          networkId: netId,
          hostNodeName: this.store.data.nodeName,
          shares: visibleShares
        });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(html);
      }

      if (req.method === 'POST' && pathname === '/api/pairing/claim' && this.pairingManager) {
        if (!this.checkRateLimit(ip)) {
          return sendJson(res, 429, { error: 'Demasiados intentos fallidos. Espera unos minutos.' });
        }
        const body = await readJsonBody(req);
        const claimed = this.pairingManager.claimPairingCode(body.code);
        if (!claimed.ok) {
          this.recordFailure(ip);
          return sendJson(res, 404, { error: claimed.error || 'Código inválido o expirado.' });
        }
        this.clearFailure(ip);
        this.log('info', `Emparejamiento mágico completado con ${ip} (${claimed.label || 'Llave'})`);
        return sendJson(res, 200, claimed);
      }

      if (req.method === 'GET' && pathname === '/api/packages/catalog' && this.miniInternetStore) {
        if (!isTrustedMeshIp(ip) && !this.authenticateRequest(req)) {
          return sendJson(res, 401, { error: 'No autorizado para consultar el catálogo.' });
        }
        return sendJson(res, 200, {
          ok: true,
          nodeName: this.store.data.nodeName,
          networks: this.miniInternetStore.listNetworks(),
          packages: this.miniInternetStore.listPackages()
        });
      }

      if (req.method === 'POST' && pathname === '/api/packages/execute' && this.miniInternetStore) {
        const keyRec = this.authenticateRequest(req);
        if (!isTrustedMeshIp(ip) && (!keyRec || keyRec.permissions !== 'rw')) {
          return sendJson(res, 401, { error: 'No autorizado para desplegar paquetes.' });
        }
        const body = await readJsonBody(req);
        const targetPkg = body.package || body.packageId;
        if (!targetPkg) return sendJson(res, 400, { error: 'Se requiere packageId o definición del paquete.' });
        const result = this.onPackageExecute
          ? await this.onPackageExecute({ pkgOrId: targetPkg, senderNode: body.senderNode || ip })
          : await this.miniInternetStore.executePackageLocally(targetPkg, { configStore: this.store });
        this.log('info', `Paquete ejecutado (${result.title || body.packageId}) desde ${body.senderNode || ip}`);
        return sendJson(res, 200, result);
      }

      if (req.method === 'POST' && pathname === '/api/fleet/checkin') {
        if (!isTrustedMeshIp(ip) && !this.authenticateRequest(req)) {
          return sendJson(res, 401, { error: 'Solo equipos de la red de oficina pueden registrarse.' });
        }
        const body = await readJsonBody(req, 4 * 1024 * 1024);
        const cleanIp = String(ip || '').replace(/^::ffff:/, '');
        const payload = { ...body, reportedIp: cleanIp };
        const saved = this.onFleetCheckin ? await this.onFleetCheckin(payload) : payload;
        return sendJson(res, 200, { ok: true, node: saved });
      }

      if (req.method === 'GET' && pathname === '/api/fleet/nodes') {
        if (!isTrustedMeshIp(ip) && !this.authenticateRequest(req)) {
          return sendJson(res, 401, { error: 'No autorizado.' });
        }
        const fleet = this.getFleetNodesFn ? await this.getFleetNodesFn() : { nodes: [], summary: {} };
        return sendJson(res, 200, { ok: true, ...fleet });
      }

      if (req.method === 'POST' && pathname === '/api/office/announcement') {
        if (!isTrustedMeshIp(ip) && !this.authenticateRequest(req)) {
          return sendJson(res, 401, { error: 'No autorizado.' });
        }
        const body = await readJsonBody(req);
        if (this.onOfficeAnnouncement) {
          Promise.resolve(this.onOfficeAnnouncement({
            title: String(body.title || 'Anuncio de Oficina').trim(),
            message: String(body.message || '').trim(),
            priority: String(body.priority || 'normal'),
            senderNode: String(body.senderNode || ip).trim()
          })).catch(() => {});
        }
        return sendJson(res, 200, { ok: true, nodeName: this.store.data.nodeName });
      }

      if (req.method === 'POST' && pathname === '/api/office/bulk-receive') {
        if (!isTrustedMeshIp(ip) && !this.authenticateRequest(req)) {
          return sendJson(res, 401, { error: 'No autorizado para transferencias masivas.' });
        }
        const rawName = decodeURIComponent(String(req.headers['x-file-name'] || 'archivo.bin'));
        const fileName = path.basename(rawName) || 'archivo.bin';
        const subRaw = decodeURIComponent(String(req.headers['x-subfolder'] || 'Entregas-Oficina'));
        const safeSub = subRaw.replace(/[<>:"|?*]/g, '_').replace(/\.\./g, '').trim() || 'Entregas-Oficina';
        const senderNode = decodeURIComponent(String(req.headers['x-sender-node'] || ip));
        const expectedSha = String(req.headers['x-file-sha256'] || '').trim().toUpperCase();

        const destDir = path.join(os.homedir(), 'Documents', 'EstebanMeshOffice-Recibidos', safeSub);
        fs.mkdirSync(destDir, { recursive: true });
        const destPath = path.join(destDir, fileName);

        const hash = crypto.createHash('sha256');
        let receivedBytes = 0;
        await new Promise((resolve, reject) => {
          const ws = fs.createWriteStream(destPath, { highWaterMark: STREAM_HIGH_WATER_MARK });
          req.on('data', (chunk) => {
            receivedBytes += chunk.length;
            hash.update(chunk);
          });
          req.on('error', reject);
          ws.on('error', reject);
          ws.on('finish', resolve);
          req.pipe(ws);
        });

        const actualSha = hash.digest('hex').toUpperCase();
        if (expectedSha && actualSha !== expectedSha) {
          try { fs.unlinkSync(destPath); } catch {}
          return sendJson(res, 400, { error: `SHA-256 inválido en transferencia masiva (${fileName}).` });
        }
        this.log('info', `Archivo masivo recibido (${fileName}, ${receivedBytes} B) de ${senderNode}`);
        if (this.onBulkReceive) {
          Promise.resolve(this.onBulkReceive({ fileName, destPath, bytes: receivedBytes, sha256: actualSha, senderNode, subfolder: safeSub })).catch(() => {});
        }
        return sendJson(res, 201, { ok: true, fileName, destPath, bytes: receivedBytes, sha256: actualSha });
      }

      if (pathname === '/api/office/resumable/init' && req.method === 'POST' && this.resumableStore) {
        if (!isTrustedMeshIp(ip) && !this.authenticateRequest(req)) {
          return sendJson(res, 401, { error: 'No autorizado para transferencias resumibles.' });
        }
        const body = await readJsonBody(req);
        const st = this.resumableStore.initUpload({
          uploadId: body.uploadId,
          fileName: body.fileName,
          totalSize: Number(body.totalSize) || 0,
          expectedSha256: body.expectedSha256 || '',
          subfolder: body.subfolder || 'Entregas-Alto-Volumen',
          senderNode: body.senderNode || ip
        });
        return sendJson(res, 200, { ok: true, ...st });
      }

      if (pathname.startsWith('/api/office/resumable/') && this.resumableStore) {
        if (!isTrustedMeshIp(ip) && !this.authenticateRequest(req)) {
          return sendJson(res, 401, { error: 'No autorizado.' });
        }
        const uploadId = decodeURIComponent(pathname.slice('/api/office/resumable/'.length));
        if (req.method === 'HEAD' || req.method === 'GET') {
          const st = this.resumableStore.getStatus(uploadId);
          if (!st) return sendJson(res, 404, { error: 'Sesión de carga no encontrada.' });
          res.writeHead(200, {
            'Upload-Offset': String(st.offset),
            'Upload-Length': String(st.totalSize),
            'Content-Type': 'application/json'
          });
          if (req.method === 'HEAD') return res.end();
          return res.end(JSON.stringify({ ok: true, ...st }));
        }
        if (req.method === 'PATCH') {
          const offset = Number(req.headers['upload-offset'] || 0);
          const chunks = [];
          await new Promise((resolve, reject) => {
            req.on('data', (c) => chunks.push(c));
            req.on('end', resolve);
            req.on('error', reject);
          });
          const buf = Buffer.concat(chunks);
          const result = this.resumableStore.appendChunk(uploadId, offset, buf);
          if (result.completed && this.onResumableComplete) {
            Promise.resolve(this.onResumableComplete(result)).catch(() => {});
          }
          res.writeHead(200, {
            'Upload-Offset': String(result.offset),
            'Content-Type': 'application/json'
          });
          return res.end(JSON.stringify({ ok: true, ...result }));
        }
      }

      if (req.method === 'POST' && pathname === '/api/office/remote-exec') {
        if (!isTrustedMeshIp(ip) && !this.authenticateRequest(req)) {
          return sendJson(res, 401, { error: 'No autorizado para diagnósticos remotos.' });
        }
        const body = await readJsonBody(req);
        if (!this.onRemotePresetExec) return sendJson(res, 503, { error: 'Diagnósticos no habilitados.' });
        const result = await this.onRemotePresetExec(String(body.presetId || ''));
        return sendJson(res, 200, result);
      }

      if (req.method === 'GET' && pathname === '/api/metrics') {
        if (!isTrustedMeshIp(ip) && !this.authenticateRequest(req)) {
          return sendJson(res, 401, { error: 'No autorizado para consultar métricas.' });
        }
        if (!this.getMetricsFn) {
          return sendJson(res, 503, { error: 'Métricas no disponibles en este nodo.' });
        }
        const m = await this.getMetricsFn();
        return sendJson(res, 200, {
          nodeName: this.store.data.nodeName,
          version: PKG_VERSION,
          metrics: m
        });
      }

      if (req.method === 'POST' && pathname === '/api/tools/clipboard') {
        if (!isTrustedMeshIp(ip) && !this.authenticateRequest(req)) {
          return sendJson(res, 401, { error: 'No autorizado para portapapeles en malla.' });
        }
        const body = await readJsonBody(req, 2 * 1024 * 1024);
        const text = String(body.text || '');
        const senderNode = String(body.senderNode || ip).trim();
        if (!text.trim()) {
          return sendJson(res, 400, { error: 'Texto vacío.' });
        }
        if (this.onClipboardPush) {
          Promise.resolve(this.onClipboardPush({ text, senderNode })).catch(() => {});
        }
        return sendJson(res, 200, { ok: true, nodeName: this.store.data.nodeName });
      }

      if (req.method === 'GET' && pathname === '/api/tools/clipboard') {
        if (!isTrustedMeshIp(ip) && !this.authenticateRequest(req)) {
          return sendJson(res, 401, { error: 'No autorizado.' });
        }
        const items = this.getClipboardItemsFn ? await this.getClipboardItemsFn() : [];
        return sendJson(res, 200, { ok: true, items });
      }

      if (req.method === 'POST' && pathname === '/api/tools/airdrop') {
        if (!isTrustedMeshIp(ip) && !this.authenticateRequest(req)) {
          return sendJson(res, 401, { error: 'No autorizado para AirDrop.' });
        }
        const body = await readJsonBody(req, 64 * 1024 * 1024);
        if (!this.onAirDropReceive) {
          return sendJson(res, 503, { error: 'AirDrop no configurado.' });
        }
        const saved = await this.onAirDropReceive({
          fileName: body.fileName || 'archivo',
          dataBase64: body.dataBase64 || '',
          senderNode: body.senderNode || ip
        });
        return sendJson(res, 201, { ok: true, ...saved });
      }

      if (req.method === 'GET' && pathname === '/api/tools/screen') {
        if (!isTrustedMeshIp(ip) && !this.authenticateRequest(req)) {
          return sendJson(res, 401, { error: 'No autorizado para pantalla remota.' });
        }
        if (!this.onScreenCapture) {
          return sendJson(res, 503, { error: 'Captura de pantalla no disponible.' });
        }
        const snap = await this.onScreenCapture();
        return sendJson(res, 200, { ok: true, nodeName: this.store.data.nodeName, ...snap });
      }

      if (req.method === 'GET' && pathname === '/api/tools/processes') {
        if (!isTrustedMeshIp(ip) && !this.authenticateRequest(req)) {
          return sendJson(res, 401, { error: 'No autorizado.' });
        }
        const processes = this.onListProcesses ? await this.onListProcesses() : [];
        return sendJson(res, 200, { ok: true, nodeName: this.store.data.nodeName, processes });
      }

      if (req.method === 'POST' && pathname === '/api/tools/kill-process') {
        if (!isTrustedMeshIp(ip) && !this.authenticateRequest(req)) {
          return sendJson(res, 401, { error: 'No autorizado.' });
        }
        const body = await readJsonBody(req);
        if (!this.onKillProcess) return sendJson(res, 503, { error: 'No disponible.' });
        const result = await this.onKillProcess(body.pid);
        return sendJson(res, 200, { ok: true, ...result });
      }

      if (req.method === 'POST' && pathname === '/api/tools/action') {
        if (!isTrustedMeshIp(ip) && !this.authenticateRequest(req)) {
          return sendJson(res, 401, { error: 'No autorizado.' });
        }
        const body = await readJsonBody(req);
        if (!this.onSystemAction) return sendJson(res, 503, { error: 'No disponible.' });
        const result = await this.onSystemAction(body.action, body.payload || {});
        return sendJson(res, 200, { ok: true, ...result });
      }

      if (pathname === '/api/tools/vault') {
        if (!isTrustedMeshIp(ip) && !this.authenticateRequest(req)) {
          return sendJson(res, 401, { error: 'No autorizado para bóveda.' });
        }
        if (req.method === 'GET') {
          const items = this.onVaultList ? await this.onVaultList() : [];
          return sendJson(res, 200, { ok: true, items });
        }
        if (req.method === 'POST') {
          const body = await readJsonBody(req);
          const item = this.onVaultUpsert ? await this.onVaultUpsert(body) : null;
          return sendJson(res, 201, { ok: true, item });
        }
        if (req.method === 'DELETE') {
          const id = urlObj.searchParams.get('id');
          if (this.onVaultDelete) await this.onVaultDelete(id);
          return sendJson(res, 200, { ok: true });
        }
      }

      if (pathname === '/api/mobile/chats' && this.chatStore) {
        if (!isTrustedMeshIp(ip) && !this.authenticateRequest(req)) {
          return sendJson(res, 401, { error: 'No autorizado.' });
        }
        const chats = this.chatStore.listChats();
        const chatId = urlObj.searchParams.get('chatId') || (chats[0] && chats[0].id) || '';
        const messages = chatId ? (this.chatStore.getChat(chatId).messages || []) : [];
        return sendJson(res, 200, { ok: true, nodeName: this.store.data.nodeName, chats, activeChatId: chatId, messages });
      }

      if (req.method === 'POST' && pathname === '/api/mobile/chat-send' && this.chatStore) {
        if (!isTrustedMeshIp(ip) && !this.authenticateRequest(req)) {
          return sendJson(res, 401, { error: 'No autorizado.' });
        }
        const body = await readJsonBody(req, 32 * 1024 * 1024);
        let chatId = body.chatId;
        if (!chatId) {
          const existing = this.chatStore.listChats()[0];
          if (existing) chatId = existing.id;
          else {
            const created = this.chatStore.createChat({ title: 'Chat Móvil Android', type: 'group' });
            chatId = created.id;
          }
        }
        const savedAttachments = [];
        for (const att of (body.attachments || [])) {
          if (att && att.base64) {
            const saved = this.chatStore.saveAttachment({
              fileName: att.name || 'foto.jpg',
              mime: att.mime || 'application/octet-stream',
              buffer: Buffer.from(att.base64, 'base64')
            });
            savedAttachments.push(saved);
          }
        }
        const senderNode = String(body.senderNode || 'Android Móvil').trim();
        const msg = this.chatStore.addMessage({
          chatId,
          chatTitle: 'Chat Móvil Android',
          senderNode,
          text: body.text || '',
          format: 'markdown',
          attachments: savedAttachments,
          incoming: true
        });
        if (this.onChatEvent) {
          Promise.resolve(this.onChatEvent({ type: 'incoming-message', chatId, message: msg, senderNode })).catch(() => {});
        }
        return sendJson(res, 201, { ok: true, message: msg });
      }

      if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/api/mobile/apk') {
        const candidateDirs = [
          ...getDefaultUpdateDirs(this.store.data.updateShareDir, path.join(__dirname, '..')),
          'E:\\Esteban-Cloud-Kit',
          'F:\\Esteban-Cloud-Kit'
        ];
        let apkPath = '';
        for (const d of candidateDirs) {
          try {
            if (!fs.existsSync(d)) continue;
            const files = fs.readdirSync(d).filter((f) => /^Esteban-Cloud.*\.apk$/i.test(f)).sort().reverse();
            if (files.length > 0) {
              apkPath = path.join(d, files[0]);
              break;
            }
          } catch {}
        }
        if (!apkPath || !fs.existsSync(apkPath)) {
          return sendJson(res, 404, { error: 'Archivo APK no encontrado en este nodo.' });
        }
        const st = fs.statSync(apkPath);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.android.package-archive',
          'Content-Length': st.size,
          'Content-Disposition': `attachment; filename="${path.basename(apkPath)}"`
        });
        if (req.method === 'HEAD') return res.end();
        return fs.createReadStream(apkPath).pipe(res);
      }

      if (req.method === 'POST' && pathname === '/api/auth/quick-mesh-unlock') {
        if (!isTrustedMeshIp(ip)) {
          return sendJson(res, 403, { error: 'Desbloqueo rápido permitido solo dentro de tu red Tailscale o Wi-Fi local.' });
        }
        const keyRecord = (this.store.data.keys || []).find((k) => !k.revoked);
        if (!keyRecord) {
          return sendJson(res, 404, { error: 'No hay ninguna llave activa en este equipo.' });
        }
        this.store.touchKeyUsed(keyRecord.keyId);
        const cookie = this.createSessionCookie(keyRecord);
        return sendJson(res, 200, {
          ok: true,
          key: { keyId: keyRecord.keyId, label: keyRecord.label, permissions: keyRecord.permissions },
          shares: this.getAuthorizedShares(keyRecord)
        }, { 'Set-Cookie': cookie });
      }

      if (pathname.startsWith('/api/chat/') && this.chatStore) {
        if (!isTrustedMeshIp(ip) && !this.authenticateRequest(req)) {
          return sendJson(res, 401, { error: 'No autorizado para mensajería.' });
        }
        if (req.method === 'POST' && pathname === '/api/chat/receive') {
          const body = await readJsonBody(req, 32 * 1024 * 1024);
          const savedAttachments = [];
          for (const att of (body.attachments || [])) {
            if (att && att.base64) {
              const buf = Buffer.from(att.base64, 'base64');
              const saved = this.chatStore.saveAttachment({
                id: att.id,
                fileName: att.name || 'archivo',
                mime: att.mime,
                buffer: buf
              });
              savedAttachments.push(saved);
            }
          }
          const senderNode = String(body.senderNode || 'Equipo remoto').trim();
          const msg = this.chatStore.addMessage({
            id: body.id,
            chatId: body.chatId,
            chatTitle: body.chatTitle || `Chat con ${senderNode}`,
            chatType: body.chatType || 'direct',
            peerNode: senderNode,
            peerUrl: body.senderUrl || '',
            senderNode,
            text: body.text || '',
            format: body.format || 'markdown',
            attachments: savedAttachments,
            createdAt: body.createdAt,
            incoming: true
          });
          this.log('info', `Mensaje recibido de ${senderNode} en chat "${body.chatTitle || body.chatId}"`);
          if (this.onChatEvent) {
            Promise.resolve(this.onChatEvent({ type: 'incoming-message', chatId: msg.chatId, message: msg, senderNode })).catch(() => {});
          }
          return sendJson(res, 201, { ok: true, message: msg });
        }

        if (req.method === 'POST' && pathname === '/api/chat/delete-message') {
          const body = await readJsonBody(req);
          try {
            this.chatStore.deleteMessage(body.chatId, body.messageId);
            if (this.onChatEvent) Promise.resolve(this.onChatEvent({ type: 'sync', chatId: body.chatId })).catch(() => {});
          } catch {}
          return sendJson(res, 200, { ok: true });
        }

        if (req.method === 'POST' && pathname === '/api/chat/delete-attachment') {
          const body = await readJsonBody(req);
          try {
            this.chatStore.deleteAttachment(body.chatId, body.messageId, body.attachmentId);
            if (this.onChatEvent) Promise.resolve(this.onChatEvent({ type: 'sync', chatId: body.chatId })).catch(() => {});
          } catch {}
          return sendJson(res, 200, { ok: true });
        }

        if (req.method === 'POST' && pathname === '/api/chat/delete-chat') {
          const body = await readJsonBody(req);
          try {
            this.chatStore.deleteChat(body.chatId);
            if (this.onChatEvent) Promise.resolve(this.onChatEvent({ type: 'sync', chatId: body.chatId })).catch(() => {});
          } catch {}
          return sendJson(res, 200, { ok: true });
        }
      }

      if (req.method === 'GET' && pathname === '/api/updates/latest') {
        const dirs = getDefaultUpdateDirs(this.store.data.updateShareDir, path.join(__dirname, '..'));
        const latest = findLatestLocalRelease(dirs);
        if (!latest) {
          return sendJson(res, 200, {
            available: false,
            hostNode: this.store.data.nodeName,
            updateDir: this.store.data.updateShareDir || ''
          });
        }
        return sendJson(res, 200, {
          available: true,
          version: latest.version,
          fileName: latest.fileName,
          size: latest.size,
          sha256: latest.sha256,
          releaseDate: latest.releaseDate,
          hostNode: this.store.data.nodeName,
          downloadPath: '/api/updates/download'
        });
      }

      if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/api/updates/download') {
        const dirs = getDefaultUpdateDirs(this.store.data.updateShareDir, path.join(__dirname, '..'));
        const latest = findLatestLocalRelease(dirs);
        if (!latest || !fs.existsSync(latest.fullPath)) {
          return sendJson(res, 404, { error: 'No hay ningún instalador disponible para actualizar en este host.' });
        }
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': latest.size,
          'Content-Disposition': `attachment; filename="${latest.fileName}"`,
          'X-Update-Version': latest.version,
          'X-Update-SHA256': latest.sha256,
          'Cache-Control': 'no-store'
        });
        if (req.method === 'HEAD') return res.end();
        this.log('info', `Sirviendo actualización v${latest.version} (${latest.fileName}) a ${ip}`);
        return fs.createReadStream(latest.fullPath).pipe(res);
      }

      if (req.method === 'POST' && pathname === '/api/updates/mesh-broadcast') {
        if (!isTrustedMeshIp(ip) && !this.authenticateRequest(req)) {
          return sendJson(res, 401, { error: 'Solo equipos de la malla Tailscale o LAN pueden anunciar actualizaciones.' });
        }
        const body = await readJsonBody(req);
        const fromUrl = String(body.fromUrl || '').trim();
        const version = String(body.version || '').trim();
        if (fromUrl && !/^https?:\/\/.+/i.test(fromUrl)) {
          return sendJson(res, 400, { error: 'fromUrl inválido.' });
        }
        this.log('info', `Broadcast automático de actualización recibido (${version || 'nueva versión'}) desde ${fromUrl || ip}`);
        if (this.onUpdateNotice) {
          Promise.resolve(this.onUpdateNotice({ fromUrl, version, autoTriggered: true })).catch(() => {});
        }
        return sendJson(res, 202, { ok: true, accepted: true });
      }

      // Auth endpoints
      if (req.method === 'POST' && pathname === '/api/auth/unlock-bundle') {
        if (!this.checkRateLimit(ip)) {
          return sendJson(res, 429, { error: 'Demasiados intentos fallidos. Espera unos minutos.' });
        }
        const body = await readJsonBody(req);
        let payload;
        try {
          payload = decryptKeyBundle(body.bundle, body.passphrase);
        } catch (e) {
          this.recordFailure(ip);
          return sendJson(res, 401, { error: e.message });
        }
        const keyRecord = this.findKeyByToken(payload.token);
        if (!keyRecord) {
          this.recordFailure(ip);
          return sendJson(res, 401, { error: 'Llave no registrada o revocada en este equipo.' });
        }
        this.clearFailure(ip);
        this.store.touchKeyUsed(keyRecord.keyId);
        const cookie = this.createSessionCookie(keyRecord);
        this.log('info', `Acceso desbloqueado con llave ${keyRecord.label} (${keyRecord.keyId}) desde ${ip}`);
        return sendJson(res, 200, {
          ok: true,
          key: { keyId: keyRecord.keyId, label: keyRecord.label, permissions: keyRecord.permissions },
          shares: this.getAuthorizedShares(keyRecord)
        }, { 'Set-Cookie': cookie });
      }

      if (req.method === 'POST' && pathname === '/api/auth/logout') {
        const cookies = parseCookies(req.headers.cookie);
        if (cookies.ec_session) this.activeSessions.delete(cookies.ec_session);
        return sendJson(res, 200, { ok: true }, {
          'Set-Cookie': 'ec_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'
        });
      }

      // WebDAV endpoint: /webdav or /webdav/<shareId>/...
      if (pathname === '/webdav' || pathname.startsWith('/webdav/')) {
        return await this.handleWebDav(req, res, pathname);
      }

      // Protected API endpoints
      if (pathname.startsWith('/api/')) {
        const keyRecord = this.authenticateRequest(req);
        if (!keyRecord) {
          return sendJson(res, 401, { error: 'No autorizado. Se requiere una llave encriptada válida.' });
        }
        return await this.handleApi(req, res, urlObj, keyRecord);
      }

      sendJson(res, 404, { error: 'Ruta no encontrada.' });
    } catch (err) {
      const code = err.statusCode || (err.code === 'ENOENT' ? 404 : err.code === 'EACCES' ? 403 : 500);
      if (!res.headersSent) {
        sendJson(res, code, { error: err.message || 'Error interno del servidor.' });
      }
    }
  }

  async handleApi(req, res, urlObj, keyRecord) {
    const pathname = urlObj.pathname;

    if (req.method === 'GET' && pathname === '/api/shares') {
      return sendJson(res, 200, {
        nodeName: this.store.data.nodeName,
        key: { keyId: keyRecord.keyId, label: keyRecord.label, permissions: keyRecord.permissions },
        shares: this.getAuthorizedShares(keyRecord)
      });
    }

    if (req.method === 'POST' && pathname === '/api/updates/notify') {
      if (keyRecord.permissions !== 'rw') {
        return sendJson(res, 403, { error: 'Solo una llave con permisos RW puede notificar actualizaciones.' });
      }
      const body = await readJsonBody(req);
      const fromUrl = String(body.fromUrl || '').trim();
      const version = String(body.version || '').trim();
      if (fromUrl && !/^https?:\/\/.+/i.test(fromUrl)) {
        return sendJson(res, 400, { error: 'fromUrl inválido.' });
      }
      this.log('info', `Aviso de actualización recibido (${version || 'nueva versión'}) desde ${fromUrl || 'peer conectado'}`);
      if (this.onUpdateNotice) {
        Promise.resolve(this.onUpdateNotice({ fromUrl, version })).catch(() => {});
      }
      return sendJson(res, 202, { ok: true, accepted: true });
    }

    if (req.method === 'GET' && pathname === '/api/files') {
      const shareId = urlObj.searchParams.get('share');
      const relPath = urlObj.searchParams.get('path') || '';
      const { share } = this.resolveShareForKey(keyRecord, shareId, false);
      const dirPath = safeResolvePath(share.path, relPath);
      const stat = await fs.promises.stat(dirPath);
      if (!stat.isDirectory()) {
        return sendJson(res, 400, { error: 'La ruta no es una carpeta.' });
      }
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      const items = (await Promise.all(
        entries.map(async (entry) => {
          try {
            const full = path.join(dirPath, entry.name);
            const st = await fs.promises.stat(full);
            return {
              name: entry.name,
              isDirectory: st.isDirectory(),
              size: st.isDirectory() ? null : st.size,
              mtime: st.mtime.toISOString()
            };
          } catch {
            return null;
          }
        })
      )).filter(Boolean);
      items.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
      });
      return sendJson(res, 200, { shareId: share.id, path: relPath, items });
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/api/download') {
      const shareId = urlObj.searchParams.get('share');
      const relPath = urlObj.searchParams.get('path') || '';
      const inline = urlObj.searchParams.get('inline') === '1';
      const { share } = this.resolveShareForKey(keyRecord, shareId, false);
      const filePath = safeResolvePath(share.path, relPath);
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) {
        return sendJson(res, 400, { error: 'Solo se pueden descargar archivos.' });
      }
      return this.streamFile(req, res, filePath, stat, inline);
    }

    if (req.method === 'POST' && pathname === '/api/upload') {
      const shareId = urlObj.searchParams.get('share');
      const relPath = urlObj.searchParams.get('path') || '';
      const fileName = path.basename(urlObj.searchParams.get('name') || '');
      if (!fileName || fileName === '.' || fileName === '..') {
        return sendJson(res, 400, { error: 'Nombre de archivo inválido.' });
      }
      const { share } = this.resolveShareForKey(keyRecord, shareId, true);
      const targetDir = safeResolvePath(share.path, relPath);
      const destFile = safeResolvePath(share.path, path.posix.join(relPath.replace(/\\/g, '/'), fileName));
      await fs.promises.mkdir(targetDir, { recursive: true });
      await new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(destFile, { highWaterMark: STREAM_HIGH_WATER_MARK });
        req.pipe(ws);
        ws.on('finish', resolve);
        ws.on('error', reject);
        req.on('error', reject);
      });
      this.log('info', `Archivo subido: ${share.name}/${relPath ? relPath + '/' : ''}${fileName}`);
      return sendJson(res, 201, { ok: true, name: fileName });
    }

    if (req.method === 'POST' && pathname === '/api/mkdir') {
      const body = await readJsonBody(req);
      const folderName = path.basename(String(body.name || '').trim());
      if (!folderName || folderName === '.' || folderName === '..') {
        return sendJson(res, 400, { error: 'Nombre de carpeta inválido.' });
      }
      const { share } = this.resolveShareForKey(keyRecord, body.share, true);
      const dest = safeResolvePath(share.path, path.posix.join(String(body.path || '').replace(/\\/g, '/'), folderName));
      await fs.promises.mkdir(dest, { recursive: true });
      return sendJson(res, 201, { ok: true });
    }

    if (req.method === 'POST' && pathname === '/api/rename') {
      const body = await readJsonBody(req);
      const { share } = this.resolveShareForKey(keyRecord, body.share, true);
      const src = safeResolvePath(share.path, body.from || '');
      const dst = safeResolvePath(share.path, body.to || '');
      if (src === path.resolve(share.path) || dst === path.resolve(share.path)) {
        return sendJson(res, 400, { error: 'No se puede renombrar la raíz de la carpeta compartida.' });
      }
      await fs.promises.rename(src, dst);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'DELETE' && pathname === '/api/file') {
      const shareId = urlObj.searchParams.get('share');
      const relPath = urlObj.searchParams.get('path') || '';
      const { share } = this.resolveShareForKey(keyRecord, shareId, true);
      const target = safeResolvePath(share.path, relPath);
      if (target === path.resolve(share.path)) {
        return sendJson(res, 400, { error: 'No se puede eliminar la raíz compartida.' });
      }
      await fs.promises.rm(target, { recursive: true, force: true });
      this.log('info', `Eliminado: ${share.name}/${relPath}`);
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 404, { error: 'Endpoint API no encontrado.' });
  }

  streamFile(req, res, filePath, stat, inline) {
    const mime = getMime(filePath);
    const fileName = path.basename(filePath);
    const disp = `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(fileName)}`;
    const range = req.headers.range;

    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      if (match) {
        const start = match[1] ? parseInt(match[1], 10) : 0;
        const end = match[2] ? Math.min(parseInt(match[2], 10), stat.size - 1) : stat.size - 1;
        if (start > end || start >= stat.size) {
          res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
          return res.end();
        }
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': (end - start) + 1,
          'Content-Type': mime,
          'Content-Disposition': disp
        });
        if (req.method === 'HEAD') return res.end();
        return fs.createReadStream(filePath, { start, end, highWaterMark: STREAM_HIGH_WATER_MARK }).pipe(res);
      }
    }

    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
      'Content-Disposition': disp
    });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(filePath, { highWaterMark: STREAM_HIGH_WATER_MARK }).pipe(res);
  }

  async handleWebDav(req, res, pathname) {
    const keyRecord = this.authenticateRequest(req);
    if (!keyRecord) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Esteban Cloud WebDAV"' });
      return res.end('Unauthorized');
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(200, {
        'DAV': '1, 2',
        'Allow': 'OPTIONS, GET, HEAD, PUT, DELETE, MKCOL, MOVE, COPY, PROPFIND',
        'MS-Author-Via': 'DAV'
      });
      return res.end();
    }

    const sub = pathname.replace(/^\/webdav\/?/, '');
    const segments = sub ? sub.split('/').filter(Boolean).map((s) => decodeURIComponent(s)) : [];

    // Root /webdav/ lists authorized shares as top-level directories
    if (segments.length === 0) {
      if (req.method === 'PROPFIND') {
        const depth = String(req.headers.depth || '1');
        const shares = this.getAuthorizedShares(keyRecord);
        const nowHttp = new Date().toUTCString();
        let responses = `<D:response><D:href>/webdav/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype><D:getlastmodified>${nowHttp}</D:getlastmodified></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;
        if (depth !== '0') {
          for (const s of shares) {
            responses += `<D:response><D:href>/webdav/${encodeURIComponent(s.name)}/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype><D:displayname>${xmlEscape(s.name)}</D:displayname><D:getlastmodified>${nowHttp}</D:getlastmodified></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;
          }
        }
        const xml = `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">${responses}</D:multistatus>`;
        res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
        return res.end(xml);
      }
      res.writeHead(405);
      return res.end();
    }

    // Match first segment by share name or share id
    const shareSeg = segments[0];
    const authShares = this.getAuthorizedShares(keyRecord);
    const matched = authShares.find((s) => s.name === shareSeg || s.id === shareSeg);
    if (!matched) {
      res.writeHead(404);
      return res.end('Share not found');
    }

    const isWriteMethod = ['PUT', 'DELETE', 'MKCOL', 'MOVE', 'COPY'].includes(req.method);
    const { share } = this.resolveShareForKey(keyRecord, matched.id, isWriteMethod);
    const relPath = segments.slice(1).join('/');
    const targetPath = safeResolvePath(share.path, relPath);

    if (req.method === 'PROPFIND') {
      const depth = String(req.headers.depth || '1');
      let stat;
      try {
        stat = await fs.promises.stat(targetPath);
      } catch {
        res.writeHead(404);
        return res.end();
      }
      const baseHref = `/webdav/${encodeUriPath([shareSeg, ...segments.slice(1)].join('/'))}`;
      const makeEntryXml = (href, st, displayName) => {
        const isDir = st.isDirectory();
        const normHref = isDir && !href.endsWith('/') ? `${href}/` : href;
        return `<D:response><D:href>${xmlEscape(normHref)}</D:href><D:propstat><D:prop>` +
          `<D:displayname>${xmlEscape(displayName)}</D:displayname>` +
          `<D:resourcetype>${isDir ? '<D:collection/>' : ''}</D:resourcetype>` +
          (isDir ? '' : `<D:getcontentlength>${st.size}</D:getcontentlength><D:getcontenttype>${xmlEscape(getMime(displayName))}</D:getcontenttype>`) +
          `<D:getlastmodified>${st.mtime.toUTCString()}</D:getlastmodified>` +
          `</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;
      };

      let responses = makeEntryXml(baseHref, stat, segments[segments.length - 1]);
      if (stat.isDirectory() && depth !== '0') {
        const entries = await fs.promises.readdir(targetPath, { withFileTypes: true });
        const xmlParts = await Promise.all(
          entries.map(async (e) => {
            try {
              const full = path.join(targetPath, e.name);
              const st = await fs.promises.stat(full);
              const childHref = `${baseHref.replace(/\/$/, '')}/${encodeURIComponent(e.name)}`;
              return makeEntryXml(childHref, st, e.name);
            } catch {
              return '';
            }
          })
        );
        responses += xmlParts.join('');
      }
      const xml = `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">${responses}</D:multistatus>`;
      res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
      return res.end(xml);
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      const stat = await fs.promises.stat(targetPath);
      if (stat.isDirectory()) {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(`Directory: ${share.name}/${relPath}`);
      }
      return this.streamFile(req, res, targetPath, stat, true);
    }

    if (req.method === 'PUT') {
      const existed = fs.existsSync(targetPath);
      await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
      await new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(targetPath, { highWaterMark: STREAM_HIGH_WATER_MARK });
        req.pipe(ws);
        ws.on('finish', resolve);
        ws.on('error', reject);
        req.on('error', reject);
      });
      res.writeHead(existed ? 204 : 201);
      return res.end();
    }

    if (req.method === 'MKCOL') {
      await fs.promises.mkdir(targetPath, { recursive: true });
      res.writeHead(201);
      return res.end();
    }

    if (req.method === 'DELETE') {
      if (targetPath === path.resolve(share.path)) {
        res.writeHead(403);
        return res.end();
      }
      await fs.promises.rm(targetPath, { recursive: true, force: true });
      res.writeHead(204);
      return res.end();
    }

    if (req.method === 'MOVE' || req.method === 'COPY') {
      const destHeader = req.headers.destination || '';
      const destUrl = new URL(destHeader, `http://${req.headers.host || 'localhost'}`);
      const destSub = destUrl.pathname.replace(/^\/webdav\/?/, '');
      const destSegs = destSub.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
      if (destSegs[0] !== shareSeg) {
        res.writeHead(403);
        return res.end('Cross-share operation not allowed');
      }
      const destPath = safeResolvePath(share.path, destSegs.slice(1).join('/'));
      const existed = fs.existsSync(destPath);
      await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
      if (req.method === 'MOVE') {
        await fs.promises.rename(targetPath, destPath);
      } else {
        await fs.promises.cp(targetPath, destPath, { recursive: true });
      }
      res.writeHead(existed ? 204 : 201);
      return res.end();
    }

    res.writeHead(405);
    return res.end();
  }

  start({ host, port } = {}) {
    return new Promise((resolve, reject) => {
      if (this.running) {
        return resolve({ host: this.boundHost, port: this.boundPort });
      }
      const listenHost = host || '0.0.0.0';
      const listenPort = port !== undefined ? Number(port) : Number(this.store.data.port || 4789);
      this.server = http.createServer((req, res) => this.handleRequest(req, res));
      this.server.keepAliveTimeout = 65000;
      this.server.headersTimeout = 70000;
      this.server.requestTimeout = 0;
      this.server.on('connection', (socket) => {
        try {
          socket.setNoDelay(true);
          socket.setKeepAlive(true, 30000);
        } catch {}
      });
      this.server.once('error', reject);
      this.server.listen(listenPort, listenHost, () => {
        const addr = this.server.address();
        this.running = true;
        this.boundHost = listenHost;
        this.boundPort = addr.port;
        this.log('info', `Servidor Esteban Cloud activo en ${listenHost}:${addr.port}`);
        resolve({ host: this.boundHost, port: this.boundPort });
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.server || !this.running) {
        this.running = false;
        return resolve();
      }
      this.server.close(() => {
        this.running = false;
        this.boundHost = null;
        this.boundPort = null;
        this.log('info', 'Servidor Esteban Cloud detenido.');
        resolve();
      });
    });
  }

  getStatus() {
    return {
      running: this.running,
      host: this.boundHost,
      port: this.boundPort,
      activeSessions: this.activeSessions.size,
      recentActivity: this.recentActivity.slice(0, 25)
    };
  }
}

module.exports = {
  EstebanCloudServer,
  safeResolvePath
};

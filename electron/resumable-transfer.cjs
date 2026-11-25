'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

const DEFAULT_STAGING_DIR = path.join(os.tmpdir(), 'esteban-mesh-office-resumable');
const DEFAULT_OUTPUT_DIR = path.join(os.homedir(), 'Documents', 'EstebanMeshOffice-Recibidos');

function sanitizeUploadId(uploadId) {
  const cleaned = String(uploadId || '').trim().replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw createHttpError(400, 'uploadId inválido');
  }
  return cleaned.slice(0, 128);
}

function sanitizeFileName(fileName) {
  const base = path.basename(String(fileName || 'archivo.bin').replace(/\\/g, '/'));
  const cleaned = base
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/^\.+$/, '')
    .trim();
  return cleaned || 'archivo.bin';
}

function sanitizeSubfolder(subfolder) {
  const raw = String(subfolder || 'Entregas-Oficina');
  const segments = raw
    .split(/[/\\]+/)
    .map((seg) => seg.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim())
    .filter((seg) => seg && seg !== '.' && seg !== '..');
  return segments.length ? path.join(...segments) : 'Entregas-Oficina';
}

function createHttpError(statusCode, message, extra = {}) {
  const err = new Error(message);
  err.statusCode = statusCode;
  Object.assign(err, extra);
  return err;
}

function computeFileSha256Sync(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.allocUnsafe(1024 * 1024);
    let bytesRead = 0;
    while ((bytesRead = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(bytesRead === buf.length ? buf : buf.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function computeFileSha256Async(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function atomicMoveSync(srcPath, destPath) {
  const destDir = path.dirname(destPath);
  fs.mkdirSync(destDir, { recursive: true });
  try {
    fs.renameSync(srcPath, destPath);
  } catch (err) {
    if (err && (err.code === 'EXDEV' || err.code === 'EPERM' || err.code === 'EACCES')) {
      const tmpDest = `${destPath}.tmp-${crypto.randomBytes(6).toString('hex')}`;
      try {
        fs.copyFileSync(srcPath, tmpDest);
        fs.renameSync(tmpDest, destPath);
        try {
          fs.unlinkSync(srcPath);
        } catch (_) {
          // Best-effort cleanup of staging file
        }
      } catch (copyErr) {
        try {
          if (fs.existsSync(tmpDest)) fs.unlinkSync(tmpDest);
        } catch (_) {
          // Ignore cleanup error
        }
        throw copyErr;
      }
    } else {
      throw err;
    }
  }
}

class ResumableTransferStore {
  constructor({ stagingDir = DEFAULT_STAGING_DIR, outputBaseDir = DEFAULT_OUTPUT_DIR } = {}) {
    this.stagingDir = path.resolve(stagingDir);
    this.outputBaseDir = path.resolve(outputBaseDir);
    this.sessions = new Map();
    fs.mkdirSync(this.stagingDir, { recursive: true });
  }

  _metaPath(safeId) {
    return path.join(this.stagingDir, `${safeId}.meta.json`);
  }

  _partPath(safeId) {
    return path.join(this.stagingDir, `${safeId}.part`);
  }

  _saveSession(session) {
    this.sessions.set(session.uploadId, session);
    fs.mkdirSync(this.stagingDir, { recursive: true });
    const metaPath = this._metaPath(session.uploadId);
    const tmpMeta = `${metaPath}.tmp`;
    fs.writeFileSync(tmpMeta, JSON.stringify(session, null, 2), 'utf8');
    fs.renameSync(tmpMeta, metaPath);
  }

  _loadSession(uploadId) {
    const safeId = sanitizeUploadId(uploadId);
    if (this.sessions.has(safeId)) {
      return this.sessions.get(safeId);
    }
    const metaPath = this._metaPath(safeId);
    if (!fs.existsSync(metaPath)) {
      return null;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (!parsed.completed) {
        const partPath = this._partPath(safeId);
        parsed.offset = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0;
      }
      this.sessions.set(safeId, parsed);
      return parsed;
    } catch (_) {
      return null;
    }
  }

  _resolveDestination(subfolder, fileName) {
    const safeSub = sanitizeSubfolder(subfolder);
    const safeFile = sanitizeFileName(fileName);
    const resolvedBase = path.resolve(this.outputBaseDir);
    const targetPath = path.resolve(resolvedBase, safeSub, safeFile);
    const rel = path.relative(resolvedBase, targetPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw createHttpError(400, 'Ruta de destino fuera del directorio permitido');
    }
    return targetPath;
  }

  _finalizeSession(session) {
    const partPath = this._partPath(session.uploadId);
    const actualSha256 = computeFileSha256Sync(partPath);
    if (
      session.expectedSha256 &&
      actualSha256.toLowerCase() !== String(session.expectedSha256).trim().toLowerCase()
    ) {
      throw createHttpError(422, 'Verificación SHA-256 fallida al finalizar la transferencia', {
        expectedSha256: session.expectedSha256,
        actualSha256,
      });
    }

    const destPath = this._resolveDestination(session.subfolder, session.fileName);
    atomicMoveSync(partPath, destPath);

    session.completed = true;
    session.sha256 = actualSha256;
    session.destPath = destPath;
    session.completedAt = new Date().toISOString();
    session.updatedAt = session.completedAt;
    this._saveSession(session);

    return {
      uploadId: session.uploadId,
      offset: session.offset,
      totalSize: session.totalSize,
      completed: true,
      sha256: actualSha256,
      destPath,
    };
  }

  initUpload({
    uploadId,
    fileName,
    totalSize,
    expectedSha256 = '',
    subfolder = 'Entregas-Oficina',
    senderNode = 'Oficina',
  } = {}) {
    const sizeNum = Number(totalSize);
    if (!Number.isFinite(sizeNum) || sizeNum < 0 || !Number.isInteger(sizeNum)) {
      throw createHttpError(400, 'totalSize debe ser un entero no negativo');
    }

    const safeId = sanitizeUploadId(uploadId || crypto.randomUUID());
    const safeFile = sanitizeFileName(fileName);
    const safeSub = sanitizeSubfolder(subfolder);
    const existing = this._loadSession(safeId);

    if (existing && existing.totalSize === sizeNum) {
      if (!existing.completed) {
        const partPath = this._partPath(safeId);
        if (!fs.existsSync(partPath)) {
          fs.writeFileSync(partPath, Buffer.alloc(0));
          existing.offset = 0;
        } else {
          existing.offset = fs.statSync(partPath).size;
        }
        this._saveSession(existing);
      }
      return {
        uploadId: existing.uploadId,
        offset: existing.offset,
        totalSize: existing.totalSize,
        completed: Boolean(existing.completed),
        ...(existing.completed ? { destPath: existing.destPath, sha256: existing.sha256 } : {}),
      };
    }

    fs.mkdirSync(this.stagingDir, { recursive: true });
    const partPath = this._partPath(safeId);
    fs.writeFileSync(partPath, Buffer.alloc(0));

    const now = new Date().toISOString();
    const session = {
      uploadId: safeId,
      fileName: safeFile,
      totalSize: sizeNum,
      expectedSha256: String(expectedSha256 || '').trim().toLowerCase(),
      subfolder: safeSub,
      senderNode: String(senderNode || 'Oficina'),
      offset: 0,
      completed: false,
      sha256: '',
      destPath: '',
      createdAt: now,
      updatedAt: now,
    };
    this._saveSession(session);

    if (sizeNum === 0) {
      return this._finalizeSession(session);
    }

    return {
      uploadId: session.uploadId,
      offset: session.offset,
      totalSize: session.totalSize,
      completed: session.completed,
    };
  }

  getStatus(uploadId) {
    let session;
    try {
      session = this._loadSession(uploadId);
    } catch (_) {
      return null;
    }
    if (!session) return null;

    if (!session.completed) {
      const partPath = this._partPath(session.uploadId);
      if (fs.existsSync(partPath)) {
        session.offset = fs.statSync(partPath).size;
      }
    }

    return {
      uploadId: session.uploadId,
      offset: session.offset,
      totalSize: session.totalSize,
      completed: Boolean(session.completed),
      fileName: session.fileName,
      destPath: session.destPath || '',
    };
  }

  appendChunk(uploadId, offset, chunkBuffer) {
    const session = this._loadSession(uploadId);
    if (!session) {
      throw createHttpError(404, `Sesión de transferencia no encontrada: ${uploadId}`);
    }

    const numericOffset = Number(offset);
    if (!Number.isFinite(numericOffset) || numericOffset < 0) {
      throw createHttpError(400, 'Upload-Offset inválido');
    }

    const buf = Buffer.isBuffer(chunkBuffer)
      ? chunkBuffer
      : chunkBuffer instanceof Uint8Array
        ? Buffer.from(chunkBuffer)
        : Buffer.from(chunkBuffer || '');

    if (session.completed) {
      if (numericOffset === session.offset && buf.length === 0) {
        return {
          uploadId: session.uploadId,
          offset: session.offset,
          totalSize: session.totalSize,
          completed: true,
          sha256: session.sha256,
          destPath: session.destPath,
        };
      }
      throw createHttpError(409, 'La transferencia ya fue completada', {
        expectedOffset: session.offset,
        receivedOffset: numericOffset,
      });
    }

    const partPath = this._partPath(session.uploadId);
    if (fs.existsSync(partPath)) {
      session.offset = fs.statSync(partPath).size;
    }

    if (numericOffset !== session.offset) {
      throw createHttpError(
        409,
        `Offset desincronizado: esperado ${session.offset}, recibido ${numericOffset}`,
        {
          expectedOffset: session.offset,
          receivedOffset: numericOffset,
        }
      );
    }

    if (session.offset + buf.length > session.totalSize) {
      throw createHttpError(
        409,
        `El fragmento excede el tamaño total declarado (${session.offset + buf.length} > ${session.totalSize})`,
        {
          expectedOffset: session.offset,
          totalSize: session.totalSize,
        }
      );
    }

    if (buf.length > 0) {
      fs.appendFileSync(partPath, buf);
      session.offset += buf.length;
    }

    session.updatedAt = new Date().toISOString();
    this._saveSession(session);

    if (session.offset >= session.totalSize) {
      return this._finalizeSession(session);
    }

    return {
      uploadId: session.uploadId,
      offset: session.offset,
      totalSize: session.totalSize,
      completed: false,
      sha256: '',
      destPath: '',
    };
  }
}

function httpRequest(method, urlStr, { headers = {}, body = null, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const transport = parsed.protocol === 'https:' ? https : http;
    const req = transport.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          let json = null;
          if (raw.length > 0) {
            try {
              json = JSON.parse(raw.toString('utf8'));
            } catch (_) {
              json = null;
            }
          }
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers || {},
            body: raw,
            json,
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error(`Timeout HTTP en ${method} ${urlStr}`));
    });
    req.on('error', reject);

    if (body !== null && body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

function readExactSync(fd, size, position) {
  const buf = Buffer.allocUnsafe(size);
  let totalRead = 0;
  while (totalRead < size) {
    const n = fs.readSync(fd, buf, totalRead, size - totalRead, position + totalRead);
    if (n <= 0) break;
    totalRead += n;
  }
  return totalRead === size ? buf : buf.subarray(0, totalRead);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendFileResumable({
  filePath,
  baseUrl,
  subfolder = 'Entregas-Oficina',
  senderNode = 'Servidor',
  chunkSize = 8 * 1024 * 1024,
  maxRetries = 4,
  onProgress,
} = {}) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`Archivo origen no encontrado: ${filePath}`);
  }
  if (!baseUrl) {
    throw new Error('baseUrl es obligatorio');
  }

  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`La ruta no corresponde a un archivo regular: ${filePath}`);
  }

  const totalSize = stat.size;
  const fileName = path.basename(filePath);
  const sha256 = await computeFileSha256Async(filePath);
  const uploadId = `${sha256.slice(0, 16)}-${totalSize}`;
  const cleanBase = String(baseUrl).replace(/\/+$/, '');
  const safeChunkSize = Math.max(1024, Number(chunkSize) || 8 * 1024 * 1024);
  const retryLimit = Math.max(0, Number(maxRetries) || 0);

  const initBody = Buffer.from(
    JSON.stringify({
      uploadId,
      fileName,
      totalSize,
      expectedSha256: sha256,
      subfolder,
      senderNode,
    }),
    'utf8'
  );

  const initRes = await httpRequest('POST', `${cleanBase}/api/office/resumable/init`, {
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': String(initBody.length),
    },
    body: initBody,
  });

  if (initRes.statusCode < 200 || initRes.statusCode >= 300 || !initRes.json) {
    const msg = (initRes.json && initRes.json.error) || `Error HTTP ${initRes.statusCode} en init`;
    throw createHttpError(initRes.statusCode || 500, msg);
  }

  let offset = Number(initRes.json.offset || 0);
  let completed = Boolean(initRes.json.completed);
  let destPath = initRes.json.destPath || '';
  let resumed = offset > 0 || completed;

  const startedAt = Date.now();
  let bytesSentThisSession = 0;

  const emitProgress = () => {
    if (typeof onProgress !== 'function') return;
    const elapsedSec = Math.max((Date.now() - startedAt) / 1000, 0.001);
    const speedMBs = Number(((bytesSentThisSession / (1024 * 1024)) / elapsedSec).toFixed(2));
    const percent = totalSize > 0 ? Math.min(100, Number(((offset / totalSize) * 100).toFixed(2))) : 100;
    onProgress({
      uploadId,
      fileName,
      offset,
      totalSize,
      percent,
      speedMBs,
      resumed,
    });
  };

  if (completed) {
    emitProgress();
  } else {
    const fd = fs.openSync(filePath, 'r');
    try {
      const uploadUrl = `${cleanBase}/api/office/resumable/${encodeURIComponent(uploadId)}`;

      while (!completed && offset < totalSize) {
        let attempt = 0;
        let chunkSucceeded = false;

        while (!chunkSucceeded) {
          const bytesToRead = Math.min(safeChunkSize, totalSize - offset);
          const chunkBuf = readExactSync(fd, bytesToRead, offset);

          try {
            const patchRes = await httpRequest('PATCH', uploadUrl, {
              headers: {
                'Upload-Offset': String(offset),
                'Content-Type': 'application/offset+octet-stream',
                'Content-Length': String(chunkBuf.length),
              },
              body: chunkBuf,
            });

            if (patchRes.statusCode >= 200 && patchRes.statusCode < 300) {
              bytesSentThisSession += chunkBuf.length;
              const serverHeaderOffset = patchRes.headers['upload-offset'];
              if (patchRes.json && typeof patchRes.json.offset === 'number') {
                offset = patchRes.json.offset;
              } else if (serverHeaderOffset !== undefined) {
                offset = Number(serverHeaderOffset);
              } else {
                offset += chunkBuf.length;
              }

              if (patchRes.json && patchRes.json.completed) {
                completed = true;
                destPath = patchRes.json.destPath || destPath;
              }

              emitProgress();
              chunkSucceeded = true;
              continue;
            }

            const errMsg =
              (patchRes.json && patchRes.json.error) ||
              `Error HTTP ${patchRes.statusCode} al subir fragmento`;
            const patchErr = createHttpError(patchRes.statusCode, errMsg);
            // Non-retryable client errors except 409 (offset sync) and 429 (rate limit)
            if (
              patchRes.statusCode >= 400 &&
              patchRes.statusCode < 500 &&
              patchRes.statusCode !== 409 &&
              patchRes.statusCode !== 429
            ) {
              throw patchErr;
            }
            throw patchErr;
          } catch (err) {
            // Do not retry deterministic 4xx errors other than 409/429
            if (
              err &&
              typeof err.statusCode === 'number' &&
              err.statusCode >= 400 &&
              err.statusCode < 500 &&
              err.statusCode !== 409 &&
              err.statusCode !== 429
            ) {
              throw err;
            }

            attempt += 1;
            if (attempt > retryLimit) {
              throw err;
            }

            // Query server HEAD to recover exact Upload-Offset
            try {
              const headRes = await httpRequest('HEAD', uploadUrl, { timeoutMs: 10000 });
              if (headRes.statusCode >= 200 && headRes.statusCode < 300) {
                const rawOffset = headRes.headers['upload-offset'];
                const parsedOffset = Number(rawOffset);
                if (Number.isFinite(parsedOffset) && parsedOffset >= 0) {
                  offset = parsedOffset;
                  if (offset > 0) resumed = true;
                  if (offset >= totalSize) {
                    const syncInit = await httpRequest(
                      'POST',
                      `${cleanBase}/api/office/resumable/init`,
                      {
                        headers: {
                          'Content-Type': 'application/json',
                          'Content-Length': String(initBody.length),
                        },
                        body: initBody,
                      }
                    );
                    if (syncInit.json && syncInit.json.completed) {
                      completed = true;
                      destPath = syncInit.json.destPath || destPath;
                      chunkSucceeded = true;
                      emitProgress();
                      break;
                    }
                  }
                }
              }
            } catch (_) {
              // If HEAD also fails transiently, wait and retry next iteration
            }

            await delay(Math.min(150 * attempt, 1000));
          }
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  }

  const durationMs = Math.max(Date.now() - startedAt, 1);
  const avgSpeedMBs = Number(((bytesSentThisSession / (1024 * 1024)) / (durationMs / 1000)).toFixed(2));

  return {
    ok: true,
    uploadId,
    fileName,
    totalSize,
    sha256,
    destPath,
    durationMs,
    avgSpeedMBs,
    resumed,
  };
}

module.exports = {
  ResumableTransferStore,
  sendFileResumable,
};

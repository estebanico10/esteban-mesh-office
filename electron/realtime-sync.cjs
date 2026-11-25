'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const IGNORED_SEGMENTS = new Set(['.git', 'node_modules']);

function computeFileSha256Sync(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.allocUnsafe(512 * 1024);
    let bytesRead = 0;
    while ((bytesRead = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(bytesRead === buf.length ? buf : buf.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function formatConflictTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const mo = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  return `${y}${mo}${d}-${h}${mi}${s}`;
}

function sanitizeNodeTag(nodeTag) {
  const cleaned = String(nodeTag || os.hostname()).replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned || 'node';
}

function copyPreservingTimesSync(srcFile, dstFile, srcStat) {
  fs.mkdirSync(path.dirname(dstFile), { recursive: true });
  fs.copyFileSync(srcFile, dstFile);
  try {
    fs.utimesSync(dstFile, srcStat.atime, srcStat.mtime);
  } catch (_) {
    // Ignore utimes permission issues on certain filesystems
  }
}

function isIgnoredRelativePath(relPath) {
  if (!relPath) return true;
  const normalized = String(relPath).replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  for (const seg of segments) {
    if (IGNORED_SEGMENTS.has(seg)) return true;
    if (seg.includes('.sync-conflict-')) return true;
  }
  return false;
}

function syncFileWithConflictProtection(srcFile, dstFile, { nodeTag = os.hostname() } = {}) {
  const srcStat = fs.statSync(srcFile);
  if (!srcStat.isFile()) {
    return { action: 'skipped', conflictPath: '' };
  }

  fs.mkdirSync(path.dirname(dstFile), { recursive: true });

  if (!fs.existsSync(dstFile)) {
    copyPreservingTimesSync(srcFile, dstFile, srcStat);
    return { action: 'copied', conflictPath: '' };
  }

  const dstStat = fs.statSync(dstFile);

  if (dstStat.size === srcStat.size && Math.abs(dstStat.mtimeMs - srcStat.mtimeMs) <= 1500) {
    return { action: 'skipped', conflictPath: '' };
  }

  if (dstStat.mtimeMs > srcStat.mtimeMs + 2000) {
    const contentDiffers =
      dstStat.size !== srcStat.size ||
      computeFileSha256Sync(srcFile) !== computeFileSha256Sync(dstFile);

    if (contentDiffers) {
      const dir = path.dirname(dstFile);
      const ext = path.extname(dstFile);
      const base = path.basename(dstFile, ext);
      const stamp = formatConflictTimestamp(new Date());
      const safeTag = sanitizeNodeTag(nodeTag);
      let conflictPath = path.join(dir, `${base}.sync-conflict-${stamp}-${safeTag}${ext}`);

      if (fs.existsSync(conflictPath)) {
        const suffix = crypto.randomBytes(2).toString('hex');
        conflictPath = path.join(dir, `${base}.sync-conflict-${stamp}-${safeTag}-${suffix}${ext}`);
      }

      copyPreservingTimesSync(dstFile, conflictPath, dstStat);
      copyPreservingTimesSync(srcFile, dstFile, srcStat);
      return { action: 'conflict-preserved', conflictPath };
    }
  }

  copyPreservingTimesSync(srcFile, dstFile, srcStat);
  return { action: 'updated', conflictPath: '' };
}

function computeFileSha256Async(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath, { highWaterMark: 256 * 1024 });
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function copyPreservingTimesAsync(srcFile, dstFile, srcStat) {
  await fs.promises.mkdir(path.dirname(dstFile), { recursive: true });
  await fs.promises.copyFile(srcFile, dstFile);
  try {
    await fs.promises.utimes(dstFile, srcStat.atime, srcStat.mtime);
  } catch (_) {
    // Ignore utimes permission issues on certain filesystems
  }
}

async function syncFileWithConflictProtectionAsync(srcFile, dstFile, { nodeTag = os.hostname() } = {}) {
  const srcStat = await fs.promises.stat(srcFile);
  if (!srcStat.isFile()) {
    return { action: 'skipped', conflictPath: '' };
  }

  await fs.promises.mkdir(path.dirname(dstFile), { recursive: true });

  let dstStat = null;
  try {
    dstStat = await fs.promises.stat(dstFile);
  } catch {
    dstStat = null;
  }

  if (!dstStat) {
    await copyPreservingTimesAsync(srcFile, dstFile, srcStat);
    return { action: 'copied', conflictPath: '' };
  }

  if (dstStat.size === srcStat.size && Math.abs(dstStat.mtimeMs - srcStat.mtimeMs) <= 1500) {
    return { action: 'skipped', conflictPath: '' };
  }

  if (dstStat.mtimeMs > srcStat.mtimeMs + 2000) {
    const contentDiffers =
      dstStat.size !== srcStat.size ||
      (await computeFileSha256Async(srcFile)) !== (await computeFileSha256Async(dstFile));

    if (contentDiffers) {
      const dir = path.dirname(dstFile);
      const ext = path.extname(dstFile);
      const base = path.basename(dstFile, ext);
      const stamp = formatConflictTimestamp(new Date());
      const safeTag = sanitizeNodeTag(nodeTag);
      let conflictPath = path.join(dir, `${base}.sync-conflict-${stamp}-${safeTag}${ext}`);

      try {
        await fs.promises.access(conflictPath);
        const suffix = crypto.randomBytes(2).toString('hex');
        conflictPath = path.join(dir, `${base}.sync-conflict-${stamp}-${safeTag}-${suffix}${ext}`);
      } catch {
        // does not exist
      }

      await copyPreservingTimesAsync(dstFile, conflictPath, dstStat);
      await copyPreservingTimesAsync(srcFile, dstFile, srcStat);
      return { action: 'conflict-preserved', conflictPath };
    }
  }

  await copyPreservingTimesAsync(srcFile, dstFile, srcStat);
  return { action: 'updated', conflictPath: '' };
}

class RealtimeSyncManager {
  constructor({ onEvent, nodeTag = os.hostname(), debounceMs = 1500 } = {}) {
    this.onEvent = typeof onEvent === 'function' ? onEvent : null;
    this.nodeTag = nodeTag;
    this.debounceMs = Math.max(50, Number(debounceMs) || 1500);
    this.watchers = new Map();
  }

  _emit(evt) {
    if (!this.onEvent) return;
    try {
      this.onEvent(evt);
    } catch (_) {
      // Never let listener errors crash watcher loop
    }
  }

  startWatch({ id, sourceDir, targetDir, label = '' } = {}) {
    if (!sourceDir || !targetDir) {
      throw new Error('sourceDir y targetDir son obligatorios');
    }

    const resolvedSrc = path.resolve(sourceDir);
    const resolvedDst = path.resolve(targetDir);

    if (!fs.existsSync(resolvedSrc) || !fs.statSync(resolvedSrc).isDirectory()) {
      throw new Error(`La carpeta origen no existe o no es un directorio: ${resolvedSrc}`);
    }

    fs.mkdirSync(resolvedDst, { recursive: true });

    const watchId = String(id || crypto.randomUUID());
    if (this.watchers.has(watchId)) {
      this.stopWatch(watchId);
    }

    const stats = {
      id: watchId,
      label: label || path.basename(resolvedSrc),
      sourceDir: resolvedSrc,
      targetDir: resolvedDst,
      active: true,
      filesSynced: 0,
      conflictsPreserved: 0,
      lastSyncAt: null,
      lastError: '',
    };

    const pendingTimers = new Map();

    const scheduleSync = (relPath) => {
      if (isIgnoredRelativePath(relPath)) return;

      const existingTimer = pendingTimers.get(relPath);
      if (existingTimer) clearTimeout(existingTimer);

      const timer = setTimeout(async () => {
        pendingTimers.delete(relPath);
        if (!stats.active) return;

        const srcFull = path.join(resolvedSrc, relPath);
        const dstFull = path.join(resolvedDst, relPath);

        try {
          let st;
          try {
            st = await fs.promises.stat(srcFull);
          } catch {
            return;
          }
          if (!st.isFile()) return;

          const result = await syncFileWithConflictProtectionAsync(srcFull, dstFull, {
            nodeTag: this.nodeTag,
          });

          if (result.action !== 'skipped') {
            stats.filesSynced += 1;
            stats.lastSyncAt = new Date().toISOString();
            stats.lastError = '';
            if (result.action === 'conflict-preserved') {
              stats.conflictsPreserved += 1;
            }
          }

          this._emit({
            type: 'sync',
            id: watchId,
            label: stats.label,
            relativePath: relPath,
            srcFile: srcFull,
            dstFile: dstFull,
            action: result.action,
            conflictPath: result.conflictPath,
            timestamp: new Date().toISOString(),
          });
        } catch (err) {
          stats.lastError = err && err.message ? err.message : String(err);
          this._emit({
            type: 'error',
            id: watchId,
            label: stats.label,
            relativePath: relPath,
            error: stats.lastError,
            timestamp: new Date().toISOString(),
          });
        }
      }, this.debounceMs);

      if (typeof timer.unref === 'function') {
        timer.unref();
      }
      pendingTimers.set(relPath, timer);
    };

    const fsWatcher = fs.watch(resolvedSrc, { recursive: true }, (_eventType, filename) => {
      if (!filename) return;
      scheduleSync(String(filename));
    });

    fsWatcher.on('error', (err) => {
      stats.lastError = err && err.message ? err.message : String(err);
      this._emit({
        type: 'error',
        id: watchId,
        label: stats.label,
        error: stats.lastError,
        timestamp: new Date().toISOString(),
      });
    });

    this.watchers.set(watchId, {
      fsWatcher,
      pendingTimers,
      stats,
    });

    this._emit({
      type: 'started',
      id: watchId,
      label: stats.label,
      sourceDir: resolvedSrc,
      targetDir: resolvedDst,
      timestamp: new Date().toISOString(),
    });

    return { ...stats };
  }

  stopWatch(id) {
    const entry = this.watchers.get(String(id));
    if (!entry) return false;

    entry.stats.active = false;
    for (const timer of entry.pendingTimers.values()) {
      clearTimeout(timer);
    }
    entry.pendingTimers.clear();

    try {
      entry.fsWatcher.close();
    } catch (_) {
      // Ignore close error
    }

    this.watchers.delete(String(id));
    this._emit({
      type: 'stopped',
      id: entry.stats.id,
      label: entry.stats.label,
      timestamp: new Date().toISOString(),
    });
    return true;
  }

  stopAll() {
    for (const watchId of Array.from(this.watchers.keys())) {
      this.stopWatch(watchId);
    }
  }

  getStatus() {
    return Array.from(this.watchers.values()).map((entry) => ({ ...entry.stats }));
  }
}

module.exports = {
  syncFileWithConflictProtection,
  RealtimeSyncManager,
};

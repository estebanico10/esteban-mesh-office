'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const http = require('http');

const { ResumableTransferStore, sendFileResumable } = require('../electron/resumable-transfer.cjs');
const { syncFileWithConflictProtection } = require('../electron/realtime-sync.cjs');
const { EnterpriseAuditLog, REMOTE_PRESETS, runSafeRemotePreset } = require('../electron/audit-remote.cjs');

function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('ResumableTransferStore + sendFileResumable: reanuda desde la mitad y valida SHA-256 exacto', async () => {
  const workDir = createTempDir('emo-resumable-test-');
  const stagingDir = path.join(workDir, 'staging');
  const outputBaseDir = path.join(workDir, 'received');
  const srcFile = path.join(workDir, 'plano-arquitectura.bin');

  // 256 KB random payload (4 chunks of 64 KB)
  const payload = crypto.randomBytes(256 * 1024);
  const expectedSha256 = sha256Buffer(payload);
  fs.writeFileSync(srcFile, payload);

  const store = new ResumableTransferStore({ stagingDir, outputBaseDir });

  // Pre-seed the first 128 KB (2 chunks) to simulate an interrupted prior transfer
  const deterministicId = `${expectedSha256.slice(0, 16)}-${payload.length}`;
  const seeded = store.initUpload({
    uploadId: deterministicId,
    fileName: 'plano-arquitectura.bin',
    totalSize: payload.length,
    expectedSha256,
    subfolder: 'Proyectos-2026',
    senderNode: 'PC-Diseno',
  });
  assert.equal(seeded.offset, 0);
  const midRes = store.appendChunk(deterministicId, 0, payload.subarray(0, 128 * 1024));
  assert.equal(midRes.offset, 128 * 1024);
  assert.equal(midRes.completed, false);

  // Verify 409 mismatch guard
  assert.throws(
    () => store.appendChunk(deterministicId, 0, payload.subarray(0, 1024)),
    (err) => err && err.statusCode === 409
  );

  // Local HTTP server implementing init, HEAD, and PATCH (plus 1 transient drop to verify HEAD recovery)
  let dropOnce = true;
  let headRequests = 0;

  const server = http.createServer(async (req, res) => {
    try {
      const urlObj = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'POST' && urlObj.pathname === '/api/office/resumable/init') {
        const body = await readRequestBody(req);
        const data = JSON.parse(body.toString('utf8'));
        const result = store.initUpload(data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }

      const match = urlObj.pathname.match(/^\/api\/office\/resumable\/([^/]+)$/);
      if (match) {
        const uploadId = decodeURIComponent(match[1]);

        if (req.method === 'HEAD') {
          headRequests += 1;
          const status = store.getStatus(uploadId);
          if (!status) {
            res.writeHead(404);
            res.end();
            return;
          }
          res.writeHead(200, { 'Upload-Offset': String(status.offset) });
          res.end();
          return;
        }

        if (req.method === 'PATCH') {
          if (dropOnce) {
            dropOnce = false;
            req.socket.destroy();
            return;
          }
          const offset = Number(req.headers['upload-offset']);
          const chunk = await readRequestBody(req);
          const result = store.appendChunk(uploadId, offset, chunk);
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Upload-Offset': String(result.offset),
          });
          res.end(JSON.stringify(result));
          return;
        }
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
    } catch (err) {
      res.writeHead(err.statusCode || 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const progressEvents = [];
    const result = await sendFileResumable({
      filePath: srcFile,
      baseUrl,
      subfolder: 'Proyectos-2026',
      senderNode: 'PC-Diseno',
      chunkSize: 64 * 1024,
      maxRetries: 4,
      onProgress: (evt) => progressEvents.push(evt),
    });

    assert.equal(result.ok, true);
    assert.equal(result.resumed, true);
    assert.equal(result.uploadId, deterministicId);
    assert.equal(result.sha256, expectedSha256);
    assert.equal(result.totalSize, payload.length);
    assert.ok(headRequests >= 1, 'Debe consultar HEAD para recuperar Upload-Offset tras error transitorio');
    assert.ok(progressEvents.length >= 2, 'Debe reportar eventos de progreso');
    assert.equal(progressEvents[progressEvents.length - 1].percent, 100);
    assert.equal(progressEvents[progressEvents.length - 1].resumed, true);

    assert.ok(fs.existsSync(result.destPath), 'El archivo final debe existir en destino');
    const receivedBuf = fs.readFileSync(result.destPath);
    assert.equal(sha256Buffer(receivedBuf), expectedSha256);
    assert.deepEqual(receivedBuf, payload);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('syncFileWithConflictProtection: copia inicial, omisión sin cambios y preservación .sync-conflict-*', () => {
  const workDir = createTempDir('emo-sync-test-');
  const srcFile = path.join(workDir, 'src', 'presupuesto.txt');
  const dstFile = path.join(workDir, 'dst', 'presupuesto.txt');

  try {
    fs.mkdirSync(path.dirname(srcFile), { recursive: true });
    fs.writeFileSync(srcFile, 'version-1-origen', 'utf8');

    // 1. Initial copy
    const resCopy = syncFileWithConflictProtection(srcFile, dstFile, { nodeTag: 'PC-Oficina' });
    assert.equal(resCopy.action, 'copied');
    assert.equal(resCopy.conflictPath, '');
    assert.equal(fs.readFileSync(dstFile, 'utf8'), 'version-1-origen');

    // 2. Skip when unchanged (same size and mtime within 1.5s)
    const resSkip = syncFileWithConflictProtection(srcFile, dstFile, { nodeTag: 'PC-Oficina' });
    assert.equal(resSkip.action, 'skipped');
    assert.equal(resSkip.conflictPath, '');

    // 3. Conflict preservation when destination is newer (> 2000ms) with different content
    fs.writeFileSync(srcFile, 'version-2-desde-origen', 'utf8');
    fs.writeFileSync(dstFile, 'edicion-mas-reciente-en-destino', 'utf8');

    const olderTime = new Date(Date.now() - 10000);
    const newerTime = new Date(Date.now());
    fs.utimesSync(srcFile, olderTime, olderTime);
    fs.utimesSync(dstFile, newerTime, newerTime);

    const resConflict = syncFileWithConflictProtection(srcFile, dstFile, { nodeTag: 'PC-Oficina' });
    assert.equal(resConflict.action, 'conflict-preserved');
    assert.ok(resConflict.conflictPath, 'Debe devolver ruta del archivo de conflicto');
    assert.match(path.basename(resConflict.conflictPath), /^presupuesto\.sync-conflict-\d{8}-\d{6}-PC-Oficina\.txt$/);
    assert.ok(fs.existsSync(resConflict.conflictPath), 'El archivo de conflicto debe existir en disco');
    assert.equal(fs.readFileSync(resConflict.conflictPath, 'utf8'), 'edicion-mas-reciente-en-destino');
    assert.equal(fs.readFileSync(dstFile, 'utf8'), 'version-2-desde-origen');
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('EnterpriseAuditLog: append JSONL, filtro por categoría y exportación CSV UTF-8 BOM', () => {
  const workDir = createTempDir('emo-audit-test-');
  const auditPath = path.join(workDir, 'audit-log.jsonl');

  try {
    const audit = new EnterpriseAuditLog(auditPath);

    const e1 = audit.record({
      category: 'transfer',
      action: 'resumable-upload',
      actor: 'PC-Diseno',
      target: 'Servidor',
      details: 'Archivo "plano,final.dwg" enviado OK',
      status: 'ok',
    });
    const e2 = audit.record({
      category: 'remote-ops',
      action: 'cleanup-temp',
      actor: 'Admin',
      target: 'PC-Recepcion',
      details: 'Limpieza completada',
      status: 'ok',
    });
    const e3 = audit.record({
      category: 'transfer',
      action: 'sync-conflict',
      actor: 'PC-Contabilidad',
      target: 'NAS',
      details: 'Conflicto preservado',
      status: 'warn',
    });

    assert.ok(e1.id && e1.ts);
    assert.ok(e2.id && e3.id);

    // Raw JSONL lines check
    const rawLines = fs.readFileSync(auditPath, 'utf8').trim().split(/\r?\n/);
    assert.equal(rawLines.length, 3);
    assert.equal(JSON.parse(rawLines[0]).action, 'resumable-upload');

    // Recent list (newest first)
    const allRecent = audit.listRecent({ limit: 10 });
    assert.equal(allRecent.length, 3);
    assert.equal(allRecent[0].id, e3.id);
    assert.equal(allRecent[2].id, e1.id);

    // Category filter
    const transferOnly = audit.listRecent({ limit: 10, category: 'transfer' });
    assert.equal(transferOnly.length, 2);
    assert.ok(transferOnly.every((item) => item.category === 'transfer'));

    // CSV export with UTF-8 BOM & RFC-4180 escaping
    const csv = audit.exportCsv();
    assert.ok(csv.startsWith('\uFEFF'), 'El CSV debe iniciar con UTF-8 BOM');
    const csvLines = csv.slice(1).split('\r\n');
    assert.equal(csvLines[0], 'Fecha,Categoria,Accion,Origen,Destino,Estado,Detalles');
    assert.equal(csvLines.length, 4);
    assert.ok(
      csv.includes('"Archivo ""plano,final.dwg"" enviado OK"'),
      'Debe escapar comillas y comas según RFC-4180'
    );
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('runSafeRemotePreset: permite preset cleanup-temp y rechaza comandos arbitrarios', async () => {
  assert.ok(Array.isArray(REMOTE_PRESETS));
  assert.ok(REMOTE_PRESETS.some((p) => p.id === 'cleanup-temp'));

  const res = await runSafeRemotePreset('cleanup-temp');
  assert.equal(res.ok, true);
  assert.equal(res.presetId, 'cleanup-temp');
  assert.equal(res.nodeName, os.hostname());
  assert.equal(typeof res.durationMs, 'number');
  assert.equal(typeof res.output, 'string');
  assert.ok(res.output.length > 0);
  assert.ok(res.executedAt);

  await assert.rejects(
    async () => runSafeRemotePreset('rm -rf /'),
    /no permitido|desconocido/i
  );
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const http = require('node:http');

const {
  collectHardwareInventory,
  FleetStore
} = require('../electron/fleet-manager.cjs');

const {
  distributeFilesToFleet,
  broadcastOfficeAnnouncement,
  wakeAllOfficePcs
} = require('../electron/bulk-transfer.cjs');
const {
  turboDownloadFile,
  selectFastestBaseUrl,
  httpAgent,
  httpsAgent
} = require('../electron/turbo-transfer.cjs');
const { ConfigStore } = require('../electron/config-store.cjs');
const { EstebanCloudServer } = require('../electron/server.cjs');
const {
  optimizeProcessMemory,
  MagicPairingManager,
  MiniInternetStore,
  redeemRemotePairingCode
} = require('../electron/mini-internet.cjs');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function startMockOfficePeer(peerName) {
  const receivedFiles = [];
  const receivedAnnouncements = [];

  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/office/bulk-receive') {
      const hash = crypto.createHash('sha256');
      let byteCount = 0;

      req.on('data', (chunk) => {
        hash.update(chunk);
        byteCount += chunk.length;
      });

      req.on('end', () => {
        const computedSha256 = hash.digest('hex');
        const headerSha256 = String(req.headers['x-file-sha256'] || '');
        const entry = {
          fileName: String(req.headers['x-file-name'] || ''),
          subfolder: String(req.headers['x-subfolder'] || ''),
          senderNode: String(req.headers['x-sender-node'] || ''),
          headerSha256,
          computedSha256,
          contentLength: Number(req.headers['content-length'] || 0),
          byteCount
        };
        receivedFiles.push(entry);

        if (headerSha256 && headerSha256 !== computedSha256) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'SHA-256 mismatch' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, sha256: computedSha256, bytes: byteCount }));
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/office/announcement') {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          receivedAnnouncements.push(body);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        peerName,
        baseUrl: `http://127.0.0.1:${addr.port}`,
        receivedFiles,
        receivedAnnouncements,
        close: () => new Promise((resClose) => server.close(() => resClose()))
      });
    });
  });
}

test('FleetStore: upsertNode, updateNodeMeta, getFleetSummary, importInventoryFiles, CSV and HTML export', async (t) => {
  const tmpDir = makeTempDir('emo-fleet-test-');
  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const fleetFile = path.join(tmpDir, 'fleet.json');
  const store = new FleetStore(fleetFile);
  const nowIso = new Date().toISOString();
  const staleIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  // Upsert 3 PCs (2 online, 1 stale/offline)
  store.upsertNode({
    nodeName: 'PC-CONTAB-01',
    department: 'General',
    role: 'Estación de Trabajo',
    lanIp: '192.168.1.101',
    tailscaleIp: '100.64.0.11',
    macAddresses: ['AA:BB:CC:DD:EE:01'],
    cpuModel: 'Intel Core i7-13700',
    cpuCores: 16,
    cpuPercent: 32,
    ramTotalGB: 32,
    ramFreeGB: 18,
    ramPercent: 43.8,
    gpuModel: 'Intel UHD Graphics 770',
    manufacturer: 'Dell Inc.',
    model: 'OptiPlex 7010',
    serialNumber: 'DL-1001',
    disks: [
      { drive: 'C:', label: 'Sistema', fs: 'NTFS', totalGB: 1024, freeGB: 512, usedPercent: 50, mediaType: 'Fixed' }
    ],
    lastSeenAt: nowIso
  });

  // Admin customizes department & role
  store.updateNodeMeta('pc-contab-01', {
    department: 'Contabilidad',
    role: 'Estación Principal',
    label: 'Caja, "Norte"',
    notes: 'Equipo de facturación'
  });

  // Subsequent beacon with default department/role must preserve admin customizations
  const updated = store.upsertNode({
    nodeName: 'PC-CONTAB-01',
    department: 'General',
    role: 'Estación de Trabajo',
    cpuPercent: 45,
    ramPercent: 50,
    lastSeenAt: nowIso
  });
  assert.equal(updated.department, 'Contabilidad');
  assert.equal(updated.role, 'Estación Principal');
  assert.equal(updated.cpuPercent, 45);

  // Add second online PC with high disk usage alert + high CPU alert
  store.upsertNode({
    nodeName: 'PC-DISENO-02',
    department: 'Diseño',
    role: 'Render Workstation',
    lanIp: '192.168.1.102',
    macAddresses: ['AA:BB:CC:DD:EE:02'],
    cpuModel: 'AMD Ryzen 9 7950X',
    cpuCores: 32,
    cpuPercent: 91,
    ramTotalGB: 64,
    ramFreeGB: 20,
    ramPercent: 68.8,
    gpuModel: 'NVIDIA RTX 4090',
    manufacturer: 'ASUS',
    model: 'ProArt Station',
    serialNumber: 'AS-2002',
    disks: [
      { drive: 'C:', label: 'NVMe', fs: 'NTFS', totalGB: 2048, freeGB: 1024, usedPercent: 50, mediaType: 'Fixed' },
      { drive: 'D:', label: 'Proyectos', fs: 'NTFS', totalGB: 1024, freeGB: 50, usedPercent: 95.1, mediaType: 'Fixed' }
    ],
    lastSeenAt: nowIso
  });

  // Add third stale/offline PC
  store.upsertNode({
    nodeName: 'PC-VENTAS-03',
    department: 'Ventas',
    role: 'Recepción',
    lanIp: '192.168.1.103',
    macAddresses: ['AA:BB:CC:DD:EE:03'],
    cpuModel: 'Intel Core i5-12400',
    cpuCores: 12,
    cpuPercent: 10,
    ramTotalGB: 16,
    ramFreeGB: 10,
    ramPercent: 37.5,
    disks: [
      { drive: 'C:', label: 'Sistema', fs: 'NTFS', totalGB: 1024, freeGB: 462, usedPercent: 54.9, mediaType: 'Fixed' }
    ],
    lastSeenAt: staleIso
  });

  // Verify persistence by reloading store from disk
  const reloaded = new FleetStore(fleetFile);
  const listed = reloaded.listNodes({ staleMs: 120000 });
  assert.equal(listed.length, 3);
  assert.equal(listed[0].online, true);
  assert.equal(listed[1].online, true);
  assert.equal(listed[2].online, false);
  assert.equal(listed[2].nodeName, 'PC-VENTAS-03');

  // Verify multi-PC summary aggregation
  // Total storage = 1024 + 2048 + 1024 + 1024 = 5120 GB = 5 TB
  // Free storage = 512 + 1024 + 50 + 462 = 2048 GB = 2 TB
  // Total RAM = 32 + 64 + 16 = 112 GB
  // Total CPU cores = 16 + 32 + 12 = 60
  // Alerts = PC-DISENO-02 CPU (91>=85) + D: disk (95.1>=90) = 2
  const summary = reloaded.getFleetSummary();
  assert.equal(summary.totalNodes, 3);
  assert.equal(summary.onlineNodes, 2);
  assert.equal(summary.capacityRecommended, 50);
  assert.equal(summary.totalStorageTB, 5);
  assert.equal(summary.freeStorageTB, 2);
  assert.equal(summary.totalRamGB, 112);
  assert.equal(summary.totalCpuCores, 60);
  assert.equal(summary.departments.Contabilidad, 1);
  assert.equal(summary.departments['Diseño'], 1);
  assert.equal(summary.departments.Ventas, 1);
  assert.equal(summary.alertsCount, 2);

  // Verify importInventoryFiles from USB directory
  const usbDir = path.join(tmpDir, 'usb-inventarios');
  fs.mkdirSync(usbDir, { recursive: true });
  fs.writeFileSync(
    path.join(usbDir, 'Inventario-PC-RRHH-04.json'),
    JSON.stringify({
      nodeName: 'PC-RRHH-04',
      department: 'RRHH',
      role: 'Analista',
      lanIps: ['192.168.1.104', '100.64.0.44'],
      macAddresses: ['AA:BB:CC:DD:EE:04'],
      cpuModel: 'Intel Core i5-13500',
      cpuCores: 14,
      ramTotalGB: 16,
      ramFreeGB: 8,
      ramPercent: 50,
      disks: [{ drive: 'C:', totalGB: 512, freeGB: 256, usedPercent: 50, mediaType: 'Fixed' }],
      collectedAt: nowIso
    }),
    'utf8'
  );
  // Non-matching file should be ignored when scanning directory
  fs.writeFileSync(path.join(usbDir, 'notes.json'), JSON.stringify({ ignored: true }), 'utf8');

  const importRes = reloaded.importInventoryFiles(usbDir);
  assert.equal(importRes.importedCount, 1);
  assert.equal(importRes.nodes[0].nodeName, 'PC-RRHH-04');
  assert.equal(importRes.nodes[0].lanIp, '192.168.1.104');
  assert.equal(importRes.nodes[0].tailscaleIp, '100.64.0.44');
  assert.equal(reloaded.getFleetSummary().totalNodes, 4);

  // Verify RFC-4180 UTF-8 CSV export with BOM
  const csv = reloaded.exportFleetCsv();
  assert.ok(csv.startsWith('\uFEFF'), 'CSV must start with UTF-8 BOM');
  assert.ok(csv.includes('Hostname,Departamento,Rol,Estado,IP LAN,IP Tailscale,MAC,CPU,RAM GB,Discos Libres GB / Total GB,GPU,Modelo,Serie,Última vez visto'));
  assert.ok(csv.includes('PC-CONTAB-01,Contabilidad,Estación Principal,En línea,192.168.1.101,100.64.0.11'));
  assert.ok(csv.includes('PC-RRHH-04,RRHH,Analista,En línea,192.168.1.104,100.64.0.44'));
  assert.ok(csv.includes('PC-VENTAS-03,Ventas,Recepción,Desconectado'));

  // Verify printable HTML enterprise audit report
  const html = reloaded.exportFleetHtmlReport('Esteban Corp <HQ>');
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes('Esteban Corp &lt;HQ&gt;'), 'Workspace name must be HTML-escaped');
  assert.ok(html.includes('PC-CONTAB-01'));
  assert.ok(html.includes('PC-DISENO-02'));
  assert.ok(html.includes('PC-RRHH-04'));
  assert.ok(html.includes('@media print'));

  // Verify removeNode
  assert.equal(reloaded.removeNode('pc-ventas-03'), true);
  assert.equal(reloaded.removeNode('non-existent'), false);
  assert.equal(reloaded.listNodes().length, 3);
});

test('BulkTransferEngine: distributeFilesToFleet to 3 mock HTTP peers with SHA-256 verification and broadcastOfficeAnnouncement', async (t) => {
  const tmpDir = makeTempDir('emo-bulk-test-');
  const peers = await Promise.all([
    startMockOfficePeer('PC-OFICINA-1'),
    startMockOfficePeer('PC-OFICINA-2'),
    startMockOfficePeer('PC-OFICINA-3')
  ]);

  t.after(async () => {
    await Promise.all(peers.map((p) => p.close()));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Create a 384 KB binary payload to exercise multi-chunk streaming
  const payloadPath = path.join(tmpDir, 'paquete-mensual.bin');
  const payloadBuf = crypto.randomBytes(384 * 1024);
  const expectedSha256 = crypto.createHash('sha256').update(payloadBuf).digest('hex');
  fs.writeFileSync(payloadPath, payloadBuf);

  const progressEvents = [];
  const distResult = await distributeFilesToFleet({
    filePaths: [payloadPath],
    targetPeers: peers.map((p) => ({ peerName: p.peerName, baseUrl: p.baseUrl })),
    destinationSubfolder: 'Entregas-Oficina',
    senderNode: 'Servidor-Central',
    concurrency: 3,
    onProgress: (ev) => progressEvents.push(ev)
  });

  assert.equal(distResult.totalFiles, 1);
  assert.equal(distResult.totalPeers, 3);
  assert.equal(distResult.totalBytes, payloadBuf.length * 3);
  assert.equal(distResult.results.length, 3);
  assert.ok(distResult.durationMs >= 1);
  assert.ok(progressEvents.some((e) => e.status === 'completed' && e.percent === 100));

  for (const r of distResult.results) {
    assert.equal(r.ok, true, `Transfer to ${r.peerName} failed: ${r.error}`);
    assert.equal(r.sha256, expectedSha256);
    assert.equal(r.bytes, payloadBuf.length);
    assert.equal(r.fileName, 'paquete-mensual.bin');
  }

  for (const peer of peers) {
    assert.equal(peer.receivedFiles.length, 1);
    const rx = peer.receivedFiles[0];
    assert.equal(rx.fileName, 'paquete-mensual.bin');
    assert.equal(rx.subfolder, 'Entregas-Oficina');
    assert.equal(rx.senderNode, 'Servidor-Central');
    assert.equal(rx.headerSha256, expectedSha256);
    assert.equal(rx.computedSha256, expectedSha256);
    assert.equal(rx.byteCount, payloadBuf.length);
    assert.equal(rx.contentLength, payloadBuf.length);
  }

  // Test broadcastOfficeAnnouncement in parallel across all 3 peers
  const annResult = await broadcastOfficeAnnouncement({
    title: 'Mantenimiento programado',
    message: 'Respaldo automático a las 19:00.',
    priority: 'high',
    senderNode: 'Administración',
    targetPeers: peers.map((p) => ({ peerName: p.peerName, baseUrl: p.baseUrl }))
  });

  assert.equal(annResult.delivered, 3);
  assert.equal(annResult.failed, 0);
  assert.equal(annResult.results.length, 3);

  for (const peer of peers) {
    assert.equal(peer.receivedAnnouncements.length, 1);
    const msg = peer.receivedAnnouncements[0];
    assert.equal(msg.title, 'Mantenimiento programado');
    assert.equal(msg.message, 'Respaldo automático a las 19:00.');
    assert.equal(msg.priority, 'high');
    assert.equal(msg.senderNode, 'Administración');
    assert.ok(msg.sentAt);
  }

  // Test wakeAllOfficePcs deduplicates valid MACs and skips invalid ones
  const wolRes = await wakeAllOfficePcs([
    { macAddresses: ['aa-bb-cc-dd-ee-01', '00:00:00:00:00:00', 'invalid-mac'] },
    { macAddresses: ['AA:BB:CC:DD:EE:01', '11:22:33:44:55:66'] }
  ]);
  assert.equal(wolRes.packetsSent, 2);
  assert.deepEqual(wolRes.macs, ['AA:BB:CC:DD:EE:01', '11:22:33:44:55:66']);
});

test('collectHardwareInventory: returns valid hostname, CPU, RAM, and disks on Windows', async () => {
  const inv = await collectHardwareInventory({
    department: 'Ingeniería',
    role: 'Servidor Local',
    workspaceName: 'Esteban Mesh Office Test',
    port: 4890,
    sharedDisksCount: 2
  });

  assert.equal(inv.nodeName, os.hostname());
  assert.equal(inv.department, 'Ingeniería');
  assert.equal(inv.role, 'Servidor Local');
  assert.equal(inv.workspaceName, 'Esteban Mesh Office Test');
  assert.equal(inv.port, 4890);
  assert.equal(inv.sharedDisksCount, 2);
  assert.equal(inv.appVersion, '1.0.0');
  assert.ok(typeof inv.cpuModel === 'string' && inv.cpuModel.length > 0);
  assert.ok(typeof inv.cpuCores === 'number' && inv.cpuCores > 0);
  assert.ok(typeof inv.ramTotalGB === 'number' && inv.ramTotalGB > 0);
  assert.ok(typeof inv.ramFreeGB === 'number' && inv.ramFreeGB >= 0);
  assert.ok(typeof inv.ramPercent === 'number' && inv.ramPercent >= 0 && inv.ramPercent <= 100);
  assert.ok(Array.isArray(inv.lanIps));
  assert.ok(Array.isArray(inv.macAddresses));
  assert.ok(Array.isArray(inv.disks));
  assert.ok(inv.collectedAt && !Number.isNaN(Date.parse(inv.collectedAt)));

  if (process.platform === 'win32') {
    assert.ok(inv.disks.length > 0, 'Should detect at least one Windows disk');
    const cDrive = inv.disks.find((d) => d.drive === 'C:') || inv.disks[0];
    assert.ok(cDrive.drive.endsWith(':'));
    assert.ok(cDrive.totalGB > 0, 'Disk totalGB should be positive');
    assert.ok(cDrive.freeGB >= 0);
    assert.ok(cDrive.mediaType === 'Fixed' || cDrive.mediaType === 'USB');
  }
});

test('turbo-transfer: 8-stream parallel HTTP Range reconstruction (18 MB) & LAN route preference', async (t) => {
  const tmpDir = makeTempDir('emo-turbo-test-');
  const totalBytes = 18 * 1024 * 1024;
  const payload = crypto.randomBytes(totalBytes);
  const expectedSha = crypto.createHash('sha256').update(payload).digest('hex');

  const rangeHeadersSeen = [];
  const srv = http.createServer((req, res) => {
    if (req.url === '/api/shares') {
      const body = JSON.stringify({ nodeName: 'OFFICE-HOST', key: { permissions: 'rw' }, shares: [{ id: 's1', name: 'DISCO-D' }] });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
      return res.end(body);
    }
    if (req.url.startsWith('/api/download')) {
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'Content-Length': totalBytes, 'Accept-Ranges': 'bytes' });
        return res.end();
      }
      const range = req.headers.range;
      if (range) {
        rangeHeadersSeen.push(range);
        const match = /bytes=(\d*)-(\d*)/.exec(range);
        const start = match && match[1] ? parseInt(match[1], 10) : 0;
        const end = match && match[2] ? Math.min(parseInt(match[2], 10), totalBytes - 1) : totalBytes - 1;
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${totalBytes}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': (end - start) + 1
        });
        return res.end(payload.subarray(start, end + 1));
      }
      res.writeHead(200, { 'Content-Length': totalBytes });
      return res.end(payload);
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const { port } = srv.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(() => {
    try { httpAgent.destroy(); } catch {}
    try { httpsAgent.destroy(); } catch {}
    srv.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const routeRes = await selectFastestBaseUrl(
    { lanIp: '127.0.0.1', tailscaleDns: 'localhost', port },
    'test-token',
    '',
    port
  );
  assert.equal(routeRes.baseUrl, baseUrl);
  assert.equal(routeRes.routeType, 'lan');
  assert.equal(routeRes.shares.length, 1);

  const destPath = path.join(tmpDir, 'reconstructed.mov');
  const progressEvents = [];
  const dlRes = await turboDownloadFile({
    baseUrl,
    token: 'test-token',
    shareId: 's1',
    relPath: 'video.mov',
    destPath,
    fileSize: 0,
    concurrency: 8,
    minParallelBytes: 4 * 1024 * 1024,
    onProgress: (p) => progressEvents.push(p)
  });

  assert.equal(dlRes.ok, true);
  assert.equal(dlRes.parallelStreams, 8);
  assert.equal(rangeHeadersSeen.length, 8);
  assert.ok(progressEvents.some((p) => p.status === 'completed' && p.percent === 100));

  const downloadedBuf = fs.readFileSync(destPath);
  assert.equal(downloadedBuf.length, totalBytes);
  const actualSha = crypto.createHash('sha256').update(downloadedBuf).digest('hex');
  assert.equal(actualSha, expectedSha);
});

test('mini-internet: MiniInternetStore defaults/CRUD, MagicPairingManager HTTP single-use claim & optimizeProcessMemory', async (t) => {
  const tmpDir = makeTempDir('emo-mini-test-');
  const miniStore = new MiniInternetStore(path.join(tmpDir, 'mini-internet.json'));
  const cfg = new ConfigStore(path.join(tmpDir, 'config.json'));
  const pairing = new MagicPairingManager();
  const srv = new EstebanCloudServer(cfg, { pairingManager: pairing, miniInternetStore: miniStore });

  await srv.start({ host: '127.0.0.1', port: 0 });
  const baseUrl = `http://127.0.0.1:${srv.boundPort}`;

  t.after(async () => {
    await srv.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const nets = miniStore.listNetworks();
  assert.equal(nets.length >= 4, true);
  assert.ok(nets.some((n) => n.domain === 'diseno.mesh'));
  const pkgs = miniStore.listPackages();
  assert.ok(pkgs.some((p) => p.id === 'pkg-winscript'));
  assert.ok(pkgs.some((p) => p.id === 'pkg-illustrator'));
  assert.ok(pkgs.some((p) => p.id === 'pkg-esteban-web'));

  const portalHtml = await new Promise((resolve, reject) => {
    http.get(`${baseUrl}/net/net-design`, (res) => {
      const c = [];
      res.on('data', (d) => c.push(d));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(c).toString('utf8') }));
    }).on('error', reject);
  });
  assert.equal(portalHtml.status, 200);
  assert.ok(portalHtml.text.includes('diseno.mesh'));

  const shortcutDir = path.join(tmpDir, 'desktop-shortcuts');
  const execWeb = await miniStore.executePackageLocally('pkg-esteban-web', { dryRun: true, shortcutDir });
  assert.equal(execWeb.ok, true);
  assert.ok(fs.existsSync(path.join(shortcutDir, 'Esteban Nicola - Portfolio y Ayuda.url')));

  const execWinScript = await miniStore.executePackageLocally('pkg-winscript', { dryRun: true });
  assert.equal(execWinScript.ok, true);
  assert.ok(execWinScript.command.includes('flick9000.WinScript'));

  const sampleBundle = JSON.stringify({ v: 1, keyId: 'EMO-PAIR-TEST', host: { lanIp: '127.0.0.1', port: srv.boundPort } });
  const invite = pairing.createPairingInvite({
    bundleJson: sampleBundle,
    passphrase: 'office-secret-phrase',
    label: 'Llave Oficina Test',
    nodeName: 'OFFICE-HOST'
  });
  assert.match(invite.code, /^EC-[A-Z0-9]{4}$/);

  const claimed = await redeemRemotePairingCode({ code: invite.code, candidateUrls: [baseUrl] });
  assert.equal(claimed.ok, true);
  assert.equal(claimed.bundleJson, sampleBundle);
  assert.equal(claimed.passphrase, 'office-secret-phrase');

  await assert.rejects(() => redeemRemotePairingCode({ code: invite.code, candidateUrls: [baseUrl] }));

  const memRes = await optimizeProcessMemory({ aggressive: false });
  assert.equal(memRes.ok, true);
  assert.equal(typeof memRes.beforeMB, 'number');
  assert.equal(typeof memRes.afterMB, 'number');
  assert.ok(memRes.afterMB > 0);
});

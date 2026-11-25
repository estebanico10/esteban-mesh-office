'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const DEFAULT_THRESHOLDS = Object.freeze({
  cpuPercent: 85,
  ramPercent: 88,
  diskPercent: 90,
  diskBusyMBs: 180
});

const BENCHMARK_SIZE_BYTES = 16 * 1024 * 1024; // 16 MB
const MAX_PLAN_DEVICES = 100;

let cachedDiskBenchmark = null;

function round1(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 10) / 10;
}

function execPowerShell(command, timeoutMs = 4000) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          stdout: String(stdout || '').trim(),
          stderr: String(stderr || '').trim()
        });
      }
    );
  });
}

function readCpuTotals(cpus) {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus || []) {
    const t = cpu && cpu.times ? cpu.times : {};
    const coreIdle = Number(t.idle) || 0;
    const coreTotal =
      (Number(t.user) || 0) +
      (Number(t.nice) || 0) +
      (Number(t.sys) || 0) +
      coreIdle +
      (Number(t.irq) || 0);
    idle += coreIdle;
    total += coreTotal;
  }
  return { idle, total };
}

function sampleCpuMetrics(intervalMs = 180) {
  return new Promise((resolve) => {
    const firstCpus = os.cpus() || [];
    const first = readCpuTotals(firstCpus);

    setTimeout(() => {
      const secondCpus = os.cpus() || [];
      const second = readCpuTotals(secondCpus);

      const totalDiff = second.total - first.total;
      const idleDiff = second.idle - first.idle;
      let percent = 0;
      if (totalDiff > 0) {
        const busyRatio = (totalDiff - idleDiff) / totalDiff;
        percent = round1(Math.min(100, Math.max(0, busyRatio * 100)));
      }

      const refCpu = secondCpus[0] || firstCpus[0] || {};
      resolve({
        percent,
        cores: secondCpus.length || firstCpus.length || 0,
        model: refCpu.model ? String(refCpu.model).trim() : ''
      });
    }, intervalMs);
  });
}

function getRamMetrics() {
  const totalBytes = Math.max(0, Number(os.totalmem()) || 0);
  const freeBytes = Math.max(0, Math.min(totalBytes, Number(os.freemem()) || 0));
  const usedBytes = Math.max(0, totalBytes - freeBytes);
  const percent = totalBytes > 0 ? round1((usedBytes / totalBytes) * 100) : 0;
  return { totalBytes, freeBytes, usedBytes, percent };
}

const DISK_META_TTL_MS = 5 * 60 * 1000;
const DISK_IO_TTL_MS = 15 * 1000;
const LOCAL_METRICS_TTL_MS = 12 * 1000;

let cachedDiskMeta = { items: null, expiresAt: 0 };
let cachedDiskIo = { value: 0, expiresAt: 0 };
let cachedLocalMetrics = { value: null, expiresAt: 0 };
let localMetricsInFlight = null;

async function refreshDiskSpaceNative(metaItems) {
  if (typeof fs.promises.statfs !== 'function') return metaItems;
  const refreshed = await Promise.all(
    metaItems.map(async (item) => {
      try {
        const st = await fs.promises.statfs(`${item.deviceId}\\`);
        const bsize = Number(st.bsize) || 0;
        const totalBytes = Math.max(0, bsize * (Number(st.blocks) || 0));
        const freeBytes = Math.max(0, Math.min(totalBytes, bsize * (Number(st.bavail ?? st.bfree) || 0)));
        const usedBytes = Math.max(0, totalBytes - freeBytes);
        const percent = totalBytes > 0 ? round1((usedBytes / totalBytes) * 100) : 0;
        return { ...item, totalBytes, freeBytes, usedBytes, percent };
      } catch {
        return item;
      }
    })
  );
  return refreshed;
}

async function getWindowsDisks() {
  if (process.platform !== 'win32') return [];

  const now = Date.now();
  if (cachedDiskMeta.items && now < cachedDiskMeta.expiresAt) {
    return refreshDiskSpaceNative(cachedDiskMeta.items);
  }

  const psCmd =
    "@(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=2 OR DriveType=3' | " +
    'Select-Object DeviceID, VolumeName, FileSystem, Size, FreeSpace, DriveType) | ' +
    'ConvertTo-Json -Compress';

  const res = await execPowerShell(psCmd, 5000);
  if (!res.ok || !res.stdout) return cachedDiskMeta.items || [];

  try {
    const parsed = JSON.parse(res.stdout);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    const mapped = items
      .filter((item) => item && item.DeviceID)
      .map((item) => {
        const driveType = Number(item.DriveType) === 2 ? 2 : 3;
        const totalBytes = Math.max(0, Number(item.Size) || 0);
        const freeBytes = Math.max(0, Math.min(totalBytes, Number(item.FreeSpace) || 0));
        const usedBytes = Math.max(0, totalBytes - freeBytes);
        const percent = totalBytes > 0 ? round1((usedBytes / totalBytes) * 100) : 0;
        return {
          deviceId: String(item.DeviceID).trim(),
          volumeName: item.VolumeName ? String(item.VolumeName).trim() : '',
          fileSystem: item.FileSystem ? String(item.FileSystem).trim() : '',
          driveType,
          isFixed: driveType === 3,
          totalBytes,
          freeBytes,
          usedBytes,
          percent
        };
      });
    cachedDiskMeta = { items: mapped, expiresAt: Date.now() + DISK_META_TTL_MS };
    return mapped;
  } catch {
    return cachedDiskMeta.items || [];
  }
}

async function getLiveDiskThroughputMBs(timeoutMs = 2500, { skipProbe = false } = {}) {
  if (process.platform !== 'win32') return 0;

  const now = Date.now();
  if (now < cachedDiskIo.expiresAt || skipProbe) {
    return cachedDiskIo.value;
  }

  const psCmd =
    '$v = $null; ' +
    "try { $v = (Get-Counter '\\PhysicalDisk(_Total)\\Disk Bytes/sec' -ErrorAction Stop).CounterSamples[0].CookedValue } catch {}; " +
    "if ($null -eq $v) { try { $v = (Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk -Filter \"Name='_Total'\" -ErrorAction Stop).DiskBytesPersec } catch {} }; " +
    'if ($null -ne $v) { [Convert]::ToDouble($v).ToString([System.Globalization.CultureInfo]::InvariantCulture) }';

  const res = await execPowerShell(psCmd, timeoutMs);
  if (!res.ok || !res.stdout) return cachedDiskIo.value;

  const normalized = res.stdout.split(/\r?\n/).pop().trim().replace(',', '.');
  const bytesPerSec = Number.parseFloat(normalized);
  if (!Number.isFinite(bytesPerSec) || bytesPerSec < 0) return cachedDiskIo.value;
  const val = round1(bytesPerSec / (1024 * 1024));
  cachedDiskIo = { value: val, expiresAt: Date.now() + DISK_IO_TTL_MS };
  return val;
}

function computeStorageSummary(disks) {
  let totalBytes = 0;
  let freeBytes = 0;
  let usedBytes = 0;

  for (const disk of disks || []) {
    if (!disk) continue;
    if (disk.isFixed === false || disk.driveType === 2) continue;
    const dTotal = Math.max(0, Number(disk.totalBytes) || 0);
    const dFree = Math.max(0, Math.min(dTotal, Number(disk.freeBytes) || 0));
    const dUsed =
      typeof disk.usedBytes === 'number' && Number.isFinite(disk.usedBytes)
        ? Math.max(0, disk.usedBytes)
        : Math.max(0, dTotal - dFree);
    totalBytes += dTotal;
    freeBytes += dFree;
    usedBytes += dUsed;
  }

  const percent = totalBytes > 0 ? round1((usedBytes / totalBytes) * 100) : 0;
  return { totalBytes, freeBytes, usedBytes, percent };
}

async function runDiskSpeedBenchmark(targetDir) {
  const dir = targetDir || os.tmpdir();
  const tmpPath = path.join(dir, `.ec_disk_bench_${Date.now()}.tmp`);
  const writeBuf = Buffer.alloc(BENCHMARK_SIZE_BYTES, 0x5a);
  const readBuf = Buffer.allocUnsafe(BENCHMARK_SIZE_BYTES);
  const sizeMB = BENCHMARK_SIZE_BYTES / (1024 * 1024);

  let writeHandle = null;
  let readHandle = null;

  try {
    const writeStart = process.hrtime.bigint();
    writeHandle = await fs.promises.open(tmpPath, 'w');
    let written = 0;
    while (written < BENCHMARK_SIZE_BYTES) {
      const { bytesWritten } = await writeHandle.write(
        writeBuf,
        written,
        BENCHMARK_SIZE_BYTES - written,
        written
      );
      if (bytesWritten <= 0) break;
      written += bytesWritten;
    }
    try {
      await writeHandle.sync();
    } catch {
      // Some virtual/network filesystems do not support fsync
    }
    await writeHandle.close();
    writeHandle = null;
    const writeEnd = process.hrtime.bigint();

    const readStart = process.hrtime.bigint();
    readHandle = await fs.promises.open(tmpPath, 'r');
    let totalRead = 0;
    while (totalRead < BENCHMARK_SIZE_BYTES) {
      const { bytesRead } = await readHandle.read(
        readBuf,
        totalRead,
        BENCHMARK_SIZE_BYTES - totalRead,
        totalRead
      );
      if (bytesRead <= 0) break;
      totalRead += bytesRead;
    }
    await readHandle.close();
    readHandle = null;
    const readEnd = process.hrtime.bigint();

    const writeSec = Math.max(Number(writeEnd - writeStart) / 1e9, 1e-6);
    const readSec = Math.max(Number(readEnd - readStart) / 1e9, 1e-6);

    const result = {
      writeMBs: Math.max(0.1, round1(sizeMB / writeSec)),
      readMBs: Math.max(0.1, round1(sizeMB / readSec)),
      testedAt: new Date().toISOString()
    };

    cachedDiskBenchmark = result;
    return { ...result };
  } finally {
    if (writeHandle) {
      try { await writeHandle.close(); } catch {}
    }
    if (readHandle) {
      try { await readHandle.close(); } catch {}
    }
    try {
      await fs.promises.unlink(tmpPath);
    } catch {}
  }
}

function evaluateAlerts(metrics, thresholds = DEFAULT_THRESHOLDS) {
  const limits = { ...DEFAULT_THRESHOLDS, ...(thresholds || {}) };
  const alerts = [];

  if (!metrics || typeof metrics !== 'object') {
    return { alerts, isBusy: false, busyReason: '' };
  }

  const cpuVal =
    metrics.cpu && typeof metrics.cpu.percent === 'number'
      ? metrics.cpu.percent
      : typeof metrics.cpuPercent === 'number'
        ? metrics.cpuPercent
        : null;

  if (cpuVal !== null && Number.isFinite(cpuVal) && cpuVal >= limits.cpuPercent) {
    const val = round1(cpuVal);
    const severity = val >= Math.min(98, limits.cpuPercent + 10) ? 'critical' : 'warn';
    alerts.push({
      id: 'cpu-overload',
      severity,
      kind: 'cpu',
      message: `CPU saturada al ${val}% (límite ${limits.cpuPercent}%)`,
      value: val,
      threshold: limits.cpuPercent
    });
  }

  const ramVal =
    metrics.ram && typeof metrics.ram.percent === 'number'
      ? metrics.ram.percent
      : typeof metrics.ramPercent === 'number'
        ? metrics.ramPercent
        : null;

  if (ramVal !== null && Number.isFinite(ramVal) && ramVal >= limits.ramPercent) {
    const val = round1(ramVal);
    const severity = val >= Math.min(98, limits.ramPercent + 7) ? 'critical' : 'warn';
    alerts.push({
      id: 'ram-overload',
      severity,
      kind: 'ram',
      message: `RAM elevada al ${val}% (límite ${limits.ramPercent}%)`,
      value: val,
      threshold: limits.ramPercent
    });
  }

  if (Array.isArray(metrics.disks) && metrics.disks.length > 0) {
    for (const disk of metrics.disks) {
      if (!disk) continue;
      if (disk.isFixed === false || disk.driveType === 2) continue;
      const diskPct =
        typeof disk.percent === 'number' && Number.isFinite(disk.percent)
          ? disk.percent
          : disk.totalBytes > 0
            ? ((disk.usedBytes != null ? disk.usedBytes : disk.totalBytes - (disk.freeBytes || 0)) /
                disk.totalBytes) *
              100
            : 0;
      if (Number.isFinite(diskPct) && diskPct >= limits.diskPercent) {
        const val = round1(diskPct);
        const label = disk.deviceId || disk.volumeName || 'fijo';
        const safeId = label.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'fixed';
        const severity = val >= Math.min(98, limits.diskPercent + 5) ? 'critical' : 'warn';
        alerts.push({
          id: `disk-space-${safeId}`,
          severity,
          kind: 'disk',
          message: `Disco ${label} casi lleno al ${val}% (límite ${limits.diskPercent}%)`,
          value: val,
          threshold: limits.diskPercent
        });
      }
    }
  } else if (
    metrics.storageSummary &&
    typeof metrics.storageSummary.percent === 'number' &&
    Number.isFinite(metrics.storageSummary.percent) &&
    metrics.storageSummary.percent >= limits.diskPercent
  ) {
    const val = round1(metrics.storageSummary.percent);
    const severity = val >= Math.min(98, limits.diskPercent + 5) ? 'critical' : 'warn';
    alerts.push({
      id: 'disk-space-total',
      severity,
      kind: 'disk',
      message: `Almacenamiento casi lleno al ${val}% (límite ${limits.diskPercent}%)`,
      value: val,
      threshold: limits.diskPercent
    });
  }

  const liveMBs =
    metrics.diskSpeed && typeof metrics.diskSpeed.liveMBs === 'number'
      ? metrics.diskSpeed.liveMBs
      : typeof metrics.liveMBs === 'number'
        ? metrics.liveMBs
        : null;

  if (liveMBs !== null && Number.isFinite(liveMBs) && liveMBs >= limits.diskBusyMBs) {
    const val = round1(liveMBs);
    const severity = val >= limits.diskBusyMBs * 1.5 ? 'critical' : 'warn';
    alerts.push({
      id: 'disk-io-busy',
      severity,
      kind: 'disk_io',
      message: `Disco con alta actividad (${val} MB/s, límite ${limits.diskBusyMBs} MB/s)`,
      value: val,
      threshold: limits.diskBusyMBs
    });
  }

  const isBusy = alerts.length > 0;
  const busyReason = isBusy ? alerts.map((a) => a.message).join(' · ') : '';

  return { alerts, isBusy, busyReason };
}

async function getLocalMetrics({ includeDiskBench = false, thresholds = DEFAULT_THRESHOLDS, force = false, skipDiskIoProbe = false } = {}) {
  const now = Date.now();
  if (!force && !includeDiskBench && cachedLocalMetrics.value && now < cachedLocalMetrics.expiresAt) {
    const cached = cachedLocalMetrics.value;
    const { alerts, isBusy, busyReason } = evaluateAlerts(cached, thresholds);
    return { ...cached, alerts, isBusy, busyReason };
  }

  if (!force && !includeDiskBench && localMetricsInFlight) {
    const shared = await localMetricsInFlight;
    const { alerts, isBusy, busyReason } = evaluateAlerts(shared, thresholds);
    return { ...shared, alerts, isBusy, busyReason };
  }

  const run = (async () => {
    const [cpu, disks, liveMBs] = await Promise.all([
      sampleCpuMetrics(180),
      getWindowsDisks(),
      getLiveDiskThroughputMBs(2500, { skipProbe: skipDiskIoProbe })
    ]);

    const ram = getRamMetrics();
    const storageSummary = computeStorageSummary(disks);

    if (includeDiskBench) {
      await runDiskSpeedBenchmark();
    }

    const diskSpeed = {
      readMBs: cachedDiskBenchmark ? cachedDiskBenchmark.readMBs : 0,
      writeMBs: cachedDiskBenchmark ? cachedDiskBenchmark.writeMBs : 0,
      liveMBs,
      testedAt: cachedDiskBenchmark ? cachedDiskBenchmark.testedAt : null
    };

    const baseMetrics = {
      nodeName: os.hostname(),
      platform: process.platform,
      uptimeSec: Math.floor(os.uptime()),
      timestamp: new Date().toISOString(),
      cpu,
      ram,
      disks,
      storageSummary,
      diskSpeed
    };

    cachedLocalMetrics = { value: baseMetrics, expiresAt: Date.now() + LOCAL_METRICS_TTL_MS };
    return baseMetrics;
  })();

  if (!includeDiskBench) {
    localMetricsInFlight = run;
  }

  try {
    const baseMetrics = await run;
    const { alerts, isBusy, busyReason } = evaluateAlerts(baseMetrics, thresholds);
    return {
      ...baseMetrics,
      alerts,
      isBusy,
      busyReason
    };
  } finally {
    if (localMetricsInFlight === run) localMetricsInFlight = null;
  }
}

function resolveNodeAlertState(metrics) {
  if (!metrics || typeof metrics !== 'object') {
    return { alerts: [], isBusy: false, busyReason: '' };
  }
  if (typeof metrics.isBusy === 'boolean' && Array.isArray(metrics.alerts)) {
    return {
      alerts: metrics.alerts,
      isBusy: metrics.isBusy,
      busyReason: typeof metrics.busyReason === 'string' ? metrics.busyReason : ''
    };
  }
  return evaluateAlerts(metrics);
}

function resolveNodeStorage(metrics) {
  if (!metrics || typeof metrics !== 'object') {
    return { totalBytes: 0, freeBytes: 0, usedBytes: 0 };
  }
  if (metrics.storageSummary && typeof metrics.storageSummary === 'object') {
    const totalBytes = Math.max(0, Number(metrics.storageSummary.totalBytes) || 0);
    const freeBytes = Math.max(0, Math.min(totalBytes, Number(metrics.storageSummary.freeBytes) || 0));
    const usedBytes =
      typeof metrics.storageSummary.usedBytes === 'number' &&
      Number.isFinite(metrics.storageSummary.usedBytes)
        ? Math.max(0, metrics.storageSummary.usedBytes)
        : Math.max(0, totalBytes - freeBytes);
    return { totalBytes, freeBytes, usedBytes };
  }
  if (Array.isArray(metrics.disks)) {
    return computeStorageSummary(metrics.disks);
  }
  return { totalBytes: 0, freeBytes: 0, usedBytes: 0 };
}

function aggregateGlobalMetrics(localMetrics, peerResults = [], tailscaleInfo = null) {
  const localAlertState = resolveNodeAlertState(localMetrics);
  const tsDnsShort =
    tailscaleInfo && tailscaleInfo.dnsName ? String(tailscaleInfo.dnsName).split('.')[0] : '';

  const localNode = {
    nodeName: (localMetrics && localMetrics.nodeName) || tsDnsShort || os.hostname(),
    isLocal: true,
    ip: (tailscaleInfo && tailscaleInfo.ip) || (localMetrics && localMetrics.ip) || '127.0.0.1',
    online: true,
    latencyMs: 0,
    version: (localMetrics && localMetrics.version) || '',
    metrics: localMetrics || null,
    isBusy: localAlertState.isBusy,
    busyReason: localAlertState.busyReason,
    alerts: localAlertState.alerts,
    error: null
  };

  const peers = (Array.isArray(peerResults) ? peerResults : []).map((peer) => {
    const online = Boolean(peer && peer.online);
    const peerMetrics = peer && peer.metrics ? peer.metrics : null;
    const alertState = online && peerMetrics ? resolveNodeAlertState(peerMetrics) : { alerts: [], isBusy: false, busyReason: '' };
    return {
      nodeName: (peer && peer.nodeName) || (peer && peer.ip) || 'Nodo remoto',
      isLocal: false,
      ip: (peer && peer.ip) || '',
      online,
      latencyMs: peer && typeof peer.latencyMs === 'number' ? peer.latencyMs : null,
      version: (peer && peer.version) || '',
      metrics: peerMetrics,
      isBusy: alertState.isBusy,
      busyReason: alertState.busyReason,
      alerts: alertState.alerts,
      error: (peer && peer.error) || null
    };
  });

  const nodes = [localNode, ...peers];
  const nodesTotal = nodes.length;
  const nodesOnline = nodes.filter((n) => n.online).length;
  const maxPlanDevices = MAX_PLAN_DEVICES;
  const availableSlots = Math.max(0, maxPlanDevices - nodesTotal);

  let totalBytes = 0;
  let freeBytes = 0;
  let usedBytes = 0;

  let cpuSum = 0;
  let cpuCount = 0;
  let ramSum = 0;
  let ramCount = 0;
  let totalDiskReadMBs = 0;
  let totalDiskWriteMBs = 0;

  const busyNodes = [];

  for (const node of nodes) {
    if (!node.online) continue;

    if (node.isBusy) {
      busyNodes.push({
        nodeName: node.nodeName,
        busyReason: node.busyReason,
        alerts: node.alerts
      });
    }

    const m = node.metrics;
    if (!m) continue;

    const storage = resolveNodeStorage(m);
    totalBytes += storage.totalBytes;
    freeBytes += storage.freeBytes;
    usedBytes += storage.usedBytes;

    if (m.cpu && typeof m.cpu.percent === 'number' && Number.isFinite(m.cpu.percent)) {
      cpuSum += m.cpu.percent;
      cpuCount += 1;
    }

    if (m.ram && typeof m.ram.percent === 'number' && Number.isFinite(m.ram.percent)) {
      ramSum += m.ram.percent;
      ramCount += 1;
    }

    if (m.diskSpeed && typeof m.diskSpeed === 'object') {
      const r = Number(m.diskSpeed.readMBs);
      const w = Number(m.diskSpeed.writeMBs);
      if (Number.isFinite(r) && r > 0) totalDiskReadMBs += r;
      if (Number.isFinite(w) && w > 0) totalDiskWriteMBs += w;
    }
  }

  const globalStorage = {
    totalBytes,
    freeBytes,
    usedBytes,
    percent: totalBytes > 0 ? round1((usedBytes / totalBytes) * 100) : 0
  };

  return {
    nodesOnline,
    nodesTotal,
    maxPlanDevices,
    availableSlots,
    globalStorage,
    avgCpuPercent: cpuCount > 0 ? round1(cpuSum / cpuCount) : 0,
    avgRamPercent: ramCount > 0 ? round1(ramSum / ramCount) : 0,
    totalDiskReadMBs: round1(totalDiskReadMBs),
    totalDiskWriteMBs: round1(totalDiskWriteMBs),
    busyNodes,
    nodes
  };
}

module.exports = {
  DEFAULT_THRESHOLDS,
  getLocalMetrics,
  runDiskSpeedBenchmark,
  evaluateAlerts,
  aggregateGlobalMetrics
};

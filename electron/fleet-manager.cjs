'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const dgram = require('dgram');
const { execFile } = require('child_process');

const APP_VERSION = (() => {
  try { return require('../package.json').version || '1.4.0'; } catch { return '1.4.0'; }
})();
const BEACON_MAGIC = 'ESTEBAN_MESH_OFFICE_V1';
const DEFAULT_UDP_PORT = 4891;
const DEFAULT_HTTP_PORT = 4890;
const CAPACITY_RECOMMENDED = 50;

function round1(val) {
  const n = Number(val);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}

function round2(val) {
  const n = Number(val);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function isTailscaleIp(ip) {
  if (!ip || typeof ip !== 'string') return false;
  const parts = ip.split('.').map(Number);
  return parts.length === 4 && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

function getLocalNetworkSnapshot() {
  const ifaces = os.networkInterfaces();
  const lanIps = [];
  const allIpv4 = [];
  const macSet = new Set();
  let lanIp = '';
  let tailscaleIp = '';

  for (const addrs of Object.values(ifaces)) {
    for (const addr of addrs || []) {
      if (!addr || addr.internal) continue;

      if (addr.mac && typeof addr.mac === 'string') {
        const cleanMac = addr.mac.trim().toUpperCase();
        if (cleanMac && cleanMac !== '00:00:00:00:00:00' && /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/.test(cleanMac)) {
          macSet.add(cleanMac);
        }
      }

      const isV4 = addr.family === 'IPv4' || addr.family === 4;
      if (!isV4 || !addr.address) continue;
      if (addr.address.startsWith('169.254.')) continue;

      if (!allIpv4.includes(addr.address)) {
        allIpv4.push(addr.address);
      }

      if (isTailscaleIp(addr.address)) {
        if (!tailscaleIp) tailscaleIp = addr.address;
      } else {
        if (!lanIps.includes(addr.address)) {
          lanIps.push(addr.address);
        }
        if (!lanIp) lanIp = addr.address;
      }
    }
  }

  // If no non-Tailscale LAN IP was found, fall back to allIpv4 so lanIps is still populated when networked
  const effectiveLanIps = lanIps.length > 0 ? lanIps : allIpv4;

  return {
    lanIps: effectiveLanIps,
    lanIp: lanIp || effectiveLanIps[0] || '',
    tailscaleIp,
    macAddresses: Array.from(macSet)
  };
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

function fallbackWindowsDisks() {
  if (process.platform !== 'win32') return [];
  const disks = [];
  for (let code = 67; code <= 90; code += 1) {
    const letter = String.fromCharCode(code);
    const drive = `${letter}:`;
    const root = `${drive}\\`;
    try {
      if (!fs.existsSync(root)) continue;
      let totalGB = 0;
      let freeGB = 0;
      let usedPercent = 0;
      if (typeof fs.statfsSync === 'function') {
        try {
          const st = fs.statfsSync(root);
          const totalBytes = Number(st.bsize) * Number(st.blocks);
          const freeBytes = Number(st.bsize) * Number(st.bavail);
          if (Number.isFinite(totalBytes) && totalBytes > 0) {
            totalGB = round2(totalBytes / (1024 ** 3));
            freeGB = round2(Math.max(0, Math.min(totalBytes, freeBytes)) / (1024 ** 3));
            usedPercent = round1(((totalBytes - Math.max(0, Math.min(totalBytes, freeBytes))) / totalBytes) * 100);
          }
        } catch {
          // ignore statfs error on unreadable drive
        }
      }
      disks.push({
        drive,
        label: 'Disco Local',
        fs: '',
        totalGB,
        freeGB,
        usedPercent,
        mediaType: 'Fixed'
      });
    } catch {
      // ignore inaccessible drive
    }
  }
  return disks;
}

function normalizeDisks(rawDisks) {
  if (!Array.isArray(rawDisks)) return [];
  return rawDisks
    .filter((d) => d && (d.drive || d.DeviceID || d.deviceId))
    .map((d) => {
      const drive = String(d.drive || d.DeviceID || d.deviceId || '').trim().toUpperCase();
      let totalGB = d.totalGB !== undefined ? round2(d.totalGB) : null;
      let freeGB = d.freeGB !== undefined ? round2(d.freeGB) : null;
      if (totalGB === null && d.Size !== undefined) {
        totalGB = round2((Number(d.Size) || 0) / (1024 ** 3));
      }
      if (freeGB === null && d.FreeSpace !== undefined) {
        freeGB = round2((Number(d.FreeSpace) || 0) / (1024 ** 3));
      }
      totalGB = Math.max(0, totalGB || 0);
      freeGB = Math.max(0, Math.min(totalGB || Infinity, freeGB || 0));
      const usedPercent =
        d.usedPercent !== undefined
          ? round1(d.usedPercent)
          : totalGB > 0
            ? round1(((totalGB - freeGB) / totalGB) * 100)
            : 0;
      const driveTypeNum = Number(d.DriveType);
      const mediaType =
        d.mediaType ||
        (driveTypeNum === 2 ? 'USB' : 'Fixed');
      return {
        drive,
        label: String(d.label ?? d.VolumeName ?? d.volumeName ?? (mediaType === 'USB' ? 'USB' : 'Disco Local')).trim(),
        fs: String(d.fs ?? d.FileSystem ?? d.fileSystem ?? '').trim(),
        totalGB,
        freeGB,
        usedPercent,
        mediaType
      };
    });
}

/**
 * Collects comprehensive Windows hardware and network inventory using Node `os`
 * plus a single fast PowerShell CIM/WMI query with safe fallback.
 */
async function collectHardwareInventory({
  department = 'General',
  role = 'Estación de Trabajo',
  workspaceName = 'Mi Empresa',
  port = DEFAULT_HTTP_PORT,
  sharedDisksCount = 0
} = {}) {
  const nodeName = os.hostname();
  let windowsUser = '';
  try {
    windowsUser = os.userInfo().username || '';
  } catch {
    windowsUser = process.env.USERNAME || process.env.USER || '';
  }

  const cpus = os.cpus() || [];
  const cpuModel = cpus[0] && cpus[0].model ? String(cpus[0].model).trim() : 'Desconocido';
  const cpuCores = cpus.length;

  const totalMemBytes = Math.max(0, Number(os.totalmem()) || 0);
  const freeMemBytes = Math.max(0, Math.min(totalMemBytes, Number(os.freemem()) || 0));
  const ramTotalGB = round2(totalMemBytes / (1024 ** 3));
  const ramFreeGB = round2(freeMemBytes / (1024 ** 3));
  const ramPercent = totalMemBytes > 0 ? round1(((totalMemBytes - freeMemBytes) / totalMemBytes) * 100) : 0;

  const netSnap = getLocalNetworkSnapshot();
  const uptimeHours = round1((Number(os.uptime()) || 0) / 3600);

  let osCaption = `${os.type()} ${os.release()}`;
  let osBuild = os.release();
  let gpuModel = 'Desconocida';
  let manufacturer = '';
  let model = '';
  let serialNumber = '';
  let disks = [];

  if (process.platform === 'win32') {
    const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
$os = Get-CimInstance Win32_OperatingSystem | Select-Object -First 1 Caption, BuildNumber, Version
$cs = Get-CimInstance Win32_ComputerSystem | Select-Object -First 1 Manufacturer, Model
$bios = Get-CimInstance Win32_BIOS | Select-Object -First 1 SerialNumber
$gpus = @(Get-CimInstance Win32_VideoController | Where-Object { $_.Name } | Select-Object -ExpandProperty Name | Select-Object -Unique)
$disks = @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=2 OR DriveType=3" | Select-Object DeviceID, VolumeName, FileSystem, Size, FreeSpace, DriveType)
[PSCustomObject]@{
  osCaption = if ($os -and $os.Caption) { [string]$os.Caption } else { '' }
  osBuild = if ($os -and $os.BuildNumber) { [string]$os.BuildNumber } else { '' }
  manufacturer = if ($cs -and $cs.Manufacturer) { [string]$cs.Manufacturer } else { '' }
  model = if ($cs -and $cs.Model) { [string]$cs.Model } else { '' }
  serialNumber = if ($bios -and $bios.SerialNumber) { [string]$bios.SerialNumber } else { '' }
  gpuModel = ($gpus -join ' / ')
  disks = $disks
} | ConvertTo-Json -Depth 4 -Compress
`;
    const cim = await runPowerShellJson(psScript, 8000);
    if (cim && typeof cim === 'object') {
      if (cim.osCaption && String(cim.osCaption).trim()) osCaption = String(cim.osCaption).trim();
      if (cim.osBuild && String(cim.osBuild).trim()) osBuild = String(cim.osBuild).trim();
      if (cim.manufacturer && String(cim.manufacturer).trim()) manufacturer = String(cim.manufacturer).trim();
      if (cim.model && String(cim.model).trim()) model = String(cim.model).trim();
      if (cim.serialNumber && String(cim.serialNumber).trim()) serialNumber = String(cim.serialNumber).trim();
      if (cim.gpuModel && String(cim.gpuModel).trim()) gpuModel = String(cim.gpuModel).trim();
      const rawDiskList = Array.isArray(cim.disks) ? cim.disks : cim.disks ? [cim.disks] : [];
      disks = normalizeDisks(rawDiskList);
    }
    if (disks.length === 0) {
      disks = fallbackWindowsDisks();
    }
  }

  return {
    nodeName,
    windowsUser,
    department: String(department || 'General').trim() || 'General',
    role: String(role || 'Estación de Trabajo').trim() || 'Estación de Trabajo',
    workspaceName: String(workspaceName || 'Mi Empresa').trim() || 'Mi Empresa',
    port: Number(port) || DEFAULT_HTTP_PORT,
    osCaption,
    osBuild,
    cpuModel,
    cpuCores,
    ramTotalGB,
    ramFreeGB,
    ramPercent,
    gpuModel,
    manufacturer,
    model,
    serialNumber,
    lanIps: netSnap.lanIps,
    lanIp: netSnap.lanIp,
    tailscaleIp: netSnap.tailscaleIp,
    macAddresses: netSnap.macAddresses,
    disks,
    sharedDisksCount: Math.max(0, Number(sharedDisksCount) || 0),
    uptimeHours,
    collectedAt: new Date().toISOString(),
    appVersion: APP_VERSION
  };
}

/**
 * UDP LAN broadcast beacon for automatic zero-config discovery of office computers.
 */
class LanDiscoveryBeacon {
  constructor(options = {}) {
    if (typeof options === 'number') {
      this.udpPort = options;
      this.broadcastAddress = '255.255.255.255';
      this.intervalMs = 15000;
    } else {
      this.udpPort = Number(options.udpPort) || DEFAULT_UDP_PORT;
      this.broadcastAddress = String(options.broadcastAddress || '255.255.255.255');
      this.intervalMs = Math.max(500, Number(options.intervalMs) || 15000);
    }
    this.socket = null;
    this.timer = null;
    this.running = false;
    this._bound = false;
    this._getBeaconPayload = null;
    this._onPeerBeacon = null;
  }

  start({ getBeaconPayload, onPeerBeacon } = {}) {
    this.stop();
    this._getBeaconPayload = typeof getBeaconPayload === 'function' ? getBeaconPayload : () => ({});
    this._onPeerBeacon = typeof onPeerBeacon === 'function' ? onPeerBeacon : null;
    this.running = true;

    return new Promise((resolve) => {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      this.socket = socket;
      let resolved = false;
      const done = (ok) => {
        if (!resolved) {
          resolved = true;
          resolve(ok);
        }
      };

      socket.on('error', () => {
        done(false);
      });

      socket.on('message', (msg, rinfo) => {
        let parsed;
        try {
          parsed = JSON.parse(msg.toString('utf8'));
        } catch {
          return;
        }
        if (!parsed || parsed.magic !== BEACON_MAGIC) return;

        let localPayload = {};
        try {
          localPayload = (this._getBeaconPayload && this._getBeaconPayload()) || {};
        } catch {
          localPayload = {};
        }

        if (localPayload.nodeId && parsed.nodeId && String(parsed.nodeId) === String(localPayload.nodeId)) {
          return;
        }

        if (this._onPeerBeacon) {
          try {
            this._onPeerBeacon(parsed, rinfo);
          } catch {
            // ignore listener error
          }
        }
      });

      socket.on('listening', () => {
        this._bound = true;
        try {
          socket.setBroadcast(true);
        } catch {
          // ignore if OS disallows broadcast on this socket
        }
        this.sendProbeNow();
        this.timer = setInterval(() => {
          this.sendProbeNow();
        }, this.intervalMs);
        if (typeof this.timer.unref === 'function') {
          this.timer.unref();
        }
        done(true);
      });

      try {
        socket.bind(this.udpPort);
      } catch {
        done(false);
      }
    });
  }

  sendProbeNow() {
    if (!this.socket || !this._bound) return false;
    let payload = {};
    try {
      payload = (this._getBeaconPayload && this._getBeaconPayload()) || {};
    } catch {
      payload = {};
    }
    const packetObj = {
      magic: BEACON_MAGIC,
      ...payload
    };
    const buf = Buffer.from(JSON.stringify(packetObj), 'utf8');
    try {
      this.socket.send(buf, 0, buf.length, this.udpPort, this.broadcastAddress, () => {
        // ignore transient send errors
      });
      return true;
    } catch {
      return false;
    }
  }

  stop() {
    this.running = false;
    this._bound = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.socket) {
      const sock = this.socket;
      this.socket = null;
      try {
        sock.removeAllListeners();
        sock.close();
      } catch {
        // already closed
      }
    }
  }
}

function normalizeNodeId(nodeData) {
  if (!nodeData || typeof nodeData !== 'object') {
    return `node-${crypto.randomBytes(4).toString('hex')}`;
  }
  const candidate = nodeData.id || nodeData.nodeId || nodeData.nodeName;
  if (candidate && String(candidate).trim()) {
    return String(candidate).trim().toLowerCase();
  }
  return `node-${crypto.randomBytes(4).toString('hex')}`;
}

function escapeCsvField(value) {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sumDiskStats(disks) {
  let totalGB = 0;
  let freeGB = 0;
  for (const d of Array.isArray(disks) ? disks : []) {
    totalGB += Math.max(0, Number(d.totalGB) || 0);
    freeGB += Math.max(0, Number(d.freeGB) || 0);
  }
  return { totalGB: round2(totalGB), freeGB: round2(freeGB) };
}

/**
 * Persistent fleet inventory store for up to 50+ office computers.
 */
class FleetStore {
  constructor(filePath = 'fleet.json') {
    this.filePath = filePath;
    this.nodes = new Map();
    this._dirty = false;
    this._saveTimer = null;
    this._saving = false;
    this._load();
  }

  _scheduleSave(delayMs = 25000) {
    if (!this.filePath) return;
    this._dirty = true;
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._saveAsync().catch(() => {});
    }, delayMs);
    if (typeof this._saveTimer.unref === 'function') {
      this._saveTimer.unref();
    }
  }

  async _saveAsync() {
    if (!this.filePath || !this._dirty || this._saving) return;
    this._saving = true;
    this._dirty = false;
    try {
      const dir = path.dirname(this.filePath);
      if (dir && dir !== '.') {
        await fs.promises.mkdir(dir, { recursive: true });
      }
      const payload = {
        version: 1,
        updatedAt: new Date().toISOString(),
        nodes: Array.from(this.nodes.values())
      };
      const json = JSON.stringify(payload, null, 2);
      const tmp = `${this.filePath}.tmp`;
      await fs.promises.writeFile(tmp, json, 'utf8');
      await fs.promises.rename(tmp, this.filePath);
    } catch {
      try {
        const payload = {
          version: 1,
          updatedAt: new Date().toISOString(),
          nodes: Array.from(this.nodes.values())
        };
        await fs.promises.writeFile(this.filePath, JSON.stringify(payload, null, 2), 'utf8');
      } catch {
        // ignore disk write failure
      }
    } finally {
      this._saving = false;
      if (this._dirty) {
        this._scheduleSave(10000);
      }
    }
  }

  flushSync() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    if (this._dirty) {
      this._dirty = false;
      this._save();
    }
  }

  _load() {
    if (!this.filePath) return;
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed)
        ? parsed
        : parsed && Array.isArray(parsed.nodes)
          ? parsed.nodes
          : [];
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const id = normalizeNodeId(item);
        this.nodes.set(id, { ...item, id });
      }
    } catch {
      this.nodes = new Map();
    }
  }

  _save() {
    if (!this.filePath) return;
    try {
      const dir = path.dirname(this.filePath);
      if (dir && dir !== '.') {
        fs.mkdirSync(dir, { recursive: true });
      }
      const payload = {
        version: 1,
        updatedAt: new Date().toISOString(),
        nodes: Array.from(this.nodes.values())
      };
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tmp, this.filePath);
    } catch {
      try {
        const payload = {
          version: 1,
          updatedAt: new Date().toISOString(),
          nodes: Array.from(this.nodes.values())
        };
        fs.writeFileSync(this.filePath, JSON.stringify(payload, null, 2), 'utf8');
      } catch {
        // ignore disk write failure
      }
    }
  }

  upsertNode(nodeData = {}) {
    if (!nodeData || typeof nodeData !== 'object') {
      throw new Error('Datos del equipo inválidos.');
    }

    let id = normalizeNodeId(nodeData);
    // Match by normalized nodeName if id wasn't found directly
    if (!this.nodes.has(id) && nodeData.nodeName) {
      const byNameId = String(nodeData.nodeName).trim().toLowerCase();
      if (this.nodes.has(byNameId)) {
        id = byNameId;
      }
    }

    const existing = this.nodes.get(id) || null;
    const nowIso = new Date().toISOString();

    // Preserve admin-customized department/role on subsequent beacons/check-ins
    const incomingDept = nodeData.department !== undefined ? String(nodeData.department).trim() : '';
    const incomingRole = nodeData.role !== undefined ? String(nodeData.role).trim() : '';

    let department = existing ? existing.department || 'General' : 'General';
    if (existing && existing._customDepartment) {
      department = existing.department;
    } else if (incomingDept && (!existing || !existing.department || existing.department === 'General' || incomingDept !== 'General')) {
      department = incomingDept;
    }

    let role = existing ? existing.role || 'Estación de Trabajo' : 'Estación de Trabajo';
    if (existing && existing._customRole) {
      role = existing.role;
    } else if (incomingRole && (!existing || !existing.role || existing.role === 'Estación de Trabajo' || incomingRole !== 'Estación de Trabajo')) {
      role = incomingRole;
    }

    // Derive lanIp / tailscaleIp from lanIps array when not explicitly passed
    const incomingLanIps = Array.isArray(nodeData.lanIps)
      ? nodeData.lanIps.filter((ip) => typeof ip === 'string' && ip.trim()).map((ip) => ip.trim())
      : null;

    let derivedLanIp = nodeData.lanIp !== undefined ? String(nodeData.lanIp || '').trim() : '';
    let derivedTailscaleIp = nodeData.tailscaleIp !== undefined ? String(nodeData.tailscaleIp || '').trim() : '';

    if (incomingLanIps) {
      if (!derivedLanIp) {
        derivedLanIp = incomingLanIps.find((ip) => !isTailscaleIp(ip)) || incomingLanIps[0] || '';
      }
      if (!derivedTailscaleIp) {
        derivedTailscaleIp = incomingLanIps.find((ip) => isTailscaleIp(ip)) || '';
      }
    }

    const incomingMacs = Array.isArray(nodeData.macAddresses)
      ? Array.from(
          new Set(
            nodeData.macAddresses
              .filter((m) => typeof m === 'string' && m.trim())
              .map((m) => m.trim().toUpperCase())
          )
        )
      : null;

    const incomingDisks = Array.isArray(nodeData.disks) ? normalizeDisks(nodeData.disks) : null;

    const merged = {
      ...(existing || {}),
      id,
      nodeId: nodeData.nodeId || existing?.nodeId || id,
      nodeName: String(nodeData.nodeName || existing?.nodeName || id).trim(),
      label: nodeData.label !== undefined ? String(nodeData.label).trim() : existing?.label || '',
      notes: nodeData.notes !== undefined ? String(nodeData.notes) : existing?.notes || '',
      windowsUser: nodeData.windowsUser !== undefined ? String(nodeData.windowsUser) : existing?.windowsUser || '',
      workspaceName: nodeData.workspaceName !== undefined ? String(nodeData.workspaceName) : existing?.workspaceName || 'Mi Empresa',
      department,
      role,
      _customDepartment: Boolean(existing?._customDepartment),
      _customRole: Boolean(existing?._customRole),
      port: Number(nodeData.port) || existing?.port || DEFAULT_HTTP_PORT,
      lanIp: derivedLanIp || existing?.lanIp || '',
      lanIps: incomingLanIps || existing?.lanIps || (derivedLanIp ? [derivedLanIp] : []),
      tailscaleIp: derivedTailscaleIp || existing?.tailscaleIp || '',
      macAddresses: incomingMacs || existing?.macAddresses || [],
      osCaption: nodeData.osCaption !== undefined ? String(nodeData.osCaption) : existing?.osCaption || '',
      osBuild: nodeData.osBuild !== undefined ? String(nodeData.osBuild) : existing?.osBuild || '',
      cpuModel: nodeData.cpuModel !== undefined ? String(nodeData.cpuModel) : existing?.cpuModel || '',
      cpuCores: nodeData.cpuCores !== undefined ? Math.max(0, Number(nodeData.cpuCores) || 0) : existing?.cpuCores || 0,
      cpuPercent: nodeData.cpuPercent !== undefined ? round1(nodeData.cpuPercent) : existing?.cpuPercent || 0,
      ramTotalGB: nodeData.ramTotalGB !== undefined ? round2(nodeData.ramTotalGB) : existing?.ramTotalGB || 0,
      ramFreeGB: nodeData.ramFreeGB !== undefined ? round2(nodeData.ramFreeGB) : existing?.ramFreeGB || 0,
      ramPercent: nodeData.ramPercent !== undefined ? round1(nodeData.ramPercent) : existing?.ramPercent || 0,
      gpuModel: nodeData.gpuModel !== undefined ? String(nodeData.gpuModel) : existing?.gpuModel || '',
      manufacturer: nodeData.manufacturer !== undefined ? String(nodeData.manufacturer) : existing?.manufacturer || '',
      model: nodeData.model !== undefined ? String(nodeData.model) : existing?.model || '',
      serialNumber: nodeData.serialNumber !== undefined ? String(nodeData.serialNumber) : existing?.serialNumber || '',
      disks: incomingDisks || existing?.disks || [],
      sharedDisksCount:
        nodeData.sharedDisksCount !== undefined
          ? Math.max(0, Number(nodeData.sharedDisksCount) || 0)
          : existing?.sharedDisksCount || 0,
      uptimeHours: nodeData.uptimeHours !== undefined ? round1(nodeData.uptimeHours) : existing?.uptimeHours || 0,
      appVersion: nodeData.appVersion !== undefined ? String(nodeData.appVersion) : existing?.appVersion || APP_VERSION,
      isLocal: nodeData.isLocal !== undefined ? Boolean(nodeData.isLocal) : Boolean(existing?.isLocal),
      online: nodeData.online !== undefined ? Boolean(nodeData.online) : true,
      lastSeenAt: nodeData.lastSeenAt || nodeData.collectedAt || nowIso,
      firstSeenAt: existing?.firstSeenAt || nowIso
    };

    this.nodes.set(id, merged);
    if (!existing) {
      this._save();
    } else {
      const metaChanged =
        existing.nodeName !== merged.nodeName ||
        existing.lanIp !== merged.lanIp ||
        existing.tailscaleIp !== merged.tailscaleIp ||
        existing.department !== merged.department ||
        existing.role !== merged.role ||
        existing.appVersion !== merged.appVersion ||
        existing.sharedDisksCount !== merged.sharedDisksCount ||
        existing.online !== merged.online;
      this._scheduleSave(metaChanged ? 3000 : 30000);
    }
    return { ...merged };
  }

  updateNodeMeta(id, { department, role, label, notes } = {}) {
    const key = String(id || '').trim().toLowerCase();
    const existing = this.nodes.get(key);
    if (!existing) {
      throw new Error(`Equipo no encontrado en la flota: ${id}`);
    }

    if (department !== undefined) {
      existing.department = String(department).trim() || 'General';
      existing._customDepartment = true;
    }
    if (role !== undefined) {
      existing.role = String(role).trim() || 'Estación de Trabajo';
      existing._customRole = true;
    }
    if (label !== undefined) {
      existing.label = String(label).trim();
    }
    if (notes !== undefined) {
      existing.notes = String(notes);
    }

    this.nodes.set(key, existing);
    this._save();
    return { ...existing };
  }

  removeNode(id) {
    const key = String(id || '').trim().toLowerCase();
    const removed = this.nodes.delete(key);
    if (removed) {
      this._save();
    }
    return removed;
  }

  importInventoryFiles(dirOrFilePaths) {
    const files = [];

    if (typeof dirOrFilePaths === 'string' && dirOrFilePaths.trim()) {
      const target = path.resolve(dirOrFilePaths);
      if (fs.existsSync(target)) {
        const st = fs.statSync(target);
        if (st.isDirectory()) {
          const entries = fs.readdirSync(target, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isFile() && /^Inventario-.*\.json$/i.test(entry.name)) {
              files.push(path.join(target, entry.name));
            }
          }
        } else if (st.isFile()) {
          files.push(target);
        }
      }
    } else if (Array.isArray(dirOrFilePaths)) {
      for (const item of dirOrFilePaths) {
        if (typeof item !== 'string' || !item.trim()) continue;
        const resolved = path.resolve(item);
        try {
          if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
            files.push(resolved);
          }
        } catch {
          // ignore unreadable path
        }
      }
    }

    const importedNodes = [];
    for (const filePath of files) {
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        const records = Array.isArray(parsed)
          ? parsed
          : parsed && Array.isArray(parsed.nodes)
            ? parsed.nodes
            : [parsed];

        for (const rec of records) {
          if (!rec || typeof rec !== 'object') continue;
          if (!rec.nodeName && !rec.id && !rec.nodeId) continue;
          const saved = this.upsertNode({
            ...rec,
            lastSeenAt: rec.lastSeenAt || rec.collectedAt || new Date().toISOString()
          });
          importedNodes.push(saved);
        }
      } catch {
        // skip corrupted or non-JSON file
      }
    }

    return {
      importedCount: importedNodes.length,
      nodes: importedNodes
    };
  }

  listNodes({ staleMs = 120000 } = {}) {
    const now = Date.now();
    const maxAge = Math.max(1000, Number(staleMs) || 120000);

    const list = Array.from(this.nodes.values()).map((n) => {
      const seenMs = n.lastSeenAt ? Date.parse(n.lastSeenAt) : NaN;
      const isOnline = n.isLocal
        ? true
        : Number.isFinite(seenMs)
          ? (now - seenMs) < maxAge
          : false;
      return {
        ...n,
        online: isOnline
      };
    });

    list.sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      if (Boolean(a.isLocal) !== Boolean(b.isLocal)) return a.isLocal ? -1 : 1;
      return String(a.nodeName || '').localeCompare(String(b.nodeName || ''), 'es', { sensitivity: 'base' });
    });

    return list;
  }

  getFleetSummary({ staleMs = 120000 } = {}) {
    const nodes = this.listNodes({ staleMs });
    let onlineNodes = 0;
    let totalStorageGB = 0;
    let freeStorageGB = 0;
    let totalRamGB = 0;
    let totalCpuCores = 0;
    let alertsCount = 0;
    const departments = {};

    for (const node of nodes) {
      if (node.online) onlineNodes += 1;

      const dept = node.department || 'General';
      departments[dept] = (departments[dept] || 0) + 1;

      totalRamGB += Math.max(0, Number(node.ramTotalGB) || 0);
      totalCpuCores += Math.max(0, Number(node.cpuCores) || 0);

      const diskTotals = sumDiskStats(node.disks);
      totalStorageGB += diskTotals.totalGB;
      freeStorageGB += diskTotals.freeGB;

      // Health alerts consistent with system thresholds (CPU >= 85%, RAM >= 88%, Disk >= 90%)
      if (Number(node.cpuPercent) >= 85) alertsCount += 1;
      if (Number(node.ramPercent) >= 88) alertsCount += 1;
      for (const d of Array.isArray(node.disks) ? node.disks : []) {
        if (Number(d.usedPercent) >= 90) {
          alertsCount += 1;
        }
      }
    }

    return {
      totalNodes: nodes.length,
      onlineNodes,
      capacityRecommended: CAPACITY_RECOMMENDED,
      totalStorageTB: round2(totalStorageGB / 1024),
      freeStorageTB: round2(freeStorageGB / 1024),
      totalRamGB: round1(totalRamGB),
      totalCpuCores,
      departments,
      alertsCount
    };
  }

  exportFleetCsv({ staleMs = 120000 } = {}) {
    const nodes = this.listNodes({ staleMs });
    const headers = [
      'Hostname',
      'Departamento',
      'Rol',
      'Estado',
      'IP LAN',
      'IP Tailscale',
      'MAC',
      'CPU',
      'RAM GB',
      'Discos Libres GB / Total GB',
      'GPU',
      'Modelo',
      'Serie',
      'Última vez visto'
    ];

    const lines = [headers.map(escapeCsvField).join(',')];

    for (const node of nodes) {
      const diskTotals = sumDiskStats(node.disks);
      const diskSummary = `${diskTotals.freeGB.toFixed(1)} GB / ${diskTotals.totalGB.toFixed(1)} GB`;
      const modelFull = [node.manufacturer, node.model].filter(Boolean).join(' ').trim();
      const macs = Array.isArray(node.macAddresses) ? node.macAddresses.join('; ') : '';
      const row = [
        node.nodeName || node.id,
        node.department || 'General',
        node.role || 'Estación de Trabajo',
        node.online ? 'En línea' : 'Desconectado',
        node.lanIp || '',
        node.tailscaleIp || '',
        macs,
        node.cpuModel || `${node.cpuCores || 0} núcleos`,
        round1(node.ramTotalGB || 0),
        diskSummary,
        node.gpuModel || '',
        modelFull,
        node.serialNumber || '',
        node.lastSeenAt || ''
      ];
      lines.push(row.map(escapeCsvField).join(','));
    }

    return `\uFEFF${lines.join('\r\n')}`;
  }

  exportFleetHtmlReport(workspaceName = 'Mi Empresa', { staleMs = 120000 } = {}) {
    const nodes = this.listNodes({ staleMs });
    const summary = this.getFleetSummary({ staleMs });
    const safeWorkspace = escapeHtml(workspaceName || 'Mi Empresa');
    const generatedAt = new Date().toLocaleString('es-ES');

    const deptBadges = Object.entries(summary.departments)
      .map(
        ([dept, count]) =>
          `<span class="badge">${escapeHtml(dept)}: <strong>${count}</strong></span>`
      )
      .join(' ');

    const rowsHtml = nodes
      .map((node) => {
        const diskTotals = sumDiskStats(node.disks);
        const modelFull = [node.manufacturer, node.model].filter(Boolean).join(' ').trim() || '—';
        const statusClass = node.online ? 'status-online' : 'status-offline';
        const statusLabel = node.online ? 'En línea' : 'Desconectado';
        const macs = Array.isArray(node.macAddresses) && node.macAddresses.length > 0
          ? node.macAddresses.join(', ')
          : '—';
        return `
        <tr>
          <td><strong>${escapeHtml(node.nodeName || node.id)}</strong>${node.label ? `<div class="sub">${escapeHtml(node.label)}</div>` : ''}</td>
          <td>${escapeHtml(node.department || 'General')}</td>
          <td>${escapeHtml(node.role || 'Estación de Trabajo')}</td>
          <td><span class="status ${statusClass}">${statusLabel}</span></td>
          <td><code>${escapeHtml(node.lanIp || '—')}</code>${node.tailscaleIp ? `<div class="sub">TS: <code>${escapeHtml(node.tailscaleIp)}</code></div>` : ''}</td>
          <td><code>${escapeHtml(macs)}</code></td>
          <td>${escapeHtml(node.cpuModel || '—')}<div class="sub">${node.cpuCores || 0} núcleos · ${round1(node.ramTotalGB || 0)} GB RAM</div></td>
          <td>${diskTotals.freeGB.toFixed(1)} / ${diskTotals.totalGB.toFixed(1)} GB</td>
          <td>${escapeHtml(node.gpuModel || '—')}</td>
          <td>${escapeHtml(modelFull)}<div class="sub">S/N: ${escapeHtml(node.serialNumber || '—')}</div></td>
          <td>${escapeHtml(node.lastSeenAt || '—')}</td>
        </tr>`;
      })
      .join('\n');

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Informe de Auditoría IT — ${safeWorkspace}</title>
  <style>
    :root { --bg: #f8fafc; --card: #ffffff; --text: #0f172a; --muted: #64748b; --border: #e2e8f0; --accent: #2563eb; }
    * { box-sizing: border-box; }
    body { font-family: "Segoe UI", system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 24px; }
    .container { max-width: 1400px; margin: 0 auto; }
    header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid var(--accent); padding-bottom: 12px; margin-bottom: 20px; }
    header h1 { margin: 0; font-size: 22px; }
    header .meta { color: var(--muted); font-size: 13px; text-align: right; }
    .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 18px; }
    .kpi { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 14px; }
    .kpi .label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
    .kpi .value { font-size: 22px; font-weight: 700; margin-top: 4px; }
    .depts { margin-bottom: 18px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .badge { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; border-radius: 999px; padding: 4px 10px; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--border); font-size: 12px; }
    th, td { border: 1px solid var(--border); padding: 8px 10px; text-align: left; vertical-align: top; }
    th { background: #f1f5f9; font-weight: 600; color: #334155; }
    tr:nth-child(even) { background: #f8fafc; }
    .sub { color: var(--muted); font-size: 11px; margin-top: 2px; }
    code { font-family: Consolas, monospace; font-size: 11px; }
    .status { display: inline-block; padding: 2px 8px; border-radius: 999px; font-weight: 600; font-size: 11px; }
    .status-online { background: #dcfce7; color: #166534; }
    .status-offline { background: #fee2e2; color: #991b1b; }
    footer { margin-top: 16px; font-size: 11px; color: var(--muted); text-align: right; }
    @media print {
      body { background: #fff; padding: 8px; }
      .kpi { break-inside: avoid; }
      table { font-size: 10px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>Esteban Mesh Office — Auditoría de Flota IT</h1>
        <div class="sub">Espacio de trabajo: <strong>${safeWorkspace}</strong></div>
      </div>
      <div class="meta">
        Generado: ${escapeHtml(generatedAt)}<br />
        Versión del agente: ${APP_VERSION}
      </div>
    </header>

    <section class="kpis">
      <div class="kpi"><div class="label">Equipos Descubiertos</div><div class="value">${summary.totalNodes} / ${summary.capacityRecommended}</div></div>
      <div class="kpi"><div class="label">En Línea</div><div class="value">${summary.onlineNodes}</div></div>
      <div class="kpi"><div class="label">Almacenamiento Libre / Total</div><div class="value">${summary.freeStorageTB} / ${summary.totalStorageTB} TB</div></div>
      <div class="kpi"><div class="label">RAM Total Flota</div><div class="value">${summary.totalRamGB} GB</div></div>
      <div class="kpi"><div class="label">Núcleos CPU</div><div class="value">${summary.totalCpuCores}</div></div>
      <div class="kpi"><div class="label">Alertas Activas</div><div class="value">${summary.alertsCount}</div></div>
    </section>

    <div class="depts">
      <strong>Departamentos:</strong> ${deptBadges || '<span class="sub">Sin equipos registrados</span>'}
    </div>

    <table>
      <thead>
        <tr>
          <th>Hostname</th>
          <th>Departamento</th>
          <th>Rol</th>
          <th>Estado</th>
          <th>IP LAN / Tailscale</th>
          <th>MAC</th>
          <th>CPU / RAM</th>
          <th>Discos (Libre / Total)</th>
          <th>GPU</th>
          <th>Modelo / Serie</th>
          <th>Última vez visto</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml || '<tr><td colspan="11" style="text-align:center;color:#64748b;">No hay equipos registrados en la flota.</td></tr>'}
      </tbody>
    </table>

    <footer>Esteban Mesh Office v${APP_VERSION} — Informe empresarial imprimible</footer>
  </div>
</body>
</html>`;
  }
}

module.exports = {
  APP_VERSION,
  BEACON_MAGIC,
  DEFAULT_UDP_PORT,
  DEFAULT_HTTP_PORT,
  collectHardwareInventory,
  LanDiscoveryBeacon,
  FleetStore
};

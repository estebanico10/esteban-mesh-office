'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

function execFileAsync(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 15000, ...opts }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error ? error.code : 0,
        stdout: String(stdout || '').trim(),
        stderr: String(stderr || '').trim()
      });
    });
  });
}

function getNetworkAddresses() {
  const ifaces = os.networkInterfaces();
  let lanIp = '';
  let tailscaleIp = '';
  const all = [];

  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const addr of addrs || []) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      if (addr.address.startsWith('169.254.')) continue;
      all.push({ name, address: addr.address });
      // Tailscale CGNAT range 100.64.0.0/10 -> 100.64.x.x - 100.127.x.x
      const parts = addr.address.split('.').map(Number);
      if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) {
        if (!tailscaleIp) tailscaleIp = addr.address;
      } else if (!lanIp) {
        lanIp = addr.address;
      }
    }
  }
  return { lanIp, tailscaleIp, all };
}

async function commandExists(cmd) {
  const res = await execFileAsync('where.exe', [cmd]);
  if (res.ok && res.stdout) {
    return res.stdout.split(/\r?\n/)[0].trim();
  }
  return null;
}

async function detectRclone() {
  let exe = await commandExists('rclone');
  if (!exe) {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const candidates = [
      path.join(localAppData, 'Microsoft', 'WinGet', 'Links', 'rclone.exe'),
      'C:\\Program Files\\rclone\\rclone.exe',
      'C:\\rclone\\rclone.exe'
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        exe = c;
        break;
      }
    }
  }
  return { installed: Boolean(exe), path: exe || '' };
}

async function detectTailscale() {
  let exe = await commandExists('tailscale');
  if (!exe) {
    const candidates = [
      'C:\\Program Files\\Tailscale\\tailscale.exe',
      'C:\\Program Files (x86)\\Tailscale\\tailscale.exe'
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        exe = c;
        break;
      }
    }
  }
  const net = getNetworkAddresses();
  if (!exe) {
    return { installed: false, running: false, ip: net.tailscaleIp || '', dnsName: '', peers: [] };
  }
  const status = await execFileAsync(exe, ['status', '--json'], { timeout: 6000 });
  if (!status.ok || !status.stdout) {
    return { installed: true, exe, running: Boolean(net.tailscaleIp), ip: net.tailscaleIp || '', dnsName: '', peers: [] };
  }
  try {
    const data = JSON.parse(status.stdout);
    const selfIps = (data.Self && data.Self.TailscaleIPs) || [];
    const ip4 = selfIps.find((ip) => !ip.includes(':')) || net.tailscaleIp || '';
    const dnsName = data.Self && data.Self.DNSName ? String(data.Self.DNSName).replace(/\.$/, '') : '';
    const peers = Object.values(data.Peer || {}).map((p) => ({
      hostName: p.HostName || '',
      dnsName: p.DNSName ? String(p.DNSName).replace(/\.$/, '') : '',
      ip: ((p.TailscaleIPs || []).find((ip) => !ip.includes(':'))) || '',
      online: Boolean(p.Online),
      os: p.OS || '',
      curAddr: p.CurAddr || '',
      relay: p.Relay || '',
      isDirect: Boolean(p.CurAddr)
    }));
    return {
      installed: true,
      exe,
      running: data.BackendState === 'Running',
      backendState: data.BackendState || '',
      ip: ip4,
      dnsName,
      peers
    };
  } catch {
    return { installed: true, exe, running: Boolean(net.tailscaleIp), ip: net.tailscaleIp || '', dnsName: '', peers: [] };
  }
}

async function detectWinFsp() {
  const paths = [
    'C:\\Program Files (x86)\\WinFsp\\bin\\winfsp-x64.dll',
    'C:\\Program Files\\WinFsp\\bin\\winfsp-x64.dll'
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) return { installed: true, path: p };
  }
  return { installed: false, path: '' };
}

async function detectOpenSshServer() {
  if (process.platform !== 'win32') {
    return { installed: false, running: false, status: 'NotInstalled', startType: '' };
  }
  const res = await execFileAsync('sc.exe', ['query', 'sshd'], { timeout: 4000 });
  if (res.ok && res.stdout) {
    const running = /STATE\s*:\s*4\s+RUNNING/i.test(res.stdout);
    const stopped = /STATE\s*:\s*1\s+STOPPED/i.test(res.stdout);
    const status = running ? 'Running' : stopped ? 'Stopped' : 'Installed';
    return { installed: true, running, status, startType: '' };
  }
  return { installed: false, running: false, status: 'NotInstalled', startType: '' };
}

async function detectRemovableDrives() {
  const psScript = [
    "$ErrorActionPreference='SilentlyContinue'",
    "$map = @{}",
    "Get-Disk | Where-Object { $_.BusType -eq 'USB' } | Get-Partition | Where-Object { $_.DriveLetter } | ForEach-Object {",
    "  $dl = $_.DriveLetter.ToString() + ':'",
    "  $v = Get-Volume -DriveLetter $_.DriveLetter",
    "  if ($v) { $map[$dl] = [PSCustomObject]@{ DeviceID=$dl; VolumeName=$v.FileSystemLabel; FreeSpace=$v.SizeRemaining; Size=$v.Size; Kind='USB' } }",
    "}",
    "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=2' | ForEach-Object {",
    "  if ($_.DeviceID -and -not $map.ContainsKey($_.DeviceID)) {",
    "    $map[$_.DeviceID] = [PSCustomObject]@{ DeviceID=$_.DeviceID; VolumeName=$_.VolumeName; FreeSpace=$_.FreeSpace; Size=$_.Size; Kind='Removable' }",
    "  }",
    "}",
    "@($map.Values | Sort-Object DeviceID) | ConvertTo-Json -Compress"
  ].join('; ');

  const res = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', psScript]);
  if (!res.ok || !res.stdout) return [];
  try {
    const parsed = JSON.parse(res.stdout);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.filter(Boolean).map((d) => ({
      drive: d.DeviceID,
      root: `${d.DeviceID}\\`,
      label: d.VolumeName || 'Disco USB',
      freeBytes: Number(d.FreeSpace || 0),
      sizeBytes: Number(d.Size || 0)
    }));
  } catch {
    return [];
  }
}

const ENV_CACHE_TTL_MS = 20_000;
const STATIC_BIN_CACHE_TTL_MS = 60_000;
let envCache = { value: null, expiresAt: 0 };
let envInFlight = null;
let staticBinCache = { value: null, expiresAt: 0 };

async function getStaticBinsCached(force = false) {
  const now = Date.now();
  if (!force && staticBinCache.value && now < staticBinCache.expiresAt) {
    return staticBinCache.value;
  }
  const [rclone, winfsp, sshd] = await Promise.all([
    detectRclone(),
    detectWinFsp(),
    detectOpenSshServer()
  ]);
  const value = { rclone, winfsp, sshd };
  staticBinCache = { value, expiresAt: now + STATIC_BIN_CACHE_TTL_MS };
  return value;
}

async function checkEnvironment({ force = false } = {}) {
  const now = Date.now();
  if (!force && envCache.value && now < envCache.expiresAt) {
    return envCache.value;
  }
  if (!force && envInFlight) {
    return envInFlight;
  }

  const run = (async () => {
    const [tailscale, staticBins, usbDrives] = await Promise.all([
      detectTailscale(),
      getStaticBinsCached(force),
      detectRemovableDrives()
    ]);
    const net = getNetworkAddresses();
    const result = {
      hostName: os.hostname(),
      userName: os.userInfo().username,
      lanIp: net.lanIp,
      tailscale,
      rclone: staticBins.rclone,
      winfsp: staticBins.winfsp,
      sshd: staticBins.sshd,
      usbDrives
    };
    envCache = { value: result, expiresAt: Date.now() + ENV_CACHE_TTL_MS };
    return result;
  })();

  envInFlight = run;
  try {
    return await run;
  } finally {
    if (envInFlight === run) envInFlight = null;
  }
}

const ALL_DRIVE_LETTERS = Object.freeze([
  'Z:', 'Y:', 'X:', 'W:', 'V:', 'U:', 'T:', 'S:', 'R:', 'Q:', 'P:', 'O:',
  'N:', 'M:', 'L:', 'K:', 'J:', 'I:', 'H:', 'G:', 'F:', 'E:', 'D:'
]);

function sanitizeMountSegment(value, fallback = 'Disco') {
  const clean = String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 42);
  return clean || fallback;
}

function getDriveLettersStatus(mountedMap = new Map(), preferredStartLetter = 'Z:') {
  const items = ALL_DRIVE_LETTERS.map((letter) => {
    if (mountedMap && mountedMap.has(letter)) {
      const m = mountedMap.get(letter);
      return {
        letter,
        status: 'mounted-by-app',
        free: false,
        label: m.alias || m.label || '',
        group: m.group || 'General',
        nodeName: m.nodeName || ''
      };
    }
    let existsOnOs = false;
    if (process.platform === 'win32') {
      try {
        existsOnOs = fs.existsSync(`${letter}\\`);
      } catch {
        existsOnOs = true;
      }
    }
    return {
      letter,
      status: existsOnOs ? 'system-busy' : 'free',
      free: !existsOnOs,
      label: existsOnOs ? 'En uso (Windows / USB / Red)' : 'Disponible',
      group: '',
      nodeName: ''
    };
  });

  const pref = String(preferredStartLetter || 'Z:').trim().toUpperCase();
  const normalizedPref = pref.endsWith(':') ? pref : `${pref}:`;
  const startIdx = Math.max(0, ALL_DRIVE_LETTERS.indexOf(normalizedPref));
  const ordered = [...items.slice(startIdx), ...items.slice(0, startIdx)];
  const nextFree = (ordered.find((x) => x.free) || items.find((x) => x.free) || {}).letter || '';

  return {
    letters: items,
    freeLetters: items.filter((x) => x.free).map((x) => x.letter),
    nextFreeLetter: nextFree
  };
}

class MountManager {
  constructor({ onLog } = {}) {
    this.onLog = onLog || (() => {});
    this.mounts = new Map(); // mountTarget (e.g. 'Z:' or folder path) -> entry
  }

  listMounts() {
    return Array.from(this.mounts.values()).map(({ proc, ...rest }) => rest);
  }

  getDriveLettersInfo(preferredStartLetter = 'Z:') {
    return getDriveLettersStatus(this.mounts, preferredStartLetter);
  }

  updateMountOrganization(targetDrive, { alias, group, color } = {}) {
    const key = this._resolveMountKey(targetDrive);
    if (!key) return null;
    const entry = this.mounts.get(key);
    if (!entry) return null;
    if (alias !== undefined) entry.alias = String(alias).trim() || entry.label;
    if (group !== undefined) entry.group = String(group).trim() || 'General';
    if (color !== undefined) entry.color = String(color).trim() || 'emerald';
    const { proc, ...rest } = entry;
    return rest;
  }

  _resolveMountKey(driveOrPath) {
    const raw = String(driveOrPath || '').trim();
    if (!raw) return null;
    if (this.mounts.has(raw)) return raw;
    const upper = raw.toUpperCase().replace(/\\+$/, '');
    const withColon = upper.length === 1 ? `${upper}:` : upper;
    if (this.mounts.has(withColon)) return withColon;
    for (const k of this.mounts.keys()) {
      if (k.toLowerCase() === raw.toLowerCase()) return k;
    }
    return null;
  }

  async mountWebDav({
    driveLetter,
    mountMode = 'letter',
    unifiedRootDir = '',
    shareSubpath = '',
    label,
    alias = '',
    group = 'General',
    color = 'emerald',
    nodeName = '',
    baseUrl,
    keyId,
    token,
    lowRamMode,
    autoFallbackIfBusy = true,
    preferredStartLetter = 'Z:'
  } = {}) {
    const rclone = await detectRclone();
    if (!rclone.installed) {
      throw new Error('rclone no está instalado. Usa el botón "Instalar dependencias" primero.');
    }
    const rcloneExe = rclone.path;
    const winfsp = await detectWinFsp();
    if (!winfsp.installed) {
      throw new Error('WinFsp no está instalado. Usa el botón "Instalar dependencias" primero.');
    }

    const obs = await execFileAsync(rcloneExe, ['obscure', token]);
    if (!obs.ok || !obs.stdout) {
      throw new Error('No se pudo preparar la credencial cifrada para rclone.');
    }

    const cleanGroup = sanitizeMountSegment(group || 'General', 'General');
    const cleanAlias = String(alias || label || nodeName || 'MeshOffice').trim();
    const volName = String(cleanAlias).replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 28) || 'MeshOffice';

    let mountTarget = '';
    let autoReassignedFrom = '';
    const effectiveMode = mountMode === 'folder' ? 'folder' : 'letter';

    if (effectiveMode === 'folder') {
      const baseRoot = unifiedRootDir
        ? path.resolve(unifiedRootDir)
        : path.join(os.homedir(), 'EstebanMeshOffice-Red');
      const groupDir = path.join(baseRoot, cleanGroup);
      fs.mkdirSync(groupDir, { recursive: true });
      const folderLeaf = sanitizeMountSegment(cleanAlias, 'Nodo');
      mountTarget = path.join(groupDir, folderLeaf);
      if (this._resolveMountKey(mountTarget)) {
        throw new Error(`Ya existe un montaje activo en "${mountTarget}".`);
      }
      if (fs.existsSync(mountTarget)) {
        try {
          const items = fs.readdirSync(mountTarget);
          if (items.length === 0) {
            fs.rmdirSync(mountTarget);
          } else {
            mountTarget = path.join(groupDir, `${folderLeaf}-${Date.now().toString().slice(-4)}`);
          }
        } catch {
          mountTarget = path.join(groupDir, `${folderLeaf}-${Date.now().toString().slice(-4)}`);
        }
      }
    } else {
      const statusInfo = getDriveLettersStatus(this.mounts, preferredStartLetter);
      const rawReq = String(driveLetter || 'AUTO').trim().toUpperCase().replace(/\\+$/, '');
      if (!rawReq || rawReq === 'AUTO') {
        if (!statusInfo.nextFreeLetter) {
          throw new Error('No quedan letras libres (D: a Z:). Usa el modo "Montar en Carpeta Unificada" (ilimitado).');
        }
        mountTarget = statusInfo.nextFreeLetter;
      } else {
        const normalizedDrive = rawReq.endsWith(':') ? rawReq : `${rawReq}:`;
        if (normalizedDrive === 'C:' || normalizedDrive === 'A:' || normalizedDrive === 'B:') {
          throw new Error(`La letra ${normalizedDrive} está reservada por el sistema. Elige entre D: y Z:.`);
        }
        const letterEntry = statusInfo.letters.find((l) => l.letter === normalizedDrive);
        const isBusy = !letterEntry || !letterEntry.free;
        if (isBusy) {
          if (autoFallbackIfBusy && statusInfo.nextFreeLetter) {
            autoReassignedFrom = normalizedDrive;
            mountTarget = statusInfo.nextFreeLetter;
          } else if (this.mounts.has(normalizedDrive)) {
            throw new Error(`La unidad ${normalizedDrive} ya está montada. Elige otra letra o activa Auto-Letra Libre.`);
          } else {
            throw new Error(`La letra ${normalizedDrive} ya está ocupada en Windows. Elige otra letra o usa Auto-Letra Libre.`);
          }
        } else {
          mountTarget = normalizedDrive;
        }
      }
    }

    const useLowRam = lowRamMode === undefined ? os.totalmem() <= 8 * 1024 ** 3 : Boolean(lowRamMode);
    const cleanSub = String(shareSubpath || '').trim().replace(/^\/+|\/+$/g, '');
    const webdavUrl = cleanSub
      ? `${baseUrl.replace(/\/$/, '')}/webdav/${encodeURIComponent(cleanSub)}/`
      : `${baseUrl.replace(/\/$/, '')}/webdav/`;

    const args = [
      'mount', ':webdav:', mountTarget,
      '--webdav-url', webdavUrl,
      '--webdav-vendor', 'other',
      '--webdav-user', keyId || 'esteban-cloud',
      '--webdav-pass', obs.stdout,
      '--vfs-cache-mode', 'full',
      '--vfs-cache-max-size', useLowRam ? '4G' : '12G',
      '--vfs-cache-max-age', '24h',
      '--vfs-read-chunk-size', useLowRam ? '8M' : '16M',
      '--vfs-read-chunk-size-limit', useLowRam ? '64M' : '128M',
      '--vfs-read-chunk-streams', useLowRam ? '4' : '6',
      '--buffer-size', useLowRam ? '16M' : '32M',
      '--vfs-read-ahead', useLowRam ? '32M' : '64M',
      '--transfers', useLowRam ? '4' : '8',
      '--checkers', useLowRam ? '8' : '16',
      '--vfs-fast-fingerprint',
      '--vfs-write-back', '1s',
      '--no-modtime',
      '--attr-timeout', '30s',
      '--dir-cache-time', '60s',
      ...(effectiveMode === 'letter' ? ['--network-mode'] : []),
      '--volname', volName,
      '--no-console'
    ];

    const proc = spawn(rcloneExe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const entry = {
      drive: mountTarget,
      mountMode: effectiveMode,
      label: volName,
      alias: cleanAlias,
      group: cleanGroup,
      color: String(color || 'emerald'),
      nodeName: String(nodeName || ''),
      shareSubpath: cleanSub,
      autoReassignedFrom,
      url: webdavUrl,
      pid: proc.pid,
      proc,
      startedAt: new Date().toISOString()
    };
    this.mounts.set(mountTarget, entry);

    let errBuf = '';
    proc.stderr.on('data', (d) => {
      const msg = d.toString('utf8').trim();
      if (msg) {
        errBuf += msg + '\n';
        this.onLog({ ts: new Date().toISOString(), level: 'info', message: `[rclone ${mountTarget}] ${msg}` });
      }
    });
    proc.on('exit', (code) => {
      this.mounts.delete(mountTarget);
      this.onLog({ ts: new Date().toISOString(), level: 'info', message: `Unidad ${mountTarget} desmontada (exit=${code}).` });
    });

    await new Promise((r) => setTimeout(r, 1400));
    if (!this.mounts.has(mountTarget)) {
      throw new Error(`rclone no pudo montar ${mountTarget}: ${errBuf || 'error desconocido'}`);
    }

    const { proc: _p, ...publicEntry } = entry;
    return publicEntry;
  }

  async unmount(driveLetterOrPath) {
    const key = this._resolveMountKey(driveLetterOrPath);
    if (!key) return false;
    const entry = this.mounts.get(key);
    if (!entry) return false;
    try {
      entry.proc.kill('SIGTERM');
    } catch {
      // ignore
    }
    this.mounts.delete(key);
    return true;
  }

  async unmountAll() {
    for (const drive of Array.from(this.mounts.keys())) {
      await this.unmount(drive);
    }
  }
}

function syncSshAuthorizedKeys(keys) {
  try {
    const sshDir = path.join(os.homedir(), '.ssh');
    const authFile = path.join(sshDir, 'authorized_keys');
    fs.mkdirSync(sshDir, { recursive: true });
    let existing = '';
    if (fs.existsSync(authFile)) {
      existing = fs.readFileSync(authFile, 'utf8');
    }
    const preserved = existing
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.includes('# esteban-cloud:'));

    const managed = (keys || [])
      .filter((k) => !k.revoked && k.sshPublicKey)
      .map((k) => `${k.sshPublicKey} # esteban-cloud:${k.keyId}`);

    const out = [...preserved, ...managed].join('\n') + (preserved.length || managed.length ? '\n' : '');
    fs.writeFileSync(authFile, out, 'utf8');
    return { ok: true, count: managed.length, path: authFile };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function launchElevatedInstaller(scriptPath, { port = 4789, installOpenSsh = false, disableSleep = false } = {}) {
  return new Promise((resolve) => {
    const logPath = path.join(os.tmpdir(), 'esteban-cloud-install.log');
    try { if (fs.existsSync(logPath)) fs.unlinkSync(logPath); } catch {}
    const psArgs = [
      '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', `"${scriptPath}"`,
      '-Port', String(port),
      '-LogPath', `"${logPath}"`
    ];
    if (installOpenSsh) psArgs.push('-InstallOpenSsh');
    if (disableSleep) psArgs.push('-DisableSleepAC');

    const cmd = `Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList '${psArgs.join(' ')}'`;
    execFile('powershell.exe', ['-NoProfile', '-Command', cmd], { windowsHide: true, timeout: 600000 }, (error, stdout, stderr) => {
      let log = '';
      try {
        if (fs.existsSync(logPath)) log = fs.readFileSync(logPath, 'utf8');
      } catch {}
      resolve({
        ok: !error && log.includes('ESTEBAN_CLOUD_SETUP_OK'),
        log,
        error: error ? (stderr || error.message) : '',
        logPath
      });
    });
  });
}

module.exports = {
  ALL_DRIVE_LETTERS,
  getDriveLettersStatus,
  getNetworkAddresses,
  checkEnvironment,
  detectRemovableDrives,
  MountManager,
  syncSshAuthorizedKeys,
  launchElevatedInstaller
};

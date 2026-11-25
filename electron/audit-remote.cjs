'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');

const DEFAULT_AUDIT_FILE = path.join(
  os.homedir(),
  'Documents',
  'EstebanMeshOffice-Logs',
  'audit-log.jsonl'
);

const REMOTE_PRESETS = Object.freeze([
  Object.freeze({
    id: 'network-health',
    name: 'Salud de Red y DNS',
    description: 'Muestra adaptadores activos, IP y limpia caché DNS',
    category: 'Red',
  }),
  Object.freeze({
    id: 'disk-smart',
    name: 'Salud de Discos y Espacio',
    description: 'Lista discos físicos, estado SMART/Healthy y espacio libre',
    category: 'Almacenamiento',
  }),
  Object.freeze({
    id: 'windows-updates',
    name: 'Últimas Actualizaciones Windows',
    description: 'Lista los 8 parches/HotFix más recientes instalados',
    category: 'Sistema',
  }),
  Object.freeze({
    id: 'top-services',
    name: 'Servicios Críticos (Tailscale/Red/Spooler)',
    description: 'Verifica el estado de Tailscale, Firewall, SMB y Cola de Impresión',
    category: 'Servicios',
  }),
  Object.freeze({
    id: 'cleanup-temp',
    name: 'Limpieza Segura de Temporales',
    description: 'Limpia archivos temporales antiguos de Esteban Mesh Office',
    category: 'Mantenimiento',
  }),
]);

const ALLOWED_PRESET_IDS = new Set(REMOTE_PRESETS.map((p) => p.id));

function escapeCsvCell(value) {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

class EnterpriseAuditLog {
  constructor(filePathOrOptions) {
    let resolved = DEFAULT_AUDIT_FILE;
    if (typeof filePathOrOptions === 'string' && filePathOrOptions.trim()) {
      resolved = filePathOrOptions;
    } else if (
      filePathOrOptions &&
      typeof filePathOrOptions === 'object' &&
      filePathOrOptions.filePath
    ) {
      resolved = filePathOrOptions.filePath;
    }
    this.filePath = path.resolve(resolved);
  }

  record({
    category = 'general',
    action = '',
    actor = os.hostname(),
    target = '',
    details = '',
    status = 'ok',
  } = {}) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });

    const entry = {
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      category: String(category || 'general'),
      action: String(action || ''),
      actor: String(actor || os.hostname()),
      target: String(target || ''),
      details: typeof details === 'string' ? details : JSON.stringify(details),
      status: String(status || 'ok'),
    };

    fs.appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`, 'utf8');
    return entry;
  }

  _readAllEntries() {
    if (!fs.existsSync(this.filePath)) {
      return [];
    }
    const content = fs.readFileSync(this.filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    const entries = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object') {
          entries.push(parsed);
        }
      } catch (_) {
        // Ignore corrupted trailing line
      }
    }
    return entries;
  }

  listRecent({ limit = 150, category = '' } = {}) {
    const all = this._readAllEntries().reverse();
    const catFilter = String(category || '').trim().toLowerCase();
    const filtered = catFilter
      ? all.filter((e) => String(e.category || '').toLowerCase() === catFilter)
      : all;
    const maxItems = Math.max(0, Number(limit) || 150);
    return filtered.slice(0, maxItems);
  }

  exportCsv() {
    const entries = this._readAllEntries().reverse();
    const header = 'Fecha,Categoria,Accion,Origen,Destino,Estado,Detalles';
    const rows = entries.map((e) =>
      [
        escapeCsvCell(e.ts),
        escapeCsvCell(e.category),
        escapeCsvCell(e.action),
        escapeCsvCell(e.actor),
        escapeCsvCell(e.target),
        escapeCsvCell(e.status),
        escapeCsvCell(e.details),
      ].join(',')
    );
    return `\uFEFF${[header, ...rows].join('\r\n')}`;
  }
}

function runPowerShellSafe(script, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      {
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      },
      (err, stdout, stderr) => {
        if (err) {
          const detail = (stderr || stdout || err.message || '').trim();
          reject(new Error(`Fallo al ejecutar diagnóstico: ${detail}`));
          return;
        }
        const combined = [stdout, stderr].filter(Boolean).join('\n').trim();
        resolve(combined || 'Comando completado sin salida.');
      }
    );
  });
}

function runCleanupTempSafe() {
  const tmpRoot = os.tmpdir();
  const maxAgeMs = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const targetPrefixes = ['esteban-mesh-office-'];

  let scanned = 0;
  let removed = 0;
  let freedBytes = 0;

  if (fs.existsSync(tmpRoot)) {
    const topEntries = fs.readdirSync(tmpRoot, { withFileTypes: true });
    for (const dirent of topEntries) {
      const lower = dirent.name.toLowerCase();
      if (!targetPrefixes.some((p) => lower.startsWith(p))) continue;

      const fullPath = path.join(tmpRoot, dirent.name);
      if (dirent.isDirectory()) {
        let children = [];
        try {
          children = fs.readdirSync(fullPath, { withFileTypes: true });
        } catch (_) {
          continue;
        }
        for (const child of children) {
          if (!child.isFile()) continue;
          const childPath = path.join(fullPath, child.name);
          scanned += 1;
          try {
            const st = fs.statSync(childPath);
            if (now - st.mtimeMs >= maxAgeMs) {
              fs.unlinkSync(childPath);
              removed += 1;
              freedBytes += st.size;
            }
          } catch (_) {
            // Skip files in use
          }
        }
      } else if (dirent.isFile()) {
        scanned += 1;
        try {
          const st = fs.statSync(fullPath);
          if (now - st.mtimeMs >= maxAgeMs) {
            fs.unlinkSync(fullPath);
            removed += 1;
            freedBytes += st.size;
          }
        } catch (_) {
          // Skip files in use
        }
      }
    }
  }

  const freedKB = (freedBytes / 1024).toFixed(2);
  return `Temporales de Esteban Mesh Office revisados: ${scanned} archivos analizados, ${removed} eliminados (${freedKB} KB liberados).`;
}

const PRESET_HANDLERS = Object.freeze({
  'network-health': async () => {
    if (process.platform !== 'win32') {
      const ifaces = os.networkInterfaces();
      return JSON.stringify(ifaces, null, 2);
    }
    const script = [
      'Write-Output "=== ADAPTADORES ACTIVOS ==="',
      'Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -ne "127.0.0.1" } | Select-Object InterfaceAlias, IPAddress, PrefixLength | Format-Table -AutoSize | Out-String',
      'try { Clear-DnsClientCache -ErrorAction Stop; Write-Output "Cache DNS limpiada correctamente." } catch { Write-Output "Cache DNS no pudo limpiarse (requiere permisos elevados)." }',
    ].join('; ');
    return runPowerShellSafe(script, 8000);
  },

  'disk-smart': async () => {
    if (process.platform !== 'win32') {
      return `Host: ${os.hostname()} (${os.platform()})`;
    }
    const script = [
      'Write-Output "=== DISCOS FISICOS (SMART/HEALTH) ==="',
      'Get-PhysicalDisk -ErrorAction SilentlyContinue | Select-Object FriendlyName, MediaType, HealthStatus, OperationalStatus, @{N="SizeGB";E={[math]::Round($_.Size/1GB,1)}} | Format-Table -AutoSize | Out-String',
      'Write-Output "=== ESPACIO LIBRE ==="',
      'Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue | Select-Object Name, @{N="UsedGB";E={[math]::Round($_.Used/1GB,1)}}, @{N="FreeGB";E={[math]::Round($_.Free/1GB,1)}} | Format-Table -AutoSize | Out-String',
    ].join('; ');
    return runPowerShellSafe(script, 8000);
  },

  'windows-updates': async () => {
    if (process.platform !== 'win32') {
      return 'Diagnóstico exclusivo de Windows.';
    }
    const script =
      'Get-HotFix -ErrorAction SilentlyContinue | Sort-Object InstalledOn -Descending | Select-Object -First 8 HotFixID, Description, InstalledOn | Format-Table -AutoSize | Out-String';
    return runPowerShellSafe(script, 8000);
  },

  'top-services': async () => {
    if (process.platform !== 'win32') {
      return 'Diagnóstico de servicios exclusivo de Windows.';
    }
    const script =
      'Get-Service -Name Tailscale*, mpssvc, LanmanServer, LanmanWorkstation, Spooler, Dnscache -ErrorAction SilentlyContinue | Select-Object Name, DisplayName, Status, StartType | Format-Table -AutoSize | Out-String';
    return runPowerShellSafe(script, 8000);
  },

  'cleanup-temp': async () => runCleanupTempSafe(),
});

async function runSafeRemotePreset(presetId) {
  const normalizedId = typeof presetId === 'string' ? presetId.trim() : '';
  if (
    !normalizedId ||
    !ALLOWED_PRESET_IDS.has(normalizedId) ||
    !Object.prototype.hasOwnProperty.call(PRESET_HANDLERS, normalizedId)
  ) {
    throw new Error(`Preset remoto no permitido o desconocido: ${String(presetId)}`);
  }

  const startedAt = Date.now();
  const output = await PRESET_HANDLERS[normalizedId]();
  const durationMs = Math.max(Date.now() - startedAt, 1);

  return {
    ok: true,
    presetId: normalizedId,
    nodeName: os.hostname(),
    durationMs,
    output: String(output || '').trim(),
    executedAt: new Date().toISOString(),
  };
}

module.exports = {
  EnterpriseAuditLog,
  REMOTE_PRESETS,
  runSafeRemotePreset,
};

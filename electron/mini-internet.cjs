'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');
const { execFile, spawn } = require('child_process');

function escHtml(str) {
  return String(str || '').replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&#39;',
    '"': '&quot;'
  }[c]));
}

function execFileAsync(cmd, args, timeout = 6000) {
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
 * Releases inactive heap memory in the current Electron/Node process via V8 GC
 * without spawning PowerShell / C# Add-Type (which caused CPU & 60-120 MB RAM spikes).
 */
async function optimizeProcessMemory({ aggressive = false } = {}) {
  const beforeMB = Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(1));
  try {
    if (typeof global.gc === 'function') {
      global.gc();
      if (aggressive) {
        global.gc();
      }
    }
  } catch {
    // ignore if --expose-gc wasn't passed
  }

  const afterMB = Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(1));
  const savedMB = Number(Math.max(0, beforeMB - afterMB).toFixed(1));
  return {
    ok: true,
    beforeMB,
    afterMB,
    savedMB,
    processCount: 1,
    timestamp: new Date().toISOString()
  };
}

const PAIRING_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function normalizePairingCode(raw) {
  return String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Ephemeral Magic-Wormhole style pairing manager: swaps encrypted .ecloudkey bundles + optional
 * vault passphrases between PCs using a short 6-character code (`EC-XXXX`) without needing USB drives.
 */
class MagicPairingManager {
  constructor() {
    this.invites = new Map();
  }

  purgeExpired() {
    const now = Date.now();
    for (const [k, v] of this.invites.entries()) {
      if (now >= v.expiresAt) this.invites.delete(k);
    }
  }

  createPairingInvite({ bundleJson, passphrase = '', label = '', nodeName = '', hostInfo = {}, hostUrls = [], ttlMs = 10 * 60 * 1000 }) {
    this.purgeExpired();
    if (!bundleJson) throw new Error('Se requiere una llave .ecloudkey válida para generar el código mágico.');

    let rand4 = '';
    const bytes = crypto.randomBytes(4);
    for (let i = 0; i < 4; i++) {
      rand4 += PAIRING_ALPHABET[bytes[i] % PAIRING_ALPHABET.length];
    }
    const displayCode = `EC-${rand4}`;
    const normCode = normalizePairingCode(displayCode);

    const salt = crypto.randomBytes(16);
    const key = crypto.scryptSync(normCode, salt, 32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const secretPayload = JSON.stringify({ bundleJson, passphrase, label, nodeName, hostInfo });
    const ciphertext = Buffer.concat([cipher.update(secretPayload, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const expiresAt = Date.now() + ttlMs;

    this.invites.set(normCode, {
      displayCode,
      salt,
      iv,
      tag,
      ciphertext,
      label: label || 'Llave Maestra',
      nodeName: nodeName || os.hostname(),
      hostUrls,
      expiresAt
    });

    return {
      code: displayCode,
      expiresAt: new Date(expiresAt).toISOString(),
      ttlMinutes: Math.round(ttlMs / 60000),
      nodeName: nodeName || os.hostname(),
      label: label || 'Llave Maestra',
      hostUrls
    };
  }

  claimPairingCode(rawCode) {
    this.purgeExpired();
    const normCode = normalizePairingCode(rawCode);
    const entry = this.invites.get(normCode);
    if (!entry) {
      return { ok: false, error: 'Código mágico inválido o expirado.' };
    }
    try {
      const key = crypto.scryptSync(normCode, entry.salt, 32);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, entry.iv);
      decipher.setAuthTag(entry.tag);
      const plain = Buffer.concat([decipher.update(entry.ciphertext), decipher.final()]).toString('utf8');
      const parsed = JSON.parse(plain);
      this.invites.delete(normCode);
      return { ok: true, ...parsed };
    } catch {
      return { ok: false, error: 'No se pudo descifrar el código de emparejamiento.' };
    }
  }
}

function postJsonClaim(baseUrl, code, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const clean = String(baseUrl || '').trim().replace(/\/$/, '');
    const u = new URL(`${clean}/api/pairing/claim`);
    const lib = u.protocol === 'https:' ? https : http;
    const body = JSON.stringify({ code });
    const req = lib.request(u, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = raw ? JSON.parse(raw) : {}; } catch {}
        if (res.statusCode >= 200 && res.statusCode < 300 && json && json.ok) {
          resolve({ baseUrl: clean, ...json });
        } else {
          reject(new Error((json && json.error) || `HTTP ${res.statusCode}`));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function redeemRemotePairingCode({ code, candidateUrls = [] }) {
  const urls = Array.from(new Set((candidateUrls || []).map((u) => String(u || '').trim().replace(/\/$/, '')).filter(Boolean)));
  if (!urls.length) {
    throw new Error('No se encontraron direcciones de equipos activos para reclamar el código.');
  }
  const results = await Promise.allSettled(urls.map((u) => postJsonClaim(u, code, 3500)));
  const hit = results.find((r) => r.status === 'fulfilled');
  if (hit) return hit.value;
  const errMsgs = results.filter((r) => r.status === 'rejected').map((r) => r.reason && r.reason.message).filter(Boolean);
  throw new Error(errMsgs[0] || 'Ningún equipo activo aceptó ese código mágico.');
}

function defaultNetworks() {
  return [
    {
      id: 'net-global',
      domain: 'esteban.mesh',
      name: 'Red Global Oficina',
      emoji: '🌐',
      color: '#10b981',
      description: 'Red troncal principal de toda la empresa con equipos, discos y acceso maestro.'
    },
    {
      id: 'net-design',
      domain: 'diseno.mesh',
      name: 'Red Diseño & Illustrator',
      emoji: '🎨',
      color: '#c084fc',
      description: 'Espacio creativo para Illustrator, plugins Adobe, scripts .jsx y Drive de diseño.'
    },
    {
      id: 'net-work',
      domain: 'trabajo.mesh',
      name: 'Red Automatización & IT',
      emoji: '🏢',
      color: '#38bdf8',
      description: 'Estaciones de trabajo, WinScript, instalación por lotes y mantenimiento automático.'
    },
    {
      id: 'net-help',
      domain: 'ayuda.mesh',
      name: 'Portal Web, Portfolio & Ayuda',
      emoji: '🛟',
      color: '#fbbf24',
      description: 'Páginas web de Esteban (estebanico.com), soporte IT y guías para empleados.'
    }
  ];
}

function defaultPackages() {
  return [
    {
      id: 'pkg-winscript',
      title: 'Paquete Automatización Windows (WinScript)',
      description: 'Instala WinScript de flick9000 vía winget o lanza el script oficial por PowerShell para optimizar cualquier PC de la empresa en 1 clic.',
      category: 'automation',
      networkId: 'net-work',
      actionType: 'powershell',
      command: 'winget install --id flick9000.WinScript --exact --accept-package-agreements --accept-source-agreements; if ($LASTEXITCODE -ne 0) { irm "https://winscript.cc/irm" | iex }',
      urls: ['https://winscript.cc', 'https://github.com/flick9000/winscript'],
      paths: [],
      wingetIds: ['flick9000.WinScript'],
      builtin: true
    },
    {
      id: 'pkg-illustrator',
      title: 'Paquete Maestro de Illustrator (Plugins, Programas y Scripts)',
      description: 'Comparte en la red y abre tus carpetas de Adobe Illustrator y plugins en Google Drive/PC listas para el departamento de Diseño.',
      category: 'design',
      networkId: 'net-design',
      actionType: 'drive-folder',
      command: '',
      urls: [],
      paths: [
        'G:\\Mi unidad\\PROGRAMAS\\ADOBE',
        'G:\\Mi unidad\\PROGRAMAS\\PLUGINS ADOBE\\PLUGINS PARA ILLUSTRATOR',
        'C:\\Users\\Nicola\\Esteban Nicola\\Adobe Plugins\\PLUGINS PARA ILLUSTRATOR',
        'G:\\Otros ordenadores\\Diana Pc\\illustrator-scripts-master'
      ],
      wingetIds: [],
      autoShareOnHost: true,
      builtin: true
    },
    {
      id: 'pkg-esteban-web',
      title: 'Paquete Páginas Web de Esteban (Portfolio y Ayuda)',
      description: 'Abre estebanico.com + centro de actualizaciones y crea acceso directo de soporte en el Escritorio de las PCs de la empresa.',
      category: 'web',
      networkId: 'net-help',
      actionType: 'web-bundle',
      command: '',
      urls: [
        'https://estebanico.com',
        'https://github.com/estebanico10/esteban-cloud/releases'
      ],
      paths: [],
      wingetIds: [],
      createDesktopShortcut: true,
      builtin: true
    },
    {
      id: 'pkg-winget-updater',
      title: 'Actualizador Universal del PC (Winget Auto-Update)',
      description: 'Actualiza silenciosamente todos los programas instalados en la estación de trabajo mediante Winget.',
      category: 'maintenance',
      networkId: 'net-global',
      actionType: 'powershell',
      command: 'winget upgrade --all --include-unknown --accept-package-agreements --accept-source-agreements --silent',
      urls: [],
      paths: [],
      wingetIds: [],
      builtin: true
    },
    {
      id: 'pkg-creator-essentials',
      title: 'Pack Esencial Productividad (PowerToys + 7-Zip + Everything)',
      description: 'Instala en lote las utilidades imprescindibles de escritorio Windows en cualquier PC nueva de la empresa.',
      category: 'automation',
      networkId: 'net-work',
      actionType: 'winget-bundle',
      command: '',
      urls: [],
      paths: [],
      wingetIds: ['Microsoft.PowerToys', '7zip.7zip', 'voidtools.Everything'],
      builtin: true
    }
  ];
}

class MiniInternetStore {
  constructor(filePath) {
    this.filePath = filePath || path.join(os.tmpdir(), 'mini-internet.json');
    this.data = this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        const networks = Array.isArray(parsed.networks) && parsed.networks.length ? parsed.networks : defaultNetworks();
        const savedPkgs = Array.isArray(parsed.packages) ? parsed.packages : [];
        const defPkgs = defaultPackages();
        const byId = new Map(defPkgs.map((p) => [p.id, p]));
        for (const p of savedPkgs) {
          if (p && p.id) byId.set(p.id, { ...(byId.get(p.id) || {}), ...p });
        }
        return { version: 1, networks, packages: Array.from(byId.values()) };
      }
    } catch {}
    const fresh = { version: 1, networks: defaultNetworks(), packages: defaultPackages() };
    this.data = fresh;
    this.save();
    return fresh;
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }

  listNetworks() {
    return this.data.networks || [];
  }

  upsertNetwork(input = {}) {
    const id = String(input.id || `net-${crypto.randomBytes(3).toString('hex')}`).trim();
    const cleanDomain = String(input.domain || `${id}.mesh`).trim().toLowerCase().replace(/[^a-z0-9.-]/g, '') || `${id}.mesh`;
    const entry = {
      id,
      domain: cleanDomain,
      name: String(input.name || cleanDomain).trim(),
      emoji: String(input.emoji || '🌐').trim().slice(0, 4),
      color: String(input.color || '#10b981').trim(),
      description: String(input.description || '').trim()
    };
    const idx = this.data.networks.findIndex((n) => n.id === id);
    if (idx >= 0) this.data.networks[idx] = entry;
    else this.data.networks.push(entry);
    this.save();
    return entry;
  }

  deleteNetwork(id) {
    if (id === 'net-global') return false;
    this.data.networks = this.data.networks.filter((n) => n.id !== id);
    this.save();
    return true;
  }

  listPackages(networkId = '') {
    const all = this.data.packages || [];
    return networkId ? all.filter((p) => p.networkId === networkId) : all;
  }

  upsertPackage(input = {}) {
    const id = String(input.id || `pkg-${crypto.randomBytes(3).toString('hex')}`).trim();
    const existing = this.data.packages.find((p) => p.id === id) || {};
    const entry = {
      ...existing,
      id,
      title: String(input.title || existing.title || 'Paquete personalizado').trim(),
      description: String(input.description !== undefined ? input.description : (existing.description || '')).trim(),
      category: String(input.category || existing.category || 'custom').trim(),
      networkId: String(input.networkId || existing.networkId || 'net-global').trim(),
      actionType: String(input.actionType || existing.actionType || 'web-bundle').trim(),
      command: String(input.command !== undefined ? input.command : (existing.command || '')),
      urls: Array.isArray(input.urls) ? input.urls.filter(Boolean) : (existing.urls || []),
      paths: Array.isArray(input.paths) ? input.paths.filter(Boolean) : (existing.paths || []),
      wingetIds: Array.isArray(input.wingetIds) ? input.wingetIds.filter(Boolean) : (existing.wingetIds || []),
      autoShareOnHost: input.autoShareOnHost !== undefined ? Boolean(input.autoShareOnHost) : Boolean(existing.autoShareOnHost),
      createDesktopShortcut: input.createDesktopShortcut !== undefined ? Boolean(input.createDesktopShortcut) : Boolean(existing.createDesktopShortcut),
      builtin: Boolean(existing.builtin)
    };
    const idx = this.data.packages.findIndex((p) => p.id === id);
    if (idx >= 0) this.data.packages[idx] = entry;
    else this.data.packages.push(entry);
    this.save();
    return entry;
  }

  deletePackage(id) {
    this.data.packages = this.data.packages.filter((p) => p.id !== id);
    this.save();
    return true;
  }

  async executePackageLocally(pkgOrId, { configStore = null, openExternalFn = null, openPathFn = null, dryRun = false, shortcutDir = '' } = {}) {
    const pkg = typeof pkgOrId === 'string'
      ? (this.data.packages.find((p) => p.id === pkgOrId) || null)
      : (pkgOrId && pkgOrId.id ? (this.data.packages.find((p) => p.id === pkgOrId.id) || pkgOrId) : pkgOrId);

    if (!pkg) throw new Error('Paquete no encontrado en el catálogo.');
    const actionsTaken = [];

    if (pkg.actionType === 'drive-folder') {
      const existingPaths = (pkg.paths || []).filter((p) => {
        try { return fs.existsSync(p); } catch { return false; }
      });

      if (configStore && (pkg.autoShareOnHost !== false)) {
        for (const p of existingPaths) {
          try {
            const shareName = path.basename(p) || 'Illustrator-Drive';
            configStore.addShare({ name: `Illustrator - ${shareName}`.slice(0, 42), folderPath: p, mode: 'rw' });
            actionsTaken.push(`Carpeta agregada a compartidos de la red: ${p}`);
          } catch {}
        }
      }

      if (!dryRun && openPathFn && existingPaths.length > 0) {
        await Promise.resolve(openPathFn(existingPaths[0])).catch(() => {});
        actionsTaken.push(`Abierta en el Explorador: ${existingPaths[0]}`);
      }

      for (const u of (pkg.urls || [])) {
        if (!dryRun && openExternalFn) {
          await Promise.resolve(openExternalFn(u)).catch(() => {});
        }
        actionsTaken.push(`Enlace abierto: ${u}`);
      }

      if (existingPaths.length === 0 && (pkg.urls || []).length === 0) {
        actionsTaken.push('No se encontraron rutas locales en este equipo (conéctate al nodo Host en Modo Cliente para acceder por disco Z:).');
      }

      return { ok: true, packageId: pkg.id, title: pkg.title, existingPaths, actionsTaken };
    }

    if (pkg.actionType === 'web-bundle') {
      const targetShortcutDir = shortcutDir || path.join(os.homedir(), 'Desktop');
      if (pkg.createDesktopShortcut && (pkg.urls || []).length > 0) {
        try {
          fs.mkdirSync(targetShortcutDir, { recursive: true });
          const primaryUrl = pkg.urls[0];
          const shortcutPath = path.join(targetShortcutDir, 'Esteban Nicola - Portfolio y Ayuda.url');
          fs.writeFileSync(shortcutPath, `[InternetShortcut]\r\nURL=${primaryUrl}\r\n`, 'utf8');
          actionsTaken.push(`Acceso directo creado: ${shortcutPath}`);
        } catch (err) {
          actionsTaken.push(`Aviso acceso directo: ${err.message}`);
        }
      }
      for (const u of (pkg.urls || [])) {
        if (!dryRun && openExternalFn) {
          await Promise.resolve(openExternalFn(u)).catch(() => {});
        }
        actionsTaken.push(`Web abierta: ${u}`);
      }
      return { ok: true, packageId: pkg.id, title: pkg.title, actionsTaken };
    }

    if (pkg.actionType === 'winget-bundle' || pkg.actionType === 'powershell') {
      let psCmd = String(pkg.command || '').trim();
      if (pkg.actionType === 'winget-bundle' && (pkg.wingetIds || []).length > 0) {
        psCmd = pkg.wingetIds
          .map((id) => `winget install --id "${String(id).replace(/"/g, '')}" --exact --accept-package-agreements --accept-source-agreements`)
          .join('; ');
      }
      if (!psCmd) {
        throw new Error('El paquete no contiene ningún comando PowerShell ni ID de winget.');
      }
      if (!dryRun) {
        const encoded = Buffer.from(`Write-Host "=== Ejecutando Paquete: ${String(pkg.title).replace(/"/g, '')} ===" -ForegroundColor Cyan\n${psCmd}`, 'utf16le').toString('base64');
        const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-EncodedCommand', encoded], {
          detached: true,
          stdio: 'ignore',
          windowsHide: false
        });
        child.unref();
      }
      actionsTaken.push(`PowerShell lanzado para: ${psCmd}`);
      return { ok: true, packageId: pkg.id, title: pkg.title, command: psCmd, actionsTaken };
    }

    throw new Error(`Tipo de paquete no soportado: ${pkg.actionType}`);
  }

  renderMiniInternetPortalHtml({ networkId = 'net-global', hostNodeName = os.hostname(), shares = [] } = {}) {
    const networks = this.listNetworks();
    const activeNet = networks.find((n) => n.id === networkId) || networks[0] || defaultNetworks()[0];
    const pkgs = this.listPackages(activeNet.id);

    const netTabs = networks.map((n) => {
      const isAct = n.id === activeNet.id;
      return `<a class="pill ${isAct ? 'active' : ''}" href="/net/${encodeURIComponent(n.id)}" style="${isAct ? `border-color:${escHtml(n.color)};background:rgba(16,185,129,0.14)` : ''}">${escHtml(n.emoji)} ${escHtml(n.domain)}</a>`;
    }).join('');

    const pkgCards = pkgs.length > 0
      ? pkgs.map((p) => {
        const links = (p.urls || []).map((u) => `<a class="btn" href="${escHtml(u)}" target="_blank" rel="noopener noreferrer">Abrir ${escHtml(u)}</a>`).join(' ');
        const pathsHtml = (p.paths || []).length ? `<div class="mono muted">${(p.paths || []).map((x) => escHtml(x)).join('<br>')}</div>` : '';
        const cmdHtml = p.command ? `<pre class="code">${escHtml(p.command)}</pre>` : '';
        return `<div class="card"><h3>${escHtml(p.title)}</h3><p class="muted">${escHtml(p.description)}</p>${pathsHtml}${cmdHtml}<div class="row">${links}<span class="tag">${escHtml(p.actionType)}</span></div></div>`;
      }).join('')
      : '<div class="card"><p class="muted">No hay paquetes en esta sub-red todavía.</p></div>';

    const shareCards = (shares || []).map((s) =>
      `<div class="card"><h3>📁 ${escHtml(s.name)}</h3><p class="muted">Permiso: ${escHtml(s.effectiveMode || s.mode || 'rw')} · Montable por WebDAV</p><a class="btn" href="/">Explorar archivos</a></div>`
    ).join('');

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escHtml(activeNet.domain)} · Mini-Internet de ${escHtml(hostNodeName)}</title>
<style>
  body { margin:0; font-family: "Segoe UI", system-ui, sans-serif; background:#080c14; color:#f1f5f9; padding:24px; }
  .wrap { max-width:980px; margin:0 auto; }
  .head { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:20px; }
  .nav { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:20px; }
  .pill { text-decoration:none; color:#cbd5e1; background:#111827; border:1px solid #1f2937; padding:8px 14px; border-radius:999px; font-size:13px; font-weight:600; }
  .pill.active { color:#fff; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:14px; }
  .card { background:#111827; border:1px solid rgba(148,163,184,0.16); border-radius:14px; padding:16px; }
  .muted { color:#94a3b8; font-size:13px; }
  .mono { font-family:Consolas,monospace; font-size:12px; margin:8px 0; }
  .code { background:#06090f; padding:10px; border-radius:8px; overflow:auto; font-size:12px; color:#67e8f9; }
  .btn { display:inline-block; background:#059669; color:#fff; text-decoration:none; padding:7px 12px; border-radius:8px; font-size:12.5px; font-weight:600; }
  .tag { display:inline-block; background:rgba(16,185,129,0.15); color:#6ee7b7; padding:4px 9px; border-radius:999px; font-size:11.5px; }
  .row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-top:10px; }
  footer { margin-top:28px; color:#64748b; font-size:12.5px; }
  footer a { color:#34d399; text-decoration:none; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="head">
      <div>
        <h1 style="margin:0">${escHtml(activeNet.emoji)} ${escHtml(activeNet.domain)} — ${escHtml(activeNet.name)}</h1>
        <p class="muted" style="margin:4px 0 0">Portal Mini-Internet alojado en <strong>${escHtml(hostNodeName)}</strong> · ${escHtml(activeNet.description)}</p>
      </div>
      <a class="btn" href="/">Abrir App Web / Archivos</a>
    </div>
    <nav class="nav">${netTabs}</nav>
    <h2>Paquetes Inteligentes y Recursos de la Red</h2>
    <div class="grid">${pkgCards}</div>
    ${shareCards ? `<h2 style="margin-top:24px">Carpetas compartidas en ${escHtml(hostNodeName)}</h2><div class="grid">${shareCards}</div>` : ''}
    <footer>Mini-Internet Federado · Hecho por Esteban Nicola · <a href="https://estebanico.com" target="_blank" rel="noopener noreferrer">estebanico.com</a></footer>
  </div>
</body>
</html>`;
  }
}

module.exports = {
  optimizeProcessMemory,
  MagicPairingManager,
  MiniInternetStore,
  redeemRemotePairingCode,
  normalizePairingCode
};

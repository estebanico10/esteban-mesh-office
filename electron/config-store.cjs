'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

function defaultConfigDir() {
  const appData = process.env.APPDATA || path.join(os.homedir(), '.config');
  return path.join(appData, 'EstebanMeshOffice');
}

function makeShareId(name) {
  const slug = String(name || 'disco')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'disco';
  const suffix = crypto.randomBytes(2).toString('hex');
  return `${slug}-${suffix}`;
}

function buildInitialShares() {
  const docs = path.join(os.homedir(), 'Documents', 'EstebanMeshOffice-Compartido');
  try {
    fs.mkdirSync(docs, { recursive: true });
    return [{ id: 'oficina-compartida', name: 'Oficina Compartida', path: docs, mode: 'rw', enabled: true }];
  } catch {
    return [];
  }
}

function createDefaultConfig() {
  return {
    version: 1,
    workspaceName: 'Espacio de Trabajo Empresarial',
    workspaceId: `WS-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
    department: 'Dirección',
    role: 'Servidor / Consola Central',
    nodeName: os.hostname(),
    port: 4890,
    udpPort: 4891,
    bindMode: 'all',
    autoStartServer: true,
    startWithWindows: true,
    minimizeToTray: true,
    ultraLightTrayMode: true,
    uiTheme: 'emerald',
    uiEffects: 'glass',
    uiDensity: 'comfortable',
    uiScale: 'normal',
    resourceProfile: 'auto',
    autoAssignFreeDrive: true,
    preferredStartLetter: 'Z:',
    unifiedMountRoot: path.join(os.homedir(), 'EstebanMeshOffice-Red'),
    autoShareAllDisks: false,
    updateShareDir: 'E:\\CODE\\ESTEBAN MESH OFFICE\\release',
    updateServerUrl: '',
    updateGithubRepo: 'estebanico10/esteban-mesh-office',
    enableGithubUpdates: false,
    autoCheckUpdates: true,
    autoDownloadUpdates: true,
    autoInstallWhenIdle: true,
    metricThresholds: {
      cpuPercent: 85,
      ramPercent: 88,
      diskPercent: 90,
      diskBusyMBs: 180
    },
    sessionSecret: crypto.randomBytes(32).toString('hex'),
    shares: buildInitialShares(),
    keys: [],
    savedPeers: [],
    keyVault: {},
    syncProfiles: [],
    driveProfiles: []
  };
}

class ConfigStore {
  constructor(customPath) {
    this.filePath = customPath || path.join(defaultConfigDir(), 'config.json');
    this.data = this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        const defaults = createDefaultConfig();
        return {
          ...defaults,
          ...parsed,
          shares: Array.isArray(parsed.shares) ? parsed.shares : defaults.shares,
          keys: Array.isArray(parsed.keys) ? parsed.keys : [],
          savedPeers: Array.isArray(parsed.savedPeers) ? parsed.savedPeers : [],
          keyVault: (parsed.keyVault && typeof parsed.keyVault === 'object') ? parsed.keyVault : {},
          syncProfiles: Array.isArray(parsed.syncProfiles) ? parsed.syncProfiles : [],
          driveProfiles: Array.isArray(parsed.driveProfiles) ? parsed.driveProfiles : []
        };
      }
    } catch {}
    const fresh = createDefaultConfig();
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

  getPublicConfig() {
    const { sessionSecret, ...safe } = this.data;
    return safe;
  }

  updateSettings(patch) {
    const allowed = [
      'workspaceName', 'workspaceId', 'department', 'role',
      'nodeName', 'port', 'udpPort', 'bindMode', 'autoStartServer', 'startWithWindows', 'minimizeToTray', 'ultraLightTrayMode',
      'uiTheme', 'uiEffects', 'uiDensity', 'uiScale', 'resourceProfile',
      'autoAssignFreeDrive', 'preferredStartLetter', 'unifiedMountRoot',
      'autoShareAllDisks', 'updateShareDir', 'updateServerUrl', 'updateGithubRepo', 'enableGithubUpdates',
      'autoCheckUpdates', 'autoDownloadUpdates', 'autoInstallWhenIdle', 'metricThresholds'
    ];
    for (const k of allowed) {
      if (patch[k] !== undefined) {
        if (k === 'port' || k === 'udpPort') {
          this.data[k] = Math.max(1024, Math.min(65535, Number(patch[k]) || (k === 'port' ? 4890 : 4891)));
        } else {
          this.data[k] = patch[k];
        }
      }
    }
    this.save();
    return this.getPublicConfig();
  }

  addShare({ name, folderPath, mode = 'rw' }) {
    const resolved = path.resolve(folderPath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error(`La carpeta o disco no existe: ${resolved}`);
    }
    const dup = this.data.shares.find((s) => path.resolve(s.path).toLowerCase() === resolved.toLowerCase());
    if (dup) {
      throw new Error(`Esta ubicación ya está compartida como "${dup.name}".`);
    }
    const cleanName = String(name || path.basename(resolved) || resolved.replace(/[:\\]+/g, '')).trim() || 'Volumen';
    const share = {
      id: makeShareId(cleanName),
      name: cleanName,
      path: resolved,
      mode: mode === 'ro' ? 'ro' : 'rw',
      enabled: true
    };
    this.data.shares.push(share);
    this.save();
    return share;
  }

  updateShare(id, patch) {
    const share = this.data.shares.find((s) => s.id === id);
    if (!share) throw new Error('Recurso compartido no encontrado.');
    if (patch.name !== undefined) share.name = String(patch.name).trim() || share.name;
    if (patch.mode !== undefined) share.mode = patch.mode === 'ro' ? 'ro' : 'rw';
    if (patch.enabled !== undefined) share.enabled = Boolean(patch.enabled);
    this.save();
    return share;
  }

  removeShare(id) {
    const before = this.data.shares.length;
    this.data.shares = this.data.shares.filter((s) => s.id !== id);
    if (this.data.shares.length === before) throw new Error('Recurso no encontrado.');
    this.save();
    return true;
  }

  addKeyRecord(record) {
    this.data.keys.unshift(record);
    this.save();
    return record;
  }

  revokeKey(keyId) {
    const key = this.data.keys.find((k) => k.keyId === keyId);
    if (!key) throw new Error('Llave no encontrada.');
    key.revoked = true;
    key.revokedAt = new Date().toISOString();
    this.save();
    return key;
  }

  deleteKey(keyId) {
    this.data.keys = this.data.keys.filter((k) => k.keyId !== keyId);
    this.save();
    return true;
  }

  touchKeyUsed(keyId) {
    const key = this.data.keys.find((k) => k.keyId === keyId);
    if (key) {
      key.lastUsedAt = new Date().toISOString();
      this.save();
    }
  }

  savePeer(peer) {
    const id = peer.id || `peer-${crypto.randomBytes(4).toString('hex')}`;
    const clean = {
      id,
      label: String(peer.label || peer.nodeName || 'PC Oficina').trim(),
      nodeName: String(peer.nodeName || '').trim(),
      tailscaleIp: String(peer.tailscaleIp || '').trim(),
      lanIp: String(peer.lanIp || '').trim(),
      port: Number(peer.port) || 4890,
      keyId: String(peer.keyId || '').trim(),
      keyFilePath: String(peer.keyFilePath || '').trim(),
      preferredDrive: String(peer.preferredDrive || 'Z:').trim(),
      updatedAt: new Date().toISOString()
    };
    const idx = this.data.savedPeers.findIndex((p) => p.id === id || (clean.keyId && p.keyId === clean.keyId));
    if (idx >= 0) this.data.savedPeers[idx] = { ...this.data.savedPeers[idx], ...clean };
    else this.data.savedPeers.unshift(clean);
    this.save();
    return clean;
  }

  removePeer(id) {
    this.data.savedPeers = this.data.savedPeers.filter((p) => p.id !== id);
    this.save();
    return true;
  }

  saveKeyVaultEntry({ keyId, passphrase, label, nodeName, permissions = 'rw', shareIds = ['*'], fileName = '' }) {
    if (!keyId) throw new Error('keyId requerido.');
    this.data.keyVault = this.data.keyVault || {};
    const prev = this.data.keyVault[keyId] || {};
    this.data.keyVault[keyId] = {
      ...prev,
      keyId: String(keyId).trim(),
      label: String(label || prev.label || keyId).trim(),
      nodeName: String(nodeName || prev.nodeName || '').trim(),
      passphrase: passphrase !== undefined ? String(passphrase) : (prev.passphrase || ''),
      permissions: permissions || prev.permissions || 'rw',
      shareIds: Array.isArray(shareIds) ? shareIds : (prev.shareIds || ['*']),
      fileName: String(fileName || prev.fileName || '').trim(),
      updatedAt: new Date().toISOString()
    };
    this.save();
    return this.data.keyVault[keyId];
  }

  saveSyncProfile({ id, label, sourceDir, targetDir, mirror = false, lastResult = null }) {
    this.data.syncProfiles = Array.isArray(this.data.syncProfiles) ? this.data.syncProfiles : [];
    const cleanId = id || `sync-${crypto.randomBytes(4).toString('hex')}`;
    const entry = {
      id: cleanId,
      label: String(label || `${path.basename(sourceDir)} → ${path.basename(targetDir)}`).trim(),
      sourceDir: String(sourceDir || '').trim(),
      targetDir: String(targetDir || '').trim(),
      mirror: Boolean(mirror),
      lastResult,
      updatedAt: new Date().toISOString()
    };
    const idx = this.data.syncProfiles.findIndex((p) => p.id === cleanId);
    if (idx >= 0) this.data.syncProfiles[idx] = { ...this.data.syncProfiles[idx], ...entry };
    else this.data.syncProfiles.unshift(entry);
    this.save();
    return entry;
  }

  removeSyncProfile(id) {
    this.data.syncProfiles = (this.data.syncProfiles || []).filter((p) => p.id !== id);
    this.save();
    return true;
  }

  saveDriveProfile(profile = {}) {
    this.data.driveProfiles = Array.isArray(this.data.driveProfiles) ? this.data.driveProfiles : [];
    const cleanId = profile.id || `drv-${crypto.randomBytes(4).toString('hex')}`;
    const entry = {
      id: cleanId,
      keyId: String(profile.keyId || '').trim(),
      nodeName: String(profile.nodeName || '').trim(),
      shareSubpath: String(profile.shareSubpath || '').trim(),
      alias: String(profile.alias || profile.label || profile.nodeName || 'Disco Remoto').trim(),
      group: String(profile.group || 'General').trim() || 'General',
      color: String(profile.color || 'emerald').trim() || 'emerald',
      mountMode: profile.mountMode === 'folder' ? 'folder' : 'letter',
      preferredDrive: String(profile.preferredDrive || 'AUTO').trim().toUpperCase(),
      updatedAt: new Date().toISOString()
    };
    const idx = this.data.driveProfiles.findIndex(
      (p) => p.id === cleanId || (entry.keyId && p.keyId === entry.keyId && p.shareSubpath === entry.shareSubpath)
    );
    if (idx >= 0) this.data.driveProfiles[idx] = { ...this.data.driveProfiles[idx], ...entry };
    else this.data.driveProfiles.unshift(entry);
    this.save();
    return entry;
  }

  removeDriveProfile(id) {
    this.data.driveProfiles = (this.data.driveProfiles || []).filter((p) => p.id !== id);
    this.save();
    return true;
  }
}

module.exports = {
  ConfigStore,
  defaultConfigDir,
  makeShareId
};

import React, { useState, useEffect, useMemo, useCallback, lazy, Suspense } from 'react';
import {
  KeyRound,
  RefreshCw,
  Copy,
  Usb,
  Monitor,
  FolderOpen,
  Eye,
  EyeOff,
  Save,
  Play,
  Trash2,
  Search,
  Activity,
  ShieldCheck,
  HardDrive,
  CheckCircle2,
  AlertCircle,
  Zap,
  Wifi,
  WifiOff,
  Server,
  ExternalLink,
  Plus
} from 'lucide-react';

const WinOptimizerPanel = lazy(() => import('./WinOptimizerPanel.jsx'));

const SUB_TABS = [
  { id: 'all', label: 'Todas' },
  { id: 'winscript', label: '🛠️ WinScript Optimizer' },
  { id: 'keys', label: 'Claves y Accesos Rápidos' },
  { id: 'airdrop', label: '⚡ AirDrop Instantáneo' },
  { id: 'remote', label: '🖥️ Control y Pantalla Remota' },
  { id: 'vault', label: '🔐 Bóveda y Cifrador USB' },
  { id: 'studio', label: '🎨 Estudio VisualCorp y Git' },
  { id: 'sync', label: 'Sincronizador de Carpetas' },
  { id: 'clipboard', label: 'Portapapeles en Malla' },
  { id: 'doctor', label: 'Doctor de Red / RDP / SMB' },
  { id: 'search', label: 'Buscador y Archivos Pesados' }
];

function fmtBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let val = n;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i += 1;
  }
  return `${i === 0 ? Math.round(val) : val.toFixed(i >= 3 ? 2 : 1)} ${units[i]}`;
}

function fmtDateTime(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString([], {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function getParentFolder(filePath) {
  if (!filePath || typeof filePath !== 'string') return '';
  const normalized = filePath.replace(/\//g, '\\');
  const idx = normalized.lastIndexOf('\\');
  if (idx <= 0) return normalized;
  if (idx === 2 && normalized[1] === ':') return `${normalized.slice(0, 3)}`;
  return normalized.slice(0, idx);
}

function normalizeDiagnosticResult(raw, defaultHost, defaultPort) {
  if (!raw) return null;
  const data = raw.result || raw;
  const host = data.host || data.ip || defaultHost || '';
  const mainPort = Number(data.port || defaultPort || 4789);
  const portsRaw = data.ports || data.portChecks || {};

  const findPortInfo = (pNum, fallbackKey, defaultLabel) => {
    let entry = null;
    if (Array.isArray(portsRaw)) {
      entry = portsRaw.find((x) => Number(x.port) === Number(pNum));
    } else if (portsRaw && typeof portsRaw === 'object') {
      entry = portsRaw[pNum] ?? portsRaw[String(pNum)] ?? (fallbackKey ? portsRaw[fallbackKey] : null);
    }
    if (entry == null && fallbackKey && data[fallbackKey] != null) {
      entry = data[fallbackKey];
    }
    if (typeof entry === 'boolean') {
      return { port: pNum, label: defaultLabel, open: entry, latencyMs: null, detail: '' };
    }
    if (entry && typeof entry === 'object') {
      return {
        port: pNum,
        label: entry.name || entry.service || entry.label || defaultLabel,
        open: Boolean(entry.open ?? entry.ok ?? entry.online ?? entry.reachable),
        latencyMs: entry.latencyMs ?? entry.ms ?? null,
        detail: entry.detail || entry.error || entry.status || ''
      };
    }
    return { port: pNum, label: defaultLabel, open: false, latencyMs: null, detail: 'No verificado' };
  };

  const rows = [
    findPortInfo(mainPort, 'estebanCloud', 'Esteban Cloud (API / Túnel)'),
    findPortInfo(445, 'smb', 'SMB / Carpetas Compartidas Windows'),
    findPortInfo(3389, 'rdp', 'Escritorio Remoto Windows (RDP)'),
    findPortInfo(22, 'ssh', 'OpenSSH / SFTP')
  ];

  const firstLatency =
    data.latencyMs ??
    data.pingMs ??
    rows.find((r) => r.latencyMs != null)?.latencyMs ??
    null;

  return {
    host,
    nodeName: data.nodeName || data.hostName || data.health?.nodeName || '',
    version: data.version || data.health?.version || '',
    online: Boolean(data.online ?? rows.some((r) => r.open)),
    latencyMs: firstLatency,
    rows,
    checkedAt: data.checkedAt || data.timestamp || new Date().toISOString()
  };
}

export default function ToolsView({ api, state, flash, onQuickConnectKey, onOpenTab }) {
  const [activeSection, setActiveSection] = useState('all');

  const config = state?.config || {};
  const env = state?.env || {};
  const detectedKeys = Array.isArray(state?.detectedKeys) ? state.detectedKeys : [];
  const mounts = Array.isArray(state?.mounts) ? state.mounts : [];
  const shares = Array.isArray(config?.shares) ? config.shares : [];
  const savedPeers = Array.isArray(config?.savedPeers) ? config.savedPeers : [];
  const usbDrives = Array.isArray(env?.usbDrives) ? env.usbDrives : [];
  const tailscalePeers = Array.isArray(env?.tailscale?.peers) ? env.tailscale.peers : [];

  // 1. Keep Awake (Modo Cafeína)
  const [keepAwakeLocal, setKeepAwakeLocal] = useState(Boolean(state?.keepAwake));
  const [togglingAwake, setTogglingAwake] = useState(false);

  useEffect(() => {
    if (typeof state?.keepAwake === 'boolean') {
      setKeepAwakeLocal(state.keepAwake);
    }
  }, [state?.keepAwake]);

  const handleToggleKeepAwake = async () => {
    if (!api?.setKeepAwake) {
      flash?.('error', 'La función Modo Despierto no está disponible.');
      return;
    }
    const next = !keepAwakeLocal;
    setTogglingAwake(true);
    try {
      const res = await api.setKeepAwake(next);
      const effective =
        typeof res?.keepAwake === 'boolean'
          ? res.keepAwake
          : typeof res?.state?.keepAwake === 'boolean'
            ? res.state.keepAwake
            : next;
      setKeepAwakeLocal(effective);
      flash?.(
        'ok',
        effective
          ? '☕ Modo Activo activado: esta PC no entrará en suspensión.'
          : 'Modo Despierto desactivado: ahorro de energía normal restaurado.'
      );
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo cambiar el Modo Despierto.');
    } finally {
      setTogglingAwake(false);
    }
  };

  // 2. Key Vault state (visible passphrases by default)
  const [hiddenPassMap, setHiddenPassMap] = useState({});
  const [passEdits, setPassEdits] = useState({});
  const [savingKeyId, setSavingKeyId] = useState('');
  const [syncingKeyId, setSyncingKeyId] = useState('');

  const getKeyPassphrase = useCallback(
    (k) => {
      if (passEdits[k.keyId] !== undefined) return passEdits[k.keyId];
      if (k.passphrase) return k.passphrase;
      const vaultEntry = config?.keyVault?.[k.keyId];
      if (typeof vaultEntry === 'string') return vaultEntry;
      if (vaultEntry && typeof vaultEntry.passphrase === 'string') return vaultEntry.passphrase;
      return '';
    },
    [passEdits, config?.keyVault]
  );

  const handleCopyText = async (text, label = 'Texto copiado al portapapeles.') => {
    if (!text) {
      flash?.('error', 'No hay contenido disponible para copiar.');
      return;
    }
    try {
      if (api?.copyText) {
        await api.copyText(text);
      } else if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      }
      flash?.('ok', label);
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo copiar al portapapeles.');
    }
  };

  const handleSaveKeyPassphrase = async (k) => {
    if (!api?.saveKeyPassphrase) {
      flash?.('error', 'El guardado de frase de paso en bóveda no está disponible.');
      return;
    }
    const passphrase = getKeyPassphrase(k).trim();
    setSavingKeyId(k.keyId);
    try {
      await api.saveKeyPassphrase({
        keyId: k.keyId,
        passphrase,
        label: k.label || k.nodeName || k.keyId
      });
      flash?.('ok', `Clave guardada en la bóveda para ${k.label || k.nodeName || k.keyId}.`);
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo guardar la clave.');
    } finally {
      setSavingKeyId('');
    }
  };

  const handleSyncKeyToUsb = async (k) => {
    if (!api?.syncKeyToAllUsb) {
      flash?.('error', 'La sincronización a USB no está disponible.');
      return;
    }
    setSyncingKeyId(k.keyId);
    try {
      const res = await api.syncKeyToAllUsb(k.keyId);
      const count = res?.copied?.length ?? res?.count ?? usbDrives.length;
      flash?.('ok', `Llave ${k.label || k.keyId} sincronizada en los USB conectados (${count}).`);
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo sincronizar la llave a los USB.');
    } finally {
      setSyncingKeyId('');
    }
  };

  const handleLaunchRdp = async (host) => {
    const cleanHost = String(host || '').trim();
    if (!cleanHost) {
      flash?.('error', 'Ingresa o selecciona una dirección IP / equipo para Escritorio Remoto.');
      return;
    }
    try {
      await api.launchRdp(cleanHost);
      flash?.('ok', `Abriendo Escritorio Remoto (mstsc) hacia ${cleanHost}...`);
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo iniciar Escritorio Remoto.');
    }
  };

  const handleOpenSmb = async (host) => {
    const cleanHost = String(host || '').trim().replace(/^\\+/, '');
    if (!cleanHost) {
      flash?.('error', 'Ingresa o selecciona una dirección IP para abrir por red SMB.');
      return;
    }
    try {
      await api.openSmbShare(cleanHost);
      flash?.('ok', `Abriendo carpetas de red SMB (\\\\${cleanHost})...`);
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo abrir el recurso SMB.');
    }
  };

  // 3. Folder Sync Studio state
  const [sourceDir, setSourceDir] = useState(() => shares[0]?.path || 'E:\\CODE\\ESTEBAN CLOUD');
  const [targetDir, setTargetDir] = useState(() => {
    if (usbDrives[0]?.root) return `${usbDrives[0].root.replace(/\\$/, '')}\\Respaldo-Esteban-Cloud`;
    if (mounts[0]?.driveLetter) return `${mounts[0].driveLetter.replace(/\\$/, '')}\\Respaldo-Esteban-Cloud`;
    return '';
  });
  const [mirrorMode, setMirrorMode] = useState(false);
  const [profileLabel, setProfileLabel] = useState('');
  const [syncingFolders, setSyncingFolders] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState(null);
  const [localProfilesOverride, setLocalProfilesOverride] = useState(null);

  useEffect(() => {
    if (Array.isArray(config?.syncProfiles)) {
      setLocalProfilesOverride(null);
    }
  }, [config?.syncProfiles]);

  const syncProfiles = useMemo(() => {
    if (Array.isArray(localProfilesOverride)) return localProfilesOverride;
    return Array.isArray(config?.syncProfiles) ? config.syncProfiles : [];
  }, [localProfilesOverride, config?.syncProfiles]);

  const handlePickFolderFor = async (setter) => {
    const picker = api?.pickSaveFolder || api?.pickFolder;
    if (!picker) return;
    try {
      const res = await picker();
      const picked =
        typeof res === 'string'
          ? res
          : res?.folderPath || res?.path || res?.filePath || '';
      if (picked) setter(picked);
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo seleccionar la carpeta.');
    }
  };

  const handleRunFolderSync = async (overrideParams = null) => {
    if (!api?.runFolderSync) {
      flash?.('error', 'El sincronizador de carpetas no está disponible.');
      return;
    }
    const src = String(overrideParams?.sourceDir ?? sourceDir).trim();
    const dst = String(overrideParams?.targetDir ?? targetDir).trim();
    const mirror = Boolean(overrideParams?.mirror ?? mirrorMode);
    const label = String(overrideParams?.label ?? profileLabel).trim();
    const saveProfile = overrideParams ? Boolean(overrideParams.saveProfile) : Boolean(label);

    if (!src || !dst) {
      flash?.('error', 'Selecciona tanto la carpeta origen como la carpeta destino.');
      return;
    }

    setSyncingFolders(true);
    try {
      const res = await api.runFolderSync({
        sourceDir: src,
        targetDir: dst,
        mirror,
        saveProfile,
        label: label || `${src.split(/[\\/]/).pop() || 'Origen'} → ${dst.split(/[\\/]/).pop() || 'Destino'}`
      });
      const r = res?.result || res || {};
      const summary = {
        sourceDir: src,
        targetDir: dst,
        mirror,
        filesCopied: Number(r.filesCopied ?? r.copiedFiles ?? 0),
        bytesCopied: Number(r.bytesCopied ?? r.copiedBytes ?? 0),
        filesDeleted: Number(r.filesDeleted ?? r.deletedFiles ?? 0),
        filesSkipped: Number(r.filesSkipped ?? r.skippedFiles ?? 0),
        durationMs: Number(r.durationMs ?? r.elapsedMs ?? 0),
        completedAt: new Date().toISOString()
      };
      setLastSyncResult(summary);
      if (Array.isArray(res?.syncProfiles)) {
        setLocalProfilesOverride(res.syncProfiles);
      } else if (Array.isArray(res?.state?.config?.syncProfiles)) {
        setLocalProfilesOverride(res.state.config.syncProfiles);
      }
      if (!overrideParams && label) {
        setProfileLabel('');
      }
      flash?.(
        'ok',
        `Sincronización completada: ${summary.filesCopied} archivos (${fmtBytes(summary.bytesCopied)}) en ${summary.durationMs} ms.`
      );
    } catch (err) {
      flash?.('error', err?.message || 'Error durante la sincronización de carpetas.');
    } finally {
      setSyncingFolders(false);
    }
  };

  const handleDeleteSyncProfile = async (id) => {
    if (!api?.deleteSyncProfile) return;
    try {
      const res = await api.deleteSyncProfile(id);
      if (Array.isArray(res?.syncProfiles)) {
        setLocalProfilesOverride(res.syncProfiles);
      } else if (Array.isArray(res?.state?.config?.syncProfiles)) {
        setLocalProfilesOverride(res.state.config.syncProfiles);
      } else {
        setLocalProfilesOverride(syncProfiles.filter((p) => p.id !== id));
      }
      flash?.('ok', 'Perfil de sincronización eliminado.');
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo eliminar el perfil.');
    }
  };

  // 4. Mesh Clipboard state
  const [clipboardText, setClipboardText] = useState('');
  const [sendingClipboard, setSendingClipboard] = useState(false);
  const [localClipboardOverride, setLocalClipboardOverride] = useState(null);

  useEffect(() => {
    if (Array.isArray(state?.clipboardHistory)) {
      setLocalClipboardOverride(null);
    }
  }, [state?.clipboardHistory]);

  const clipboardHistory = useMemo(() => {
    if (Array.isArray(localClipboardOverride)) return localClipboardOverride;
    return Array.isArray(state?.clipboardHistory) ? state.clipboardHistory : [];
  }, [localClipboardOverride, state?.clipboardHistory]);

  const handlePasteFromSystemClipboard = async () => {
    try {
      if (navigator?.clipboard?.readText) {
        const txt = await navigator.clipboard.readText();
        if (txt) {
          setClipboardText(txt);
          flash?.('ok', 'Contenido pegado desde tu portapapeles actual.');
          return;
        }
      }
      if (api?.readClipboard) {
        const txt = await api.readClipboard();
        if (txt) {
          setClipboardText(txt);
          flash?.('ok', 'Contenido pegado desde tu portapapeles actual.');
          return;
        }
      }
      flash?.('error', 'El portapapeles actual está vacío o no contiene texto.');
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo leer el portapapeles local.');
    }
  };

  const handlePushMeshClipboard = async () => {
    const text = clipboardText.trim();
    if (!text) {
      flash?.('error', 'Escribe o pega algún texto, enlace o comando antes de enviarlo.');
      return;
    }
    if (!api?.pushMeshClipboard) {
      flash?.('error', 'El portapapeles en malla no está disponible.');
      return;
    }
    setSendingClipboard(true);
    try {
      const res = await api.pushMeshClipboard({ text });
      if (Array.isArray(res?.clipboardHistory)) {
        setLocalClipboardOverride(res.clipboardHistory);
      } else if (Array.isArray(res?.history)) {
        setLocalClipboardOverride(res.history);
      } else if (Array.isArray(res?.state?.clipboardHistory)) {
        setLocalClipboardOverride(res.state.clipboardHistory);
      }
      setClipboardText('');
      const delivered = res?.deliveredCount ?? res?.peersReached ?? res?.delivered?.length;
      flash?.(
        'ok',
        delivered != null
          ? `Portapapeles enviado a la malla (${delivered} equipos alcanzados) y copiado localmente.`
          : 'Texto enviado al portapapeles de todas las PCs conectadas.'
      );
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo enviar al portapapeles en malla.');
    } finally {
      setSendingClipboard(false);
    }
  };

  const handleDeleteClipboardItem = async (id) => {
    if (!api?.deleteClipboardItem) return;
    try {
      const res = await api.deleteClipboardItem(id);
      if (Array.isArray(res?.clipboardHistory)) {
        setLocalClipboardOverride(res.clipboardHistory);
      } else if (Array.isArray(res?.history)) {
        setLocalClipboardOverride(res.history);
      } else if (Array.isArray(res?.state?.clipboardHistory)) {
        setLocalClipboardOverride(res.state.clipboardHistory);
      } else {
        setLocalClipboardOverride(clipboardHistory.filter((item) => item.id !== id));
      }
      flash?.('ok', 'Elemento eliminado del historial de portapapeles.');
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo eliminar el elemento.');
    }
  };

  // 5. Mesh Doctor state
  const doctorTargets = useMemo(() => {
    const map = new Map();
    const localIp = env?.tailscale?.ip || env?.lanIp || '127.0.0.1';
    map.set(localIp, {
      host: localIp,
      port: Number(config?.port) || 4789,
      label: `${config?.nodeName || env?.hostName || 'Esta PC'} (Local)`,
      online: true
    });
    for (const tp of tailscalePeers) {
      if (!tp?.ip) continue;
      map.set(tp.ip, {
        host: tp.ip,
        port: Number(config?.port) || 4789,
        label: `${tp.hostName || tp.ip} (Tailscale)`,
        online: Boolean(tp.online)
      });
    }
    for (const sp of savedPeers) {
      const ip = sp.tailscaleIp || sp.lanIp;
      if (!ip) continue;
      if (!map.has(ip)) {
        map.set(ip, {
          host: ip,
          port: Number(sp.port || config?.port) || 4789,
          label: `${sp.nodeName || sp.label || ip}`,
          online: true
        });
      }
    }
    for (const k of detectedKeys) {
      const ip = k.tailscaleIp || k.lanIp;
      if (!ip) continue;
      if (!map.has(ip)) {
        map.set(ip, {
          host: ip,
          port: Number(k.port || config?.port) || 4789,
          label: `${k.nodeName || k.label || ip}`,
          online: true
        });
      }
    }
    return Array.from(map.values());
  }, [env, config, tailscalePeers, savedPeers, detectedKeys]);

  const [doctorHost, setDoctorHost] = useState(() => {
    const remote = doctorTargets.find((t) => !t.label.includes('(Local)'));
    return remote?.host || doctorTargets[0]?.host || '127.0.0.1';
  });
  const [doctorPort, setDoctorPort] = useState(() => Number(config?.port) || 4789);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagResult, setDiagResult] = useState(null);

  const handleRunDiagnosis = async (customHost, customPort) => {
    if (!api?.diagnosePeer) {
      flash?.('error', 'El diagnóstico de red no está disponible.');
      return;
    }
    const targetHost = String(customHost ?? doctorHost).trim();
    const targetPort = Number(customPort ?? doctorPort) || 4789;
    if (!targetHost) {
      flash?.('error', 'Ingresa una dirección IP o nombre de host para diagnosticar.');
      return;
    }
    setDiagnosing(true);
    try {
      const res = await api.diagnosePeer({ host: targetHost, port: targetPort });
      const normalized = normalizeDiagnosticResult(res, targetHost, targetPort);
      setDiagResult(normalized);
      flash?.('ok', `Diagnóstico completado para ${targetHost}.`);
    } catch (err) {
      flash?.('error', err?.message || 'Error al diagnosticar el equipo.');
    } finally {
      setDiagnosing(false);
    }
  };

  // 6. Global Storage Scanner & SHA-256 Verifier state
  const [searchQuery, setSearchQuery] = useState('');
  const [scanningStorage, setScanningStorage] = useState(false);
  const [storageReport, setStorageReport] = useState(null);
  const [storageSubTab, setStorageSubTab] = useState('results'); // 'results' | 'largest' | 'duplicates'
  const [hashResult, setHashResult] = useState(null);
  const [hashingFile, setHashingFile] = useState(false);

  const handleScanStorage = async (e) => {
    if (e?.preventDefault) e.preventDefault();
    if (!api?.scanSharedStorage) {
      flash?.('error', 'El analizador de carpetas compartidas no está disponible.');
      return;
    }
    setScanningStorage(true);
    try {
      const res = await api.scanSharedStorage({ query: searchQuery.trim() });
      const data = res?.result || res || {};
      const matches = Array.isArray(data.matches)
        ? data.matches
        : Array.isArray(data.results)
          ? data.results
          : Array.isArray(data.searchResults)
            ? data.searchResults
            : Array.isArray(data.files)
              ? data.files
              : [];
      const largest = Array.isArray(data.largestFiles)
        ? data.largestFiles
        : Array.isArray(data.largest)
          ? data.largest
          : Array.isArray(data.topLargest)
            ? data.topLargest
            : Array.isArray(data.heavyFiles)
              ? data.heavyFiles
              : [];
      const duplicates = Array.isArray(data.duplicates)
        ? data.duplicates
        : Array.isArray(data.duplicateGroups)
          ? data.duplicateGroups
          : Array.isArray(data.possibleDuplicates)
            ? data.possibleDuplicates
            : [];

      setStorageReport({
        matches,
        largest,
        duplicates,
        totalFiles: Number(data.totalFiles ?? data.scannedFiles ?? matches.length),
        totalBytes: Number(data.totalBytes ?? data.scannedBytes ?? 0),
        wastedBytes: Number(
          data.wastedBytes ??
            duplicates.reduce((acc, d) => acc + Number(d.wastedBytes || 0), 0)
        ),
        durationMs: Number(data.durationMs ?? 0)
      });

      if (!searchQuery.trim() && matches.length === 0 && largest.length > 0 && storageSubTab === 'results') {
        setStorageSubTab('largest');
      }
      flash?.('ok', 'Análisis de carpetas compartidas completado.');
    } catch (err) {
      flash?.('error', err?.message || 'Error al analizar las carpetas compartidas.');
    } finally {
      setScanningStorage(false);
    }
  };

  const handleComputeFileHash = async (filePath) => {
    if (!filePath || !api?.computeFileHash) return;
    setHashingFile(true);
    try {
      const res = await api.computeFileHash(filePath);
      const data = res?.result || res || {};
      if (data.sha256 || data.md5) {
        setHashResult({
          filePath: data.filePath || data.path || filePath,
          fileName: data.fileName || data.name || filePath.split(/[\\/]/).pop(),
          size: Number(data.size ?? 0),
          sha256: data.sha256 || '',
          md5: data.md5 || ''
        });
        flash?.('ok', 'Huella criptográfica SHA-256 / MD5 calculada.');
      }
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo calcular el hash del archivo.');
    } finally {
      setHashingFile(false);
    }
  };

  const handlePickFileForHash = async () => {
    if (!api?.pickFileForHash) {
      flash?.('error', 'El verificador SHA-256 no está disponible.');
      return;
    }
    setHashingFile(true);
    try {
      const res = await api.pickFileForHash();
      if (!res || res.canceled) {
        setHashingFile(false);
        return;
      }
      const data = res?.result || res;
      if (typeof data === 'string') {
        await handleComputeFileHash(data);
        return;
      }
      if (data.sha256 || data.md5) {
        setHashResult({
          filePath: data.filePath || data.path || '',
          fileName: data.fileName || data.name || (data.filePath || data.path || '').split(/[\\/]/).pop(),
          size: Number(data.size ?? 0),
          sha256: data.sha256 || '',
          md5: data.md5 || ''
        });
        flash?.('ok', 'Verificación SHA-256 y MD5 completada.');
      } else if (data.filePath || data.path) {
        await handleComputeFileHash(data.filePath || data.path);
      }
    } catch (err) {
      flash?.('error', err?.message || 'Error al verificar el archivo.');
    } finally {
      setHashingFile(false);
    }
  };

  const handleOpenFolderInExplorer = async (fileOrFolderPath) => {
    if (!fileOrFolderPath || !api?.openLocalFolder) return;
    try {
      await api.openLocalFolder(fileOrFolderPath);
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo abrir la carpeta en el Explorador.');
    }
  };

  // 7. Auto-Watch in Sync Studio
  const [autoWatchSync, setAutoWatchSync] = useState(Boolean(state?.autoWatchSync));

  const handleToggleAutoWatchSync = async (checked) => {
    const next = Boolean(checked);
    if (next && (!sourceDir.trim() || !targetDir.trim())) {
      flash?.('error', 'Configura carpeta origen y destino antes de activar Auto-Watch.');
      return;
    }
    setAutoWatchSync(next);
    try {
      if (api?.setFolderAutoWatch) {
        await api.setFolderAutoWatch({
          enabled: next,
          sourceDir: sourceDir.trim(),
          targetDir: targetDir.trim(),
          mirror: mirrorMode
        });
      } else if (api?.toggleFolderAutoWatch) {
        await api.toggleFolderAutoWatch({
          enabled: next,
          sourceDir: sourceDir.trim(),
          targetDir: targetDir.trim(),
          mirror: mirrorMode
        });
      }
      flash?.(
        'ok',
        next
          ? '🔄 Auto-Watch en tiempo real activado: los cambios en origen se sincronizarán automáticamente.'
          : 'Auto-Watch en tiempo real detenido.'
      );
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo cambiar el estado de Auto-Watch.');
    }
  };

  useEffect(() => {
    if (!autoWatchSync) return undefined;
    if (api?.setFolderAutoWatch || api?.toggleFolderAutoWatch) return undefined;
    const timer = setInterval(() => {
      if (!syncingFolders && sourceDir.trim() && targetDir.trim() && api?.runFolderSync) {
        api
          .runFolderSync({
            sourceDir: sourceDir.trim(),
            targetDir: targetDir.trim(),
            mirror: mirrorMode,
            saveProfile: false
          })
          .then((res) => {
            const r = res?.result || res || {};
            if (Number(r.filesCopied || 0) > 0 || Number(r.filesDeleted || 0) > 0) {
              setLastSyncResult({
                sourceDir: sourceDir.trim(),
                targetDir: targetDir.trim(),
                mirror: mirrorMode,
                filesCopied: Number(r.filesCopied || 0),
                bytesCopied: Number(r.bytesCopied || 0),
                filesDeleted: Number(r.filesDeleted || 0),
                filesSkipped: Number(r.filesSkipped || 0),
                durationMs: Number(r.durationMs || 0),
                completedAt: new Date().toISOString()
              });
            }
          })
          .catch(() => {});
      }
    }, 10000);
    return () => clearInterval(timer);
  }, [autoWatchSync, syncingFolders, sourceDir, targetDir, mirrorMode, api]);

  // 8. Peer targets for AirDrop & Remote Control
  const meshPeerOptions = useMemo(() => {
    const defaultPort = Number(config?.port) || 4789;
    const list = [
      {
        id: 'local',
        peerUrl: '',
        host: '127.0.0.1',
        port: defaultPort,
        label: `${config?.nodeName || env?.hostName || 'Esta PC'} (Local)`,
        isLocal: true
      }
    ];
    const seenUrls = new Set(['']);

    const addPeerOption = (ip, port, name, tag = '') => {
      if (!ip) return;
      const p = Number(port) || defaultPort;
      const url = `http://${ip}:${p}`;
      if (seenUrls.has(url)) return;
      seenUrls.add(url);
      list.push({
        id: url,
        peerUrl: url,
        host: ip,
        port: p,
        label: `${name || ip}${tag ? ` (${tag})` : ''}`,
        isLocal: false
      });
    };

    for (const tp of tailscalePeers) {
      if (tp?.ip) {
        addPeerOption(tp.ip, defaultPort, tp.hostName || tp.ip, tp.online ? 'Tailscale · Online' : 'Tailscale');
      }
    }
    for (const sp of savedPeers) {
      const ip = sp.tailscaleIp || sp.lanIp;
      if (ip) {
        addPeerOption(ip, sp.port || defaultPort, sp.nodeName || sp.label || ip, 'Guardado');
      }
    }
    for (const k of detectedKeys) {
      const ip = k.tailscaleIp || k.lanIp;
      if (ip) {
        addPeerOption(ip, k.port || defaultPort, k.nodeName || k.label || ip, 'Llave');
      }
    }
    if (!list.some((x) => x.label.toLowerCase().includes('dell'))) {
      addPeerOption('100.118.251.119', defaultPort, 'EstebanPcDELL', 'Tailscale');
    }
    return list;
  }, [config, env, tailscalePeers, savedPeers, detectedKeys]);

  // 9. AirDrop Instantáneo state
  const [airDropPeerUrl, setAirDropPeerUrl] = useState(() => {
    const firstRemote = meshPeerOptions.find((p) => !p.isLocal);
    return firstRemote ? firstRemote.peerUrl : '';
  });
  const [sendingAirDrop, setSendingAirDrop] = useState(false);
  const [airDropResults, setAirDropResults] = useState([]);

  const handleSendAirDropFiles = async () => {
    if (!api?.sendAirDropFiles) {
      flash?.('error', 'El envío AirDrop no está disponible en este momento.');
      return;
    }
    setSendingAirDrop(true);
    try {
      const res = await api.sendAirDropFiles({ peerUrl: airDropPeerUrl });
      if (res?.canceled) {
        setSendingAirDrop(false);
        return;
      }
      const filesSent = Array.isArray(res?.files)
        ? res.files
        : Array.isArray(res?.sentFiles)
          ? res.sentFiles
          : res?.fileName
            ? [res]
            : [];
      if (filesSent.length > 0) {
        setAirDropResults((prev) => [...filesSent, ...prev].slice(0, 15));
      }
      const count = res?.sentCount ?? (filesSent.length || 1);
      flash?.(
        'ok',
        `⚡ AirDrop completado: ${count} ${count === 1 ? 'archivo enviado' : 'archivos enviados'} directamente a Downloads\\EstebanCloud-AirDrop.`
      );
    } catch (err) {
      flash?.('error', err?.message || 'No se pudieron enviar los archivos por AirDrop.');
    } finally {
      setSendingAirDrop(false);
    }
  };

  const handleOpenAirDropFolder = async () => {
    try {
      if (api?.openAirDropFolder) {
        await api.openAirDropFolder();
        return;
      }
      const fallbackDir = state?.airDropDir || env?.airDropDir || 'Downloads\\EstebanCloud-AirDrop';
      if (api?.openLocalFolder) {
        await api.openLocalFolder(fallbackDir);
      }
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo abrir la carpeta EstebanCloud-AirDrop.');
    }
  };

  // 10. Control y Pantalla Remota state
  const [remoteTargetUrl, setRemoteTargetUrl] = useState('');
  const [remoteScreen, setRemoteScreen] = useState(null);
  const [loadingScreen, setLoadingScreen] = useState(false);
  const [liveScreenStream, setLiveScreenStream] = useState(false);
  const [remoteProcesses, setRemoteProcesses] = useState([]);
  const [loadingProcesses, setLoadingProcesses] = useState(false);
  const [killingPid, setKillingPid] = useState(null);
  const [runningSysAction, setRunningSysAction] = useState('');
  const [wolMac, setWolMac] = useState(() => config?.lastWolMac || 'AA:BB:CC:DD:EE:FF');

  const handleFetchRemoteScreen = useCallback(
    async (silent = false) => {
      if (!api?.fetchRemoteScreen) {
        if (!silent) flash?.('error', 'La captura de pantalla remota no está disponible.');
        return;
      }
      if (!silent) setLoadingScreen(true);
      try {
        const res = await api.fetchRemoteScreen({ peerUrl: remoteTargetUrl });
        const payload = res?.result || res;
        if (payload?.dataUrl) {
          setRemoteScreen({
            dataUrl: payload.dataUrl,
            capturedAt: payload.capturedAt || new Date().toISOString(),
            peerUrl: remoteTargetUrl
          });
          if (!silent) {
            flash?.('ok', '📸 Captura de pantalla en vivo actualizada.');
          }
        }
      } catch (err) {
        if (!silent) {
          flash?.('error', err?.message || 'No se pudo obtener la pantalla del equipo.');
        }
      } finally {
        if (!silent) setLoadingScreen(false);
      }
    },
    [api, remoteTargetUrl, flash]
  );

  useEffect(() => {
    if (!liveScreenStream) return undefined;
    handleFetchRemoteScreen(true);
    const interval = setInterval(() => {
      handleFetchRemoteScreen(true);
    }, 3500);
    return () => clearInterval(interval);
  }, [liveScreenStream, handleFetchRemoteScreen]);

  const handleFetchRemoteProcesses = async () => {
    if (!api?.fetchRemoteProcesses) {
      flash?.('error', 'El monitor de procesos remotos no está disponible.');
      return;
    }
    setLoadingProcesses(true);
    try {
      const res = await api.fetchRemoteProcesses({ peerUrl: remoteTargetUrl, limit: 15 });
      const list = Array.isArray(res)
        ? res
        : Array.isArray(res?.processes)
          ? res.processes
          : Array.isArray(res?.result)
            ? res.result
            : [];
      setRemoteProcesses(list);
      flash?.('ok', `📋 Lista de procesos actualizada (${list.length} procesos top).`);
    } catch (err) {
      flash?.('error', err?.message || 'No se pudieron obtener los procesos del equipo.');
    } finally {
      setLoadingProcesses(false);
    }
  };

  const handleKillRemoteProcess = async (pid, name) => {
    const killFn = api?.killRemoteProcess || api?.killProcess;
    if (!killFn && !api?.executeRemoteAction) {
      flash?.('error', 'La función para terminar procesos no está disponible.');
      return;
    }
    setKillingPid(pid);
    try {
      if (killFn) {
        await killFn({ peerUrl: remoteTargetUrl, pid });
      } else {
        await api.executeRemoteAction({
          peerUrl: remoteTargetUrl,
          action: 'kill-process',
          payload: { pid }
        });
      }
      setRemoteProcesses((prev) => prev.filter((p) => Number(p.pid) !== Number(pid)));
      flash?.('ok', `Proceso ${name || ''} (PID ${pid}) terminado.`);
    } catch (err) {
      flash?.('error', err?.message || `No se pudo terminar el proceso ${pid}.`);
    } finally {
      setKillingPid(null);
    }
  };

  const handleQuickSystemAction = async (action, extraPayload = {}, confirmMsg = '') => {
    const execFn =
      api?.executeRemoteAction || api?.executeQuickSystemAction || api?.runSystemAction;
    if (!execFn) {
      flash?.('error', 'La acción rápida de sistema no está disponible.');
      return;
    }
    setRunningSysAction(action);
    try {
      const res = await execFn({
        peerUrl: remoteTargetUrl,
        action,
        payload: extraPayload
      });
      flash?.('ok', res?.message || confirmMsg || `Acción '${action}' ejecutada correctamente.`);
    } catch (err) {
      flash?.('error', err?.message || `Error al ejecutar acción '${action}'.`);
    } finally {
      setRunningSysAction('');
    }
  };

  // 11. Bóveda Secreta Cifrada (Esteban Vault) & Cifrador USB state
  const [vaultItems, setVaultItems] = useState(() =>
    Array.isArray(state?.vaultItems) ? state.vaultItems : []
  );
  const [loadingVault, setLoadingVault] = useState(false);
  const [syncingVault, setSyncingVault] = useState(false);
  const [vaultForm, setVaultForm] = useState({
    id: '',
    title: '',
    category: 'password',
    username: '',
    secret: '',
    notes: ''
  });
  const [visibleVaultSecrets, setVisibleVaultSecrets] = useState({});
  const [usbFilePassphrase, setUsbFilePassphrase] = useState('');
  const [processingUsbCrypto, setProcessingUsbCrypto] = useState(false);
  const [lastUsbCryptoResult, setLastUsbCryptoResult] = useState(null);

  const loadVaultItems = useCallback(async () => {
    if (!api?.vaultList) return;
    setLoadingVault(true);
    try {
      const res = await api.vaultList();
      const items = Array.isArray(res)
        ? res
        : Array.isArray(res?.items)
          ? res.items
          : Array.isArray(res?.vaultItems)
            ? res.vaultItems
            : [];
      setVaultItems(items);
    } catch {
      // ignore initial load error
    } finally {
      setLoadingVault(false);
    }
  }, [api]);

  useEffect(() => {
    if (Array.isArray(state?.vaultItems)) {
      setVaultItems(state.vaultItems);
    }
  }, [state?.vaultItems]);

  useEffect(() => {
    loadVaultItems();
  }, [loadVaultItems]);

  const handleVaultUpsert = async (e) => {
    if (e?.preventDefault) e.preventDefault();
    if (!vaultForm.title.trim()) {
      flash?.('error', 'Ingresa un título para el secreto, licencia o nota.');
      return;
    }
    if (!api?.vaultUpsert) {
      flash?.('error', 'La Bóveda Secreta Cifrada no está disponible.');
      return;
    }
    setLoadingVault(true);
    try {
      const res = await api.vaultUpsert({
        id: vaultForm.id || undefined,
        title: vaultForm.title.trim(),
        category: vaultForm.category || 'general',
        username: vaultForm.username.trim(),
        secret: vaultForm.secret,
        notes: vaultForm.notes
      });
      if (Array.isArray(res?.items)) {
        setVaultItems(res.items);
      } else if (Array.isArray(res?.vaultItems)) {
        setVaultItems(res.vaultItems);
      } else if (res?.item || res?.id) {
        const savedItem = res.item || res;
        setVaultItems((prev) => [
          savedItem,
          ...prev.filter((it) => it.id !== savedItem.id)
        ]);
      } else {
        await loadVaultItems();
      }
      setVaultForm({
        id: '',
        title: '',
        category: 'password',
        username: '',
        secret: '',
        notes: ''
      });
      flash?.('ok', '🔐 Elemento cifrado con AES-256-GCM y guardado en Esteban Vault.');
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo guardar en la bóveda.');
    } finally {
      setLoadingVault(false);
    }
  };

  const handleVaultDelete = async (id) => {
    if (!api?.vaultDelete) return;
    try {
      const res = await api.vaultDelete(id);
      if (Array.isArray(res?.items)) {
        setVaultItems(res.items);
      } else {
        setVaultItems((prev) => prev.filter((it) => it.id !== id));
      }
      flash?.('ok', 'Elemento eliminado de la bóveda.');
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo eliminar el elemento de la bóveda.');
    }
  };

  const handleVaultSyncPeers = async () => {
    if (!api?.vaultSyncPeers) {
      flash?.('error', 'La sincronización P2P de bóveda no está disponible.');
      return;
    }
    setSyncingVault(true);
    try {
      const res = await api.vaultSyncPeers();
      if (Array.isArray(res?.items)) {
        setVaultItems(res.items);
      } else {
        await loadVaultItems();
      }
      flash?.('ok', '🔄 Bóveda sincronizada con los equipos de tu malla.');
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo sincronizar la bóveda con la malla.');
    } finally {
      setSyncingVault(false);
    }
  };

  const handleEncryptUsbFile = async () => {
    const fn = api?.pickAndEncryptUsbFile || api?.encryptFileForUsb;
    if (!fn) {
      flash?.('error', 'El cifrador de archivos USB no está disponible.');
      return;
    }
    const pass = usbFilePassphrase.trim();
    if (!pass) {
      flash?.('error', 'Ingresa una contraseña para cifrar el archivo (.ecloudenc).');
      return;
    }
    setProcessingUsbCrypto(true);
    try {
      const res = await fn({ passphrase: pass });
      if (res?.canceled) {
        setProcessingUsbCrypto(false);
        return;
      }
      const out = res?.result || res;
      if (out?.outputPath) {
        setLastUsbCryptoResult({
          mode: 'encrypt',
          outputPath: out.outputPath,
          size: Number(out.size || 0)
        });
        flash?.('ok', `🔒 Archivo cifrado creado: ${out.outputPath}`);
      }
    } catch (err) {
      flash?.('error', err?.message || 'Error al cifrar el archivo.');
    } finally {
      setProcessingUsbCrypto(false);
    }
  };

  const handleDecryptUsbFile = async () => {
    const fn = api?.pickAndDecryptUsbFile || api?.decryptFileFromUsb;
    if (!fn) {
      flash?.('error', 'El descifrador de archivos USB no está disponible.');
      return;
    }
    const pass = usbFilePassphrase.trim();
    if (!pass) {
      flash?.('error', 'Ingresa la contraseña para descifrar el archivo .ecloudenc.');
      return;
    }
    setProcessingUsbCrypto(true);
    try {
      const res = await fn({ passphrase: pass });
      if (res?.canceled) {
        setProcessingUsbCrypto(false);
        return;
      }
      const out = res?.result || res;
      if (out?.outputPath) {
        setLastUsbCryptoResult({
          mode: 'decrypt',
          outputPath: out.outputPath,
          size: Number(out.size || 0)
        });
        flash?.('ok', `🔓 Archivo descifrado restaurado: ${out.outputPath}`);
      }
    } catch (err) {
      flash?.('error', err?.message || 'Contraseña incorrecta o error al descifrar.');
    } finally {
      setProcessingUsbCrypto(false);
    }
  };

  // 12. Estudio VisualCorp (Image Converter) & Git Projects Monitor state
  const [imgFormat, setImgFormat] = useState('png');
  const [imgMaxWidth, setImgMaxWidth] = useState(0);
  const [convertingImg, setConvertingImg] = useState(false);
  const [convertedImgResult, setConvertedImgResult] = useState(null);

  const [gitProjects, setGitProjects] = useState(() =>
    Array.isArray(state?.gitProjects) ? state.gitProjects : []
  );
  const [scanningGit, setScanningGit] = useState(false);
  const [gitMessages, setGitMessages] = useState({});
  const [pushingRepoPath, setPushingRepoPath] = useState('');
  const [lastGitOutput, setLastGitOutput] = useState(null);

  const handlePickAndConvertImage = async () => {
    if (!api?.pickAndConvertImage) {
      flash?.('error', 'El conversor de imágenes no está disponible.');
      return;
    }
    setConvertingImg(true);
    try {
      const res = await api.pickAndConvertImage({
        outputFormat: imgFormat,
        maxWidth: Number(imgMaxWidth) || 0
      });
      if (res?.canceled) {
        setConvertingImg(false);
        return;
      }
      const out = res?.result || res;
      if (out?.outputPath) {
        setConvertedImgResult({
          outputPath: out.outputPath,
          size: Number(out.size || 0),
          format: imgFormat.toUpperCase()
        });
        flash?.('ok', `🎨 Imagen convertida a ${imgFormat.toUpperCase()}: ${out.outputPath}`);
      }
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo convertir la imagen.');
    } finally {
      setConvertingImg(false);
    }
  };

  const handleScanGitProjects = useCallback(async (silent = false) => {
    if (!api?.scanGitProjects) {
      if (!silent) flash?.('error', 'El monitor de proyectos Git no está disponible.');
      return;
    }
    setScanningGit(true);
    try {
      const res = await api.scanGitProjects();
      const repos = Array.isArray(res)
        ? res
        : Array.isArray(res?.projects)
          ? res.projects
          : Array.isArray(res?.repos)
            ? res.repos
            : [];
      setGitProjects(repos);
      if (!silent) {
        flash?.('ok', `Monitor Git actualizado: ${repos.length} repositorios encontrados.`);
      }
    } catch (err) {
      if (!silent) {
        flash?.('error', err?.message || 'Error al escanear repositorios Git.');
      }
    } finally {
      setScanningGit(false);
    }
  }, [api, flash]);

  useEffect(() => {
    if (activeSection === 'studio' && gitProjects.length === 0) {
      handleScanGitProjects(true);
    }
  }, [activeSection, gitProjects.length, handleScanGitProjects]);

  const handleGitQuickCommitPush = async (repo) => {
    if (!api?.gitQuickCommitPush) {
      flash?.('error', 'La función Commit + Push rápido no está disponible.');
      return;
    }
    const msg =
      (gitMessages[repo.path] ?? 'chore: actualizacion rapida desde Esteban Cloud').trim() ||
      'chore: actualizacion rapida desde Esteban Cloud';
    setPushingRepoPath(repo.path);
    try {
      const res = await api.gitQuickCommitPush({
        repoDir: repo.path,
        message: msg
      });
      const out = res?.result || res || {};
      setLastGitOutput({
        repoName: repo.name,
        ok: out.ok !== false,
        output: out.output || 'Commit + Push finalizado.'
      });
      if (out.ok !== false) {
        flash?.('ok', `🚀 Commit + Push completado en ${repo.name}.`);
      } else {
        flash?.('error', `Git reportó un aviso en ${repo.name}. Revisa la salida.`);
      }
      await handleScanGitProjects(true);
    } catch (err) {
      flash?.('error', err?.message || `No se pudo hacer Commit + Push en ${repo.name}.`);
    } finally {
      setPushingRepoPath('');
    }
  };

  const showSection = (id) => activeSection === 'all' || activeSection === id;

  return (
    <>
      {/* 1. Header & Quick System Bar */}
      <div className="page-head">
        <div>
          <h1>Centro de Herramientas y Utilidades de Red</h1>
          <p>
            Bóveda rápida de claves visibles, sincronizador de carpetas, portapapeles compartido en malla, diagnóstico de puertos/RDP/SMB y buscador global.
          </p>
        </div>
        <div className="row">
          <button
            type="button"
            className={`btn ${keepAwakeLocal ? 'btn-primary' : ''}`}
            onClick={handleToggleKeepAwake}
            disabled={togglingAwake}
            title="Evita que Windows suspenda el equipo mientras transfieres archivos o usas servidores remotos"
          >
            <span>{keepAwakeLocal ? '☕ Modo Activo (No suspender)' : '☕ Activar Modo Despierto'}</span>
          </button>
        </div>
      </div>

      {/* 2. Sub-navigation pills */}
      <div className="row" style={{ gap: 8 }}>
        {SUB_TABS.map((tab) => {
          const isActive = activeSection === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              className={`btn btn-sm ${isActive ? 'btn-primary' : ''}`}
              onClick={() => setActiveSection(tab.id)}
            >
              {tab.label}
              {tab.id === 'keys' && (
                <span
                  className="badge"
                  style={{
                    padding: '1px 6px',
                    fontSize: 10.5,
                    background: isActive ? 'rgba(5, 17, 31, 0.25)' : undefined,
                    color: isActive ? '#05111f' : undefined
                  }}
                >
                  {detectedKeys.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 3. Section 1 — Bóveda Visible de Claves y Conexión / Escritorio Remoto 1-Clic */}
      {showSection('keys') && (
        <div className="card hero-card">
          <div className="between">
            <div>
              <h2>🔑 Bóveda Visible de Claves y Conexión / Escritorio Remoto 1-Clic</h2>
              <p className="muted" style={{ margin: '4px 0 0' }}>
                Todas tus llaves detectadas en este equipo, pendrives USB y carpetas de proyecto con su frase de paso visible, copia rápida y conexión inmediata.
              </p>
            </div>
            <span className="badge accent">
              <KeyRound size={12} /> {detectedKeys.length} {detectedKeys.length === 1 ? 'llave detectada' : 'llaves detectadas'}
            </span>
          </div>

          {detectedKeys.length === 0 ? (
            <div className="step-card">
              <div className="between">
                <div>
                  <strong>No se detectaron archivos de llave (.ec-key.json) todavía</strong>
                  <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
                    Genera una llave TOTAL desde la pestaña de Llaves USB o inserta tu pendrive con Esteban-Cloud-Kit.
                  </div>
                </div>
                {onOpenTab && (
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => onOpenTab('keys')}>
                    Ir a Llaves USB
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="grid-2">
              {detectedKeys.map((k, idx) => {
                const keyId = k.keyId || `key-${idx}`;
                const isHidden = Boolean(hiddenPassMap[keyId]);
                const currentPass = getKeyPassphrase(k);
                const hostIp = k.tailscaleIp || k.lanIp || '';
                const locations = Array.isArray(k.locations) && k.locations.length > 0
                  ? k.locations.join(' · ')
                  : k.primaryPath || 'Almacenamiento local';
                const isTotal = k.isTotal !== false;

                return (
                  <div key={keyId} className="card" style={{ background: 'rgba(11, 16, 26, 0.78)' }}>
                    <div className="between" style={{ alignItems: 'flex-start' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        <div className="row" style={{ gap: 7 }}>
                          <strong style={{ fontSize: 15 }}>{k.label || k.nodeName || 'Llave de Acceso'}</strong>
                          <span className={`badge ${isTotal ? 'ok' : 'accent'}`}>
                            {isTotal ? 'TOTAL · Todas las carpetas (RW)' : 'Acceso personalizado'}
                          </span>
                          {k.isLocalHostKey && (
                            <span className="badge accent">Anfitrión local</span>
                          )}
                        </div>
                        <div className="row muted mono" style={{ fontSize: 12, gap: 8 }}>
                          <span>Nodo: <strong style={{ color: 'var(--text)' }}>{k.nodeName || 'Sin nodo'}</strong></span>
                          <span>· ID: {keyId}</span>
                          {hostIp && <span>· IP: {hostIp}:{k.port || 4789}</span>}
                        </div>
                      </div>
                    </div>

                    <div className="muted" style={{ fontSize: 12 }}>
                      📍 Ubicaciones: <span className="mono" style={{ color: 'var(--text)' }}>{locations}</span>
                    </div>

                    {/* Visible Passphrase Box */}
                    <div className="field">
                      <label>Clave / Frase de paso visible (para desbloqueo automático)</label>
                      <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                        <div className="input-wrap" style={{ flex: 1 }}>
                          <input
                            type={isHidden ? 'password' : 'text'}
                            className="mono"
                            value={currentPass}
                            onChange={(e) =>
                              setPassEdits((prev) => ({ ...prev, [keyId]: e.target.value }))
                            }
                            placeholder="Escribe o guarda aquí la frase de paso de esta llave..."
                          />
                          <button
                            type="button"
                            className="input-eye"
                            onClick={() =>
                              setHiddenPassMap((prev) => ({ ...prev, [keyId]: !prev[keyId] }))
                            }
                            title={isHidden ? 'Mostrar clave' : 'Ocultar clave'}
                          >
                            {isHidden ? <Eye size={15} /> : <EyeOff size={15} />}
                          </button>
                        </div>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => handleCopyText(currentPass, `Clave de ${k.label || k.nodeName} copiada.`)}
                          disabled={!currentPass}
                        >
                          <Copy size={13} /> Copiar clave
                        </button>
                        {api?.saveKeyPassphrase && (
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => handleSaveKeyPassphrase(k)}
                            disabled={savingKeyId === keyId}
                            title="Guardar frase de paso en la bóveda local"
                          >
                            <Save size={13} /> {savingKeyId === keyId ? '...' : 'Guardar'}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="row" style={{ gap: 7, marginTop: 2 }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() => onQuickConnectKey && onQuickConnectKey({ ...k, passphrase: currentPass })}
                      >
                        ⚡ Conectar ahora en 1 clic
                      </button>

                      {k.clipboardString && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() =>
                            handleCopyText(
                              k.clipboardString,
                              `Texto mágico ECLOUD1: de ${k.label || k.nodeName} copiado.`
                            )
                          }
                        >
                          <Copy size={13} /> Copiar ECLOUD1:
                        </button>
                      )}

                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => handleSyncKeyToUsb(k)}
                        disabled={syncingKeyId === keyId}
                      >
                        <Usb size={13} /> {syncingKeyId === keyId ? 'Sincronizando...' : 'Sincronizar a todos los USB'}
                      </button>

                      {hostIp && (
                        <>
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => handleLaunchRdp(hostIp)}
                          >
                            🖥️ Escritorio Remoto (RDP)
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => handleOpenSmb(hostIp)}
                          >
                            📂 Abrir Red SMB (\\{hostIp})
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Section — ⚡ AirDrop Instantáneo entre PCs y Celular */}
      {showSection('airdrop') && (
        <div className="card">
          <div className="between">
            <div>
              <h2>⚡ AirDrop Instantáneo entre PCs y Celular</h2>
              <p className="muted" style={{ margin: '4px 0 0' }}>
                Envía archivos en 1 clic directamente a la carpeta <span className="mono">Downloads\EstebanCloud-AirDrop</span> de cualquier PC conectada en tu malla Tailscale o LAN.
              </p>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn btn-sm"
                onClick={handleOpenAirDropFolder}
              >
                <FolderOpen size={14} /> Abrir carpeta local EstebanCloud-AirDrop
              </button>
              <span className="badge accent">Transferencia directa P2P</span>
            </div>
          </div>

          <div className="between" style={{ gap: 12, alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Seleccionar PC destino para AirDrop</label>
              <div className="row" style={{ gap: 8 }}>
                {meshPeerOptions.map((peer) => {
                  const selected = airDropPeerUrl === peer.peerUrl;
                  return (
                    <button
                      key={peer.id}
                      type="button"
                      className={`btn btn-sm ${selected ? 'btn-primary' : ''}`}
                      onClick={() => setAirDropPeerUrl(peer.peerUrl)}
                    >
                      <Monitor size={13} />
                      <span>{peer.label}</span>
                      <span className="mono" style={{ fontSize: 11, opacity: 0.85 }}>
                        ({peer.host}:{peer.port})
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="field" style={{ minWidth: 260 }}>
              <label>URL destino personalizada (opcional)</label>
              <input
                type="text"
                className="mono"
                value={airDropPeerUrl}
                onChange={(e) => setAirDropPeerUrl(e.target.value)}
                placeholder="Vacío = Esta PC · o http://100.x.y.z:4789"
              />
            </div>

            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSendAirDropFiles}
              disabled={sendingAirDrop}
            >
              {sendingAirDrop
                ? '⚡ Enviando archivos por AirDrop...'
                : '⚡ Elegir y Enviar Archivos por AirDrop'}
            </button>
          </div>

          {(airDropResults.length > 0 || Array.isArray(state?.airDropHistory) && state.airDropHistory.length > 0) && (
            <div className="list" style={{ marginTop: 4 }}>
              {(airDropResults.length > 0 ? airDropResults : state.airDropHistory).slice(0, 8).map((item, i) => (
                <div key={`${item.savedPath || item.fileName || i}-${i}`} className="list-item">
                  <div className="row" style={{ gap: 8 }}>
                    <CheckCircle2 size={15} color="var(--ok)" />
                    <strong>{item.fileName || 'Archivo AirDrop'}</strong>
                    {item.size != null && <span className="badge accent">{fmtBytes(item.size)}</span>}
                    {item.senderNode && <span className="badge">De: {item.senderNode}</span>}
                    {item.savedPath && (
                      <span className="muted mono" style={{ fontSize: 11.5 }}>{item.savedPath}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={handleOpenAirDropFolder}
                  >
                    <FolderOpen size={13} /> Ver en carpeta
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Section — 🖥️ Control y Pantalla Remota (Monitor en Vivo + Procesos + Energía) */}
      {showSection('remote') && (
        <div className="card">
          <div className="between">
            <div>
              <h2>🖥️ Control y Pantalla Remota (Monitor en Vivo + Procesos + Energía)</h2>
              <p className="muted" style={{ margin: '4px 0 0' }}>
                Visualiza la pantalla en vivo de cualquier PC, inspecciona o cierra procesos que consuman mucha RAM/CPU y ejecuta acciones rápidas de energía o mantenimiento.
              </p>
            </div>
            <span className="badge accent">Telemetría y Control Remoto</span>
          </div>

          {/* Target PC Selector */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>
              Equipo objetivo:
            </span>
            <div className="row" style={{ gap: 8 }}>
              {meshPeerOptions.map((peer) => {
                const selected = remoteTargetUrl === peer.peerUrl;
                return (
                  <button
                    key={peer.id}
                    type="button"
                    className={`btn btn-sm ${selected ? 'btn-primary' : ''}`}
                    onClick={() => setRemoteTargetUrl(peer.peerUrl)}
                  >
                    <Monitor size={13} />
                    <span>{peer.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Screen & Processes & Quick Actions bar */}
          <div className="between" style={{ gap: 10 }}>
            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => handleFetchRemoteScreen(false)}
                disabled={loadingScreen}
              >
                {loadingScreen ? '📸 Capturando pantalla...' : '📸 Ver Pantalla en Vivo'}
              </button>
              <label className="checkbox-row" style={{ marginLeft: 4 }}>
                <input
                  type="checkbox"
                  checked={liveScreenStream}
                  onChange={(e) => setLiveScreenStream(e.target.checked)}
                />
                <span>Auto-refrescar cada 3.5s</span>
              </label>
              <button
                type="button"
                className="btn"
                onClick={handleFetchRemoteProcesses}
                disabled={loadingProcesses}
              >
                {loadingProcesses ? '📋 Cargando procesos...' : '📋 Ver Procesos Top CPU/RAM'}
              </button>
            </div>

            <div className="row" style={{ gap: 7 }}>
              <button
                type="button"
                className="btn btn-sm"
                disabled={runningSysAction === 'lock-screen'}
                onClick={() =>
                  handleQuickSystemAction('lock-screen', {}, '🔒 Pantalla bloqueada en el equipo objetivo.')
                }
              >
                🔒 Bloquear pantalla
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={runningSysAction === 'empty-recycle-bin'}
                onClick={() =>
                  handleQuickSystemAction('empty-recycle-bin', {}, '🗑️ Papelera de reciclaje vaciada.')
                }
              >
                🗑️ Vaciar papelera
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={runningSysAction === 'clear-temp'}
                onClick={() =>
                  handleQuickSystemAction('clear-temp', {}, '🧹 Archivos temporales limpiados.')
                }
              >
                🧹 Limpiar temporales
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={runningSysAction === 'restart-explorer'}
                onClick={() =>
                  handleQuickSystemAction('restart-explorer', {}, '🔄 Explorador de Windows reiniciado.')
                }
              >
                🔄 Reiniciar Explorer
              </button>
            </div>
          </div>

          {/* Wake-on-LAN Bar */}
          <div className="between" style={{ gap: 10 }}>
            <div className="row" style={{ gap: 8, flex: 1 }}>
              <span className="muted" style={{ fontSize: 12.5 }}>
                Dirección MAC para Wake-on-LAN:
              </span>
              <input
                type="text"
                className="mono"
                style={{ maxWidth: 220 }}
                value={wolMac}
                onChange={(e) => setWolMac(e.target.value)}
                placeholder="AA:BB:CC:DD:EE:FF"
              />
              <button
                type="button"
                className="btn btn-sm"
                disabled={runningSysAction === 'wake-on-lan'}
                onClick={() =>
                  handleQuickSystemAction(
                    'wake-on-lan',
                    { mac: wolMac.trim() },
                    `⚡ Paquete mágico Wake-on-LAN enviado a ${wolMac.trim()}.`
                  )
                }
              >
                ⚡ Despertar PC por red (Wake-on-LAN)
              </button>
            </div>
          </div>

          {/* Live Screen Preview */}
          {remoteScreen?.dataUrl && (
            <div
              style={{
                padding: 12,
                borderRadius: 12,
                background: 'rgba(8, 12, 20, 0.85)',
                border: '1px solid var(--border-strong)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8
              }}
            >
              <div className="between">
                <div className="row" style={{ gap: 8 }}>
                  <strong>Vista en Vivo del Escritorio</strong>
                  <span className="badge accent">
                    Capturado: {fmtDateTime(remoteScreen.capturedAt)}
                  </span>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => handleFetchRemoteScreen(false)}
                  >
                    <RefreshCw size={13} /> Actualizar captura
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      setLiveScreenStream(false);
                      setRemoteScreen(null);
                    }}
                  >
                    Cerrar vista
                  </button>
                </div>
              </div>
              <img
                src={remoteScreen.dataUrl}
                alt="Captura remota"
                style={{
                  width: '100%',
                  maxHeight: 520,
                  objectFit: 'contain',
                  borderRadius: 8,
                  border: '1px solid var(--border)'
                }}
              />
            </div>
          )}

          {/* Top Processes List */}
          {remoteProcesses.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="between">
                <strong style={{ fontSize: 13.5 }}>
                  Top Procesos por Uso de Memoria / CPU ({remoteProcesses.length})
                </strong>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setRemoteProcesses([])}
                >
                  Ocultar lista
                </button>
              </div>
              <div className="list">
                {remoteProcesses.map((proc) => (
                  <div key={proc.pid} className="list-item">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <div className="row" style={{ gap: 8 }}>
                        <strong>{proc.name}</strong>
                        <span className="badge mono">PID {proc.pid}</span>
                        <span className="badge accent">{proc.memoryMB} MB RAM</span>
                        {proc.cpuSeconds > 0 && (
                          <span className="badge">{proc.cpuSeconds}s CPU</span>
                        )}
                      </div>
                      {proc.windowTitle && (
                        <div className="muted" style={{ fontSize: 12 }}>
                          🪟 {proc.windowTitle}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      disabled={killingPid === proc.pid}
                      onClick={() => handleKillRemoteProcess(proc.pid, proc.name)}
                    >
                      <Trash2 size={13} />
                      {killingPid === proc.pid ? 'Terminando...' : 'Terminar proceso'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Section — 🔐 Bóveda Secreta Cifrada (Esteban Vault · AES-256-GCM) & Cifrador de Archivos USB */}
      {showSection('vault') && (
        <div className="card">
          <div className="between">
            <div>
              <h2>🔐 Bóveda Secreta Cifrada (Esteban Vault · AES-256-GCM) y Cifrador de Archivos USB</h2>
              <p className="muted" style={{ margin: '4px 0 0' }}>
                Almacena contraseñas, licencias, números de serie, tokens API y notas privadas cifradas en disco con AES-256-GCM, o cifra cualquier archivo para pendrive USB (<span className="mono">.ecloudenc</span>).
              </p>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn btn-sm"
                onClick={handleVaultSyncPeers}
                disabled={syncingVault}
              >
                <RefreshCw size={13} />
                {syncingVault ? 'Sincronizando bóveda...' : 'Sincronizar Bóveda entre PCs'}
              </button>
              <span className="badge ok">AES-256-GCM + PBKDF2</span>
            </div>
          </div>

          <div className="grid-2" style={{ alignItems: 'start' }}>
            {/* Left column: Vault Create / Edit Form */}
            <form
              onSubmit={handleVaultUpsert}
              className="card"
              style={{ background: 'rgba(11, 16, 26, 0.78)', gap: 10 }}
            >
              <strong>
                {vaultForm.id ? '✏️ Editar secreto en bóveda' : '➕ Guardar nueva clave, licencia o nota cifrada'}
              </strong>
              <div className="grid-2">
                <div className="field">
                  <label>Título / Servicio</label>
                  <input
                    type="text"
                    value={vaultForm.title}
                    onChange={(e) => setVaultForm((p) => ({ ...p, title: e.target.value }))}
                    placeholder="Ej: Licencia Windows 11 Pro / API OpenAI"
                  />
                </div>
                <div className="field">
                  <label>Categoría</label>
                  <select
                    value={vaultForm.category}
                    onChange={(e) => setVaultForm((p) => ({ ...p, category: e.target.value }))}
                  >
                    <option value="password">Contraseña / Login</option>
                    <option value="license">Licencia / Serial</option>
                    <option value="api-key">Token / API Key</option>
                    <option value="note">Nota Privada</option>
                    <option value="general">General</option>
                  </select>
                </div>
              </div>

              <div className="grid-2">
                <div className="field">
                  <label>Usuario / Correo / ID (opcional)</label>
                  <input
                    type="text"
                    value={vaultForm.username}
                    onChange={(e) => setVaultForm((p) => ({ ...p, username: e.target.value }))}
                    placeholder="Ej: esteban@visualcorp.com"
                  />
                </div>
                <div className="field">
                  <label>Secreto / Contraseña / Serial (cifrado AES-256-GCM)</label>
                  <input
                    type="text"
                    className="mono"
                    value={vaultForm.secret}
                    onChange={(e) => setVaultForm((p) => ({ ...p, secret: e.target.value }))}
                    placeholder="Clave, serial o token secreto..."
                  />
                </div>
              </div>

              <div className="field">
                <label>Notas privadas adicionales (cifradas en reposo)</label>
                <textarea
                  rows={2}
                  value={vaultForm.notes}
                  onChange={(e) => setVaultForm((p) => ({ ...p, notes: e.target.value }))}
                  placeholder="Instrucciones, códigos de recuperación o notas confidenciales..."
                />
              </div>

              <div className="between">
                {vaultForm.id ? (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() =>
                      setVaultForm({
                        id: '',
                        title: '',
                        category: 'password',
                        username: '',
                        secret: '',
                        notes: ''
                      })
                    }
                  >
                    Cancelar edición
                  </button>
                ) : (
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    Cifrado autenticado en disco local
                  </span>
                )}
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={loadingVault}
                >
                  <Save size={14} />
                  {vaultForm.id ? 'Actualizar en Bóveda' : 'Guardar en Bóveda Cifrada'}
                </button>
              </div>
            </form>

            {/* Right column: USB File Encryptor / Decryptor (.ecloudenc) */}
            <div
              className="card"
              style={{ background: 'rgba(11, 16, 26, 0.78)', gap: 10 }}
            >
              <strong>🛡️ Cifrador Militar de Archivos para Pendrive USB (.ecloudenc)</strong>
              <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
                Protege cualquier documento, ZIP, base de datos o contrato con <span className="mono">PBKDF2-SHA256 (100,000 iteraciones) + AES-256-GCM</span> antes de llevarlo en tu USB.
              </p>

              <div className="field">
                <label>Contraseña de cifrado / descifrado para el archivo</label>
                <input
                  type="text"
                  className="mono"
                  value={usbFilePassphrase}
                  onChange={(e) => setUsbFilePassphrase(e.target.value)}
                  placeholder="Escribe la contraseña para proteger o abrir el archivo .ecloudenc..."
                />
              </div>

              <div className="row" style={{ gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleEncryptUsbFile}
                  disabled={processingUsbCrypto}
                >
                  🔒 Cifrar archivo para USB (.ecloudenc)
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={handleDecryptUsbFile}
                  disabled={processingUsbCrypto}
                >
                  🔓 Descifrar archivo .ecloudenc
                </button>
              </div>

              {lastUsbCryptoResult && (
                <div className="banner ok" style={{ marginTop: 4 }}>
                  <div className="between">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <strong>
                        {lastUsbCryptoResult.mode === 'encrypt'
                          ? '🔒 Archivo cifrado correctamente'
                          : '🔓 Archivo descifrado correctamente'}
                      </strong>
                      <span className="mono" style={{ fontSize: 11.5, wordBreak: 'break-all' }}>
                        {lastUsbCryptoResult.outputPath} ({fmtBytes(lastUsbCryptoResult.size)})
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() =>
                        handleOpenFolderInExplorer(getParentFolder(lastUsbCryptoResult.outputPath))
                      }
                    >
                      <FolderOpen size={13} /> Abrir carpeta
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Vault Items List */}
          {vaultItems.length === 0 ? (
            <div className="muted" style={{ fontSize: 12.5 }}>
              Aún no hay elementos guardados en Esteban Vault. Usa el formulario superior para registrar tu primera clave, licencia o nota cifrada.
            </div>
          ) : (
            <div className="list" style={{ marginTop: 6 }}>
              {vaultItems.map((item) => {
                const isRevealed = Boolean(visibleVaultSecrets[item.id]);
                return (
                  <div key={item.id} className="list-item" style={{ alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                      <div className="row" style={{ gap: 8 }}>
                        <strong>{item.title}</strong>
                        <span className="badge accent">{item.category || 'general'}</span>
                        {item.username && (
                          <span className="badge mono">{item.username}</span>
                        )}
                        {item.updatedAt && (
                          <span className="muted" style={{ fontSize: 11.5 }}>
                            {fmtDateTime(item.updatedAt)}
                          </span>
                        )}
                      </div>

                      {item.secret && (
                        <div className="row" style={{ gap: 8 }}>
                          <span className="muted" style={{ fontSize: 12 }}>Secreto:</span>
                          <code className="mono" style={{ fontSize: 12.5 }}>
                            {isRevealed ? item.secret : '••••••••••••••••'}
                          </code>
                          <button
                            type="button"
                            className="btn btn-sm"
                            style={{ padding: '2px 7px', fontSize: 11 }}
                            onClick={() =>
                              setVisibleVaultSecrets((p) => ({ ...p, [item.id]: !p[item.id] }))
                            }
                          >
                            {isRevealed ? <EyeOff size={12} /> : <Eye size={12} />}
                            {isRevealed ? 'Ocultar' : 'Mostrar'}
                          </button>
                        </div>
                      )}

                      {item.notes && (
                        <div className="muted" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
                          📝 {item.notes}
                        </div>
                      )}
                    </div>

                    <div className="row" style={{ gap: 6 }}>
                      {item.secret && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() =>
                            handleCopyText(item.secret, `Secreto de "${item.title}" copiado.`)
                          }
                        >
                          <Copy size={13} /> Copiar secreto
                        </button>
                      )}
                      {item.username && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() =>
                            handleCopyText(item.username, `Usuario de "${item.title}" copiado.`)
                          }
                        >
                          <Copy size={13} /> Usuario
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() =>
                          setVaultForm({
                            id: item.id,
                            title: item.title || '',
                            category: item.category || 'general',
                            username: item.username || '',
                            secret: item.secret || '',
                            notes: item.notes || ''
                          })
                        }
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => handleVaultDelete(item.id)}
                      >
                        <Trash2 size={13} /> Eliminar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Section — 🎨 Estudio VisualCorp (Conversor de Imágenes) & Monitor de Proyectos Git */}
      {showSection('studio') && (
        <div className="card">
          <div className="between">
            <div>
              <h2>🎨 Estudio VisualCorp (Conversor de Imágenes) y Monitor de Proyectos Git</h2>
              <p className="muted" style={{ margin: '4px 0 0' }}>
                Convierte y redimensiona imágenes en 1 clic (<span className="mono">PNG / JPG / BMP / ICO</span>) y supervisa el estado Git de todos tus proyectos en <span className="mono">MY APPS</span> y <span className="mono">E:\CODE</span>.
              </p>
            </div>
            <span className="badge accent">Productividad VisualCorp & Dev</span>
          </div>

          {/* 1-Click Image Converter */}
          <div
            className="card"
            style={{ background: 'rgba(11, 16, 26, 0.78)', gap: 10 }}
          >
            <div className="between">
              <strong>🖼️ Conversor y Redimensionador Rápido de Imágenes (PNG / JPG / BMP / ICO)</strong>
              <span className="badge">Sin perder el archivo original</span>
            </div>

            <div className="between" style={{ gap: 12, alignItems: 'flex-end' }}>
              <div className="row" style={{ gap: 12, flex: 1 }}>
                <div className="field" style={{ minWidth: 160 }}>
                  <label>Formato de salida</label>
                  <select
                    value={imgFormat}
                    onChange={(e) => setImgFormat(e.target.value)}
                  >
                    <option value="png">PNG (Transparente / Alta calidad)</option>
                    <option value="jpg">JPG (Comprimido / Fotos)</option>
                    <option value="ico">ICO (Icono de Windows 256px)</option>
                    <option value="bmp">BMP (Mapa de bits)</option>
                  </select>
                </div>

                <div className="field" style={{ minWidth: 200 }}>
                  <label>Ancho máximo (0 = mantener tamaño original)</label>
                  <input
                    type="number"
                    className="mono"
                    value={imgMaxWidth}
                    onChange={(e) => setImgMaxWidth(Math.max(0, Number(e.target.value) || 0))}
                    placeholder="0 = Original (ej. 1920, 1280, 512)"
                  />
                </div>

                <div className="row" style={{ gap: 6, paddingBottom: 4 }}>
                  {[0, 1920, 1280, 512, 256].map((presetW) => (
                    <button
                      key={presetW}
                      type="button"
                      className={`btn btn-sm ${Number(imgMaxWidth) === presetW ? 'btn-primary' : ''}`}
                      onClick={() => setImgMaxWidth(presetW)}
                    >
                      {presetW === 0 ? 'Original' : `${presetW}px`}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                className="btn btn-primary"
                onClick={handlePickAndConvertImage}
                disabled={convertingImg}
              >
                {convertingImg
                  ? '🎨 Convirtiendo imagen...'
                  : `🎨 Elegir imagen y convertir a ${imgFormat.toUpperCase()}`}
              </button>
            </div>

            {convertedImgResult && (
              <div className="banner ok">
                <div className="between">
                  <div className="row" style={{ gap: 8 }}>
                    <CheckCircle2 size={16} />
                    <span>
                      <strong>Imagen convertida ({convertedImgResult.format}):</strong>{' '}
                      <span className="mono">{convertedImgResult.outputPath}</span> (
                      {fmtBytes(convertedImgResult.size)})
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() =>
                      handleOpenFolderInExplorer(getParentFolder(convertedImgResult.outputPath))
                    }
                  >
                    <FolderOpen size={13} /> Abrir carpeta
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Git Projects Monitor */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="between">
              <div>
                <strong>🚀 Monitor de Proyectos Git (MY APPS & E:\CODE)</strong>
                <div className="muted" style={{ fontSize: 12 }}>
                  Revisa qué proyectos tienen cambios sin subir y haz Commit + Push a GitHub en 1 clic.
                </div>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => handleScanGitProjects(false)}
                disabled={scanningGit}
              >
                <RefreshCw size={13} />
                {scanningGit ? 'Escaneando repositorios...' : 'Escanear Proyectos Git'}
              </button>
            </div>

            {lastGitOutput && (
              <div className={`banner ${lastGitOutput.ok ? 'ok' : 'warn'}`}>
                <div className="between">
                  <div>
                    <strong>Resultado Git ({lastGitOutput.repoName}):</strong>
                    <div className="mono" style={{ fontSize: 11.5, whiteSpace: 'pre-wrap', marginTop: 3 }}>
                      {lastGitOutput.output}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setLastGitOutput(null)}
                  >
                    Cerrar
                  </button>
                </div>
              </div>
            )}

            {gitProjects.length === 0 ? (
              <div className="muted" style={{ fontSize: 12.5 }}>
                Haz clic en &ldquo;Escanear Proyectos Git&rdquo; para listar todos tus repositorios en MY APPS y E:\CODE.
              </div>
            ) : (
              <div className="list">
                {gitProjects.map((repo) => {
                  const isDirty = Number(repo.dirtyCount || 0) > 0;
                  const commitMsg =
                    gitMessages[repo.path] ?? 'chore: actualizacion rapida desde Esteban Cloud';
                  return (
                    <div
                      key={repo.path}
                      className="list-item"
                      style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}
                    >
                      <div className="between">
                        <div className="row" style={{ gap: 8 }}>
                          <strong style={{ fontSize: 14 }}>{repo.name}</strong>
                          <span className="badge accent">🌿 {repo.branch || 'main'}</span>
                          <span className={`badge ${isDirty ? 'warn' : 'ok'}`}>
                            {isDirty
                              ? `${repo.dirtyCount} ${repo.dirtyCount === 1 ? 'cambio pendiente' : 'cambios pendientes'}`
                              : '✓ Limpio'}
                          </span>
                          <span className="muted mono" style={{ fontSize: 11.5 }}>
                            {repo.path}
                          </span>
                        </div>

                        <div className="row" style={{ gap: 6 }}>
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => handleOpenFolderInExplorer(repo.path)}
                          >
                            <FolderOpen size={13} /> Abrir carpeta
                          </button>
                        </div>
                      </div>

                      <div className="between" style={{ gap: 8 }}>
                        <input
                          type="text"
                          className="mono"
                          style={{ flex: 1, fontSize: 12 }}
                          value={commitMsg}
                          onChange={(e) =>
                            setGitMessages((p) => ({ ...p, [repo.path]: e.target.value }))
                          }
                          placeholder="Mensaje de commit..."
                        />
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          disabled={pushingRepoPath === repo.path}
                          onClick={() => handleGitQuickCommitPush(repo)}
                        >
                          {pushingRepoPath === repo.path
                            ? '⏳ Subiendo a GitHub...'
                            : '🚀 Commit + Push a GitHub'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 4. Section 2 — Sincronizador y Respaldo Rápido de Carpetas (Sync Studio) */}
      {showSection('sync') && (
        <div className="card">
          <div className="between">
            <div>
              <h2>🔄 Sincronizador y Respaldo Rápido de Carpetas (Sync Studio)</h2>
              <p className="muted" style={{ margin: '4px 0 0' }}>
                Copia incremental ultrarrápida entre tus carpetas compartidas, proyectos, pendrives USB y discos remotos montados.
              </p>
            </div>
            <span className="badge accent">Copia inteligente por fecha y tamaño</span>
          </div>

          <div className="grid-2">
            {/* Carpeta Origen */}
            <div className="field">
              <label>Carpeta origen</label>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input
                  type="text"
                  className="mono"
                  value={sourceDir}
                  onChange={(e) => setSourceDir(e.target.value)}
                  placeholder="Ej: E:\CODE\ESTEBAN CLOUD"
                />
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => handlePickFolderFor(setSourceDir)}
                >
                  <FolderOpen size={14} /> Examinar
                </button>
              </div>
              <div className="row" style={{ gap: 6, marginTop: 3 }}>
                <span className="muted" style={{ fontSize: 11.5 }}>Presets origen:</span>
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{ padding: '3px 8px', fontSize: 11.5 }}
                  onClick={() => setSourceDir('E:\\CODE\\ESTEBAN CLOUD')}
                >
                  E:\CODE\ESTEBAN CLOUD
                </button>
                {shares.map((sh) => (
                  <button
                    key={sh.id || sh.path}
                    type="button"
                    className="btn btn-sm"
                    style={{ padding: '3px 8px', fontSize: 11.5 }}
                    onClick={() => setSourceDir(sh.path)}
                  >
                    📂 {sh.name || sh.path}
                  </button>
                ))}
              </div>
            </div>

            {/* Carpeta Destino */}
            <div className="field">
              <label>Carpeta destino</label>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input
                  type="text"
                  className="mono"
                  value={targetDir}
                  onChange={(e) => setTargetDir(e.target.value)}
                  placeholder="Ej: F:\Respaldo-Esteban-Cloud o Z:\Backup"
                />
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => handlePickFolderFor(setTargetDir)}
                >
                  <FolderOpen size={14} /> Examinar
                </button>
              </div>
              <div className="row" style={{ gap: 6, marginTop: 3 }}>
                <span className="muted" style={{ fontSize: 11.5 }}>Presets destino:</span>
                {usbDrives.map((u) => {
                  const base = String(u.root || '').replace(/\\$/, '');
                  return (
                    <button
                      key={base}
                      type="button"
                      className="btn btn-sm"
                      style={{ padding: '3px 8px', fontSize: 11.5 }}
                      onClick={() => setTargetDir(`${base}\\Respaldo-Esteban-Cloud`)}
                    >
                      🔌 USB {base} ({u.label || 'Pendrive'})
                    </button>
                  );
                })}
                {mounts.map((m) => {
                  const dl = String(m.driveLetter || '').replace(/\\$/, '');
                  return (
                    <button
                      key={m.id || dl}
                      type="button"
                      className="btn btn-sm"
                      style={{ padding: '3px 8px', fontSize: 11.5 }}
                      onClick={() => setTargetDir(`${dl}\\Respaldo-Esteban-Cloud`)}
                    >
                      ☁️ Disco {dl} ({m.shareName || m.nodeName || 'Remoto'})
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="between" style={{ gap: 12, paddingTop: 4 }}>
            <div className="row" style={{ gap: 14, flex: 1 }}>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={mirrorMode}
                  onChange={(e) => setMirrorMode(e.target.checked)}
                />
                <span>Modo espejo (eliminar en destino lo que ya no exista en origen)</span>
              </label>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={autoWatchSync}
                  onChange={(e) => handleToggleAutoWatchSync(e.target.checked)}
                />
                <span>🔄 Auto-Watch en tiempo real</span>
              </label>

              <div style={{ minWidth: 240, flex: '0 1 300px' }}>
                <input
                  type="text"
                  value={profileLabel}
                  onChange={(e) => setProfileLabel(e.target.value)}
                  placeholder="Nombre opcional para guardar perfil..."
                />
              </div>
            </div>

            <button
              type="button"
              className="btn btn-primary"
              onClick={() => handleRunFolderSync()}
              disabled={syncingFolders}
            >
              {syncingFolders ? '⏳ Sincronizando carpetas...' : '🚀 Sincronizar carpetas ahora'}
            </button>
          </div>

          {lastSyncResult && (
            <div className="banner ok">
              <div className="between">
                <div className="row" style={{ gap: 10 }}>
                  <CheckCircle2 size={16} />
                  <span>
                    <strong>Última sincronización:</strong> {lastSyncResult.filesCopied} archivos copiados (
                    {fmtBytes(lastSyncResult.bytesCopied)}) en {lastSyncResult.durationMs} ms
                    {lastSyncResult.filesDeleted > 0 ? ` · ${lastSyncResult.filesDeleted} eliminados (espejo)` : ''}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => handleOpenFolderInExplorer(lastSyncResult.targetDir)}
                >
                  <FolderOpen size={13} /> Abrir destino
                </button>
              </div>
            </div>
          )}

          {/* Saved Sync Profiles */}
          {syncProfiles.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
              <div className="muted" style={{ fontSize: 12, fontWeight: 600 }}>
                Perfiles de sincronización guardados ({syncProfiles.length})
              </div>
              <div className="list">
                {syncProfiles.map((prof) => (
                  <div key={prof.id || `${prof.sourceDir}-${prof.targetDir}`} className="list-item">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <div className="row" style={{ gap: 8 }}>
                        <strong>{prof.label || 'Perfil de sincronización'}</strong>
                        {prof.mirror && <span className="badge warn">Modo espejo</span>}
                      </div>
                      <div className="muted mono" style={{ fontSize: 12 }}>
                        {prof.sourceDir} → {prof.targetDir}
                      </div>
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        disabled={syncingFolders}
                        onClick={() => {
                          setSourceDir(prof.sourceDir);
                          setTargetDir(prof.targetDir);
                          setMirrorMode(Boolean(prof.mirror));
                          handleRunFolderSync({
                            sourceDir: prof.sourceDir,
                            targetDir: prof.targetDir,
                            mirror: Boolean(prof.mirror),
                            saveProfile: false
                          });
                        }}
                      >
                        <Play size={13} /> Ejecutar
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => handleDeleteSyncProfile(prof.id)}
                      >
                        <Trash2 size={13} /> Eliminar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 5. Section 3 — Portapapeles Compartido entre Computadoras (Mesh Clipboard) */}
      {showSection('clipboard') && (
        <div className="card">
          <div className="between">
            <div>
              <h2>📋 Portapapeles Compartido entre Computadoras (Mesh Clipboard)</h2>
              <p className="muted" style={{ margin: '4px 0 0' }}>
                Envía texto, enlaces, rutas o comandos directamente al portapapeles de todas las PCs conectadas en tu malla Tailscale.
              </p>
            </div>
            <span className="badge accent">
              {clipboardHistory.length} {clipboardHistory.length === 1 ? 'elemento en historial' : 'elementos en historial'}
            </span>
          </div>

          <div className="field">
            <label>Texto, enlace, comando o fragmento de código a compartir</label>
            <textarea
              rows={3}
              className="mono"
              value={clipboardText}
              onChange={(e) => setClipboardText(e.target.value)}
              placeholder="Escribe o pega aquí cualquier texto, URL, clave o comando para enviarlo al portapapeles de tus otras computadoras..."
            />
          </div>

          <div className="between">
            <button
              type="button"
              className="btn btn-sm"
              onClick={handlePasteFromSystemClipboard}
            >
              <Copy size={13} /> Pegar de mi portapapeles actual
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handlePushMeshClipboard}
              disabled={sendingClipboard || !clipboardText.trim()}
            >
              {sendingClipboard
                ? '📡 Enviando a la malla...'
                : '📡 Enviar al portapapeles de todas las PCs conectadas'}
            </button>
          </div>

          {clipboardHistory.length === 0 ? (
            <div className="muted" style={{ fontSize: 12.5 }}>
              Aún no hay recortes en el historial compartido. Todo lo que envíes o recibas de otras PCs aparecerá aquí.
            </div>
          ) : (
            <div className="list" style={{ marginTop: 4 }}>
              {clipboardHistory.map((item, idx) => (
                <div key={item.id || idx} className="list-item" style={{ alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: 1, minWidth: 0 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <span className="badge accent">{item.senderNode || config?.nodeName || 'Nodo'}</span>
                      <span className="muted" style={{ fontSize: 11.5 }}>
                        {fmtDateTime(item.createdAt || item.timestamp)}
                      </span>
                    </div>
                    <div
                      className="mono"
                      style={{
                        fontSize: 12.5,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        maxHeight: 110,
                        overflowY: 'auto',
                        background: 'rgba(10, 15, 24, 0.72)',
                        padding: '8px 10px',
                        borderRadius: 8,
                        border: '1px solid var(--border)'
                      }}
                    >
                      {item.text}
                    </div>
                  </div>
                  <div className="row" style={{ gap: 6, flexShrink: 0 }}>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => handleCopyText(item.text, 'Recorte copiado al portapapeles.')}
                    >
                      <Copy size={13} /> Copiar
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => handleDeleteClipboardItem(item.id)}
                    >
                      <Trash2 size={13} /> Eliminar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 6. Section 4 — Doctor de Red, Puertos y Accesos Remotos (Mesh Doctor) */}
      {showSection('doctor') && (
        <div className="card">
          <div className="between">
            <div>
              <h2>🩺 Doctor de Red, Puertos y Accesos Remotos (Mesh Doctor)</h2>
              <p className="muted" style={{ margin: '4px 0 0' }}>
                Verifica al instante los puertos de Esteban Cloud (4789), SMB (445), Escritorio Remoto RDP (3389) y SSH (22), latencia y versión remota.
              </p>
            </div>
            <span className="badge accent">Diagnóstico TCP + HTTP en vivo</span>
          </div>

          {/* Quick target selectors */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>
              Seleccionar equipo rápido:
            </span>
            <div className="row" style={{ gap: 7 }}>
              {doctorTargets.map((t) => {
                const selected = doctorHost === t.host;
                return (
                  <button
                    key={t.host}
                    type="button"
                    className={`btn btn-sm ${selected ? 'btn-primary' : ''}`}
                    onClick={() => {
                      setDoctorHost(t.host);
                      setDoctorPort(t.port || 4789);
                      handleRunDiagnosis(t.host, t.port || 4789);
                    }}
                  >
                    <Monitor size={13} />
                    <span>{t.label}</span>
                    <span className="mono" style={{ fontSize: 11, opacity: 0.85 }}>({t.host})</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom host & port input + actions */}
          <div className="between" style={{ gap: 12, alignItems: 'flex-end' }}>
            <div className="row" style={{ gap: 10, flex: 1 }}>
              <div className="field" style={{ flex: '1 1 240px' }}>
                <label>Dirección IP Tailscale / LAN o Host</label>
                <input
                  type="text"
                  className="mono"
                  value={doctorHost}
                  onChange={(e) => setDoctorHost(e.target.value)}
                  placeholder="Ej: 100.83.249.39 o 192.168.1.50"
                />
              </div>
              <div className="field" style={{ width: 130 }}>
                <label>Puerto Esteban Cloud</label>
                <input
                  type="number"
                  className="mono"
                  value={doctorPort}
                  onChange={(e) => setDoctorPort(Number(e.target.value) || 4789)}
                />
              </div>
            </div>

            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => handleRunDiagnosis()}
                disabled={diagnosing}
              >
                {diagnosing ? '🩺 Diagnosticando...' : '🩺 Diagnosticar puertos y conexión'}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => handleLaunchRdp(doctorHost)}
                disabled={!doctorHost.trim()}
              >
                🖥️ Abrir Escritorio Remoto (mstsc)
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => handleOpenSmb(doctorHost)}
                disabled={!doctorHost.trim()}
              >
                📂 Abrir Carpetas SMB (\\{doctorHost || 'IP'})
              </button>
            </div>
          </div>

          {/* Diagnostic Result Table */}
          {diagResult && (
            <div
              style={{
                padding: '14px 16px',
                borderRadius: 13,
                background: 'rgba(10, 15, 24, 0.78)',
                border: '1px solid var(--border-strong)',
                display: 'flex',
                flexDirection: 'column',
                gap: 12
              }}
            >
              <div className="between">
                <div className="row" style={{ gap: 8 }}>
                  <Server size={16} color="var(--accent)" />
                  <strong style={{ fontSize: 14.5 }}>
                    Resultado para {diagResult.nodeName ? `${diagResult.nodeName} (${diagResult.host})` : diagResult.host}
                  </strong>
                  <span className={`badge ${diagResult.online ? 'ok' : 'danger'}`}>
                    {diagResult.online ? <Wifi size={11} /> : <WifiOff size={11} />}
                    {diagResult.online ? ' alcanzable' : 'Sin respuesta'}
                  </span>
                  {diagResult.latencyMs != null && (
                    <span className="badge accent">Latencia: {Math.round(diagResult.latencyMs)} ms</span>
                  )}
                  {diagResult.version && (
                    <span className="badge ok">Esteban Cloud v{diagResult.version}</span>
                  )}
                </div>
                <span className="muted" style={{ fontSize: 11.5 }}>
                  Verificado: {fmtDateTime(diagResult.checkedAt)}
                </span>
              </div>

              <div className="grid-4">
                {diagResult.rows.map((row) => (
                  <div
                    key={row.port}
                    style={{
                      padding: '11px 13px',
                      borderRadius: 11,
                      background: 'var(--panel-2)',
                      border: `1px solid ${row.open ? 'rgba(52, 211, 153, 0.35)' : 'var(--border)'}`,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6
                    }}
                  >
                    <div className="between">
                      <span className="mono" style={{ fontWeight: 700, fontSize: 13.5 }}>
                        Puerto {row.port}
                      </span>
                      <span className={`badge ${row.open ? 'ok' : 'warn'}`}>
                        {row.open ? 'Abierto' : 'Cerrado / Filtrado'}
                      </span>
                    </div>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>{row.label}</div>
                    <div className="muted mono" style={{ fontSize: 11.5 }}>
                      {row.latencyMs != null
                        ? `Respuesta en ${Math.round(row.latencyMs)} ms`
                        : row.detail || (row.open ? 'Conexión TCP activa' : 'Sin escucha TCP')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 7. Section 5 — Buscador Global, Archivos Más Pesados, Duplicados y Hash SHA-256 */}
      {showSection('search') && (
        <div className="card">
          <div className="between">
            <div>
              <h2>🔎 Buscador Global, Archivos Más Pesados, Duplicados y Hash SHA-256</h2>
              <p className="muted" style={{ margin: '4px 0 0' }}>
                Busca instantáneamente en todas tus carpetas compartidas, localiza los archivos que más espacio consumen, detecta posibles duplicados y verifica integridad SHA-256 / MD5.
              </p>
            </div>
            <button
              type="button"
              className="btn"
              onClick={handlePickFileForHash}
              disabled={hashingFile}
            >
              {hashingFile ? '⏳ Calculando hash...' : '🔐 Verificador SHA-256 / MD5 de cualquier archivo'}
            </button>
          </div>

          {/* Search bar */}
          <form onSubmit={handleScanStorage} className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por nombre de archivo, extensión (.exe, .zip, .mp4, .pdf) o deja vacío para analizar todo..."
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={scanningStorage}
              style={{ flexShrink: 0 }}
            >
              <Search size={15} />
              {scanningStorage ? 'Analizando...' : 'Analizar carpetas compartidas'}
            </button>
          </form>

          {/* SHA-256 / MD5 Result Card */}
          {hashResult && (
            <div
              style={{
                padding: '13px 15px',
                borderRadius: 12,
                background: 'rgba(56, 189, 248, 0.08)',
                border: '1px solid rgba(56, 189, 248, 0.32)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8
              }}
            >
              <div className="between">
                <div className="row" style={{ gap: 8 }}>
                  <ShieldCheck size={16} color="var(--accent)" />
                  <strong>Huella verificada: {hashResult.fileName}</strong>
                  {hashResult.size > 0 && (
                    <span className="badge accent">{fmtBytes(hashResult.size)}</span>
                  )}
                </div>
                <div className="row" style={{ gap: 6 }}>
                  {hashResult.filePath && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => handleOpenFolderInExplorer(getParentFolder(hashResult.filePath))}
                    >
                      <FolderOpen size={13} /> Abrir carpeta
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setHashResult(null)}
                  >
                    Cerrar
                  </button>
                </div>
              </div>

              {hashResult.sha256 && (
                <div className="between" style={{ gap: 8 }}>
                  <div className="mono" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                    <span className="muted">SHA-256: </span>
                    <strong>{hashResult.sha256}</strong>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => handleCopyText(hashResult.sha256, 'Hash SHA-256 copiado al portapapeles.')}
                  >
                    <Copy size={12} /> Copiar SHA-256
                  </button>
                </div>
              )}

              {hashResult.md5 && (
                <div className="between" style={{ gap: 8 }}>
                  <div className="mono" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                    <span className="muted">MD5: </span>
                    <strong>{hashResult.md5}</strong>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => handleCopyText(hashResult.md5, 'Hash MD5 copiado al portapapeles.')}
                  >
                    <Copy size={12} /> Copiar MD5
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Storage Analysis Sub-tabs & Results */}
          {storageReport && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="between">
                <div className="row" style={{ gap: 8 }}>
                  <button
                    type="button"
                    className={`btn btn-sm ${storageSubTab === 'results' ? 'btn-primary' : ''}`}
                    onClick={() => setStorageSubTab('results')}
                  >
                    Resultados de búsqueda ({storageReport.matches.length})
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm ${storageSubTab === 'largest' ? 'btn-primary' : ''}`}
                    onClick={() => setStorageSubTab('largest')}
                  >
                    Top Archivos Más Pesados ({storageReport.largest.length})
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm ${storageSubTab === 'duplicates' ? 'btn-primary' : ''}`}
                    onClick={() => setStorageSubTab('duplicates')}
                  >
                    Posibles Duplicados ({storageReport.duplicates.length})
                  </button>
                </div>

                <div className="row" style={{ gap: 8 }}>
                  <span className="badge">
                    {storageReport.totalFiles} archivos analizados ({fmtBytes(storageReport.totalBytes)})
                  </span>
                  {storageReport.wastedBytes > 0 && (
                    <span className="badge warn">
                      Espacio duplicado recuperable: {fmtBytes(storageReport.wastedBytes)}
                    </span>
                  )}
                </div>
              </div>

              {/* Sub-tab 1: Resultados de búsqueda */}
              {storageSubTab === 'results' && (
                <div className="list">
                  {storageReport.matches.length === 0 ? (
                    <div className="muted" style={{ fontSize: 13 }}>
                      No se encontraron archivos que coincidan con la búsqueda actual. Prueba la pestaña &ldquo;Top Archivos Más Pesados&rdquo;.
                    </div>
                  ) : (
                    storageReport.matches.slice(0, 60).map((f, idx) => {
                      const fullPath = f.fullPath || f.path || '';
                      const folderPath = f.dir || getParentFolder(fullPath);
                      return (
                        <div key={`${fullPath}-${idx}`} className="list-item">
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                            <div className="row" style={{ gap: 8 }}>
                              <strong>{f.name || f.fileName || fullPath.split(/[\\/]/).pop()}</strong>
                              <span className="badge accent">{fmtBytes(f.size)}</span>
                              {f.shareName && <span className="badge">{f.shareName}</span>}
                            </div>
                            <div className="muted mono" style={{ fontSize: 11.5, wordBreak: 'break-all' }}>
                              {fullPath || f.relPath}
                            </div>
                          </div>
                          <div className="row" style={{ gap: 6, flexShrink: 0 }}>
                            {fullPath && (
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() => handleComputeFileHash(fullPath)}
                                disabled={hashingFile}
                              >
                                🔐 SHA-256
                              </button>
                            )}
                            {folderPath && (
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() => handleOpenFolderInExplorer(folderPath)}
                              >
                                <FolderOpen size={13} /> Abrir carpeta
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {/* Sub-tab 2: Top Archivos Más Pesados */}
              {storageSubTab === 'largest' && (
                <div className="list">
                  {storageReport.largest.length === 0 ? (
                    <div className="muted" style={{ fontSize: 13 }}>
                      No se encontraron archivos en las carpetas compartidas configuradas.
                    </div>
                  ) : (
                    storageReport.largest.slice(0, 40).map((f, idx) => {
                      const fullPath = f.fullPath || f.path || '';
                      const folderPath = f.dir || getParentFolder(fullPath);
                      return (
                        <div key={`${fullPath}-${idx}`} className="list-item">
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                            <div className="row" style={{ gap: 8 }}>
                              <span className="badge warn">#{idx + 1}</span>
                              <strong>{f.name || f.fileName || fullPath.split(/[\\/]/).pop()}</strong>
                              <span className="badge accent">{fmtBytes(f.size)}</span>
                              {f.shareName && <span className="badge">{f.shareName}</span>}
                            </div>
                            <div className="muted mono" style={{ fontSize: 11.5, wordBreak: 'break-all' }}>
                              {fullPath || f.relPath}
                            </div>
                          </div>
                          <div className="row" style={{ gap: 6, flexShrink: 0 }}>
                            {fullPath && (
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() => handleComputeFileHash(fullPath)}
                                disabled={hashingFile}
                              >
                                🔐 SHA-256
                              </button>
                            )}
                            {folderPath && (
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() => handleOpenFolderInExplorer(folderPath)}
                              >
                                <FolderOpen size={13} /> Abrir carpeta
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {/* Sub-tab 3: Posibles Duplicados */}
              {storageSubTab === 'duplicates' && (
                <div className="list">
                  {storageReport.duplicates.length === 0 ? (
                    <div className="muted" style={{ fontSize: 13 }}>
                      ¡Excelente! No se detectaron archivos duplicados en tus carpetas compartidas.
                    </div>
                  ) : (
                    storageReport.duplicates.slice(0, 40).map((dup, idx) => {
                      const locations = Array.isArray(dup.files)
                        ? dup.files
                        : Array.isArray(dup.locations)
                          ? dup.locations
                          : Array.isArray(dup.paths)
                            ? dup.paths
                            : Array.isArray(dup.items)
                              ? dup.items
                              : [];
                      const count = dup.count || locations.length || 2;
                      const wasted = dup.wastedBytes ?? (Number(dup.size || 0) * Math.max(1, count - 1));
                      return (
                        <div
                          key={`${dup.name || idx}-${idx}`}
                          className="list-item"
                          style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}
                        >
                          <div className="between">
                            <div className="row" style={{ gap: 8 }}>
                              <strong>{dup.name || dup.fileName || 'Archivo duplicado'}</strong>
                              <span className="badge">{count} copias</span>
                              <span className="badge accent">{fmtBytes(dup.size)} c/u</span>
                            </div>
                            <span className="badge warn">
                              Espacio desperdiciado: {fmtBytes(wasted)}
                            </span>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                            {locations.map((loc, li) => {
                              const p = typeof loc === 'string' ? loc : loc.fullPath || loc.path || '';
                              const folderPath = getParentFolder(p);
                              return (
                                <div key={`${p}-${li}`} className="between" style={{ gap: 8 }}>
                                  <span className="muted mono" style={{ fontSize: 11.5, wordBreak: 'break-all' }}>
                                    • {p}
                                  </span>
                                  {folderPath && (
                                    <button
                                      type="button"
                                      className="btn btn-sm"
                                      style={{ padding: '3px 8px', fontSize: 11 }}
                                      onClick={() => handleOpenFolderInExplorer(folderPath)}
                                    >
                                      <FolderOpen size={12} /> Abrir
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {(activeSection === 'all' || activeSection === 'winscript') && (
        <Suspense fallback={<div className="card"><p className="muted">Cargando WinScript Studio...</p></div>}>
          <WinOptimizerPanel api={api} flash={flash} />
        </Suspense>
      )}
    </>
  );
}

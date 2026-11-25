import React, { useEffect, useState, useCallback, useMemo, lazy, Suspense } from 'react';
import {
  Cloud,
  FolderOpen,
  KeyRound,
  HardDrive,
  Wrench,
  Settings,
  Play,
  Square,
  Plus,
  Trash2,
  Copy,
  Usb,
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
  Upload,
  Download,
  FolderPlus,
  ExternalLink,
  Smartphone,
  CheckCircle2,
  AlertCircle,
  Link2,
  Eye,
  EyeOff,
  Search,
  Pencil,
  Globe,
  Wifi,
  ArrowRight,
  Sparkles,
  Bookmark,
  Package,
  Activity,
  MessageSquare,
  Zap
} from 'lucide-react';
const MetricsView = lazy(() => import('./components/MetricsView.jsx'));
const ChatView = lazy(() => import('./components/ChatView.jsx'));
const ToolsView = lazy(() => import('./components/ToolsView.jsx'));
const FleetView = lazy(() => import('./components/FleetView.jsx'));
const BulkDeployView = lazy(() => import('./components/BulkDeployView.jsx'));
const EnterpriseOpsView = lazy(() => import('./components/EnterpriseOpsView.jsx'));
const MiniInternetPackagesView = lazy(() => import('./components/MiniInternetPackagesView.jsx'));
const DriveOrganizerCard = lazy(() => import('./components/DriveOrganizerCard.jsx'));

const api = window.estebanCloud;

function fmtSize(n) {
  if (n == null) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = Number(n);
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v.toFixed(1)} ${units[i]}`;
}

function getPassStrength(pass) {
  if (!pass) return { score: 0, label: '', color: 'transparent' };
  let score = 0;
  if (pass.length >= 6) score += 25;
  if (pass.length >= 10) score += 25;
  if (/[A-Z]/.test(pass) && /[a-z]/.test(pass)) score += 20;
  if (/\d/.test(pass)) score += 15;
  if (/[^A-Za-z0-9]/.test(pass)) score += 15;
  if (score < 45) return { score, label: 'Débil (añade más caracteres)', color: '#f87171' };
  if (score < 75) return { score, label: 'Buena', color: '#fbbf24' };
  return { score: 100, label: 'Fuerte (recomendada para pendrive)', color: '#34d399' };
}

function BrandEmblem() {
  return (
    <svg viewBox="0 0 256 256" width="40" height="40" aria-hidden="true">
      <defs>
        <linearGradient id="emoBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0b1826" />
          <stop offset="100%" stopColor="#070f18" />
        </linearGradient>
      </defs>
      <rect x="8" y="8" width="240" height="240" rx="56" fill="url(#emoBg)" stroke="#10b981" strokeOpacity="0.6" strokeWidth="7" />
      <g stroke="#34d399" strokeWidth="6" strokeOpacity="0.75">
        <line x1="128" y1="60" x2="187" y2="94" />
        <line x1="187" y1="94" x2="187" y2="162" />
        <line x1="187" y1="162" x2="128" y2="196" />
        <line x1="128" y1="196" x2="69" y2="162" />
        <line x1="69" y1="162" x2="69" y2="94" />
        <line x1="69" y1="94" x2="128" y2="60" />
        <line x1="128" y1="128" x2="128" y2="60" />
        <line x1="128" y1="128" x2="187" y2="94" />
        <line x1="128" y1="128" x2="187" y2="162" />
        <line x1="128" y1="128" x2="128" y2="196" />
        <line x1="128" y1="128" x2="69" y2="162" />
        <line x1="128" y1="128" x2="69" y2="94" />
      </g>
      <circle cx="128" cy="60" r="14" fill="#38bdf8" />
      <circle cx="187" cy="94" r="14" fill="#38bdf8" />
      <circle cx="187" cy="162" r="14" fill="#38bdf8" />
      <circle cx="128" cy="196" r="14" fill="#38bdf8" />
      <circle cx="69" cy="162" r="14" fill="#38bdf8" />
      <circle cx="69" cy="94" r="14" fill="#38bdf8" />
      <circle cx="128" cy="128" r="24" fill="#10b981" />
      <circle cx="128" cy="128" r="10" fill="#090d14" />
    </svg>
  );
}

export default function App() {
  const [tab, setTab] = useState('fleet');
  const [preselectedBulkPeerIds, setPreselectedBulkPeerIds] = useState([]);
  const [state, setState] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  // Key generator state
  const [keyLabel, setKeyLabel] = useState('Esteban Total (Todas las carpetas)');
  const [keyPass, setKeyPass] = useState('');
  const [keyPass2, setKeyPass2] = useState('');
  const [showKeyPass, setShowKeyPass] = useState(true);
  const [keyPerm, setKeyPerm] = useState('rw');
  const [keyAllShares, setKeyAllShares] = useState(true);
  const [selectedShareIds, setSelectedShareIds] = useState([]);
  const [generatedKey, setGeneratedKey] = useState(null);
  const [saveDirs, setSaveDirs] = useState([]);

  // Client connect state
  const [usbKeys, setUsbKeys] = useState([]);
  const [bundleText, setBundleText] = useState('');
  const [bundleFilePath, setBundleFilePath] = useState('');
  const [clientPass, setClientPass] = useState('');
  const [showClientPass, setShowClientPass] = useState(true);
  const [overrideUrl, setOverrideUrl] = useState('');
  const [quickPairCode, setQuickPairCode] = useState('');
  const [showAdvancedClient, setShowAdvancedClient] = useState(false);
  const [draggingKey, setDraggingKey] = useState(false);
  const [driveLetter, setDriveLetter] = useState('Z:');
  const [activeSessionId, setActiveSessionId] = useState('');
  const [activeRemoteShare, setActiveRemoteShare] = useState(null);
  const [remotePath, setRemotePath] = useState('');
  const [remoteItems, setRemoteItems] = useState([]);
  const [remoteSearch, setRemoteSearch] = useState('');

  // Dependencies state
  const [optOpenSsh, setOptOpenSsh] = useState(false);
  const [optDisableSleep, setOptDisableSleep] = useState(true);
  const [installLog, setInstallLog] = useState('');

  // Updates state
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateProgress, setUpdateProgress] = useState(null);
  const [transferProgress, setTransferProgress] = useState(null);
  const [unreadChats, setUnreadChats] = useState(0);

  // Pendrive Kit exporter state
  const [kitTargetDir, setKitTargetDir] = useState('');
  const [kitCustomInstaller, setKitCustomInstaller] = useState('');
  const [kitIncludeGeneratedKey, setKitIncludeGeneratedKey] = useState(true);
  const [kitCreateZip, setKitCreateZip] = useState(false);
  const [kitResult, setKitResult] = useState(null);

  const flash = useCallback((type, text) => setNotice({ type, text }), []);

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      const next = await api.getState();
      setState(next);
      if (typeof next.totalUnread === 'number') setUnreadChats(next.totalUnread);
      if (next.env?.usbDrives?.length) {
        setSaveDirs((prev) => (prev.length === 0 ? next.env.usbDrives.map((d) => d.root) : prev));
        setKitTargetDir((prev) => prev || next.env.usbDrives[0].root);
      }
    } catch (err) {
      flash('error', err.message || 'No se pudo cargar el estado.');
    }
  }, [flash]);

  useEffect(() => {
    refresh();
    if (!api) return;
    const unsubLog = api.onLog((entry) => {
      if (!entry) return;
      setState((prev) => {
        if (!prev || !prev.server) return prev;
        const prevLogs = Array.isArray(prev.server.recentActivity) ? prev.server.recentActivity : [];
        const nextLogs = [entry, ...prevLogs].slice(0, 60);
        return { ...prev, server: { ...prev.server, recentActivity: nextLogs } };
      });
    });
    const unsubUpd = api.onUpdateProgress ? api.onUpdateProgress((p) => setUpdateProgress(p)) : null;
    const unsubTransfer = api.onTransferProgress ? api.onTransferProgress((p) => setTransferProgress(p)) : null;
    const unsubAvail = api.onUpdateAvailable ? api.onUpdateAvailable((info) => setUpdateInfo(info)) : null;
    const unsubChat = api.onChatEvent ? api.onChatEvent((evt) => {
      if (evt && typeof evt.totalUnread === 'number') setUnreadChats(evt.totalUnread);
    }) : null;
    // Quietly check for updates on launch
    api.checkUpdates().then((info) => {
      if (info && info.status === 'update-available') setUpdateInfo(info);
    }).catch(() => {});
    return () => {
      unsubLog && unsubLog();
      unsubUpd && unsubUpd();
      unsubTransfer && unsubTransfer();
      unsubAvail && unsubAvail();
      unsubChat && unsubChat();
    };
  }, [refresh]);

  useEffect(() => {
    const cfg = state?.config;
    if (!cfg) return;
    const root = document.documentElement;
    root.dataset.theme = cfg.uiTheme || 'emerald';
    root.dataset.effects = cfg.uiEffects || 'glass';
    root.dataset.density = cfg.uiDensity || 'comfortable';
    root.dataset.scale = cfg.uiScale || 'normal';
  }, [state?.config?.uiTheme, state?.config?.uiEffects, state?.config?.uiDensity, state?.config?.uiScale]);

  const filteredRemoteItems = useMemo(() => {
    const q = remoteSearch.trim().toLowerCase();
    if (!q) return remoteItems;
    return remoteItems.filter((it) => it.name.toLowerCase().includes(q));
  }, [remoteItems, remoteSearch]);

  if (!api) {
    return (
      <div style={{ padding: 32 }}>
        <h1>Esteban Cloud</h1>
        <p className="muted">Ejecuta esta aplicación dentro de Electron (<code>npm run dev</code> o instalador Windows).</p>
      </div>
    );
  }

  if (!state) {
    return (
      <div style={{ padding: 32 }}>
        <p className="muted">Cargando Esteban Cloud...</p>
      </div>
    );
  }

  const { config, server, env, urls, mounts, activeClientSessions, installerInfo, hostedUpdate } = state;
  const activeSession = activeClientSessions.find((s) => s.sessionId === activeSessionId) || activeClientSessions[0] || null;
  const depsReady = env.tailscale.installed && env.rclone.installed && env.winfsp.installed;
  const hasActiveKeys = config.keys.some((k) => !k.revoked);
  const strength = getPassStrength(keyPass);

  const toggleServer = async () => {
    setBusy(true);
    try {
      const next = server.running ? await api.stopServer() : await api.startServer();
      setState(next);
      flash('ok', next.server.running ? `Servidor activo en puerto ${next.server.port}.` : 'Servidor detenido.');
    } catch (err) {
      flash('error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleAddShare = async () => {
    try {
      const folderPath = await api.pickShareFolder();
      if (!folderPath) return;
      const parts = folderPath.split(/[\\/]/).filter(Boolean);
      const name = parts[parts.length - 1] || 'Carpeta';
      const next = await api.addShare({ name, folderPath, mode: 'rw' });
      setState(next);
      flash('ok', `Carpeta "${name}" añadida para compartir.`);
    } catch (err) {
      flash('error', err.message);
    }
  };

  const handleGenerateKey = async (e) => {
    e.preventDefault();
    if (keyPass.length < 6) return flash('error', 'La frase de paso debe tener al menos 6 caracteres.');
    if (keyPass !== keyPass2) return flash('error', 'Las frases de paso no coinciden.');
    const shareIds = keyAllShares ? ['*'] : selectedShareIds;
    if (!keyAllShares && shareIds.length === 0) return flash('error', 'Selecciona al menos una carpeta.');

    setBusy(true);
    try {
      const res = await api.generateKey({ label: keyLabel, permissions: keyPerm, shareIds, passphrase: keyPass });
      setGeneratedKey(res);
      setState(res.state);
      setKeyPass('');
      setKeyPass2('');
      if (res.state.env.usbDrives.length > 0) {
        setSaveDirs(res.state.env.usbDrives.map((d) => d.root));
      }
      flash('ok', `Llave encriptada ${res.keyId} creada. Guárdala en tu pendrive o cópiala ahora.`);
    } catch (err) {
      flash('error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleAddSaveDir = async () => {
    const dir = await api.pickSaveFolder();
    if (dir && !saveDirs.includes(dir)) setSaveDirs((prev) => [...prev, dir]);
  };

  const handleSaveKeyMultiple = async () => {
    if (!generatedKey) return;
    if (!saveDirs.length) return flash('error', 'Selecciona al menos una carpeta o pendrive destino.');
    const res = await api.saveKeyToLocations({
      fileName: generatedKey.suggestedFileName,
      bundleJson: generatedKey.bundleJson,
      directories: saveDirs
    });
    if (res.saved.length && !res.errors.length) {
      flash('ok', `Llave guardada en ${res.saved.length} ubicación(es): ${res.saved.join(' | ')}`);
    } else if (res.saved.length) {
      flash('error', `Guardada en ${res.saved.length}, pero falló en: ${res.errors.map((e) => e.dir).join(', ')}`);
    } else {
      flash('error', `No se pudo guardar: ${res.errors.map((e) => e.error).join('; ')}`);
    }
  };

  const handleScanUsb = async () => {
    const list = await api.scanUsbKeys();
    setUsbKeys(list);
    if (list.length === 0) {
      flash('info', 'No se encontraron archivos .ecloudkey en la raíz de los pendrives USB conectados.');
    } else {
      flash('ok', `Se detectaron ${list.length} llave(s) .ecloudkey en USB.`);
    }
  };

  const handlePickKeyFile = async () => {
    const res = await api.pickKeyFile();
    if (!res) return;
    setBundleFilePath(res.filePath);
    setBundleText(res.content);
    flash('ok', `Llave cargada: ${res.filePath}`);
  };

  const handleDropKeyFile = async (e) => {
    e.preventDefault();
    setDraggingKey(false);
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    const text = await file.text();
    setBundleText(text);
    setBundleFilePath(file.path || file.name);
    flash('ok', `Llave cargada por arrastre: ${file.name}`);
  };

  const handleConnect = async (e) => {
    e.preventDefault();
    if (!bundleText && !bundleFilePath) return flash('error', 'Carga un archivo .ecloudkey (desde tu pendrive) o pega la llave.');
    if (!clientPass) return flash('error', 'Ingresa la frase de paso para desbloquear la llave.');
    setBusy(true);
    try {
      const res = await api.unlockAndConnect({
        bundleText,
        filePath: bundleFilePath,
        passphrase: clientPass,
        overrideBaseUrl: overrideUrl.trim() || undefined,
        saveBookmark: true
      });
      setState(res.state);
      setActiveSessionId(res.sessionId);
      setActiveRemoteShare(null);
      setRemotePath('');
      setRemoteItems([]);
      setRemoteSearch('');
      setClientPass('');
      flash('ok', `Conectado a ${res.session.nodeName} (${res.session.baseUrl}).`);
    } catch (err) {
      flash('error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleQuickConnectKey = async (k, { autoMount = false } = {}) => {
    if (!k) return;
    const pass = k.passphrase || state?.config?.keyVault?.[k.keyId]?.passphrase || '';
    const fPath = k.primaryPath || k.filePath || k.keyFilePath || '';
    const bText = k.bundleJson || '';
    setTab('client');
    setBundleFilePath(fPath);
    setBundleText(fPath ? '' : bText);
    setClientPass(pass);
    if (!pass) {
      flash('info', `Llave ${k.label || k.keyId} seleccionada. Escribe su clave y pulsa Conectar.`);
      return;
    }
    setBusy(true);
    try {
      const res = await api.unlockAndConnect({
        bundleText: fPath ? '' : bText,
        filePath: fPath,
        passphrase: pass,
        overrideBaseUrl: overrideUrl.trim() || undefined,
        saveBookmark: true
      });
      let nextState = res.state;
      setActiveSessionId(res.sessionId);
      setActiveRemoteShare(null);
      setRemotePath('');
      setRemoteItems([]);
      setRemoteSearch('');
      if (autoMount) {
        const savedProf = (nextState?.config?.driveProfiles || []).find((p) => p.keyId === res.session.keyId && !p.shareSubpath);
        const mRes = await api.mountDrive({
          sessionId: res.sessionId,
          driveLetter: savedProf?.preferredDrive || 'AUTO',
          mountMode: savedProf?.mountMode || 'letter',
          alias: savedProf?.alias || res.session.nodeName,
          group: savedProf?.group || 'General',
          color: savedProf?.color || 'emerald'
        });
        nextState = mRes.state;
        setState(nextState);
        flash('ok', `Conectado y montado ${res.session.nodeName} en ${mRes.mounted.drive}.`);
      } else {
        setState(nextState);
        flash('ok', `Conectado en 1 clic a ${res.session.nodeName} (${res.session.baseUrl}).`);
      }
    } catch (err) {
      flash('error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleQuickConnectPeer = (peer, opts = {}) => {
    const dk = (state?.detectedKeys || []).find((k) => k.keyId === peer.keyId);
    const savedPass = dk?.passphrase || state?.config?.keyVault?.[peer.keyId]?.passphrase || '';
    return handleQuickConnectKey(
      {
        keyId: peer.keyId,
        label: peer.label,
        nodeName: peer.nodeName,
        primaryPath: dk?.primaryPath || peer.keyFilePath,
        bundleJson: dk?.bundleJson || '',
        passphrase: savedPass
      },
      opts
    );
  };

  const loadRemoteDir = async (sessionId, share, relPath) => {
    setBusy(true);
    try {
      const data = await api.listRemoteFiles({ sessionId, shareId: share.id, relPath });
      setActiveRemoteShare(share);
      setRemotePath(relPath);
      setRemoteItems(data.items || []);
      setRemoteSearch('');
    } catch (err) {
      flash('error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleMountDrive = async () => {
    if (!activeSession) return;
    setBusy(true);
    try {
      const res = await api.mountDrive({ sessionId: activeSession.sessionId, driveLetter });
      setState(res.state);
      flash('ok', `Unidad ${res.mounted.drive} montada en Modo Turbo 8x. Ya puedes abrirla en el Explorador de Windows.`);
    } catch (err) {
      flash('error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleOptimizeRoute = async () => {
    if (!activeSession) return;
    setBusy(true);
    try {
      const res = await api.optimizeRoute({ sessionId: activeSession.sessionId });
      setState(res.state);
      const rInfo = res.routeInfo || {};
      const routeText = rInfo.routeType === 'lan'
        ? `Ruta LAN Directa (${rInfo.latencyMs} ms)`
        : rInfo.routeType === 'tailscale-direct'
          ? `Tailscale UDP Directo P2P (${rInfo.latencyMs} ms)`
          : `Tailscale Relay "${rInfo.relay || 'DERP'}" (${rInfo.latencyMs || '?'} ms)`;
      const remountMsg = res.remounted?.length ? ` · Disco(s) ${res.remounted.map((m) => m.drive).join(', ')} remontados en Turbo 8x.` : '';
      flash('ok', `Ruta optimizada para ${activeSession.nodeName}: ${routeText} → ${res.baseUrl}${remountMsg}`);
    } catch (err) {
      flash('error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const renderRouteBadge = (routeInfo) => {
    if (!routeInfo) return null;
    if (routeInfo.routeType === 'lan') {
      return <span className="badge ok">🟢 Ruta LAN Directa (Ultra Rápida · {routeInfo.latencyMs || 1} ms)</span>;
    }
    if (routeInfo.routeType === 'tailscale-direct') {
      return <span className="badge ok">🟢 Tailscale UDP Directo (P2P · {routeInfo.latencyMs || '?'} ms)</span>;
    }
    if (routeInfo.routeType === 'tailscale-relay') {
      return <span className="badge warn">🟠 Tailscale Relay DERP "{routeInfo.relay || '?'}" (Lento · {routeInfo.latencyMs || '?'} ms)</span>;
    }
    return <span className="badge accent">🔵 Ruta Activa ({routeInfo.latencyMs || '?'} ms)</span>;
  };

  const handleInstallDeps = async () => {
    setBusy(true);
    setInstallLog('Solicitando permisos de Administrador (UAC) y ejecutando PowerShell...');
    try {
      const res = await api.installDependencies({ installOpenSsh: optOpenSsh, disableSleep: optDisableSleep });
      setState(res.state);
      setInstallLog(res.log || res.error || 'Sin salida registrada.');
      if (res.ok) {
        flash('ok', 'Dependencias y firewall configurados correctamente.');
      } else {
        flash('error', 'El instalador terminó con advertencias o UAC fue cancelado. Revisa el registro.');
      }
    } catch (err) {
      setInstallLog(err.message);
      flash('error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleExportKit = async () => {
    let dest = kitTargetDir;
    if (!dest) {
      dest = await api.pickSaveFolder();
      if (!dest) return;
      setKitTargetDir(dest);
    }
    setBusy(true);
    try {
      const res = await api.exportPendriveKit({
        targetDir: dest,
        installerPath: kitCustomInstaller || undefined,
        keyFileName: (kitIncludeGeneratedKey && generatedKey) ? generatedKey.suggestedFileName : undefined,
        keyBundleJson: (kitIncludeGeneratedKey && generatedKey) ? generatedKey.bundleJson : undefined,
        createZip: kitCreateZip
      });
      setKitResult(res);
      flash(
        'ok',
        `Kit Pendrive creado en ${res.kitDir}${res.zipPath ? ` y archivo único ${res.zipPath}` : ''}.`
      );
    } catch (err) {
      flash('error', err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><BrandEmblem /></div>
          <div>
            <div className="brand-title">Esteban Mesh Office</div>
            <div className="brand-sub">{config.workspaceName || config.nodeName} · v{state.appVersion}</div>
          </div>
        </div>

        <button
          type="button"
          className="web-pill"
          onClick={() => api.openExternal('https://estebanico.com')}
          title="Abrir sitio oficial de Esteban Nicola (estebanico.com)"
        >
          <span className="row" style={{ gap: 7 }}>
            <Globe size={14} color="var(--accent)" />
            <span className="web-pill-domain">estebanico.com</span>
          </span>
          <ExternalLink size={13} color="var(--muted)" />
        </button>

        <nav className="nav" aria-label="Navegación principal">
          <div className="nav-section">Espacio de Trabajo</div>
          <button className={`nav-btn ${tab === 'fleet' ? 'active' : ''}`} onClick={() => setTab('fleet')}>
            <Globe size={17} /> Flota Oficina (10+ PCs)
            <span className="pill-count" style={{ background: 'rgba(16,185,129,0.25)', color: '#a7f3d0' }}>
              {state.fleet?.summary?.onlineNodes || 1}/{state.fleet?.summary?.totalNodes || 1}
            </span>
          </button>
          <button className={`nav-btn ${tab === 'bulk' ? 'active' : ''}`} onClick={() => setTab('bulk')}>
            <Package size={17} /> Discos Masivos y Kit USB
          </button>
          <button className={`nav-btn ${tab === 'ops' ? 'active' : ''}`} onClick={() => setTab('ops')}>
            <ShieldCheck size={17} /> Alto Volumen, Sync y Auditoría
          </button>
          <button className={`nav-btn ${tab === 'metrics' ? 'active' : ''}`} onClick={() => setTab('metrics')}>
            <Activity size={17} /> Métricas Globales
          </button>
          <button className={`nav-btn ${tab === 'chat' ? 'active' : ''}`} onClick={() => setTab('chat')}>
            <MessageSquare size={17} /> Chat Corporativo
            {unreadChats > 0 && <span className="pill-count" style={{ background: 'rgba(56,189,248,0.28)', color: '#e0f2fe' }}>{unreadChats}</span>}
          </button>
          <button className={`nav-btn ${tab === 'tools' ? 'active' : ''}`} onClick={() => setTab('tools')}>
            <Sparkles size={17} /> Herramientas IT
          </button>
          <button className={`nav-btn ${tab === 'mini' ? 'active' : ''}`} onClick={() => setTab('mini')}>
            <Globe size={17} /> Mini-Internet y Paquetes
            <span className="pill-count">{state.miniInternet?.packages?.length || 5}</span>
          </button>

          <div className="nav-section">Red y Discos</div>
          <button className={`nav-btn ${tab === 'dashboard' ? 'active' : ''}`} onClick={() => setTab('dashboard')}>
            <Cloud size={17} /> Panel y Acceso Móvil
          </button>
          <button className={`nav-btn ${tab === 'host' ? 'active' : ''}`} onClick={() => setTab('host')}>
            <FolderOpen size={17} /> Discos Compartidos
            <span className="pill-count">{config.shares.filter((s) => s.enabled).length}</span>
          </button>
          <button className={`nav-btn ${tab === 'keys' ? 'active' : ''}`} onClick={() => setTab('keys')}>
            <KeyRound size={17} /> Llaves y Bóveda
            <span className="pill-count">{(state.detectedKeys || []).length || config.keys.filter((k) => !k.revoked).length}</span>
          </button>
          <button className={`nav-btn ${tab === 'client' ? 'active' : ''}`} onClick={() => setTab('client')}>
            <HardDrive size={17} /> Montar Discos (Cliente)
            <span className="pill-count">{mounts.length + activeClientSessions.length}</span>
          </button>

          <div className="nav-section">Sistema</div>
          <button className={`nav-btn ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>
            <Settings size={17} /> Ajustes de Empresa
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="status-chip">
            <span className={`dot ${server.running ? 'ok' : 'danger'}`} />
            <span>{server.running ? `Servidor activo :${server.port}` : 'Servidor detenido'}</span>
          </div>
          <div className="status-chip">
            <span className={`dot ${env.tailscale.running ? 'ok' : 'warn'}`} />
            <span>{env.tailscale.running ? `Túnel ${env.tailscale.ip}` : 'Tailscale sin conectar'}</span>
          </div>
          <div className="credit">
            Hecho por Esteban Nicola ·{' '}
            <button type="button" onClick={() => api.openExternal('https://estebanico.com')}>
              estebanico.com
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        {updateInfo?.status === 'update-available' && (
          <div className="banner ok">
            <div className="between">
              <span>
                <strong>Actualización disponible: v{updateInfo.latestVersion}</strong> ({updateInfo.sourceLabel})
              </span>
              <div className="row">
                <button
                  className="btn btn-sm btn-primary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await api.downloadAndInstallUpdate(updateInfo);
                    } catch (err) {
                      setUpdateProgress(null);
                      flash('error', err.message);
                      setBusy(false);
                    }
                  }}
                >
                  <Download size={13} /> Actualizar ahora
                </button>
                <button className="btn btn-sm" onClick={() => setTab('settings')}>Detalles</button>
              </div>
            </div>
            {updateProgress && (
              <div style={{ marginTop: 8 }}>
                <div className="strength-bar">
                  <div className="strength-fill" style={{ width: `${updateProgress.percent || 0}%`, background: '#38bdf8' }} />
                </div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                  {updateProgress.stage === 'installing'
                    ? 'Verificado SHA-256. Instalando y reiniciando Esteban Cloud...'
                    : `Descargando: ${updateProgress.percent || 0}% (${fmtSize(updateProgress.received)} / ${fmtSize(updateProgress.total)})`}
                </div>
              </div>
            )}
          </div>
        )}

        {transferProgress && (
          <div className="banner ok" style={{ borderColor: 'rgba(16, 185, 129, 0.45)', background: 'rgba(16, 185, 129, 0.12)' }}>
            <div className="between" style={{ gap: 8, flexWrap: 'wrap' }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <Zap size={16} color="#34d399" />
                <strong>
                  Motor Turbo {transferProgress.parallelStreams || 1}x · {transferProgress.mode === 'upload' ? 'Subiendo' : 'Descargando'}: {transferProgress.fileName}
                </strong>
                <span className="badge ok" style={{ fontWeight: 700 }}>{transferProgress.speedMBs || 0} MB/s</span>
                <span className="mono muted" style={{ fontSize: 12 }}>
                  {transferProgress.percent || 0}% ({fmtSize(transferProgress.transferredBytes)} / {fmtSize(transferProgress.totalBytes)})
                </span>
              </div>
              {transferProgress.status === 'completed' && (
                <button className="btn btn-sm" onClick={() => setTransferProgress(null)}>Cerrar</button>
              )}
            </div>
            <div className="strength-bar" style={{ marginTop: 8 }}>
              <div className="strength-fill" style={{ width: `${transferProgress.percent || 0}%`, background: 'linear-gradient(90deg, #10b981, #38bdf8)' }} />
            </div>
          </div>
        )}

        {notice && (
          <div className={`banner ${notice.type === 'error' ? 'error' : notice.type === 'ok' ? 'ok' : ''}`}>
            <div className="between">
              <span>{notice.text}</span>
              <button className="btn btn-sm" onClick={() => setNotice(null)}>Cerrar</button>
            </div>
          </div>
        )}

        <Suspense fallback={<div className="card"><p className="muted">Cargando módulo...</p></div>}>
        {tab === 'fleet' && (
          <FleetView
            api={api}
            state={state}
            flash={flash}
            onOpenTab={setTab}
            onSelectPeersForBulk={(nodes) => {
              setPreselectedBulkPeerIds((nodes || []).map((n) => n.id));
              setTab('bulk');
            }}
          />
        )}

        {tab === 'bulk' && (
          <BulkDeployView
            api={api}
            state={state}
            flash={flash}
            preselectedPeerIds={preselectedBulkPeerIds}
          />
        )}

        {tab === 'ops' && (
          <EnterpriseOpsView
            api={api}
            state={state}
            flash={flash}
          />
        )}
        </Suspense>

        {tab === 'dashboard' && (
          <>
            <div className="page-head">
              <div>
                <h1>Panel de Esteban Cloud</h1>
                <p>Tu nube personal bidireccional en malla: comparte tus carpetas y monta tus otros equipos desde casa, el trabajo o cualquier país.</p>
              </div>
              <div className="row">
                <button className="btn" onClick={() => setTab('kit')}>
                  <Package size={15} /> Pasar al Pendrive
                </button>
                <button className="btn" onClick={refresh} disabled={busy}>
                  <RefreshCw size={15} /> Actualizar
                </button>
                <button className={`btn ${server.running ? 'btn-danger' : 'btn-primary'}`} onClick={toggleServer} disabled={busy}>
                  {server.running ? <><Square size={15} /> Detener servidor</> : <><Play size={15} /> Iniciar servidor</>}
                </button>
              </div>
            </div>

            <div className="card hero-card">
              <div className="between">
                <h2><Sparkles size={17} color="#67e8f9" /> Puesta en marcha rápida (3 pasos)</h2>
                <span className="badge accent">
                  {[depsReady && env.tailscale.running, hasActiveKeys, config.shares.some((s) => s.enabled)].filter(Boolean).length}/3 listos
                </span>
              </div>
              <div className="grid-3">
                <div className={`step-card ${depsReady && env.tailscale.running ? 'done' : ''}`}>
                  <div className="between">
                    <strong>1. Túnel y motor (1 clic)</strong>
                    {depsReady && env.tailscale.running ? <CheckCircle2 size={16} color="#34d399" /> : <AlertCircle size={16} color="#fbbf24" />}
                  </div>
                  <p className="muted" style={{ margin: 0 }}>
                    {!depsReady
                      ? 'Instala Tailscale, rclone, WinFsp y Firewall en un clic.'
                      : env.tailscale.running
                        ? `Túnel global activo en ${env.tailscale.ip}.`
                        : 'Dependencias instaladas. Inicia sesión en Tailscale.'}
                  </p>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => (!depsReady ? setTab('deps') : api.launchTailscale())}
                  >
                    {!depsReady ? <>Ir al Instalador 1-clic <ArrowRight size={13} /></> : <>Abrir Tailscale <ExternalLink size={13} /></>}
                  </button>
                </div>

                <div className={`step-card ${hasActiveKeys ? 'done' : ''}`}>
                  <div className="between">
                    <strong>2. Llave para tu pendrive</strong>
                    {hasActiveKeys ? <CheckCircle2 size={16} color="#34d399" /> : <AlertCircle size={16} color="#fbbf24" />}
                  </div>
                  <p className="muted" style={{ margin: 0 }}>
                    {hasActiveKeys
                      ? `${config.keys.filter((k) => !k.revoked).length} llave(s) activa(s) y listas para desbloquear.`
                      : 'Genera tu archivo .ecloudkey cifrado y guárdalo en tu pendrive.'}
                  </p>
                  <button className="btn btn-sm" onClick={() => setTab('keys')}>
                    {hasActiveKeys ? 'Gestionar llaves' : 'Crear primera llave'} <ArrowRight size={13} />
                  </button>
                </div>

                <div className={`step-card ${mounts.length > 0 || activeClientSessions.length > 0 ? 'done' : ''}`}>
                  <div className="between">
                    <strong>3. Conectar PC o Android</strong>
                    {mounts.length > 0 ? <CheckCircle2 size={16} color="#34d399" /> : <ArrowRight size={16} color="#38bdf8" />}
                  </div>
                  <p className="muted" style={{ margin: 0 }}>
                    Monta otro PC como disco <code>Z:</code> o escanea el QR abajo desde Android con Tailscale.
                  </p>
                  <button className="btn btn-sm" onClick={() => setTab('client')}>
                    Abrir Conectar (Cliente) <ArrowRight size={13} />
                  </button>
                </div>
              </div>
            </div>

            <div className="grid-4">
              <div className="card">
                <div className="kpi-head">
                  <span className="muted">Servidor local</span>
                  <div className={`icon-chip ${server.running ? 'ok' : 'warn'}`}><Cloud size={15} /></div>
                </div>
                <div className="stat-value">{server.running ? 'En línea' : 'Detenido'}</div>
                <span className={`badge ${server.running ? 'ok' : 'danger'}`}>TCP :{server.port || config.port}</span>
              </div>
              <div className="card">
                <div className="kpi-head">
                  <span className="muted">Túnel global (Tailscale)</span>
                  <div className={`icon-chip ${env.tailscale.running ? 'ok' : 'warn'}`}><Globe size={15} /></div>
                </div>
                <div className="stat-value mono">{env.tailscale.ip || 'Sin conectar'}</div>
                <span className={`badge ${env.tailscale.running ? 'ok' : 'warn'}`}>
                  {env.tailscale.running ? 'Accesible desde el mundo' : 'Requiere Tailscale'}
                </span>
              </div>
              <div className="card">
                <div className="kpi-head">
                  <span className="muted">Red local (LAN)</span>
                  <div className="icon-chip"><Wifi size={15} /></div>
                </div>
                <div className="stat-value mono">{env.lanIp || 'Sin IP'}</div>
                <span className="badge accent">{config.nodeName}</span>
              </div>
              <div className="card">
                <div className="kpi-head">
                  <span className="muted">Pendrives USB</span>
                  <div className="icon-chip"><Usb size={15} /></div>
                </div>
                <div className="stat-value">{env.usbDrives.length}</div>
                <span className="badge">{env.usbDrives.length ? env.usbDrives.map((u) => u.drive).join(', ') : 'Conecta tu USB'}</span>
              </div>
            </div>

            <div className="grid-2">
              <div className="card">
                <h2><Smartphone size={17} /> App Nativa Android (APK) y Super-App Móvil</h2>
                <p className="muted">
                  Escanea el QR con tu celular para abrir la Super-App móvil (Archivos, AirDrop, Pantalla Remota, Chat, Portapapeles y Bóveda) o descargar e instalar el <strong>APK nativo de Android (<code>Esteban-Cloud-0.4.0.apk</code>)</strong>.
                </p>
                {urls.tailscaleUrl ? (
                  <div className="qr-card">
                    {urls.tailscaleQr && <img src={urls.tailscaleQr} alt="QR Tailscale" />}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <span className="badge ok">Global · Tailscale</span>
                      <div className="mono" style={{ margin: '6px 0', wordBreak: 'break-all' }}>{urls.tailscaleUrl}</div>
                      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                        <button className="btn btn-sm" onClick={() => { api.copyText(urls.tailscaleUrl); flash('ok', 'URL de Tailscale copiada.'); }}>
                          <Copy size={13} /> Copiar URL
                        </button>
                        <button className="btn btn-sm btn-primary" onClick={() => { api.copyText(`${urls.tailscaleUrl}/api/mobile/apk`); flash('ok', 'Enlace directo del APK por Tailscale copiado.'); }}>
                          <Download size={13} /> Copiar link APK
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="banner">
                    Aún no detecto IP de Tailscale. Ve a <strong>Instalador 1-clic</strong> para habilitar el acceso desde fuera de tu casa.
                  </div>
                )}

                {urls.lanUrl && (
                  <div className="qr-card">
                    {urls.lanQr && <img src={urls.lanQr} alt="QR LAN" />}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <span className="badge accent">Red local · Wi-Fi</span>
                      <div className="mono" style={{ margin: '6px 0', wordBreak: 'break-all' }}>{urls.lanUrl}</div>
                      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                        <button className="btn btn-sm" onClick={() => { api.copyText(urls.lanUrl); flash('ok', 'URL LAN copiada.'); }}>
                          <Copy size={13} /> Copiar URL
                        </button>
                        <button className="btn btn-sm btn-primary" onClick={() => { api.copyText(`${urls.lanUrl}/api/mobile/apk`); flash('ok', 'Enlace directo del APK por Wi-Fi copiado.'); }}>
                          <Download size={13} /> Copiar link APK (Wi-Fi)
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="card">
                <h2><Link2 size={17} /> Equipos en tu malla Tailscale y actividad</h2>
                {env.tailscale.peers?.length > 0 ? (
                  <div className="list">
                    {env.tailscale.peers.map((p, idx) => (
                      <div key={idx} className="list-item">
                        <div>
                          <div style={{ fontWeight: 600 }}>{p.hostName || p.dnsName}</div>
                          <div className="muted mono">{p.ip} · {p.os}</div>
                        </div>
                        <span className={`badge ${p.online ? 'ok' : ''}`}>{p.online ? 'En línea' : 'Apagado'}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted">Cuando inicies sesión en Tailscale en tus otros equipos y tu Android, aparecerán aquí automáticamente.</p>
                )}

                <h3 style={{ marginTop: 6 }}>Registro en vivo</h3>
                <div className="log-box">
                  {server.recentActivity?.length
                    ? server.recentActivity.map((a) => `[${a.ts.slice(11, 19)}] ${a.message}`).join('\n')
                    : 'Sin actividad registrada todavía.'}
                </div>
              </div>
            </div>
          </>
        )}

        <Suspense fallback={<div className="card"><p className="muted">Cargando módulo...</p></div>}>
        {tab === 'metrics' && (
          <MetricsView api={api} flash={flash} />
        )}

        {tab === 'chat' && (
          <ChatView api={api} state={state} flash={flash} onUnreadChange={(n) => setUnreadChats(Number(n) || 0)} />
        )}

        {tab === 'tools' && (
          <ToolsView
            api={api}
            state={state}
            flash={flash}
            onQuickConnectKey={handleQuickConnectKey}
            onOpenTab={setTab}
          />
        )}

        {tab === 'mini' && (
          <MiniInternetPackagesView
            api={api}
            state={state}
            flash={flash}
            onSessionConnected={(res) => {
              setState(res.state);
              setActiveSessionId(res.sessionId);
              setActiveRemoteShare(null);
              setRemotePath('');
              setRemoteItems([]);
              setTab('client');
            }}
          />
        )}
        </Suspense>

        {tab === 'host' && (
          <>
            <div className="page-head">
              <div>
                <h1>Carpetas compartidas (Modo Host)</h1>
                <p>Selecciona qué carpetas de este equipo expones por tu túnel cifrado y con qué permisos.</p>
              </div>
              <button className="btn btn-primary" onClick={handleAddShare}>
                <Plus size={16} /> Añadir carpeta
              </button>
            </div>

            <div className="card">
              <div className="list">
                {config.shares.length === 0 && (
                  <p className="muted">No hay carpetas agregadas todavía. Pulsa "Añadir carpeta" para comenzar.</p>
                )}
                {config.shares.map((s) => (
                  <div key={s.id} className="list-item">
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="row">
                        <strong>{s.name}</strong>
                        <span className={`badge ${s.enabled ? 'ok' : 'warn'}`}>{s.enabled ? 'Activa' : 'Pausada'}</span>
                        <span className={`badge ${s.mode === 'rw' ? 'accent' : ''}`}>
                          {s.mode === 'rw' ? 'Lectura y escritura' : 'Solo lectura'}
                        </span>
                      </div>
                      <div className="muted mono" style={{ marginTop: 4 }}>{s.path}</div>
                    </div>
                    <div className="row">
                      <button
                        className="btn btn-sm"
                        onClick={async () => setState(await api.updateShare(s.id, { mode: s.mode === 'rw' ? 'ro' : 'rw' }))}
                      >
                        Cambiar a {s.mode === 'rw' ? 'Solo lectura' : 'RW'}
                      </button>
                      <button
                        className="btn btn-sm"
                        onClick={async () => setState(await api.updateShare(s.id, { enabled: !s.enabled }))}
                      >
                        {s.enabled ? 'Pausar' : 'Activar'}
                      </button>
                      <button className="btn btn-sm" onClick={() => api.openLocalFolder(s.path)}>Abrir</button>
                      <button
                        className="btn btn-sm btn-danger"
                        title="Quitar de compartidos"
                        onClick={async () => {
                          setState(await api.removeShare(s.id));
                          flash('ok', `Carpeta "${s.name}" quitada (tus archivos locales no se borran).`);
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {tab === 'keys' && (
          <>
            <div className="page-head">
              <div>
                <h1>Llaves encriptadas y Pendrive</h1>
                <p>Genera llaves cifradas (PBKDF2 + AES-256-GCM + Ed25519), guárdalas en uno o varios pendrives/carpetas o cópialas al portapapeles.</p>
              </div>
              <button className="btn" onClick={refresh}><RefreshCw size={15} /> Detectar USB</button>
            </div>

            <div className="grid-2">
              <form className="card" onSubmit={handleGenerateKey}>
                <h2><KeyRound size={17} /> Generar nueva llave encriptada</h2>
                <div className="field">
                  <label>Nombre identificador</label>
                  <input type="text" value={keyLabel} onChange={(e) => setKeyLabel(e.target.value)} placeholder="Ej. Pendrive Esteban / Laptop Trabajo" />
                </div>
                <div className="grid-2">
                  <div className="field">
                    <label>Permisos</label>
                    <select value={keyPerm} onChange={(e) => setKeyPerm(e.target.value)}>
                      <option value="rw">Lectura y escritura completa (RW)</option>
                      <option value="ro">Solo lectura (RO)</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Alcance de carpetas</label>
                    <select value={keyAllShares ? 'all' : 'custom'} onChange={(e) => setKeyAllShares(e.target.value === 'all')}>
                      <option value="all">Todas las carpetas activas</option>
                      <option value="custom">Elegir carpetas específicas</option>
                    </select>
                  </div>
                </div>

                {!keyAllShares && (
                  <div className="list">
                    {config.shares.map((s) => (
                      <label key={s.id} className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={selectedShareIds.includes(s.id)}
                          onChange={(e) => setSelectedShareIds((prev) => e.target.checked ? [...prev, s.id] : prev.filter((x) => x !== s.id))}
                        />
                        <span>{s.name}</span>
                      </label>
                    ))}
                  </div>
                )}

                <div className="grid-2">
                  <div className="field">
                    <label>Frase de paso (cifra la llave)</label>
                    <div className="input-wrap">
                      <input
                        type={showKeyPass ? 'text' : 'password'}
                        value={keyPass}
                        onChange={(e) => setKeyPass(e.target.value)}
                        placeholder="Mínimo 6 caracteres"
                      />
                      <button type="button" className="input-eye" onClick={() => setShowKeyPass((v) => !v)} aria-label="Mostrar u ocultar frase">
                        {showKeyPass ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                  </div>
                  <div className="field">
                    <label>Confirmar frase de paso</label>
                    <input
                      type={showKeyPass ? 'text' : 'password'}
                      value={keyPass2}
                      onChange={(e) => setKeyPass2(e.target.value)}
                      placeholder="Repetir frase"
                    />
                  </div>
                </div>

                {keyPass && (
                  <div className="field" style={{ gap: 4 }}>
                    <div className="strength-bar">
                      <div className="strength-fill" style={{ width: `${strength.score}%`, background: strength.color }} />
                    </div>
                    <span className="muted" style={{ fontSize: 11.5 }}>Seguridad: <strong style={{ color: strength.color }}>{strength.label}</strong></span>
                  </div>
                )}

                <button type="submit" className="btn btn-primary" disabled={busy}>
                  <ShieldCheck size={16} /> Generar llave encriptada (.ecloudkey)
                </button>
              </form>

              <div className="card">
                <h2><Usb size={17} /> Guardar en pendrive / varias ubicaciones o copiar</h2>
                {!generatedKey ? (
                  <p className="muted">
                    Genera una llave a la izquierda para guardarla simultáneamente en tus pendrives USB detectados, en carpetas de respaldo o copiarla en un clic.
                  </p>
                ) : (
                  <>
                    <div className="banner ok">
                      Llave lista: <strong className="mono">{generatedKey.keyId}</strong> ({generatedKey.suggestedFileName})
                    </div>
                    <div className="field">
                      <label>Destinos donde guardar la llave</label>
                      {env.usbDrives.length > 0 && (
                        <div className="list">
                          {env.usbDrives.map((u) => (
                            <label key={u.drive} className="checkbox-row">
                              <input
                                type="checkbox"
                                checked={saveDirs.includes(u.root)}
                                onChange={(e) => setSaveDirs((prev) => e.target.checked ? [...new Set([...prev, u.root])] : prev.filter((d) => d !== u.root))}
                              />
                              <span><strong>{u.drive}</strong> ({u.label}) — {fmtSize(u.freeBytes)} libres</span>
                            </label>
                          ))}
                        </div>
                      )}
                      {saveDirs.filter((d) => !env.usbDrives.some((u) => u.root === d)).map((dir) => (
                        <div key={dir} className="list-item" style={{ padding: '8px 10px' }}>
                          <span className="mono">{dir}</span>
                          <button className="btn btn-sm btn-danger" onClick={() => setSaveDirs((prev) => prev.filter((x) => x !== dir))}>Quitar</button>
                        </div>
                      ))}
                      <div className="row" style={{ marginTop: 6 }}>
                        <button type="button" className="btn btn-sm" onClick={handleAddSaveDir}>
                          <Plus size={14} /> Añadir carpeta destino
                        </button>
                        <button type="button" className="btn btn-sm btn-primary" onClick={handleSaveKeyMultiple}>
                          Guardar en {saveDirs.length} ubicación(es)
                        </button>
                      </div>
                    </div>

                    <div className="field">
                      <label>Texto cifrado portable (para copiar o pegar en móvil/otro PC)</label>
                      <textarea readOnly className="mono" value={generatedKey.clipboardString} />
                      <div className="row">
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => { api.copyText(generatedKey.clipboardString); flash('ok', 'Llave encriptada copiada al portapapeles.'); }}
                        >
                          <Copy size={14} /> Copiar llave encriptada
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => { api.copyText(generatedKey.bundleJson); flash('ok', 'JSON .ecloudkey copiado.'); }}
                        >
                          <Copy size={14} /> Copiar JSON
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="card">
              <div className="between" style={{ marginBottom: 12 }}>
                <div>
                  <h2><KeyRound size={17} color="#67e8f9" /> Bóveda Visible de Claves (Este equipo y Pendrives USB)</h2>
                  <p className="muted" style={{ margin: '4px 0 0' }}>
                    Aquí ves todas tus llaves Totales, sus claves/contraseñas en texto claro, dónde están guardadas y sus códigos portables.
                  </p>
                </div>
                <button className="btn btn-sm" onClick={refresh}>
                  <RefreshCw size={14} /> Actualizar llaves
                </button>
              </div>

              {(state.detectedKeys || []).length === 0 && config.keys.length === 0 ? (
                <p className="muted">Todavía no hay llaves registradas ni detectadas.</p>
              ) : (
                <div className="list">
                  {(state.detectedKeys || []).map((k) => {
                    const visiblePass = k.passphrase || config.keyVault?.[k.keyId]?.passphrase || '';
                    return (
                      <div key={k.keyId} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
                        <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                            <strong style={{ fontSize: 14.5 }}>{k.label}</strong>
                            <span className="mono badge">{k.keyId}</span>
                            <span className={`badge ${k.revoked ? 'danger' : 'ok'}`}>
                              {k.revoked ? 'Revocada' : (k.isLocalHostKey ? 'Autorizada en este PC' : `Equipo: ${k.nodeName || 'Remoto'}`)}
                            </span>
                            <span className="badge accent">
                              {k.isTotal !== false ? 'TOTAL · Todas las carpetas (RW)' : (k.permissions === 'rw' ? 'RW' : 'Solo lectura')}
                            </span>
                            {(k.tailscaleIp || k.lanIp) && (
                              <span className="mono muted" style={{ fontSize: 12 }}>
                                {k.tailscaleIp || k.lanIp}:{k.port || 4789}
                              </span>
                            )}
                          </div>
                          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                            {k.primaryPath && (
                              <button
                                className="btn btn-sm btn-primary"
                                onClick={() => handleQuickConnectKey(k)}
                              >
                                <Link2 size={13} /> Conectar en 1 clic
                              </button>
                            )}
                            {k.clipboardString && (
                              <button
                                className="btn btn-sm"
                                onClick={() => { api.copyText(k.clipboardString); flash('ok', `Código ECLOUD1 de ${k.keyId} copiado.`); }}
                              >
                                <Copy size={13} /> Copiar ECLOUD1:
                              </button>
                            )}
                            {k.bundleJson && (
                              <button
                                className="btn btn-sm"
                                onClick={() => { api.copyText(k.bundleJson); flash('ok', `JSON .ecloudkey de ${k.keyId} copiado.`); }}
                              >
                                <Copy size={13} /> Copiar JSON
                              </button>
                            )}
                            {k.bundleJson && (
                              <button
                                className="btn btn-sm"
                                onClick={async () => {
                                  try {
                                    const res = await api.syncKeyToAllUsb(k.keyId);
                                    setState(res.state);
                                    flash('ok', `Llave ${k.keyId} sincronizada en: ${res.saved.join(' | ')}`);
                                  } catch (err) {
                                    flash('error', err.message);
                                  }
                                }}
                              >
                                <Usb size={13} /> Sincronizar a USBs
                              </button>
                            )}
                            {k.isLocalHostKey && !k.revoked && (
                              <button
                                className="btn btn-sm btn-danger"
                                onClick={async () => {
                                  setState(await api.revokeKey(k.keyId));
                                  flash('ok', `Llave ${k.keyId} revocada al instante.`);
                                }}
                              >
                                <ShieldAlert size={13} /> Revocar
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="between" style={{ flexWrap: 'wrap', gap: 10, background: 'rgba(15, 23, 42, 0.55)', padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(56, 189, 248, 0.18)' }}>
                          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                            <span className="muted" style={{ fontSize: 12 }}>Clave / Contraseña:</span>
                            <code className="mono" style={{ fontSize: 13.5, color: '#67e8f9', fontWeight: 700, background: 'rgba(8, 47, 73, 0.55)', padding: '3px 8px', borderRadius: 6 }}>
                              {visiblePass || '(sin clave guardada)'}
                            </code>
                            {visiblePass && (
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() => { api.copyText(visiblePass); flash('ok', `Clave de ${k.keyId} copiada al portapapeles.`); }}
                              >
                                <Copy size={12} /> Copiar clave
                              </button>
                            )}
                          </div>
                          {k.locations && k.locations.length > 0 && (
                            <div className="muted mono" style={{ fontSize: 11.5 }}>
                              Archivos: {k.locations.join(' · ')}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {tab === 'kit' && (
          <>
            <div className="page-head">
              <div>
                <h1>Pasar Esteban Cloud al Pendrive (Paquete Todo-en-Uno)</h1>
                <p>Exporta en un solo clic un paquete completo listo para enchufar en cualquier otra PC Windows: instalador, lanzador automático, scripts de dependencias y tu llave encriptada.</p>
              </div>
              <button className="btn" onClick={refresh} disabled={busy}>
                <RefreshCw size={15} /> Detectar USB
              </button>
            </div>

            <div className="card hero-card">
              <div className="between">
                <div>
                  <h2><Package size={18} color="#67e8f9" /> Exportar paquete completo al pendrive</h2>
                  <p className="muted" style={{ marginTop: 4, marginBottom: 0 }}>
                    Crea la carpeta <code>Esteban-Cloud-Kit</code> (y opcionalmente un único archivo <code>.zip</code>) con <strong>1-INSTALAR-ESTEBAN-CLOUD.cmd</strong>, el instalador Windows, scripts PowerShell y tu llave <code>.ecloudkey</code>.
                  </p>
                </div>
                <button className="btn btn-primary btn-lg" onClick={handleExportKit} disabled={busy}>
                  <Usb size={17} /> Pasar todo al Pendrive ahora
                </button>
              </div>

              <div className="grid-2">
                <div className="field">
                  <label>1. Pendrive USB o carpeta destino</label>
                  {env.usbDrives.length > 0 && (
                    <div className="row" style={{ marginBottom: 4 }}>
                      {env.usbDrives.map((u) => (
                        <button
                          key={u.drive}
                          type="button"
                          className={`btn btn-sm ${kitTargetDir === u.root ? 'btn-primary' : ''}`}
                          onClick={() => setKitTargetDir(u.root)}
                        >
                          <Usb size={13} /> {u.drive} ({u.label} · {fmtSize(u.freeBytes)} libres)
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="row">
                    <input
                      type="text"
                      style={{ flex: 1 }}
                      value={kitTargetDir}
                      onChange={(e) => setKitTargetDir(e.target.value)}
                      placeholder="Ej. E:\ o elige una carpeta destino"
                    />
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={async () => {
                        const dir = await api.pickSaveFolder();
                        if (dir) setKitTargetDir(dir);
                      }}
                    >
                      <FolderOpen size={14} /> Elegir carpeta
                    </button>
                  </div>
                </div>

                <div className="field">
                  <label>2. Instalador incluido en el paquete</label>
                  <div className="list-item" style={{ padding: '9px 12px' }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>
                        {kitCustomInstaller
                          ? kitCustomInstaller.split(/[\\/]/).pop()
                          : installerInfo?.found
                            ? installerInfo.name
                            : 'Instalador no detectado automáticamente'}
                      </div>
                      <div className="muted mono" style={{ wordBreak: 'break-all' }}>
                        {kitCustomInstaller || (installerInfo?.found ? `${fmtSize(installerInfo.size)} · ${installerInfo.path}` : 'Selecciona el .exe manualmente')}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={async () => {
                        const p = await api.pickKitInstaller();
                        if (p) setKitCustomInstaller(p);
                      }}
                    >
                      Cambiar .exe
                    </button>
                  </div>
                </div>
              </div>

              <div className="row">
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={kitIncludeGeneratedKey}
                    disabled={!generatedKey}
                    onChange={(e) => setKitIncludeGeneratedKey(e.target.checked)}
                  />
                  <span>
                    {generatedKey
                      ? `Incluir la llave recién generada (${generatedKey.suggestedFileName})`
                      : 'Sin llave recién generada (opcional: crea una en "Llaves y Pendrive" para incluirla aquí)'}
                  </span>
                </label>
                {!generatedKey && (
                  <button type="button" className="btn btn-sm" onClick={() => setTab('keys')}>
                    <KeyRound size={13} /> Crear llave primero
                  </button>
                )}
              </div>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={kitCreateZip}
                  onChange={(e) => setKitCreateZip(e.target.checked)}
                />
                <span>Empaquetar también en un solo archivo <code>.zip</code> además de la carpeta lista para doble clic</span>
              </label>
            </div>

            {kitResult && (
              <div className="card">
                <div className="between">
                  <h2><CheckCircle2 size={17} color="#34d399" /> Kit exportado correctamente</h2>
                  <button className="btn btn-sm btn-primary" onClick={() => api.openLocalFolder(kitResult.kitDir)}>
                    <FolderOpen size={14} /> Abrir carpeta del Kit
                  </button>
                </div>
                <div className="list">
                  <div className="list-item">
                    <span>Carpeta lista en destino</span>
                    <span className="mono">{kitResult.kitDir}</span>
                  </div>
                  <div className="list-item">
                    <span>Instalador incluido</span>
                    <span className="mono">{kitResult.installerName} ({fmtSize(kitResult.installerSize)})</span>
                  </div>
                  <div className="list-item">
                    <span>Llave encriptada incluida</span>
                    <span className={`badge ${kitResult.keyIncluded ? 'ok' : ''}`}>
                      {kitResult.keyIncluded ? kitResult.keyFileName : 'No incluida (solo programa + scripts)'}
                    </span>
                  </div>
                  {kitResult.zipPath && (
                    <div className="list-item">
                      <span>Archivo único ZIP</span>
                      <span className="mono">{kitResult.zipPath}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="card">
              <h2>Qué va dentro de tu pendrive</h2>
              <div className="grid-3">
                <div className="step-card done">
                  <strong>1-INSTALAR-ESTEBAN-CLOUD.cmd</strong>
                  <p className="muted" style={{ margin: 0 }}>En cualquier otra PC Windows, haces doble clic ahí: instala el programa y lo abre automáticamente.</p>
                </div>
                <div className="step-card done">
                  <strong>Setup .exe + Scripts 1-clic</strong>
                  <p className="muted" style={{ margin: 0 }}>Lleva el instalador oficial local + el script PowerShell para instalar Tailscale, rclone, WinFsp y Firewall.</p>
                </div>
                <div className="step-card done">
                  <strong>Tu llave .ecloudkey + guía</strong>
                  <p className="muted" style={{ margin: 0 }}>Al abrir la app en el otro PC, "Buscar llaves en USB" la detecta automáticamente dentro de <code>Esteban-Cloud-Kit</code>.</p>
                </div>
              </div>
            </div>
          </>
        )}

        {tab === 'client' && (
          <>
            <div className="page-head">
              <div>
                <h1>Conectar a otro equipo (Modo Cliente · Bidireccional)</h1>
                <p>Arrastra o carga tu llave <code>.ecloudkey</code> desde el pendrive para montar carpetas remotas como unidad <code>Z:</code> o explorarlas directamente aquí.</p>
              </div>
              <div className="row">
                <button className="btn" onClick={handleScanUsb}><Usb size={15} /> Buscar llaves en USB</button>
                <button className="btn" onClick={handlePickKeyFile}><FolderOpen size={15} /> Cargar .ecloudkey</button>
              </div>
            </div>

            <div className="card hero-card">
              <div className="between" style={{ gap: 10, flexWrap: 'wrap' }}>
                <div>
                  <h3><Sparkles size={16} color="#34d399" /> Conexión Mágica sin Pendrive (Código EC-XXXX)</h3>
                  <p className="muted" style={{ margin: '2px 0 0' }}>
                    En el otro PC entra a <strong>Mini-Internet y Paquetes → Generar Código Mágico</strong> y escríbelo aquí para conectar al instante.
                  </p>
                </div>
                <form
                  className="row"
                  style={{ gap: 6 }}
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!quickPairCode.trim()) return flash('error', 'Escribe el código mágico (ej. EC-7K9P).');
                    setBusy(true);
                    try {
                      const res = await api.connectWithPairingCode({ code: quickPairCode.trim() });
                      setState(res.state);
                      setActiveSessionId(res.sessionId);
                      setActiveRemoteShare(null);
                      setRemotePath('');
                      setRemoteItems([]);
                      setQuickPairCode('');
                      flash('ok', `Conectado mágicamente a ${res.session.nodeName} (${res.session.baseUrl}).`);
                    } catch (err) {
                      flash('error', err.message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <input
                    type="text"
                    style={{ width: 135, textTransform: 'uppercase' }}
                    value={quickPairCode}
                    onChange={(e) => setQuickPairCode(e.target.value)}
                    placeholder="EC-XXXX"
                  />
                  <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
                    <Zap size={13} /> Conectar 1-clic
                  </button>
                </form>
              </div>
            </div>

            {((state.detectedKeys && state.detectedKeys.length > 0) || usbKeys.length > 0) && (
              <div className="card">
                <div className="between" style={{ marginBottom: 10 }}>
                  <h3><KeyRound size={16} color="#67e8f9" /> Llaves Totales y Claves disponibles (Conexión en 1 clic)</h3>
                  <span className="badge accent">Auto-relleno de clave activo</span>
                </div>
                <div className="list">
                  {(state.detectedKeys || []).map((dk) => {
                    const savedPass = dk.passphrase || config.keyVault?.[dk.keyId]?.passphrase || '';
                    return (
                      <div key={dk.keyId} className="list-item" style={{ flexWrap: 'wrap', gap: 10 }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                            <strong>{dk.label}</strong>
                            <span className="mono badge">{dk.keyId}</span>
                            <span className="badge ok">Equipo: {dk.nodeName || 'Nodo'}</span>
                            <span className="badge accent">TOTAL · RW</span>
                          </div>
                          <div className="row" style={{ marginTop: 6, flexWrap: 'wrap', gap: 10 }}>
                            <span className="muted" style={{ fontSize: 12 }}>
                              Clave: <strong className="mono" style={{ color: '#67e8f9' }}>{savedPass || '(sin clave guardada)'}</strong>
                            </span>
                            {dk.primaryPath && (
                              <span className="muted mono" style={{ fontSize: 11.5 }}>{dk.primaryPath}</span>
                            )}
                          </div>
                        </div>
                        <div className="row" style={{ gap: 6 }}>
                          {savedPass && (
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => { api.copyText(savedPass); flash('ok', `Clave ${savedPass} copiada.`); }}
                            >
                              <Copy size={13} /> Copiar clave
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => {
                              setBundleFilePath(dk.primaryPath || '');
                              setBundleText(dk.primaryPath ? '' : (dk.bundleJson || ''));
                              if (savedPass) setClientPass(savedPass);
                              flash('ok', `Llave y clave de ${dk.nodeName || dk.label} cargadas en el formulario.`);
                            }}
                          >
                            Rellenar formulario
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm"
                            disabled={busy}
                            onClick={() => handleQuickConnectKey(dk, { autoMount: false })}
                          >
                            <Link2 size={13} /> Conectar
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            disabled={busy}
                            onClick={() => handleQuickConnectKey(dk, { autoMount: true })}
                          >
                            <Zap size={13} /> Conectar + Montar Libre
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="grid-2">
              <form
                className="card"
                onSubmit={handleConnect}
                onDragOver={(e) => { e.preventDefault(); setDraggingKey(true); }}
                onDragLeave={() => setDraggingKey(false)}
                onDrop={handleDropKeyFile}
              >
                <h2>Desbloquear y conectar</h2>
                <div className={`dropzone ${draggingKey ? 'dragging' : ''}`}>
                  <div className="between">
                    <span className="muted">
                      {bundleFilePath
                        ? <>Archivo listo: <strong className="mono" style={{ color: '#bae6fd' }}>{bundleFilePath}</strong></>
                        : 'Arrastra aquí tu archivo .ecloudkey desde tu pendrive, o pega el texto abajo.'}
                    </span>
                    <button type="button" className="btn btn-sm" onClick={handlePickKeyFile}>Examinar</button>
                  </div>
                </div>
                <div className="field">
                  <label>O pegar texto encriptado</label>
                  <textarea
                    className="mono"
                    value={bundleText}
                    onChange={(e) => { setBundleText(e.target.value); setBundleFilePath(''); }}
                    placeholder="ECLOUD1:... o JSON .ecloudkey"
                  />
                </div>
                <div className="field">
                  <label>Frase de paso de la llave</label>
                  <div className="input-wrap">
                    <input
                      type={showClientPass ? 'text' : 'password'}
                      value={clientPass}
                      onChange={(e) => setClientPass(e.target.value)}
                      placeholder="Escribe la frase secreta de esta llave"
                    />
                    <button type="button" className="input-eye" onClick={() => setShowClientPass((v) => !v)} aria-label="Mostrar u ocultar frase">
                      {showClientPass ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
                <div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setShowAdvancedClient((v) => !v)}
                  >
                    {showAdvancedClient ? 'Ocultar opciones avanzadas' : 'Opciones avanzadas (URL manual)'}
                  </button>
                  {showAdvancedClient && (
                    <div className="field" style={{ marginTop: 8 }}>
                      <label>URL manual del nodo (opcional — normalmente dejar vacío)</label>
                      <input
                        type="text"
                        value={overrideUrl}
                        onChange={(e) => setOverrideUrl(e.target.value)}
                        placeholder="Auto (Tailscale → LAN), ej. http://100.x.x.x:4789"
                      />
                    </div>
                  )}
                </div>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  <Link2 size={16} /> Conectar al nodo remoto
                </button>
              </form>

              <Suspense fallback={<div className="card"><p className="muted">Cargando organizador de discos...</p></div>}>
                <DriveOrganizerCard
                  api={api}
                  state={state}
                  activeSession={activeSession}
                  busy={busy}
                  setBusy={setBusy}
                  setState={setState}
                  flash={flash}
                  onQuickConnectAndMount={handleQuickConnectPeer}
                  onOptimizeRoute={handleOptimizeRoute}
                  renderRouteBadge={renderRouteBadge}
                />
              </Suspense>
            </div>

            {activeSession && (
              <div className="card">
                <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
                  <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                    <h2>Explorador remoto integrado · {activeSession.nodeName}</h2>
                    {renderRouteBadge(activeSession.routeInfo)}
                    <button className="btn btn-sm" onClick={handleOptimizeRoute} disabled={busy}>
                      <Zap size={13} /> Optimizar Ruta + Turbo 8x
                    </button>
                  </div>
                  {activeRemoteShare && (
                    <div className="row">
                      <div style={{ position: 'relative', width: 200 }}>
                        <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: '#94a3b8' }} />
                        <input
                          type="text"
                          value={remoteSearch}
                          onChange={(e) => setRemoteSearch(e.target.value)}
                          placeholder="Filtrar archivos..."
                          style={{ paddingLeft: 30, paddingTop: 6, paddingBottom: 6, fontSize: 12.5 }}
                        />
                      </div>
                      <button className="btn btn-sm" onClick={() => loadRemoteDir(activeSession.sessionId, activeRemoteShare, remotePath)}>
                        <RefreshCw size={13} /> Actualizar
                      </button>
                      {activeRemoteShare.effectiveMode === 'rw' && (
                        <>
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={async () => {
                              const r = await api.uploadRemoteFiles({ sessionId: activeSession.sessionId, shareId: activeRemoteShare.id, relPath: remotePath });
                              if (!r.canceled) {
                                flash('ok', `Subido(s): ${r.uploaded.join(', ')}`);
                                loadRemoteDir(activeSession.sessionId, activeRemoteShare, remotePath);
                              }
                            }}
                          >
                            <Upload size={13} /> Subir
                          </button>
                          <button
                            className="btn btn-sm"
                            onClick={async () => {
                              const name = window.prompt('Nombre de la nueva carpeta:');
                              if (!name) return;
                              await api.createRemoteFolder({ sessionId: activeSession.sessionId, shareId: activeRemoteShare.id, relPath: remotePath, name });
                              loadRemoteDir(activeSession.sessionId, activeRemoteShare, remotePath);
                            }}
                          >
                            <FolderPlus size={13} /> + Carpeta
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {!activeRemoteShare ? (
                  <div className="grid-3">
                    {activeSession.shares.map((s) => (
                      <button
                        key={s.id}
                        className="list-item"
                        style={{ cursor: 'pointer', textAlign: 'left', color: 'var(--text)' }}
                        onClick={() => loadRemoteDir(activeSession.sessionId, s, '')}
                      >
                        <div>
                          <strong>📁 {s.name}</strong>
                          <div className="muted">{s.effectiveMode === 'rw' ? 'Lectura y escritura' : 'Solo lectura'}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <>
                    <div className="row">
                      <button className="btn btn-sm" onClick={() => { setActiveRemoteShare(null); setRemotePath(''); }}>← Carpetas</button>
                      {remotePath && (
                        <button
                          className="btn btn-sm"
                          onClick={() => {
                            const parts = remotePath.split('/').filter(Boolean);
                            parts.pop();
                            loadRemoteDir(activeSession.sessionId, activeRemoteShare, parts.join('/'));
                          }}
                        >
                          ↑ Subir nivel
                        </button>
                      )}
                      <span className="mono muted">{activeRemoteShare.name}/{remotePath}</span>
                    </div>
                    <div className="list">
                      {filteredRemoteItems.length === 0 && <p className="muted">Sin elementos para mostrar.</p>}
                      {filteredRemoteItems.map((it) => {
                        const full = remotePath ? `${remotePath}/${it.name}` : it.name;
                        return (
                          <div key={full} className="list-item" style={{ padding: '9px 12px' }}>
                            <div
                              style={{ cursor: it.isDirectory ? 'pointer' : 'default', flex: 1 }}
                              onClick={() => it.isDirectory && loadRemoteDir(activeSession.sessionId, activeRemoteShare, full)}
                            >
                              <span>{it.isDirectory ? '📁' : '📄'} {it.name}</span>
                              {!it.isDirectory && <span className="muted" style={{ marginLeft: 10 }}>{fmtSize(it.size)}</span>}
                            </div>
                            <div className="row">
                              {!it.isDirectory && (
                                <button
                                  className="btn btn-sm"
                                  onClick={async () => {
                                    const r = await api.downloadRemoteFile({
                                      sessionId: activeSession.sessionId,
                                      shareId: activeRemoteShare.id,
                                      relPath: full,
                                      fileName: it.name,
                                      fileSize: it.size
                                    });
                                    if (!r.canceled) flash('ok', `Descargado en ${r.savedPath}${r.speedMBs ? ` (${r.speedMBs} MB/s · ${r.parallelStreams || 1}x)` : ''}`);
                                  }}
                                >
                                  <Download size={13} /> Descargar Turbo
                                </button>
                              )}
                              {activeRemoteShare.effectiveMode === 'rw' && (
                                <>
                                  <button
                                    className="btn btn-sm"
                                    title="Renombrar"
                                    onClick={async () => {
                                      const nextName = window.prompt('Nuevo nombre:', it.name);
                                      if (!nextName || nextName === it.name) return;
                                      const to = remotePath ? `${remotePath}/${nextName}` : nextName;
                                      await api.renameRemoteItem({ sessionId: activeSession.sessionId, shareId: activeRemoteShare.id, from: full, to });
                                      loadRemoteDir(activeSession.sessionId, activeRemoteShare, remotePath);
                                    }}
                                  >
                                    <Pencil size={13} />
                                  </button>
                                  <button
                                    className="btn btn-sm btn-danger"
                                    title="Eliminar"
                                    onClick={async () => {
                                      if (!window.confirm(`¿Eliminar "${it.name}"?`)) return;
                                      await api.deleteRemoteItem({ sessionId: activeSession.sessionId, shareId: activeRemoteShare.id, relPath: full });
                                      loadRemoteDir(activeSession.sessionId, activeRemoteShare, remotePath);
                                    }}
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}

        {tab === 'deps' && (
          <>
            <div className="page-head">
              <div>
                <h1>Instalador automático con un solo botón</h1>
                <p>Instala y configura automáticamente con PowerShell + <code>winget</code> todo lo necesario para tu túnel global cifrado y montaje de discos <code>Z:</code>.</p>
              </div>
              <button className="btn" onClick={refresh}><RefreshCw size={15} /> Re-comprobar</button>
            </div>

            <div className="card hero-card">
              <div className="between">
                <div>
                  <h2><Wrench size={18} color="#67e8f9" /> Instalación completa en 1 clic</h2>
                  <p className="muted" style={{ marginTop: 4, marginBottom: 0 }}>
                    Instala <strong>Tailscale</strong> (túnel global), <strong>rclone</strong> + <strong>WinFsp</strong> (disco <code>Z:</code>) y crea el Firewall limitado solo a Tailscale y tu red privada.
                  </p>
                </div>
                <button className="btn btn-primary btn-lg" onClick={handleInstallDeps} disabled={busy}>
                  <Wrench size={17} /> Instalar y configurar todo ahora
                </button>
              </div>
              <div className="row">
                <label className="checkbox-row">
                  <input type="checkbox" checked={optDisableSleep} onChange={(e) => setOptDisableSleep(e.target.checked)} />
                  <span>Evitar suspensión automática (enchufado)</span>
                </label>
                <label className="checkbox-row">
                  <input type="checkbox" checked={optOpenSsh} onChange={(e) => setOptOpenSsh(e.target.checked)} />
                  <span>Instalar OpenSSH Server (SFTP opcional)</span>
                </label>
                <button className="btn btn-sm" onClick={() => api.launchTailscale()}>
                  <Globe size={14} /> Abrir / iniciar sesión en Tailscale
                </button>
                <button className="btn btn-sm" onClick={() => api.openScriptsFolder()}>
                  <FolderOpen size={14} /> Ver scripts PowerShell
                </button>
              </div>
              {installLog && <div className="log-box">{installLog}</div>}
            </div>

            <div className="card">
              <h2>Estado de dependencias en {env.hostName}</h2>
              <div className="grid-2">
                {[
                  { name: 'Tailscale (túnel global WireGuard)', ok: env.tailscale.installed, detail: env.tailscale.running ? `Conectado (${env.tailscale.ip})` : env.tailscale.installed ? 'Instalado · falta iniciar sesión' : 'Falta instalar' },
                  { name: 'rclone (montaje bidireccional WebDAV)', ok: env.rclone.installed, detail: env.rclone.installed ? env.rclone.path : 'Falta instalar' },
                  { name: 'WinFsp (driver de disco virtual Z:)', ok: env.winfsp.installed, detail: env.winfsp.installed ? 'Instalado y listo' : 'Falta instalar' },
                  { name: 'OpenSSH Server (SFTP nativo opcional)', ok: env.sshd.running, detail: env.sshd.installed ? env.sshd.status : 'Opcional (no instalado)' }
                ].map((item) => (
                  <div key={item.name} className="list-item">
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{item.name}</div>
                      <div className="muted mono" style={{ wordBreak: 'break-all' }}>{item.detail}</div>
                    </div>
                    {item.ok ? <CheckCircle2 size={18} color="#34d399" /> : <AlertCircle size={18} color="#fbbf24" />}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {tab === 'settings' && (
          <>
            <div className="page-head">
              <div>
                <h1>Ajustes, actualizaciones y acerca de</h1>
                <p>Configura el arranque automático al encender tu PC y revisa el canal propio de actualizaciones.</p>
              </div>
            </div>

            <div className="grid-2">
              <div className="card">
                <h2>Configuración del nodo</h2>
                <div className="field">
                  <label>Nombre visible de este equipo</label>
                  <input
                    type="text"
                    value={config.nodeName}
                    onChange={(e) => setState({ ...state, config: { ...config, nodeName: e.target.value } })}
                  />
                </div>
                <div className="grid-2">
                  <div className="field">
                    <label>Puerto TCP</label>
                    <input
                      type="number"
                      value={config.port}
                      onChange={(e) => setState({ ...state, config: { ...config, port: Number(e.target.value) } })}
                    />
                  </div>
                  <div className="field">
                    <label>Interfaz de escucha</label>
                    <select
                      value={config.bindMode}
                      onChange={(e) => setState({ ...state, config: { ...config, bindMode: e.target.value } })}
                    >
                      <option value="all">Tailscale + Red Local (Recomendado)</option>
                      <option value="tailscale">Solo túnel Tailscale (más estricto)</option>
                    </select>
                  </div>
                </div>

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={config.autoStartServer}
                    onChange={(e) => setState({ ...state, config: { ...config, autoStartServer: e.target.checked } })}
                  />
                  <span>Activar servidor automáticamente al abrir Esteban Cloud</span>
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={config.startWithWindows}
                    onChange={(e) => setState({ ...state, config: { ...config, startWithWindows: e.target.checked } })}
                  />
                  <span>Iniciar Esteban Cloud automáticamente cuando encienda Windows</span>
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={config.minimizeToTray}
                    onChange={(e) => setState({ ...state, config: { ...config, minimizeToTray: e.target.checked } })}
                  />
                  <span>Mantener activo en la bandeja del sistema al cerrar la ventana</span>
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={Boolean(config.ultraLightTrayMode)}
                    onChange={(e) => setState({ ...state, config: { ...config, ultraLightTrayMode: e.target.checked } })}
                  />
                  <span>Modo Ultra-Ligero en bandeja (&lt; 35 MB RAM liberando Chromium al minimizar)</span>
                </label>

                <button
                  className="btn btn-primary"
                  onClick={async () => {
                    const next = await api.updateSettings({
                      nodeName: config.nodeName,
                      port: config.port,
                      bindMode: config.bindMode,
                      autoStartServer: config.autoStartServer,
                      startWithWindows: config.startWithWindows,
                      minimizeToTray: config.minimizeToTray,
                      ultraLightTrayMode: config.ultraLightTrayMode,
                      uiTheme: config.uiTheme,
                      uiEffects: config.uiEffects,
                      uiDensity: config.uiDensity,
                      uiScale: config.uiScale,
                      resourceProfile: config.resourceProfile,
                      autoAssignFreeDrive: config.autoAssignFreeDrive,
                      preferredStartLetter: config.preferredStartLetter,
                      unifiedMountRoot: config.unifiedMountRoot,
                      updateShareDir: config.updateShareDir,
                      updateServerUrl: config.updateServerUrl,
                      updateGithubRepo: config.updateGithubRepo,
                      enableGithubUpdates: config.enableGithubUpdates,
                      autoCheckUpdates: config.autoCheckUpdates,
                      autoDownloadUpdates: config.autoDownloadUpdates,
                      autoInstallWhenIdle: config.autoInstallWhenIdle
                    });
                    setState((prev) => (next && next.config ? next : { ...prev, config: next }));
                    flash('ok', 'Ajustes y personalización guardados.');
                  }}
                >
                  Guardar cambios
                </button>
              </div>

              <div className="card hero-card">
                <h2><Sparkles size={17} /> Apariencia, Glassmorphism y Discos</h2>
                <div className="field">
                  <label>Paleta de color / Acento</label>
                  <div className="swatch-row">
                    {[
                      { id: 'emerald', label: 'Esmeralda Malla', color: '#34d399' },
                      { id: 'cyan', label: 'Cian Nube', color: '#38bdf8' },
                      { id: 'violet', label: 'Violeta Aurora', color: '#a78bfa' },
                      { id: 'amber', label: 'Ámbar', color: '#fbbf24' },
                      { id: 'rose', label: 'Rosa Neón', color: '#fb7185' },
                      { id: 'mono', label: 'Minimal Mono', color: '#e2e8f0' }
                    ].map((sw) => (
                      <button
                        key={sw.id}
                        type="button"
                        className={`swatch-btn ${(config.uiTheme || 'emerald') === sw.id ? 'active' : ''}`}
                        onClick={async () => {
                          const res = await api.updateSettings({ uiTheme: sw.id });
                          setState((prev) => (res && res.config ? res : { ...prev, config: res }));
                        }}
                      >
                        <span className="swatch-dot" style={{ background: sw.color }} />
                        {sw.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid-3">
                  <div className="field">
                    <label>Efectos visuales</label>
                    <select
                      value={config.uiEffects || 'glass'}
                      onChange={async (e) => {
                        const res = await api.updateSettings({ uiEffects: e.target.value });
                        setState((prev) => (res && res.config ? res : { ...prev, config: res }));
                      }}
                    >
                      <option value="glass">Glassmorphism Moderno</option>
                      <option value="minimal">Minimalista (0% GPU · sin blur)</option>
                      <option value="vivid">Gradientes Aurora Vivos</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Densidad</label>
                    <select
                      value={config.uiDensity || 'comfortable'}
                      onChange={async (e) => {
                        const res = await api.updateSettings({ uiDensity: e.target.value });
                        setState((prev) => (res && res.config ? res : { ...prev, config: res }));
                      }}
                    >
                      <option value="comfortable">Cómoda</option>
                      <option value="compact">Compacta</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Escala de texto</label>
                    <select
                      value={config.uiScale || 'normal'}
                      onChange={async (e) => {
                        const res = await api.updateSettings({ uiScale: e.target.value });
                        setState((prev) => (res && res.config ? res : { ...prev, config: res }));
                      }}
                    >
                      <option value="sm">Compacta (94%)</option>
                      <option value="normal">Normal (100%)</option>
                      <option value="lg">Grande (106%)</option>
                    </select>
                  </div>
                </div>

                <div className="grid-2">
                  <div className="field">
                    <label>Perfil de consumo de recursos</label>
                    <select
                      value={config.resourceProfile || 'auto'}
                      onChange={async (e) => {
                        const res = await api.updateSettings({ resourceProfile: e.target.value });
                        setState((prev) => (res && res.config ? res : { ...prev, config: res }));
                      }}
                    >
                      <option value="auto">Automático según RAM del PC</option>
                      <option value="eco">Modo Eco Estricto (Mínima RAM)</option>
                      <option value="turbo">Modo Turbo (Máxima velocidad)</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Letra inicial preferida (D: a Z:)</label>
                    <select
                      value={config.preferredStartLetter || 'Z:'}
                      onChange={async (e) => {
                        const res = await api.updateSettings({ preferredStartLetter: e.target.value });
                        setState((prev) => (res && res.config ? res : { ...prev, config: res }));
                      }}
                    >
                      {(state.driveLetters?.letters || []).map((l) => (
                        <option key={l.letter} value={l.letter}>{l.letter}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={config.autoAssignFreeDrive !== false}
                    onChange={async (e) => {
                      const res = await api.updateSettings({ autoAssignFreeDrive: e.target.checked });
                      setState((prev) => (res && res.config ? res : { ...prev, config: res }));
                    }}
                  />
                  <span>Auto-asignar otra letra libre si la letra elegida ya está usada por otra PC o USB</span>
                </label>

                <div className="field">
                  <label>Carpeta raíz para montajes sin letra (más allá de 26 unidades)</label>
                  <div className="row">
                    <input
                      type="text"
                      style={{ flex: 1 }}
                      value={config.unifiedMountRoot || ''}
                      onChange={(e) => setState({ ...state, config: { ...config, unifiedMountRoot: e.target.value } })}
                      placeholder="C:\Users\...\EstebanMeshOffice-Red"
                    />
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={async () => {
                        const dir = await api.pickSaveFolder();
                        if (dir) {
                          const res = await api.updateSettings({ unifiedMountRoot: dir });
                          setState((prev) => (res && res.config ? res : { ...prev, config: res }));
                        }
                      }}
                    >
                      Elegir
                    </button>
                  </div>
                </div>

                <div className="between" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <span className="muted" style={{ fontSize: 12 }}>Sitio oficial y proyectos de Esteban Nicola:</span>
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => api.openExternal('https://estebanico.com')}>
                    <Globe size={13} /> Visitar estebanico.com <ExternalLink size={12} />
                  </button>
                </div>
              </div>

              <div className="card">
                <h2>Actualizador automático (Tailscale + GitHub Releases)</h2>
                <p className="muted">
                  Busca automáticamente la versión más reciente tanto en tus equipos de <strong>Tailscale</strong> como en <strong>GitHub Releases</strong>, descarga con verificación <strong>SHA-256</strong> y actualiza automáticamente cuando no hay discos en uso.
                </p>

                <div className="field">
                  <label>Repositorio de GitHub para actualizaciones automáticas</label>
                  <input
                    type="text"
                    value={config.updateGithubRepo || 'estebanico10/esteban-cloud'}
                    onChange={(e) => setState({ ...state, config: { ...config, updateGithubRepo: e.target.value } })}
                    placeholder="estebanico10/esteban-cloud"
                  />
                </div>

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={config.enableGithubUpdates !== false}
                    onChange={(e) => setState({ ...state, config: { ...config, enableGithubUpdates: e.target.checked } })}
                  />
                  <span>Activar canal automático de GitHub Releases (funciona incluso sin PC principal encendida)</span>
                </label>

                <div className="field">
                  <label>Carpeta local que comparte actualizaciones (en tu PC principal)</label>
                  <div className="row">
                    <input
                      type="text"
                      style={{ flex: 1 }}
                      value={config.updateShareDir || ''}
                      onChange={(e) => setState({ ...state, config: { ...config, updateShareDir: e.target.value } })}
                      placeholder="E:\CODE\ESTEBAN CLOUD\release"
                    />
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={async () => {
                        const dir = await api.pickSaveFolder();
                        if (dir) setState({ ...state, config: { ...config, updateShareDir: dir } });
                      }}
                    >
                      Elegir
                    </button>
                  </div>
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    {hostedUpdate
                      ? `Compartiendo ahora a tus otros equipos: v${hostedUpdate.version} (${hostedUpdate.fileName} · ${fmtSize(hostedUpdate.size)})`
                      : 'Sin instalador detectado aún en esa carpeta.'}
                  </span>
                </div>

                <div className="field">
                  <label>URL fija del equipo servidor de actualizaciones (opcional — vacío = automático en Tailscale)</label>
                  <input
                    type="text"
                    value={config.updateServerUrl || ''}
                    onChange={(e) => setState({ ...state, config: { ...config, updateServerUrl: e.target.value } })}
                    placeholder="Auto (detecta PRO-NICOLA y equipos conectados en Tailscale)"
                  />
                </div>

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={config.autoCheckUpdates !== false}
                    onChange={(e) => setState({ ...state, config: { ...config, autoCheckUpdates: e.target.checked } })}
                  />
                  <span>Buscar actualizaciones automáticamente en segundo plano (al iniciar, cada 3 min y por push Tailscale)</span>
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={config.autoDownloadUpdates !== false}
                    onChange={(e) => setState({ ...state, config: { ...config, autoDownloadUpdates: e.target.checked } })}
                  />
                  <span>Pre-descargar y verificar SHA-256 automáticamente desde Tailscale o GitHub Releases</span>
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={config.autoInstallWhenIdle !== false}
                    onChange={(e) => setState({ ...state, config: { ...config, autoInstallWhenIdle: e.target.checked } })}
                  />
                  <span>Instalar y reiniciar automáticamente sin intervención en cuanto la actualización esté verificada</span>
                </label>

                <div className="row">
                  <button
                    className="btn btn-primary"
                    onClick={async () => {
                      setBusy(true);
                      setUpdateProgress(null);
                      try {
                        const info = await api.checkUpdates();
                        setUpdateInfo(info);
                      } finally {
                        setBusy(false);
                      }
                    }}
                    disabled={busy}
                  >
                    <RefreshCw size={15} /> Buscar actualizaciones
                  </button>
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const res = await api.pushUpdateToConnectedPeers();
                        const summary = (res.results || []).map((r) =>
                          r.ok
                            ? `${r.peer}: ${r.mode === 'push-notify' ? 'aviso push enviado' : `paquete subido a ${r.destination}`}`
                            : `${r.peer}: ${r.reason}`
                        ).join(' | ');
                        flash('ok', `Envío de actualización: ${summary}`);
                      } catch (err) {
                        flash('error', err.message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <Upload size={15} /> Enviar a equipos conectados
                  </button>
                  {updateInfo && (updateInfo.downloadUrl || updateInfo.localPath) && updateInfo.status === 'update-available' && (
                    <button
                      className="btn btn-primary"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await api.downloadAndInstallUpdate(updateInfo);
                        } catch (err) {
                          setUpdateProgress(null);
                          flash('error', err.message);
                          setBusy(false);
                        }
                      }}
                    >
                      <Download size={15} /> Descargar e instalar v{updateInfo.latestVersion}
                    </button>
                  )}
                  <button className="btn btn-sm" onClick={() => api.openExternal(`https://github.com/${config.updateGithubRepo || 'estebanico10/esteban-cloud'}/releases`)}>
                    <ExternalLink size={14} /> GitHub Releases
                  </button>
                </div>

                {updateProgress && (
                  <div className="field" style={{ gap: 4 }}>
                    <div className="strength-bar">
                      <div className="strength-fill" style={{ width: `${updateProgress.percent || 0}%`, background: '#38bdf8' }} />
                    </div>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {updateProgress.stage === 'installing'
                        ? 'SHA-256 verificado. Instalando actualización y reiniciando...'
                        : `Descargando actualización: ${updateProgress.percent || 0}% (${fmtSize(updateProgress.received)} / ${fmtSize(updateProgress.total)})`}
                    </span>
                  </div>
                )}

                {updateInfo && (
                  <div className={`banner ${updateInfo.status === 'update-available' ? 'ok' : ''}`}>
                    <div><strong>Actual: v{updateInfo.currentVersion}</strong> · {updateInfo.message}</div>
                    {updateInfo.sha256 && (
                      <div className="mono muted" style={{ marginTop: 4, fontSize: 11 }}>SHA-256: {updateInfo.sha256.slice(0, 24)}...</div>
                    )}
                  </div>
                )}

                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 6 }}>
                  <div className="row" style={{ marginBottom: 10 }}>
                    <BrandEmblem />
                    <div>
                      <div style={{ fontWeight: 700 }}>Esteban Cloud v{state.appVersion}</div>
                      <div className="muted">Hecho por Esteban Nicola · canal: estebanico10/esteban-cloud + red Tailscale</div>
                    </div>
                  </div>
                  <button className="btn btn-sm" onClick={() => api.openExternal('https://estebanico.com')}>
                    <ExternalLink size={14} /> estebanico.com
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

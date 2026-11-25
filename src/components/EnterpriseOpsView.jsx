import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  CheckSquare,
  Clock,
  Copy,
  FileSpreadsheet,
  Files,
  FolderOpen,
  HardDrive,
  Layers,
  Lock,
  Monitor,
  Play,
  RefreshCw,
  Rocket,
  ScrollText,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Square,
  Terminal,
  Trash2,
  Upload,
  X,
  Zap
} from 'lucide-react';

const EMERALD = '#10b981';
const EMERALD_LIGHT = '#34d399';
const CYAN = '#38bdf8';

const CHUNK_SIZES_MB = [4, 8, 16];

const SECTION_FILTERS = [
  { id: 'all', label: 'Todas', icon: Layers },
  { id: 'resumable', label: 'Transferencia Resumible Multi-GB', icon: Zap },
  { id: 'realtime', label: 'Auto-Sync en Tiempo Real', icon: RefreshCw },
  { id: 'diagnostics', label: 'Diagnóstico Masivo 10 PCs', icon: Terminal },
  { id: 'audit', label: 'Auditoría Empresarial', icon: ScrollText }
];

const AUDIT_CATEGORIES = [
  { id: 'all', label: 'Todas' },
  { id: 'fleet', label: 'fleet' },
  { id: 'transfer', label: 'transfer' },
  { id: 'sync', label: 'sync' },
  { id: 'remote', label: 'remote' },
  { id: 'security', label: 'security' }
];

function fmtBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let idx = 0;
  let val = n;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx += 1;
  }
  return `${idx === 0 ? Math.round(val) : val.toFixed(idx >= 3 ? 2 : 1)} ${units[idx]}`;
}

function fmtSpeed(mbps) {
  const n = Number(mbps);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 100) return `${Math.round(n)} MB/s`;
  return `${n.toFixed(1)} MB/s`;
}

function fmtDurationMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1000) return `${Math.round(n)} ms`;
  if (n < 60000) return `${(n / 1000).toFixed(1)} s`;
  const mins = Math.floor(n / 60000);
  const secs = Math.round((n % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

function fmtTimestamp(ts) {
  if (!ts) return '—';
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleString([], {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function fmtDetails(details) {
  if (details == null || details === '') return '—';
  if (typeof details === 'string') return details;
  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}

function normalizeNode(raw) {
  const n = raw || {};
  const id = n.id || n.nodeId || n.hostname || n.nodeName || n.ip || n.lanIp || '';
  const hostname = n.hostname || n.nodeName || n.computerName || n.name || id || 'PC-Sin-Nombre';
  const online = Boolean(
    n.online === true ||
    String(n.status || '').toLowerCase() === 'online' ||
    n.isLocal === true
  );
  const department = String(n.department || 'General').trim() || 'General';
  const role = String(n.role || 'Estación de Trabajo').trim() || 'Estación de Trabajo';
  const ip = n.lanIp || n.ip || n.tailscaleIp || '';
  return {
    id,
    hostname,
    online,
    department,
    role,
    ip,
    isLocal: Boolean(n.isLocal)
  };
}

function normalizeTransferRow(raw, idx) {
  const item = raw || {};
  const ok = Boolean(
    item.ok ??
    item.success ??
    (!item.error && item.status !== 'error' && item.status !== 'failed')
  );
  const bytesSent = Number(item.bytesSent ?? item.bytes ?? item.totalBytes ?? 0);
  const durationMs = Number(item.durationMs || 0);
  const speedMBs =
    item.speedMBs ??
    item.avgSpeedMBs ??
    item.rateMBs ??
    (durationMs > 0 && bytesSent > 0 ? bytesSent / (1024 * 1024) / (durationMs / 1000) : null);
  const shaOk = Boolean(item.sha256Verified ?? item.sha256Ok ?? item.verified ?? ok);
  return {
    key: item.peerId || item.id || item.peerName || item.nodeName || `tus-res-${idx}`,
    peerName: item.peerName || item.nodeName || item.hostname || item.peerId || `Equipo #${idx + 1}`,
    ok,
    resumed: Boolean(item.resumed || item.resumedChunks > 0 || item.offsetResumed > 0),
    speedMBs,
    bytesSent,
    durationMs,
    shaOk,
    filesCount: item.filesCount ?? item.filesSent ?? item.files?.length ?? null,
    error: item.error || item.message || ''
  };
}

function getCategoryBadgeStyle(category) {
  const c = String(category || '').toLowerCase();
  if (c === 'transfer') {
    return {
      background: 'rgba(16, 185, 129, 0.14)',
      borderColor: 'rgba(52, 211, 153, 0.36)',
      color: '#6ee7b7'
    };
  }
  if (c === 'fleet') {
    return {
      background: 'rgba(56, 189, 248, 0.14)',
      borderColor: 'rgba(56, 189, 248, 0.36)',
      color: '#7dd3fc'
    };
  }
  if (c === 'sync') {
    return {
      background: 'rgba(20, 184, 166, 0.15)',
      borderColor: 'rgba(45, 212, 191, 0.36)',
      color: '#5eead4'
    };
  }
  if (c === 'remote') {
    return {
      background: 'rgba(251, 191, 36, 0.14)',
      borderColor: 'rgba(251, 191, 36, 0.34)',
      color: '#fde68a'
    };
  }
  if (c === 'security') {
    return {
      background: 'rgba(248, 113, 113, 0.14)',
      borderColor: 'rgba(248, 113, 113, 0.36)',
      color: '#fca5a5'
    };
  }
  return {};
}

function getAuditStatusClass(status) {
  const s = String(status || '').toLowerCase();
  if (['ok', 'success', 'completed', 'allowed', 'verified'].includes(s)) return 'badge ok';
  if (['warn', 'warning', 'conflict', 'partial', 'resumed'].includes(s)) return 'badge warn';
  if (['error', 'fail', 'failed', 'denied', 'blocked'].includes(s)) return 'badge danger';
  return 'badge accent';
}

export default function EnterpriseOpsView({ api, state, flash }) {
  const workspaceName = state?.config?.workspaceName || 'Esteban Mesh Office';
  const shares = Array.isArray(state?.config?.shares) ? state.config.shares : [];

  const fleetNodes = useMemo(() => {
    const raw = Array.isArray(state?.fleet?.nodes) ? state.fleet.nodes : [];
    return raw.map(normalizeNode).sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1;
      return a.hostname.localeCompare(b.hostname);
    });
  }, [state?.fleet?.nodes]);

  const onlineNodes = useMemo(() => fleetNodes.filter((n) => n.online), [fleetNodes]);

  const remotePresets = useMemo(
    () => (Array.isArray(state?.remotePresets) ? state.remotePresets : []),
    [state?.remotePresets]
  );

  // Sub-navigation filter pill state
  const [activeSection, setActiveSection] = useState('all');

  // -------------------------------------------------------------------------
  // 1. Transferencia Masiva Resumible Multi-GB (TUS)
  // -------------------------------------------------------------------------
  const [tusFiles, setTusFiles] = useState([]);
  const [chunkSizeMB, setChunkSizeMB] = useState(8);
  const [destinationSubfolder, setDestinationSubfolder] = useState('Entregas-Alto-Volumen');
  const [tusPeerIds, setTusPeerIds] = useState([]);
  const [tusSending, setTusSending] = useState(false);
  const [tusProgress, setTusProgress] = useState(null);
  const [tusPeerProgressMap, setTusPeerProgressMap] = useState({});
  const [tusSummary, setTusSummary] = useState(null);

  const totalTusBytes = useMemo(
    () => tusFiles.reduce((acc, f) => acc + (Number(f.size) || 0), 0),
    [tusFiles]
  );

  useEffect(() => {
    if (!api?.onResumableProgress) return undefined;
    const unsubscribe = api.onResumableProgress((evt) => {
      if (!evt) return;
      const pct = Math.max(0, Math.min(100, Number(evt.percent ?? 0)));
      const normalized = {
        peerName: evt.peerName || evt.nodeName || evt.hostname || 'Equipo',
        fileName: evt.fileName || evt.name || 'Archivo',
        percent: pct,
        speedMBs: Number(evt.speedMBs || 0),
        resumed: Boolean(evt.resumed)
      };
      setTusProgress(normalized);
      setTusPeerProgressMap((prev) => ({
        ...prev,
        [normalized.peerName]: normalized
      }));
    });
    return typeof unsubscribe === 'function' ? unsubscribe : undefined;
  }, [api]);

  const handlePickTusFiles = async () => {
    if (!api?.pickBulkFiles) {
      flash?.('error', 'El selector de archivos multi-GB no está disponible.');
      return;
    }
    try {
      const res = await api.pickBulkFiles();
      const rawList = Array.isArray(res) ? res : Array.isArray(res?.files) ? res.files : [];
      if (rawList.length === 0) return;

      setTusFiles((prev) => {
        const byPath = new Map(prev.map((f) => [f.path, f]));
        for (const item of rawList) {
          if (!item?.path) continue;
          byPath.set(item.path, {
            path: item.path,
            name: item.name || item.path.split(/[\\/]/).pop() || item.path,
            size: Number(item.size || 0)
          });
        }
        return Array.from(byPath.values());
      });
      flash?.('ok', `${rawList.length} archivo(s) preparado(s) para envío resumible TUS.`);
    } catch (err) {
      flash?.('error', err?.message || 'No se pudieron seleccionar los archivos.');
    }
  };

  const toggleTusPeer = (peerId) => {
    setTusPeerIds((prev) =>
      prev.includes(peerId) ? prev.filter((id) => id !== peerId) : [...prev, peerId]
    );
  };

  const selectAllOnlineForTus = () => {
    const ids = onlineNodes.map((n) => n.id).filter(Boolean);
    setTusPeerIds(ids);
    if (ids.length === 0) {
      flash?.('info', 'No se detectaron equipos en línea en este momento.');
    }
  };

  const handleSendResumable = async () => {
    if (!api?.resumableDistributeFiles) {
      flash?.('error', 'El motor de transferencia resumible TUS no está disponible.');
      return;
    }
    if (tusFiles.length === 0) {
      flash?.('error', 'Agrega al menos un archivo para iniciar la transferencia resumible.');
      return;
    }
    if (tusPeerIds.length === 0) {
      flash?.('error', 'Selecciona al menos una computadora destino.');
      return;
    }

    setTusSending(true);
    setTusProgress(null);
    setTusPeerProgressMap({});
    setTusSummary(null);

    try {
      const res = await api.resumableDistributeFiles({
        filePaths: tusFiles.map((f) => f.path),
        targetPeerIds: tusPeerIds,
        destinationSubfolder: destinationSubfolder.trim() || 'Entregas-Alto-Volumen',
        chunkSizeMB
      });

      const rawResults = Array.isArray(res?.results)
        ? res.results
        : Array.isArray(res)
          ? res
          : [];
      const rows = rawResults.map(normalizeTransferRow);

      setTusSummary({
        results: rows,
        avgSpeedMBs: Number(res?.avgSpeedMBs || 0),
        totalBytes: Number(res?.totalBytes ?? totalTusBytes),
        durationMs: Number(res?.durationMs || 0)
      });

      const okCount = rows.filter((r) => r.ok).length;
      const failCount = rows.length - okCount;
      const resumedCount = rows.filter((r) => r.resumed).length;

      if (failCount === 0 && okCount > 0) {
        flash?.(
          'ok',
          `Envío TUS + SHA-256 completado en ${okCount} PC(s)${resumedCount > 0 ? ` (${resumedCount} reanudada(s))` : ''}.`
        );
      } else if (okCount > 0) {
        flash?.('info', `Envío TUS finalizado: ${okCount} OK, ${failCount} con error.`);
      } else if (rows.length > 0) {
        flash?.('error', `Falló la transferencia en ${failCount} PC(s). Revisa el detalle.`);
      } else {
        flash?.('ok', 'Transferencia resumible TUS procesada.');
      }
    } catch (err) {
      flash?.('error', err?.message || 'Error durante la transferencia resumible TUS.');
    } finally {
      setTusSending(false);
    }
  };

  // -------------------------------------------------------------------------
  // 2. Sincronización Continua en Tiempo Real (Syncthing-style)
  // -------------------------------------------------------------------------
  const [localWatchers, setLocalWatchers] = useState(null);
  const [watchLabel, setWatchLabel] = useState('');
  const [watchSourceDir, setWatchSourceDir] = useState('');
  const [watchTargetDir, setWatchTargetDir] = useState('');
  const [watchBusy, setWatchBusy] = useState(false);
  const [stoppingWatchId, setStoppingWatchId] = useState('');

  useEffect(() => {
    if (Array.isArray(state?.realtimeSync)) {
      setLocalWatchers(state.realtimeSync);
    }
  }, [state?.realtimeSync]);

  const watchers = useMemo(
    () => (Array.isArray(localWatchers) ? localWatchers : Array.isArray(state?.realtimeSync) ? state.realtimeSync : []),
    [localWatchers, state?.realtimeSync]
  );

  const activeWatchersCount = useMemo(
    () => watchers.filter((w) => w && w.active !== false).length,
    [watchers]
  );

  const pickFolderInto = async (setter) => {
    if (!api?.pickSaveFolder) {
      flash?.('error', 'El selector de carpetas no está disponible.');
      return;
    }
    try {
      const res = await api.pickSaveFolder();
      const picked =
        typeof res === 'string'
          ? res
          : res?.folderPath || res?.path || res?.filePath || '';
      if (picked) setter(picked);
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo seleccionar la carpeta.');
    }
  };

  const extractWatchersFromResponse = (res) => {
    if (Array.isArray(res)) return res;
    if (Array.isArray(res?.realtimeSync)) return res.realtimeSync;
    if (Array.isArray(res?.watchers)) return res.watchers;
    return null;
  };

  const handleStartRealtimeWatch = async (e) => {
    e?.preventDefault?.();
    if (!api?.startRealtimeWatch) {
      flash?.('error', 'El motor de Auto-Sync en tiempo real no está disponible.');
      return;
    }
    const sourceDir = watchSourceDir.trim();
    const targetDir = watchTargetDir.trim();
    if (!sourceDir || !targetDir) {
      flash?.('error', 'Especifica tanto la carpeta origen como la carpeta destino / disco montado.');
      return;
    }
    if (sourceDir.toLowerCase() === targetDir.toLowerCase()) {
      flash?.('error', 'La carpeta origen y destino deben ser rutas distintas.');
      return;
    }
    const inferredName = sourceDir.split(/[\\/]/).filter(Boolean).pop() || 'Carpeta';
    const label = watchLabel.trim() || `Auto-Sync ${inferredName}`;

    setWatchBusy(true);
    try {
      const res = await api.startRealtimeWatch({ sourceDir, targetDir, label });
      const updated = extractWatchersFromResponse(res);
      if (updated) {
        setLocalWatchers(updated);
      }
      setWatchLabel('');
      setWatchSourceDir('');
      setWatchTargetDir('');
      flash?.('ok', `Auto-Sync en vivo activado: "${label}".`);
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo activar la sincronización en tiempo real.');
    } finally {
      setWatchBusy(false);
    }
  };

  const handleStopRealtimeWatch = async (watcher) => {
    if (!api?.stopRealtimeWatch || !watcher?.id) {
      flash?.('error', 'No se pudo detener este monitor de sincronización.');
      return;
    }
    setStoppingWatchId(watcher.id);
    try {
      const res = await api.stopRealtimeWatch(watcher.id);
      const updated = extractWatchersFromResponse(res);
      if (updated) {
        setLocalWatchers(updated);
      } else {
        setLocalWatchers((prev) =>
          Array.isArray(prev) ? prev.filter((w) => w.id !== watcher.id) : prev
        );
      }
      flash?.('ok', `Auto-Sync detenido: "${watcher.label || watcher.id}".`);
    } catch (err) {
      flash?.('error', err?.message || 'Error al detener Auto-Sync.');
    } finally {
      setStoppingWatchId('');
    }
  };

  // -------------------------------------------------------------------------
  // 3. Ejecución Masiva de Diagnósticos IT (MeshCentral · Allow-List)
  // -------------------------------------------------------------------------
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [diagPeerIds, setDiagPeerIds] = useState([]);
  const [diagInitialized, setDiagInitialized] = useState(false);
  const [diagRunning, setDiagRunning] = useState(false);
  const [diagRunResult, setDiagRunResult] = useState(null);

  useEffect(() => {
    if (!selectedPresetId && remotePresets.length > 0) {
      setSelectedPresetId(remotePresets[0].id);
    }
  }, [remotePresets, selectedPresetId]);

  useEffect(() => {
    if (!diagInitialized && onlineNodes.length > 0) {
      setDiagPeerIds(onlineNodes.map((n) => n.id).filter(Boolean));
      setDiagInitialized(true);
    }
  }, [diagInitialized, onlineNodes]);

  const activePreset = useMemo(
    () => remotePresets.find((p) => p.id === selectedPresetId) || remotePresets[0] || null,
    [remotePresets, selectedPresetId]
  );

  const toggleDiagPeer = (peerId) => {
    setDiagPeerIds((prev) =>
      prev.includes(peerId) ? prev.filter((id) => id !== peerId) : [...prev, peerId]
    );
  };

  const selectAllOnlineForDiag = () => {
    const ids = onlineNodes.map((n) => n.id).filter(Boolean);
    setDiagPeerIds(ids);
  };

  const selectLocalOnlyForDiag = () => {
    const localIds = fleetNodes.filter((n) => n.isLocal).map((n) => n.id).filter(Boolean);
    if (localIds.length > 0) {
      setDiagPeerIds(localIds);
    } else if (fleetNodes[0]?.id) {
      setDiagPeerIds([fleetNodes[0].id]);
    }
  };

  const handleRunPresetAcrossFleet = async () => {
    if (!api?.runPresetAcrossFleet) {
      flash?.('error', 'El ejecutor masivo de diagnósticos IT no está disponible.');
      return;
    }
    if (!activePreset?.id) {
      flash?.('error', 'Selecciona un diagnóstico seguro de la lista blanca.');
      return;
    }
    if (diagPeerIds.length === 0) {
      flash?.('error', 'Selecciona al menos una computadora para ejecutar el diagnóstico.');
      return;
    }

    setDiagRunning(true);
    setDiagRunResult(null);
    try {
      const res = await api.runPresetAcrossFleet({
        presetId: activePreset.id,
        targetPeerIds: diagPeerIds
      });

      const results = Array.isArray(res?.results)
        ? res.results
        : Array.isArray(res)
          ? res
          : [];

      setDiagRunResult({
        presetId: res?.presetId || activePreset.id,
        presetName: activePreset.name || activePreset.id,
        executedAt: new Date().toISOString(),
        results
      });

      const okCount = results.filter((r) => r?.ok).length;
      const errCount = results.length - okCount;
      if (errCount === 0 && okCount > 0) {
        flash?.('ok', `Diagnóstico "${activePreset.name}" ejecutado con éxito en ${okCount} PC(s).`);
      } else if (okCount > 0) {
        flash?.('info', `Diagnóstico finalizado: ${okCount} OK, ${errCount} con error.`);
      } else if (results.length > 0) {
        flash?.('error', `El diagnóstico falló en ${errCount} PC(s).`);
      } else {
        flash?.('ok', 'Diagnóstico ejecutado.');
      }
    } catch (err) {
      flash?.('error', err?.message || 'Error ejecutando el diagnóstico masivo.');
    } finally {
      setDiagRunning(false);
    }
  };

  const handleCopyOutput = async (text, nodeName) => {
    try {
      await navigator.clipboard.writeText(String(text || ''));
      flash?.('ok', `Salida de ${nodeName} copiada al portapapeles.`);
    } catch {
      flash?.('error', 'No se pudo copiar al portapapeles.');
    }
  };

  // -------------------------------------------------------------------------
  // 4. Registro de Auditoría Empresarial en Vivo
  // -------------------------------------------------------------------------
  const [auditCategory, setAuditCategory] = useState('all');
  const [auditSearch, setAuditSearch] = useState('');
  const [auditRefreshing, setAuditRefreshing] = useState(false);
  const [auditExporting, setAuditExporting] = useState(false);
  const [fetchedAuditLogs, setFetchedAuditLogs] = useState(null);

  useEffect(() => {
    if (Array.isArray(state?.auditLogs)) {
      setFetchedAuditLogs(state.auditLogs);
    }
  }, [state?.auditLogs]);

  const rawAuditLogs = useMemo(
    () => (Array.isArray(fetchedAuditLogs) ? fetchedAuditLogs : Array.isArray(state?.auditLogs) ? state.auditLogs : []),
    [fetchedAuditLogs, state?.auditLogs]
  );

  const handleRefreshAuditLogs = useCallback(
    async (categoryOverride) => {
      const targetCat = categoryOverride ?? auditCategory;
      if (!api?.refreshAuditLogs) {
        flash?.('error', 'El servicio de auditoría en vivo no está disponible.');
        return;
      }
      setAuditRefreshing(true);
      try {
        const res = await api.refreshAuditLogs({
          category: targetCat === 'all' ? undefined : targetCat
        });
        const list = Array.isArray(res)
          ? res
          : Array.isArray(res?.auditLogs)
            ? res.auditLogs
            : Array.isArray(res?.logs)
              ? res.logs
              : null;
        if (list) {
          setFetchedAuditLogs(list);
        }
        if (categoryOverride === undefined) {
          flash?.('ok', 'Registro de auditoría actualizado.');
        }
      } catch (err) {
        flash?.('error', err?.message || 'No se pudo refrescar el registro de auditoría.');
      } finally {
        setAuditRefreshing(false);
      }
    },
    [api, auditCategory, flash]
  );

  const handleSelectAuditCategory = (catId) => {
    setAuditCategory(catId);
    if (api?.refreshAuditLogs) {
      handleRefreshAuditLogs(catId);
    }
  };

  const handleExportAuditCsv = async () => {
    if (!api?.exportAuditCsv) {
      flash?.('error', 'La exportación CSV de auditoría no está disponible.');
      return;
    }
    setAuditExporting(true);
    try {
      const res = await api.exportAuditCsv();
      if (res?.canceled) return;
      const outPath = typeof res === 'string' ? res : res?.filePath || res?.path || '';
      flash?.(
        'ok',
        outPath
          ? `Auditoría empresarial exportada a CSV: ${outPath}`
          : 'Auditoría empresarial exportada a CSV correctamente.'
      );
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo exportar la auditoría a CSV.');
    } finally {
      setAuditExporting(false);
    }
  };

  const filteredAuditLogs = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    return rawAuditLogs.filter((entry) => {
      if (!entry) return false;
      if (auditCategory !== 'all') {
        const cat = String(entry.category || '').toLowerCase();
        if (cat !== auditCategory) return false;
      }
      if (!q) return true;
      const haystack = [
        entry.category,
        entry.action,
        entry.actor,
        entry.target,
        entry.status,
        fmtDetails(entry.details)
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rawAuditLogs, auditCategory, auditSearch]);

  const showResumable = activeSection === 'all' || activeSection === 'resumable';
  const showRealtime = activeSection === 'all' || activeSection === 'realtime';
  const showDiagnostics = activeSection === 'all' || activeSection === 'diagnostics';
  const showAudit = activeSection === 'all' || activeSection === 'audit';

  const sectionCounts = {
    all: 4,
    resumable: tusFiles.length,
    realtime: activeWatchersCount,
    diagnostics: remotePresets.length,
    audit: rawAuditLogs.length
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Hero Header + Sub-Navigation Filter Pills */}
      <div
        className="card hero-card"
        style={{
          borderColor: 'rgba(16, 185, 129, 0.3)',
          background:
            'linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(56, 189, 248, 0.09) 52%, rgba(17, 23, 35, 0.94))'
        }}
      >
        <div className="between">
          <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
            <div
              className="icon-chip ok"
              style={{
                width: 44,
                height: 44,
                borderRadius: 13,
                background: 'rgba(16, 185, 129, 0.16)',
                borderColor: 'rgba(52, 211, 153, 0.36)',
                color: EMERALD_LIGHT
              }}
            >
              <ShieldCheck size={22} />
            </div>
            <div>
              <h2 style={{ fontSize: 19, letterSpacing: '-0.02em', marginBottom: 3 }}>
                Centro de Operaciones Empresariales · {workspaceName}
              </h2>
              <p className="muted" style={{ margin: 0 }}>
                Transferencias resumibles multi-GB (TUS + SHA-256), auto-sincronización continua con protección de conflictos, diagnósticos seguros en lista blanca y auditoría en vivo.
              </p>
            </div>
          </div>

          <div className="row">
            <span className="badge ok">
              <span className="dot ok" />
              {onlineNodes.length}/{fleetNodes.length} PCs en línea
            </span>
            <span className="badge accent">
              <Activity size={12} />
              {activeWatchersCount} Auto-Sync activo(s)
            </span>
            <span className="badge">
              <ScrollText size={12} />
              {rawAuditLogs.length} eventos
            </span>
          </div>
        </div>

        {/* Sub-navigation filter pills */}
        <div
          className="row"
          style={{
            paddingTop: 10,
            borderTop: '1px solid var(--border)',
            gap: 8
          }}
        >
          {SECTION_FILTERS.map((sec) => {
            const Icon = sec.icon;
            const isActive = activeSection === sec.id;
            return (
              <button
                key={sec.id}
                type="button"
                className="btn btn-sm"
                onClick={() => setActiveSection(sec.id)}
                style={{
                  borderRadius: 999,
                  padding: '7px 13px',
                  background: isActive
                    ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.24), rgba(56, 189, 248, 0.2))'
                    : 'rgba(15, 22, 34, 0.72)',
                  borderColor: isActive ? 'rgba(52, 211, 153, 0.55)' : 'var(--border)',
                  color: isActive ? '#f8fafc' : 'var(--muted)',
                  boxShadow: isActive ? '0 0 18px rgba(16, 185, 129, 0.18)' : 'none'
                }}
              >
                <Icon size={14} style={{ color: isActive ? EMERALD_LIGHT : CYAN }} />
                <span>{sec.label}</span>
                {sec.id !== 'all' && (
                  <span
                    className="mono"
                    style={{
                      fontSize: 11,
                      padding: '1px 6px',
                      borderRadius: 999,
                      background: isActive ? 'rgba(52, 211, 153, 0.22)' : 'rgba(148, 163, 184, 0.14)',
                      color: isActive ? '#a7f3d0' : 'var(--muted)'
                    }}
                  >
                    {sectionCounts[sec.id]}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* =====================================================================
          PANEL 1: TRANSFERENCIA MASIVA RESUMIBLE MULTI-GB (TUS)
         ===================================================================== */}
      {showResumable && (
        <section className="card">
          <div className="between">
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <div
                className="icon-chip"
                style={{
                  background: 'rgba(56, 189, 248, 0.14)',
                  borderColor: 'rgba(56, 189, 248, 0.32)',
                  color: CYAN
                }}
              >
                <Zap size={17} />
              </div>
              <div>
                <h3>⚡ Transferencia Masiva Resumible Multi-GB (Protocolo estilo TUS)</h3>
                <p className="muted" style={{ margin: '2px 0 0' }}>
                  Divide archivos multi-GB en bloques de <strong style={{ color: '#e2e8f0' }}>4 MB / 8 MB / 16 MB</strong>, reanuda automáticamente desde el byte exacto si parpadea el Wi-Fi o la red LAN, y verifica integridad criptográfica <span className="mono" style={{ color: EMERALD_LIGHT }}>SHA-256</span> al finalizar.
                </p>
              </div>
            </div>
            <div className="row">
              <span className="badge accent">TUS Chunked</span>
              <span className="badge ok">SHA-256 Verificado</span>
            </div>
          </div>

          <div className="grid-2" style={{ alignItems: 'start' }}>
            {/* Left column: Files + Chunk Size + Destination */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="between">
                <span className="muted" style={{ fontWeight: 600, color: '#cbd5e1' }}>
                  1. Archivos multi-GB a distribuir ({tusFiles.length} · {fmtBytes(totalTusBytes)})
                </span>
                <div className="row">
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={handlePickTusFiles}
                    disabled={tusSending}
                  >
                    <Upload size={14} style={{ color: CYAN }} />
                    Elegir archivos
                  </button>
                  {tusFiles.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => setTusFiles([])}
                      disabled={tusSending}
                    >
                      <Trash2 size={13} />
                      Vaciar
                    </button>
                  )}
                </div>
              </div>

              {tusFiles.length === 0 ? (
                <div
                  className="dropzone"
                  style={{
                    textAlign: 'center',
                    padding: '18px 14px',
                    borderColor: 'rgba(56, 189, 248, 0.28)'
                  }}
                >
                  <Files size={20} style={{ color: CYAN, marginBottom: 6 }} />
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Sin archivos en cola</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    Ideal para renders, videos 4K, backups ISO, proyectos CAD/Adobe o instaladores pesados.
                  </div>
                </div>
              ) : (
                <div className="list" style={{ maxHeight: 205, overflowY: 'auto' }}>
                  {tusFiles.map((file) => (
                    <div key={file.path} className="list-item" style={{ padding: '9px 12px' }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }}
                        >
                          {file.name}
                        </div>
                        <div
                          className="mono muted"
                          style={{
                            fontSize: 11,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }}
                          title={file.path}
                        >
                          {file.path}
                        </div>
                      </div>
                      <div className="row" style={{ flexShrink: 0 }}>
                        <span className="badge accent mono">{fmtBytes(file.size)}</span>
                        <button
                          type="button"
                          className="btn btn-sm"
                          style={{ padding: '4px 6px' }}
                          onClick={() =>
                            setTusFiles((prev) => prev.filter((item) => item.path !== file.path))
                          }
                          disabled={tusSending}
                          title="Quitar archivo"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid-2" style={{ gap: 10 }}>
                <div className="field">
                  <label>Tamaño de bloque (Chunk TUS)</label>
                  <div className="row" style={{ gap: 6 }}>
                    {CHUNK_SIZES_MB.map((mb) => {
                      const active = chunkSizeMB === mb;
                      return (
                        <button
                          key={mb}
                          type="button"
                          className="btn btn-sm"
                          disabled={tusSending}
                          onClick={() => setChunkSizeMB(mb)}
                          style={{
                            flex: 1,
                            background: active ? 'rgba(16, 185, 129, 0.2)' : 'var(--panel-2)',
                            borderColor: active ? 'rgba(52, 211, 153, 0.55)' : 'var(--border-strong)',
                            color: active ? '#a7f3d0' : 'var(--muted)'
                          }}
                        >
                          {mb} MB
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="tus-subfolder">Subcarpeta destino</label>
                  <input
                    id="tus-subfolder"
                    type="text"
                    value={destinationSubfolder}
                    onChange={(e) => setDestinationSubfolder(e.target.value)}
                    placeholder="Entregas-Alto-Volumen"
                    disabled={tusSending}
                  />
                </div>
              </div>
            </div>

            {/* Right column: Target PC Multi-selector */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="between">
                <span className="muted" style={{ fontWeight: 600, color: '#cbd5e1' }}>
                  2. Computadoras destino ({tusPeerIds.length} seleccionada(s))
                </span>
                <div className="row">
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={selectAllOnlineForTus}
                    disabled={tusSending || onlineNodes.length === 0}
                    style={{
                      borderColor: 'rgba(52, 211, 153, 0.38)',
                      color: '#a7f3d0'
                    }}
                  >
                    <CheckSquare size={13} style={{ color: EMERALD_LIGHT }} />
                    Todas en línea ({onlineNodes.length})
                  </button>
                  {tusPeerIds.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setTusPeerIds([])}
                      disabled={tusSending}
                    >
                      Limpiar
                    </button>
                  )}
                </div>
              </div>

              {fleetNodes.length === 0 ? (
                <div className="banner">
                  Aún no hay computadoras descubiertas en la flota. Conecta nodos en la red LAN o Tailscale.
                </div>
              ) : (
                <div
                  className="list"
                  style={{ maxHeight: 245, overflowY: 'auto', paddingRight: 2 }}
                >
                  {fleetNodes.map((node) => {
                    const checked = tusPeerIds.includes(node.id);
                    return (
                      <label
                        key={node.id}
                        className="list-item"
                        style={{
                          padding: '9px 12px',
                          cursor: tusSending ? 'not-allowed' : 'pointer',
                          borderColor: checked
                            ? 'rgba(52, 211, 153, 0.48)'
                            : 'var(--border)',
                          background: checked
                            ? 'rgba(16, 185, 129, 0.1)'
                            : 'var(--panel-2)'
                        }}
                      >
                        <div className="row" style={{ gap: 9, minWidth: 0, flex: 1 }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={tusSending}
                            onChange={() => toggleTusPeer(node.id)}
                            style={{ width: 'auto', accentColor: EMERALD }}
                          />
                          <span className={`dot ${node.online ? 'ok' : ''}`} />
                          <div style={{ minWidth: 0 }}>
                            <div className="row" style={{ gap: 6 }}>
                              <strong style={{ fontSize: 13 }}>{node.hostname}</strong>
                              {node.isLocal && <span className="badge accent">Local</span>}
                            </div>
                            <div className="mono muted" style={{ fontSize: 11.5 }}>
                              {node.ip || 'Sin IP'} · {node.department}
                            </div>
                          </div>
                        </div>
                        <span className={`badge ${node.online ? 'ok' : ''}`}>
                          {node.online ? 'En línea' : 'Offline'}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Primary Send Button */}
          <div className="between" style={{ paddingTop: 4, borderTop: '1px solid var(--border)' }}>
            <span className="muted" style={{ fontSize: 12.5 }}>
              Bloques de <strong style={{ color: '#e2e8f0' }}>{chunkSizeMB} MB</strong> · Destino:{' '}
              <span className="mono" style={{ color: CYAN }}>
                {destinationSubfolder.trim() || 'Entregas-Alto-Volumen'}
              </span>
            </span>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSendResumable}
              disabled={tusSending || tusFiles.length === 0 || tusPeerIds.length === 0}
              style={{
                background: `linear-gradient(135deg, ${EMERALD_LIGHT}, ${EMERALD} 48%, ${CYAN})`,
                color: '#031510',
                fontWeight: 700
              }}
            >
              <Zap size={15} />
              {tusSending
                ? 'Transmitiendo bloques TUS...'
                : '⚡ Enviar con Reanudación Automática (TUS)'}
            </button>
          </div>

          {/* Live Progress Bar */}
          {(tusSending || tusProgress) && (
            <div
              className="step-card"
              style={{
                borderColor: 'rgba(56, 189, 248, 0.34)',
                background: 'rgba(9, 15, 26, 0.84)'
              }}
            >
              <div className="between">
                <div className="row" style={{ gap: 8 }}>
                  <span className="dot ok" />
                  <strong style={{ fontSize: 13 }}>
                    {tusProgress
                      ? `${tusProgress.peerName} — ${tusProgress.fileName}`
                      : 'Inicializando sesión TUS y calculando offsets...'}
                  </strong>
                  {tusProgress?.resumed && (
                    <span className="badge warn">Reanudado desde último byte</span>
                  )}
                </div>
                <div className="row" style={{ gap: 8 }}>
                  {tusProgress?.speedMBs > 0 && (
                    <span className="badge accent mono">{fmtSpeed(tusProgress.speedMBs)}</span>
                  )}
                  <span className="badge ok mono">
                    {tusProgress ? `${Math.round(tusProgress.percent)}%` : '0%'}
                  </span>
                </div>
              </div>

              <div className="strength-bar" style={{ height: 9 }}>
                <div
                  className="strength-fill"
                  style={{
                    width: `${tusProgress ? Math.max(4, Math.round(tusProgress.percent)) : 8}%`,
                    background: `linear-gradient(90deg, ${EMERALD}, ${EMERALD_LIGHT}, ${CYAN})`
                  }}
                />
              </div>

              {Object.keys(tusPeerProgressMap).length > 1 && (
                <div className="row" style={{ gap: 6, marginTop: 2 }}>
                  {Object.values(tusPeerProgressMap).map((p) => (
                    <span key={p.peerName} className="badge" style={{ fontSize: 11 }}>
                      <Monitor size={11} style={{ color: CYAN }} />
                      {p.peerName}: <strong className="mono">{Math.round(p.percent)}%</strong>
                      {p.speedMBs > 0 ? ` (${fmtSpeed(p.speedMBs)})` : ''}
                      {p.resumed ? ' · Reanudado' : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Per-PC Completion Summary */}
          {tusSummary && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="grid-3">
                <div className="step-card done">
                  <span className="muted" style={{ fontSize: 11.5 }}>Volumen total enviado</span>
                  <strong className="stat-value mono" style={{ color: EMERALD_LIGHT }}>
                    {fmtBytes(tusSummary.totalBytes)}
                  </strong>
                </div>
                <div className="step-card">
                  <span className="muted" style={{ fontSize: 11.5 }}>Velocidad promedio flota</span>
                  <strong className="stat-value mono" style={{ color: CYAN }}>
                    {fmtSpeed(tusSummary.avgSpeedMBs)}
                  </strong>
                </div>
                <div className="step-card">
                  <span className="muted" style={{ fontSize: 11.5 }}>Duración total</span>
                  <strong className="stat-value mono">
                    {fmtDurationMs(tusSummary.durationMs)}
                  </strong>
                </div>
              </div>

              {tusSummary.results.length > 0 && (
                <div className="list">
                  {tusSummary.results.map((row) => (
                    <div
                      key={row.key}
                      className="list-item"
                      style={{
                        borderColor: row.ok
                          ? 'rgba(52, 211, 153, 0.34)'
                          : 'rgba(248, 113, 113, 0.36)'
                      }}
                    >
                      <div className="row" style={{ gap: 10, minWidth: 0 }}>
                        {row.ok ? (
                          <CheckCircle2 size={17} style={{ color: EMERALD_LIGHT, flexShrink: 0 }} />
                        ) : (
                          <AlertCircle size={17} style={{ color: '#f87171', flexShrink: 0 }} />
                        )}
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 650, fontSize: 13.5 }}>{row.peerName}</div>
                          {row.error ? (
                            <div style={{ fontSize: 12, color: '#fca5a5' }}>{row.error}</div>
                          ) : (
                            <div className="muted mono" style={{ fontSize: 11.5 }}>
                              {row.bytesSent > 0 ? fmtBytes(row.bytesSent) : 'Transferencia completada'}
                              {row.durationMs > 0 ? ` · ${fmtDurationMs(row.durationMs)}` : ''}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="row" style={{ flexShrink: 0 }}>
                        {row.resumed && <span className="badge warn">Reanudado</span>}
                        {row.speedMBs != null && (
                          <span className="badge accent mono">{fmtSpeed(row.speedMBs)}</span>
                        )}
                        {row.ok && row.shaOk ? (
                          <span className="badge ok">
                            <ShieldCheck size={12} />
                            SHA-256 OK
                          </span>
                        ) : (
                          <span className="badge danger">Error</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* =====================================================================
          PANEL 2: SINCRONIZACIÓN CONTINUA EN TIEMPO REAL (SYNCTHING-STYLE)
         ===================================================================== */}
      {showRealtime && (
        <section className="card">
          <div className="between">
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <div
                className="icon-chip ok"
                style={{
                  background: 'rgba(16, 185, 129, 0.15)',
                  borderColor: 'rgba(52, 211, 153, 0.34)',
                  color: EMERALD_LIGHT
                }}
              >
                <RefreshCw size={17} />
              </div>
              <div>
                <h3>🔄 Sincronización Continua en Tiempo Real (Estilo Syncthing con Protección de Conflictos)</h3>
                <p className="muted" style={{ margin: '2px 0 0' }}>
                  Cada cambio guardado se replica automáticamente al destino. Si otro compañero editó una versión más reciente en paralelo, el motor guarda una copia segura <span className="mono" style={{ color: '#fde68a' }}>.sync-conflict-*</span> en lugar de sobrescribir su trabajo.
                </p>
              </div>
            </div>
            <div className="row">
              <span className="badge ok">
                <span className={`dot ${activeWatchersCount > 0 ? 'ok' : ''}`} />
                {activeWatchersCount} activo(s)
              </span>
              <span className="badge warn">Protección .sync-conflict-*</span>
            </div>
          </div>

          {/* Add New Live Watcher Form */}
          <form
            onSubmit={handleStartRealtimeWatch}
            className="step-card"
            style={{ gap: 12, background: 'rgba(11, 16, 26, 0.72)' }}
          >
            <div className="grid-3">
              <div className="field">
                <label htmlFor="watch-label">Nombre del perfil en vivo</label>
                <input
                  id="watch-label"
                  type="text"
                  value={watchLabel}
                  onChange={(e) => setWatchLabel(e.target.value)}
                  placeholder="Ej: Proyectos Diseño → Disco Z:"
                  disabled={watchBusy}
                />
              </div>

              <div className="field">
                <label htmlFor="watch-src">Carpeta origen</label>
                <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
                  <input
                    id="watch-src"
                    type="text"
                    value={watchSourceDir}
                    onChange={(e) => setWatchSourceDir(e.target.value)}
                    placeholder="C:\Proyectos\Oficina"
                    disabled={watchBusy}
                  />
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => pickFolderInto(setWatchSourceDir)}
                    disabled={watchBusy}
                    title="Seleccionar carpeta origen"
                    style={{ flexShrink: 0, height: 39 }}
                  >
                    <FolderOpen size={14} style={{ color: CYAN }} />
                  </button>
                </div>
              </div>

              <div className="field">
                <label htmlFor="watch-dst">Carpeta destino / Disco montado</label>
                <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
                  <input
                    id="watch-dst"
                    type="text"
                    value={watchTargetDir}
                    onChange={(e) => setWatchTargetDir(e.target.value)}
                    placeholder="Z:\Respaldo-En-Vivo"
                    disabled={watchBusy}
                  />
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => pickFolderInto(setWatchTargetDir)}
                    disabled={watchBusy}
                    title="Seleccionar carpeta destino"
                    style={{ flexShrink: 0, height: 39 }}
                  >
                    <HardDrive size={14} style={{ color: EMERALD_LIGHT }} />
                  </button>
                </div>
              </div>
            </div>

            {shares.length > 0 && (
              <div className="row" style={{ gap: 6 }}>
                <span className="muted" style={{ fontSize: 11.5 }}>
                  Usar carpeta compartida como origen:
                </span>
                {shares.slice(0, 5).map((sh) => (
                  <button
                    key={sh.id || sh.folderPath || sh.name}
                    type="button"
                    className="btn btn-sm"
                    style={{ fontSize: 11.5, padding: '4px 8px' }}
                    onClick={() => {
                      if (sh.folderPath) setWatchSourceDir(sh.folderPath);
                      if (!watchLabel && sh.name) setWatchLabel(`Auto-Sync ${sh.name}`);
                    }}
                  >
                    <FolderOpen size={11} style={{ color: CYAN }} />
                    {sh.name || sh.folderPath}
                  </button>
                ))}
              </div>
            )}

            <div className="between">
              <span className="muted" style={{ fontSize: 12 }}>
                Detecta guardados en subcarpetas al instante y registra conflictos sin pérdida de datos.
              </span>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={watchBusy || !watchSourceDir.trim() || !watchTargetDir.trim()}
                style={{
                  background: `linear-gradient(135deg, ${EMERALD_LIGHT}, ${EMERALD})`,
                  color: '#031510',
                  fontWeight: 700
                }}
              >
                <Play size={14} />
                {watchBusy ? 'Activando monitor...' : '▶️ Activar Auto-Sync en Vivo'}
              </button>
            </div>
          </form>

          {/* Active Watchers List */}
          {watchers.length === 0 ? (
            <div className="banner">
              No hay monitores Auto-Sync en tiempo real activos. Agrega una carpeta origen y un disco montado o destino para comenzar.
            </div>
          ) : (
            <div className="list">
              {watchers.map((w) => {
                const isLive = w.active !== false;
                const conflicts = Number(w.conflictsPreserved || 0);
                const filesSynced = Number(w.filesSynced || 0);
                return (
                  <div
                    key={w.id}
                    className="list-item"
                    style={{
                      alignItems: 'flex-start',
                      flexWrap: 'wrap',
                      borderColor: w.lastError
                        ? 'rgba(248, 113, 113, 0.36)'
                        : isLive
                          ? 'rgba(52, 211, 153, 0.32)'
                          : 'var(--border)'
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 260, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div className="row" style={{ gap: 8 }}>
                        <span className={`badge ${isLive ? 'ok' : ''}`}>
                          <span className={`dot ${isLive ? 'ok' : ''}`} />
                          {isLive ? 'En vivo' : 'Detenido'}
                        </span>
                        <strong style={{ fontSize: 14 }}>{w.label || 'Auto-Sync'}</strong>
                      </div>

                      <div className="mono muted" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                        <span style={{ color: CYAN }}>{w.sourceDir}</span>
                        {'  →  '}
                        <span style={{ color: EMERALD_LIGHT }}>{w.targetDir}</span>
                      </div>

                      <div className="row" style={{ gap: 8 }}>
                        <span className="badge accent mono">
                          {filesSynced} archivo(s) sincronizado(s)
                        </span>
                        <span className={`badge ${conflicts > 0 ? 'warn' : 'ok'} mono`}>
                          {conflicts > 0 ? (
                            <AlertTriangle size={11} />
                          ) : (
                            <ShieldCheck size={11} />
                          )}
                          {conflicts} conflicto(s) preservado(s)
                        </span>
                        <span className="badge mono">
                          <Clock size={11} />
                          Último sync: {fmtTimestamp(w.lastSyncAt)}
                        </span>
                      </div>

                      {w.lastError && (
                        <div className="banner error" style={{ padding: '7px 10px', fontSize: 12 }}>
                          <AlertCircle size={13} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                          {w.lastError}
                        </div>
                      )}
                    </div>

                    <div className="row" style={{ flexShrink: 0 }}>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => handleStopRealtimeWatch(w)}
                        disabled={stoppingWatchId === w.id}
                      >
                        <Square size={12} />
                        {stoppingWatchId === w.id ? 'Deteniendo...' : '⏹️ Detener'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* =====================================================================
          PANEL 3: EJECUCIÓN MASIVA DE DIAGNÓSTICOS IT EN LAS 10 PCs
         ===================================================================== */}
      {showDiagnostics && (
        <section className="card">
          <div className="between">
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <div
                className="icon-chip"
                style={{
                  background: 'rgba(56, 189, 248, 0.14)',
                  borderColor: 'rgba(56, 189, 248, 0.34)',
                  color: CYAN
                }}
              >
                <Terminal size={17} />
              </div>
              <div>
                <h3>🛠️ Ejecución Masiva de Diagnósticos IT en las 10 PCs (Estilo MeshCentral · Lista Blanca Segura)</h3>
                <p className="muted" style={{ margin: '2px 0 0' }}>
                  Ejecuta diagnósticos pre-aprobados y auditados en paralelo sobre los equipos seleccionados sin abrir consolas arbitrarias.
                </p>
              </div>
            </div>
            <div className="row">
              <span className="badge ok">
                <Lock size={11} />
                Lista Blanca Segura
              </span>
              <span className="badge accent">{remotePresets.length} presets</span>
            </div>
          </div>

          <div className="grid-2" style={{ alignItems: 'start' }}>
            {/* Preset Allow-List Selector */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="field">
                <label htmlFor="preset-select">1. Diagnóstico IT permitido (Allow-List)</label>
                {remotePresets.length === 0 ? (
                  <div className="banner">
                    No hay presets de diagnóstico cargados en <span className="mono">state.remotePresets</span>.
                  </div>
                ) : (
                  <select
                    id="preset-select"
                    value={activePreset?.id || ''}
                    onChange={(e) => setSelectedPresetId(e.target.value)}
                    disabled={diagRunning}
                  >
                    {remotePresets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        [{preset.category || 'IT'}] {preset.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Quick preset cards for one-click selection */}
              {remotePresets.length > 0 && (
                <div className="list" style={{ maxHeight: 225, overflowY: 'auto', paddingRight: 2 }}>
                  {remotePresets.map((preset) => {
                    const selected = activePreset?.id === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => setSelectedPresetId(preset.id)}
                        disabled={diagRunning}
                        className="list-item"
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          cursor: diagRunning ? 'not-allowed' : 'pointer',
                          color: 'var(--text)',
                          borderColor: selected
                            ? 'rgba(56, 189, 248, 0.55)'
                            : 'var(--border)',
                          background: selected
                            ? 'rgba(56, 189, 248, 0.12)'
                            : 'var(--panel-2)'
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="row" style={{ gap: 7 }}>
                            <strong style={{ fontSize: 13 }}>{preset.name}</strong>
                            {preset.category && (
                              <span className="badge accent">{preset.category}</span>
                            )}
                          </div>
                          <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                            {preset.description || 'Diagnóstico verificado en lista blanca.'}
                          </div>
                        </div>
                        {selected && (
                          <CheckCircle2 size={16} style={{ color: CYAN, flexShrink: 0 }} />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Target PC Multi-Selector (Local + Online Fleet) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="between">
                <span className="muted" style={{ fontWeight: 600, color: '#cbd5e1' }}>
                  2. Equipos objetivo ({diagPeerIds.length} seleccionada(s))
                </span>
                <div className="row">
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={selectAllOnlineForDiag}
                    disabled={diagRunning || onlineNodes.length === 0}
                    style={{ borderColor: 'rgba(52, 211, 153, 0.38)', color: '#a7f3d0' }}
                  >
                    <CheckSquare size={13} style={{ color: EMERALD_LIGHT }} />
                    Todas en línea ({onlineNodes.length})
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={selectLocalOnlyForDiag}
                    disabled={diagRunning || fleetNodes.length === 0}
                  >
                    Solo local
                  </button>
                  {diagPeerIds.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setDiagPeerIds([])}
                      disabled={diagRunning}
                    >
                      Limpiar
                    </button>
                  )}
                </div>
              </div>

              {fleetNodes.length === 0 ? (
                <div className="banner">
                  No se detectaron computadoras en la flota todavía.
                </div>
              ) : (
                <div className="list" style={{ maxHeight: 278, overflowY: 'auto', paddingRight: 2 }}>
                  {fleetNodes.map((node) => {
                    const checked = diagPeerIds.includes(node.id);
                    return (
                      <label
                        key={node.id}
                        className="list-item"
                        style={{
                          padding: '9px 12px',
                          cursor: diagRunning ? 'not-allowed' : 'pointer',
                          borderColor: checked
                            ? 'rgba(56, 189, 248, 0.5)'
                            : 'var(--border)',
                          background: checked
                            ? 'rgba(56, 189, 248, 0.1)'
                            : 'var(--panel-2)'
                        }}
                      >
                        <div className="row" style={{ gap: 9, minWidth: 0, flex: 1 }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={diagRunning}
                            onChange={() => toggleDiagPeer(node.id)}
                            style={{ width: 'auto', accentColor: CYAN }}
                          />
                          <span className={`dot ${node.online ? 'ok' : ''}`} />
                          <div style={{ minWidth: 0 }}>
                            <div className="row" style={{ gap: 6 }}>
                              <strong style={{ fontSize: 13 }}>{node.hostname}</strong>
                              {node.isLocal && <span className="badge ok">Esta PC</span>}
                            </div>
                            <div className="mono muted" style={{ fontSize: 11.5 }}>
                              {node.ip || 'Localhost'} · {node.department}
                            </div>
                          </div>
                        </div>
                        <span className={`badge ${node.online ? 'ok' : ''}`}>
                          {node.online ? 'En línea' : 'Offline'}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Launch Diagnostic Button */}
          <div className="between" style={{ paddingTop: 4, borderTop: '1px solid var(--border)' }}>
            <span className="muted" style={{ fontSize: 12.5 }}>
              {activePreset ? (
                <>
                  Preset activo: <strong style={{ color: '#e2e8f0' }}>{activePreset.name}</strong>
                </>
              ) : (
                'Selecciona un diagnóstico para ejecutar'
              )}
            </span>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleRunPresetAcrossFleet}
              disabled={diagRunning || !activePreset || diagPeerIds.length === 0}
            >
              <Rocket size={15} />
              {diagRunning
                ? `Ejecutando en ${diagPeerIds.length} computadora(s)...`
                : `🚀 Ejecutar en ${diagPeerIds.length} computadoras simultáneamente`}
            </button>
          </div>

          {/* Side-by-side Output Cards */}
          {diagRunResult && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="between">
                <div className="row" style={{ gap: 8 }}>
                  <strong style={{ fontSize: 13.5 }}>
                    Resultados: {diagRunResult.presetName}
                  </strong>
                  <span className="badge ok">
                    {diagRunResult.results.filter((r) => r?.ok).length} OK
                  </span>
                  {diagRunResult.results.some((r) => !r?.ok) && (
                    <span className="badge danger">
                      {diagRunResult.results.filter((r) => !r?.ok).length} Error
                    </span>
                  )}
                </div>
                <span className="muted mono" style={{ fontSize: 11.5 }}>
                  {fmtTimestamp(diagRunResult.executedAt)}
                </span>
              </div>

              <div className="grid-2">
                {diagRunResult.results.map((item, idx) => {
                  const nodeName = item?.nodeName || item?.hostname || `PC #${idx + 1}`;
                  const ok = Boolean(item?.ok);
                  const content = ok
                    ? item?.output || '(Sin salida estándar)'
                    : item?.error || item?.output || 'Error desconocido al ejecutar el preset.';
                  return (
                    <div
                      key={`${nodeName}-${idx}`}
                      className="step-card"
                      style={{
                        borderColor: ok
                          ? 'rgba(52, 211, 153, 0.34)'
                          : 'rgba(248, 113, 113, 0.38)',
                        background: 'rgba(9, 14, 24, 0.85)'
                      }}
                    >
                      <div className="between">
                        <div className="row" style={{ gap: 8 }}>
                          <Server
                            size={15}
                            style={{ color: ok ? EMERALD_LIGHT : '#f87171' }}
                          />
                          <strong style={{ fontSize: 13.5 }}>{nodeName}</strong>
                        </div>
                        <div className="row" style={{ gap: 6 }}>
                          <span className="badge mono">
                            <Clock size={11} />
                            {item?.durationMs != null ? `${Math.round(Number(item.durationMs))} ms` : '—'}
                          </span>
                          <span className={`badge ${ok ? 'ok' : 'danger'}`}>
                            {ok ? 'OK' : 'Error'}
                          </span>
                          <button
                            type="button"
                            className="btn btn-sm"
                            style={{ padding: '4px 7px' }}
                            onClick={() => handleCopyOutput(content, nodeName)}
                            title="Copiar salida"
                          >
                            <Copy size={12} />
                          </button>
                        </div>
                      </div>
                      <pre
                        className="log-box"
                        style={{
                          margin: 0,
                          color: ok ? '#cbd5e1' : '#fecaca',
                          borderColor: ok
                            ? 'var(--border)'
                            : 'rgba(248, 113, 113, 0.25)'
                        }}
                      >
                        {content}
                      </pre>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {/* =====================================================================
          PANEL 4: REGISTRO DE AUDITORÍA EMPRESARIAL EN VIVO
         ===================================================================== */}
      {showAudit && (
        <section className="card">
          <div className="between">
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <div
                className="icon-chip ok"
                style={{
                  background: 'rgba(16, 185, 129, 0.14)',
                  borderColor: 'rgba(52, 211, 153, 0.34)',
                  color: EMERALD_LIGHT
                }}
              >
                <ScrollText size={17} />
              </div>
              <div>
                <h3>📜 Registro de Auditoría Empresarial en Vivo</h3>
                <p className="muted" style={{ margin: '2px 0 0' }}>
                  Trazabilidad completa de eventos de flota, transferencias TUS, sincronización en vivo, diagnósticos remotos y seguridad.
                </p>
              </div>
            </div>

            <div className="row">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => handleRefreshAuditLogs()}
                disabled={auditRefreshing}
              >
                <RefreshCw size={13} style={{ color: CYAN }} />
                {auditRefreshing ? 'Actualizando...' : '🔄 Refrescar'}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={handleExportAuditCsv}
                disabled={auditExporting}
                style={{
                  background: `linear-gradient(135deg, ${CYAN}, ${EMERALD_LIGHT})`,
                  color: '#04141d'
                }}
              >
                <FileSpreadsheet size={13} />
                {auditExporting ? 'Exportando...' : '📄 Exportar Auditoría CSV'}
              </button>
            </div>
          </div>

          {/* Category Filter Pills + Search */}
          <div className="between" style={{ gap: 10 }}>
            <div className="row" style={{ gap: 6 }}>
              {AUDIT_CATEGORIES.map((cat) => {
                const active = auditCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    className="btn btn-sm"
                    onClick={() => handleSelectAuditCategory(cat.id)}
                    style={{
                      borderRadius: 999,
                      padding: '5px 12px',
                      background: active
                        ? 'rgba(56, 189, 248, 0.2)'
                        : 'rgba(15, 22, 34, 0.72)',
                      borderColor: active
                        ? 'rgba(56, 189, 248, 0.55)'
                        : 'var(--border)',
                      color: active ? '#e0f2fe' : 'var(--muted)'
                    }}
                  >
                    {cat.label}
                  </button>
                );
              })}
            </div>

            <div style={{ position: 'relative', minWidth: 220, flex: '0 1 280px' }}>
              <Search
                size={14}
                style={{
                  position: 'absolute',
                  left: 11,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--muted)',
                  pointerEvents: 'none'
                }}
              />
              <input
                type="text"
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                placeholder="Buscar PC, acción o detalle..."
                style={{ paddingLeft: 32, paddingTop: 7, paddingBottom: 7, fontSize: 12.5 }}
              />
            </div>
          </div>

          {/* Audit Entries Table */}
          {filteredAuditLogs.length === 0 ? (
            <div className="banner">
              No hay eventos de auditoría para el filtro seleccionado.
            </div>
          ) : (
            <div
              style={{
                overflowX: 'auto',
                borderRadius: 12,
                border: '1px solid var(--border)',
                background: 'rgba(8, 12, 20, 0.75)'
              }}
            >
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 12.5,
                  textAlign: 'left'
                }}
              >
                <thead>
                  <tr
                    style={{
                      borderBottom: '1px solid var(--border-strong)',
                      background: 'rgba(17, 23, 35, 0.92)',
                      color: 'var(--muted)',
                      fontSize: 11,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em'
                    }}
                  >
                    <th style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>Fecha / Hora</th>
                    <th style={{ padding: '10px 10px' }}>Categoría</th>
                    <th style={{ padding: '10px 10px' }}>Acción</th>
                    <th style={{ padding: '10px 10px' }}>Equipo Actor</th>
                    <th style={{ padding: '10px 10px' }}>Destino</th>
                    <th style={{ padding: '10px 10px' }}>Estado</th>
                    <th style={{ padding: '10px 12px' }}>Detalles</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAuditLogs.map((entry, idx) => (
                    <tr
                      key={entry.id || `${entry.ts}-${idx}`}
                      style={{
                        borderBottom: '1px solid rgba(148, 163, 184, 0.09)',
                        verticalAlign: 'top'
                      }}
                    >
                      <td
                        className="mono muted"
                        style={{ padding: '9px 12px', whiteSpace: 'nowrap', fontSize: 11.5 }}
                      >
                        {fmtTimestamp(entry.ts)}
                      </td>
                      <td style={{ padding: '9px 10px', whiteSpace: 'nowrap' }}>
                        <span
                          className="badge"
                          style={getCategoryBadgeStyle(entry.category)}
                        >
                          {entry.category || 'general'}
                        </span>
                      </td>
                      <td style={{ padding: '9px 10px', fontWeight: 600, color: '#f1f5f9' }}>
                        {entry.action || '—'}
                      </td>
                      <td className="mono" style={{ padding: '9px 10px', color: CYAN, whiteSpace: 'nowrap' }}>
                        {entry.actor || '—'}
                      </td>
                      <td className="mono" style={{ padding: '9px 10px', color: '#cbd5e1', whiteSpace: 'nowrap' }}>
                        {entry.target || '—'}
                      </td>
                      <td style={{ padding: '9px 10px', whiteSpace: 'nowrap' }}>
                        <span className={getAuditStatusClass(entry.status)}>
                          {entry.status || 'ok'}
                        </span>
                      </td>
                      <td
                        className="muted"
                        style={{
                          padding: '9px 12px',
                          fontSize: 12,
                          maxWidth: 360,
                          wordBreak: 'break-word'
                        }}
                      >
                        {fmtDetails(entry.details)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="between" style={{ fontSize: 12 }}>
            <span className="muted">
              Mostrando <strong style={{ color: '#e2e8f0' }}>{filteredAuditLogs.length}</strong> de{' '}
              <strong style={{ color: '#e2e8f0' }}>{rawAuditLogs.length}</strong> registro(s) de auditoría.
            </span>
            <span className="muted mono">
              <ShieldAlert size={12} style={{ verticalAlign: 'middle', marginRight: 5, color: EMERALD_LIGHT }} />
              Auditoría inmutable en tiempo real
            </span>
          </div>
        </section>
      )}
    </div>
  );
}

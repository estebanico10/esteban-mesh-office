import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Cpu,
  Download,
  FileSpreadsheet,
  FolderOpen,
  HardDrive,
  Megaphone,
  MemoryStick,
  Monitor,
  Network,
  Pencil,
  Power,
  Printer,
  Radio,
  RefreshCw,
  Search,
  Send,
  Server,
  ShieldCheck,
  Trash2,
  Usb,
  Users,
  X,
  Zap
} from 'lucide-react';

const DEFAULT_DEPARTMENTS = [
  'Todos',
  'Dirección',
  'Diseño',
  'Administración',
  'Ventas',
  'Producción',
  'Soporte IT',
  'General'
];

const EDITABLE_DEPARTMENTS = DEFAULT_DEPARTMENTS.filter((d) => d !== 'Todos');

const DEFAULT_ROLES = [
  'Servidor / Consola Central',
  'Estación de Trabajo',
  'Diseñador / Producción',
  'Administración',
  'Ventas / Comercial',
  'Soporte IT',
  'Solo Lectura'
];

const EMERALD = '#10b981';
const EMERALD_LIGHT = '#34d399';
const CYAN = '#38bdf8';

function toNum(val, fallback = 0) {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function fmtTB(val) {
  const n = toNum(val, 0);
  if (n >= 100) return n.toFixed(0);
  if (n >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

function fmtGB(val) {
  const n = toNum(val, 0);
  if (n >= 1000) return `${(n / 1024).toFixed(2)} TB`;
  if (n >= 100) return `${Math.round(n)} GB`;
  return `${n.toFixed(1)} GB`;
}

function fmtClock(iso) {
  if (!iso) return '—';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString([], {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function normalizeNode(raw, defaultPort = 4890) {
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
  const label = String(n.label || '').trim();
  const notes = String(n.notes || '').trim();
  const user = n.windowsUser || n.username || n.user || n.currentUser || '—';
  const lanIp = n.lanIp || n.ip || n.ipv4 || '';
  const tailscaleIp = n.tailscaleIp || n.tsIp || '';
  const mac = n.mac || n.macAddress || '';
  const port = Number(n.port || defaultPort || 4890);

  const primaryIp = lanIp || tailscaleIp || '';
  const peerUrl =
    n.peerUrl ||
    n.url ||
    (primaryIp ? `http://${primaryIp}:${port}` : '');

  const cpuObj = n.cpu && typeof n.cpu === 'object' ? n.cpu : null;
  const cpuModel =
    (cpuObj ? cpuObj.model || cpuObj.name : n.cpuModel || (typeof n.cpu === 'string' ? n.cpu : '')) ||
    'CPU sin datos';
  const cpuCores = toNum(
    cpuObj?.cores ?? cpuObj?.logicalCores ?? n.cpuCores ?? n.cores,
    0
  );

  const ramGB = toNum(
    n.ramGB ??
    n.ramTotalGB ??
    n.memoryGB ??
    (n.ramBytes ? n.ramBytes / (1024 ** 3) : null) ??
    (n.totalMemoryBytes ? n.totalMemoryBytes / (1024 ** 3) : null),
    0
  );

  let gpu = '';
  if (Array.isArray(n.gpus) && n.gpus.length) {
    gpu = n.gpus.map((g) => (typeof g === 'string' ? g : g?.name || g?.model || '')).filter(Boolean).join(' + ');
  } else if (typeof n.gpu === 'string') {
    gpu = n.gpu;
  } else if (n.gpu && typeof n.gpu === 'object') {
    gpu = n.gpu.name || n.gpu.model || '';
  } else {
    gpu = n.gpuModel || '';
  }

  const manufacturer = n.manufacturer || n.vendor || '';
  const systemModel = n.model || n.systemModel || n.productModel || '';
  const modelDisplay = [manufacturer, systemModel].filter(Boolean).join(' ').trim();
  const serial = n.serial || n.serialNumber || n.biosSerial || '';
  const osName = n.os || n.osVersion || n.platform || '';

  const rawDisks = Array.isArray(n.disks)
    ? n.disks
    : Array.isArray(n.volumes)
      ? n.volumes
      : Array.isArray(n.drives)
        ? n.drives
        : [];

  const disks = rawDisks.map((d, idx) => {
    const drive = String(d.drive || d.letter || d.mount || d.name || `D${idx + 1}:`)
      .replace(/\\+$/, '');
    const totalGB = toNum(
      d.totalGB ??
      d.sizeGB ??
      (d.totalBytes != null ? d.totalBytes / (1024 ** 3) : null) ??
      (d.size != null ? d.size / (1024 ** 3) : null),
      0
    );
    const freeGB = toNum(
      d.freeGB ??
      (d.freeBytes != null ? d.freeBytes / (1024 ** 3) : null) ??
      (d.free != null ? d.free / (1024 ** 3) : null),
      0
    );
    const usedGB = Math.max(0, totalGB - freeGB);
    const usedPct =
      d.usedPercent != null
        ? Math.max(0, Math.min(100, Math.round(toNum(d.usedPercent, 0))))
        : totalGB > 0
          ? Math.max(0, Math.min(100, Math.round((usedGB / totalGB) * 100)))
          : 0;
    return {
      drive: drive.endsWith(':') ? drive : `${drive}:`,
      label: d.label || d.volumeName || '',
      totalGB,
      freeGB,
      usedGB,
      usedPct
    };
  });

  return {
    raw: n,
    id,
    hostname,
    online,
    isLocal: Boolean(n.isLocal),
    department,
    role,
    label,
    notes,
    user,
    lanIp,
    tailscaleIp,
    primaryIp,
    mac,
    port,
    peerUrl,
    cpuModel,
    cpuCores,
    ramGB,
    gpu,
    modelDisplay,
    serial,
    osName,
    disks,
    source: n.source || '',
    lastSeen: n.lastSeen || n.updatedAt || n.collectedAt || ''
  };
}

function getDiskBarColor(usedPct) {
  if (usedPct >= 90) return 'var(--danger)';
  if (usedPct >= 75) return 'var(--warn)';
  return EMERALD_LIGHT;
}

export default function FleetView({
  api,
  state,
  flash,
  onOpenTab,
  onSelectPeersForBulk
}) {
  const config = state?.config || {};
  const fleet = state?.fleet || {};
  const rawNodes = Array.isArray(fleet.nodes) ? fleet.nodes : [];
  const defaultPort = Number(config.port || 4890);

  const nodes = useMemo(
    () =>
      rawNodes
        .map((n) => normalizeNode(n, defaultPort))
        .sort((a, b) => {
          if (a.online !== b.online) return a.online ? -1 : 1;
          if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1;
          return a.hostname.localeCompare(b.hostname);
        }),
    [rawNodes, defaultPort]
  );

  const summary = useMemo(() => {
    const s = fleet.summary || {};
    const totalNodes = s.totalNodes ?? nodes.length;
    const onlineNodes = s.onlineNodes ?? nodes.filter((n) => n.online).length;
    const capacityRecommended = s.capacityRecommended ?? 50;

    let calcTotalGB = 0;
    let calcFreeGB = 0;
    let calcRam = 0;
    let calcCores = 0;
    let calcAlerts = 0;
    for (const n of nodes) {
      calcRam += n.ramGB;
      calcCores += n.cpuCores;
      for (const d of n.disks) {
        calcTotalGB += d.totalGB;
        calcFreeGB += d.freeGB;
        if (d.usedPct >= 90) calcAlerts += 1;
      }
    }

    const totalStorageTB = s.totalStorageTB ?? calcTotalGB / 1024;
    const freeStorageTB = s.freeStorageTB ?? calcFreeGB / 1024;
    const totalRamGB = s.totalRamGB ?? Math.round(calcRam);
    const totalCpuCores = s.totalCpuCores ?? calcCores;
    const alertsCount = s.alertsCount ?? calcAlerts;
    const usedStoragePct =
      totalStorageTB > 0
        ? Math.max(0, Math.min(100, Math.round(((totalStorageTB - freeStorageTB) / totalStorageTB) * 100)))
        : 0;

    return {
      totalNodes,
      onlineNodes,
      capacityRecommended,
      totalStorageTB,
      freeStorageTB,
      totalRamGB,
      totalCpuCores,
      alertsCount,
      usedStoragePct
    };
  }, [fleet.summary, nodes]);

  // Toolbar async states
  const [scanning, setScanning] = useState(false);
  const [collectingLocal, setCollectingLocal] = useState(false);
  const [importingUsb, setImportingUsb] = useState(false);
  const [wakingAll, setWakingAll] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [exportingHtml, setExportingHtml] = useState(false);

  // Office Broadcast Alert state
  const [broadcastOpen, setBroadcastOpen] = useState(true);
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcastPriority, setBroadcastPriority] = useState('Normal');
  const [sendingBroadcast, setSendingBroadcast] = useState(false);

  // Filters & search
  const [selectedDept, setSelectedDept] = useState('Todos');
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyOnline, setOnlyOnline] = useState(false);

  // Inline metadata edit state
  const [editingNodeId, setEditingNodeId] = useState(null);
  const [editForm, setEditForm] = useState({
    department: 'General',
    role: 'Estación de Trabajo',
    label: '',
    notes: ''
  });
  const [savingMeta, setSavingMeta] = useState(false);

  // Delete confirmation state
  const [confirmRemoveId, setConfirmRemoveId] = useState(null);
  const [removingId, setRemovingId] = useState(null);

  // Remote screen modal state
  const [screenModalNode, setScreenModalNode] = useState(null);
  const [screenData, setScreenData] = useState(null);
  const [screenLoading, setScreenLoading] = useState(false);
  const [screenError, setScreenError] = useState('');
  const [screenAutoLive, setScreenAutoLive] = useState(false);

  const departmentsList = useMemo(() => {
    const extras = [];
    for (const n of nodes) {
      if (n.department && !DEFAULT_DEPARTMENTS.includes(n.department) && !extras.includes(n.department)) {
        extras.push(n.department);
      }
    }
    return [...DEFAULT_DEPARTMENTS, ...extras];
  }, [nodes]);

  const deptCounts = useMemo(() => {
    const map = { Todos: nodes.length };
    for (const n of nodes) {
      map[n.department] = (map[n.department] || 0) + 1;
    }
    return map;
  }, [nodes]);

  const filteredNodes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return nodes.filter((n) => {
      if (selectedDept !== 'Todos' && n.department.toLowerCase() !== selectedDept.toLowerCase()) {
        return false;
      }
      if (onlyOnline && !n.online) return false;
      if (!q) return true;
      const haystack = [
        n.hostname,
        n.label,
        n.department,
        n.role,
        n.user,
        n.lanIp,
        n.tailscaleIp,
        n.mac,
        n.cpuModel,
        n.gpu,
        n.modelDisplay,
        n.serial,
        n.notes
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [nodes, selectedDept, searchQuery, onlyOnline]);

  const onlineTargetNodes = useMemo(
    () => nodes.filter((n) => n.online),
    [nodes]
  );

  // Handlers
  const handleScanNow = async () => {
    if (!api?.fleetScanNow) {
      flash?.('error', 'El escáner de flota no está disponible.');
      return;
    }
    setScanning(true);
    try {
      const res = await api.fleetScanNow();
      const found = res?.found ?? res?.onlineNodes ?? res?.count;
      flash?.(
        'ok',
        found != null
          ? `Escaneo LAN + Tailscale completado (${found} equipo(s) detectado(s)).`
          : 'Escaneo LAN + Tailscale completado.'
      );
    } catch (err) {
      flash?.('error', err?.message || 'Error al escanear equipos en LAN y Tailscale.');
    } finally {
      setScanning(false);
    }
  };

  const handleCollectLocal = async () => {
    if (!api?.fleetCollectLocalInventory) {
      flash?.('error', 'La recolección local de inventario no está disponible.');
      return;
    }
    setCollectingLocal(true);
    try {
      await api.fleetCollectLocalInventory();
      flash?.('ok', 'Inventario de hardware, discos y red de esta PC actualizado.');
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo recolectar el inventario de esta PC.');
    } finally {
      setCollectingLocal(false);
    }
  };

  const handleImportUsb = async () => {
    if (!api?.fleetImportUsbInventories) {
      flash?.('error', 'La importación desde USB no está disponible.');
      return;
    }
    setImportingUsb(true);
    try {
      const res = await api.fleetImportUsbInventories();
      if (res?.canceled) return;
      const imported = res?.imported ?? res?.count ?? res?.nodes?.length ?? 0;
      if (imported > 0) {
        flash?.('ok', `Se importaron ${imported} inventario(s) desde la carpeta/USB.`);
      } else {
        flash?.('info', res?.message || 'No se encontraron archivos Inventario-*.json en la carpeta seleccionada.');
      }
    } catch (err) {
      flash?.('error', err?.message || 'Error al importar inventarios desde USB.');
    } finally {
      setImportingUsb(false);
    }
  };

  const handleWakeAll = async () => {
    if (!api?.fleetWakeAll) {
      flash?.('error', 'Wake-on-LAN no está disponible.');
      return;
    }
    setWakingAll(true);
    try {
      const res = await api.fleetWakeAll();
      const sent = res?.sent ?? res?.count ?? 0;
      flash?.(
        'ok',
        sent > 0
          ? `Paquetes mágicos Wake-on-LAN enviados a ${sent} equipo(s) de la oficina.`
          : res?.message || 'Paquetes Wake-on-LAN enviados a la red.'
      );
    } catch (err) {
      flash?.('error', err?.message || 'No se pudieron enviar los paquetes Wake-on-LAN.');
    } finally {
      setWakingAll(false);
    }
  };

  const handleExportCsv = async () => {
    if (!api?.fleetExportCsv) {
      flash?.('error', 'La exportación CSV no está disponible.');
      return;
    }
    setExportingCsv(true);
    try {
      const res = await api.fleetExportCsv();
      if (res?.canceled) return;
      flash?.('ok', `Reporte CSV/Excel guardado${res?.filePath ? `: ${res.filePath}` : '.'}`);
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo exportar el reporte CSV.');
    } finally {
      setExportingCsv(false);
    }
  };

  const handleExportHtml = async () => {
    if (!api?.fleetExportHtmlReport) {
      flash?.('error', 'La exportación de reporte HTML no está disponible.');
      return;
    }
    setExportingHtml(true);
    try {
      const res = await api.fleetExportHtmlReport();
      if (res?.canceled) return;
      flash?.('ok', `Reporte de auditoría HTML generado${res?.filePath ? `: ${res.filePath}` : '.'}`);
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo generar el reporte HTML.');
    } finally {
      setExportingHtml(false);
    }
  };

  const handleBroadcast = async (e) => {
    e?.preventDefault();
    if (!api?.fleetBroadcastAnnouncement) {
      flash?.('error', 'Los anuncios globales no están disponibles.');
      return;
    }
    const title = broadcastTitle.trim() || `Aviso — ${config.workspaceName || 'Oficina'}`;
    const message = broadcastMessage.trim();
    if (!message) {
      flash?.('error', 'Escribe un mensaje para enviar el anuncio a las PCs.');
      return;
    }
    setSendingBroadcast(true);
    try {
      const targetIds = onlineTargetNodes.map((n) => n.id);
      const res = await api.fleetBroadcastAnnouncement({
        title,
        message,
        priority: broadcastPriority.toLowerCase(),
        targetIds
      });
      const delivered = res?.delivered ?? res?.sent ?? targetIds.length;
      flash?.(
        'ok',
        `Anuncio ${broadcastPriority === 'Urgente' ? 'URGENTE ' : ''}enviado a ${delivered} computadora(s) en línea.`
      );
      setBroadcastMessage('');
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo enviar el anuncio global.');
    } finally {
      setSendingBroadcast(false);
    }
  };

  const startEditNode = (node) => {
    setEditingNodeId(node.id);
    setConfirmRemoveId(null);
    setEditForm({
      department: node.department || 'General',
      role: node.role || 'Estación de Trabajo',
      label: node.label || '',
      notes: node.notes || ''
    });
  };

  const handleSaveNodeMeta = async (nodeId) => {
    if (!api?.fleetUpdateNodeMeta) {
      flash?.('error', 'No se puede actualizar la metadata del equipo.');
      return;
    }
    setSavingMeta(true);
    try {
      await api.fleetUpdateNodeMeta({
        id: nodeId,
        department: editForm.department.trim() || 'General',
        role: editForm.role.trim() || 'Estación de Trabajo',
        label: editForm.label.trim(),
        notes: editForm.notes.trim()
      });
      setEditingNodeId(null);
      flash?.('ok', 'Departamento y rol del equipo actualizados.');
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo guardar los cambios del equipo.');
    } finally {
      setSavingMeta(false);
    }
  };

  const handleRemoveNode = async (node) => {
    if (!api?.fleetRemoveNode) {
      flash?.('error', 'No se puede quitar el equipo de la flota.');
      return;
    }
    setRemovingId(node.id);
    try {
      await api.fleetRemoveNode(node.id);
      setConfirmRemoveId(null);
      flash?.('ok', `Equipo "${node.hostname}" eliminado del registro de flota.`);
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo quitar el equipo.');
    } finally {
      setRemovingId(null);
    }
  };

  const handleLaunchRdp = async (node) => {
    if (!node.primaryIp) {
      flash?.('error', `El equipo ${node.hostname} no tiene una IP registrada para RDP.`);
      return;
    }
    if (!api?.launchRdp) {
      flash?.('error', 'El lanzador de RDP no está disponible.');
      return;
    }
    try {
      await api.launchRdp(node.primaryIp);
      flash?.('ok', `Abriendo Escritorio Remoto (RDP) hacia ${node.hostname} (${node.primaryIp}).`);
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo iniciar RDP.');
    }
  };

  const handleOpenSmb = async (node) => {
    if (!node.primaryIp) {
      flash?.('error', `El equipo ${node.hostname} no tiene IP registrada para red SMB.`);
      return;
    }
    if (!api?.openSmbShare) {
      flash?.('error', 'El acceso a recursos SMB no está disponible.');
      return;
    }
    try {
      await api.openSmbShare(node.primaryIp);
      flash?.('ok', `Abriendo carpetas de red \\\\${node.primaryIp} en el Explorador.`);
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo abrir el recurso compartido SMB.');
    }
  };

  const handleCopyText = async (text, label) => {
    if (!text) return;
    try {
      if (api?.copyText) {
        await api.copyText(text);
      } else if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      }
      flash?.('ok', `${label} copiado: ${text}`);
    } catch {
      flash?.('error', 'No se pudo copiar al portapapeles.');
    }
  };

  // Remote screen fetch
  const fetchScreenForNode = useCallback(
    async (node, silent = false) => {
      if (!node || !api?.fetchRemoteScreen) return;
      if (!node.peerUrl) {
        setScreenError('Este equipo no tiene URL de agente ni IP registrada.');
        return;
      }
      if (!silent) {
        setScreenLoading(true);
        setScreenError('');
      }
      try {
        const res = await api.fetchRemoteScreen({ peerUrl: node.peerUrl });
        const payload = res?.result || res;
        if (payload?.dataUrl) {
          setScreenData({
            dataUrl: payload.dataUrl,
            capturedAt: payload.capturedAt || new Date().toISOString()
          });
          setScreenError('');
        } else {
          setScreenError(payload?.error || 'El equipo no devolvió una captura de pantalla.');
        }
      } catch (err) {
        setScreenError(err?.message || 'No se pudo conectar para capturar la pantalla remota.');
      } finally {
        if (!silent) setScreenLoading(false);
      }
    },
    [api]
  );

  const openScreenModal = (node) => {
    setScreenModalNode(node);
    setScreenData(null);
    setScreenError('');
    setScreenAutoLive(false);
    fetchScreenForNode(node, false);
  };

  const closeScreenModal = () => {
    setScreenModalNode(null);
    setScreenAutoLive(false);
    setScreenData(null);
    setScreenError('');
  };

  useEffect(() => {
    if (!screenModalNode || !screenAutoLive) return undefined;
    const timer = setInterval(() => {
      fetchScreenForNode(screenModalNode, true);
    }, 3500);
    return () => clearInterval(timer);
  }, [screenModalNode, screenAutoLive, fetchScreenForNode]);

  useEffect(() => {
    if (!screenModalNode) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') closeScreenModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screenModalNode]);

  const workspaceTitle = config.workspaceName || 'Espacio de Trabajo Empresarial';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Header */}
      <div className="page-head">
        <div>
          <div className="row" style={{ gap: 8, marginBottom: 4 }}>
            <span
              className="badge ok"
              style={{
                background: 'rgba(16, 185, 129, 0.16)',
                borderColor: 'rgba(52, 211, 153, 0.42)',
                color: '#6ee7b7'
              }}
            >
              <Building2 size={12} /> Enterprise Office
            </span>
            <span className="badge accent">
              <Radio size={12} /> LAN + Tailscale Mesh
            </span>
            {config.department && (
              <span className="badge">
                Mi estación: {config.department} · {config.role || 'Consola'}
              </span>
            )}
          </div>
          <h1>Consola de Flota Empresarial — {workspaceTitle}</h1>
          <p>
            Supervisa inventario de hardware, almacenamiento global, estado en tiempo real y acciones remotas para
            oficinas de 10 a {summary.capacityRecommended}+ computadoras en red local y Tailscale.
          </p>
        </div>

        <div className="row" style={{ gap: 8 }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={scanning}
            onClick={handleScanNow}
            style={{
              background: 'linear-gradient(135deg, #34d399, #10b981 48%, #38bdf8)',
              color: '#041311',
              boxShadow: '0 6px 20px rgba(16, 185, 129, 0.28)'
            }}
          >
            <RefreshCw size={15} className={scanning ? 'spin' : ''} />
            {scanning ? 'Escaneando red...' : '🔄 Escanear 10+ PCs (LAN + Tailscale)'}
          </button>

          <button
            type="button"
            className="btn"
            disabled={collectingLocal}
            onClick={handleCollectLocal}
          >
            <Monitor size={15} color={CYAN} />
            {collectingLocal ? 'Recolectando...' : '📊 Recolectar mi PC'}
          </button>

          <button
            type="button"
            className="btn"
            disabled={importingUsb}
            onClick={handleImportUsb}
          >
            <Usb size={15} color={EMERALD_LIGHT} />
            {importingUsb ? 'Importando...' : '📥 Importar desde USB'}
          </button>

          <button
            type="button"
            className="btn"
            disabled={wakingAll || nodes.length === 0}
            onClick={handleWakeAll}
            title="Enviar paquete mágico Wake-on-LAN a todas las MAC registradas"
          >
            <Power size={15} color="#fbbf24" />
            {wakingAll ? 'Despertando...' : '⚡ Despertar Oficina (WoL)'}
          </button>
        </div>
      </div>

      {/* Top KPI Row */}
      <div className="grid-4">
        {/* KPI 1: Equipos en Línea */}
        <div
          className="card"
          style={{
            borderColor: 'rgba(16, 185, 129, 0.28)',
            background: 'linear-gradient(155deg, rgba(16, 185, 129, 0.10), rgba(17, 23, 35, 0.90))'
          }}
        >
          <div className="kpi-head">
            <span className="muted" style={{ fontWeight: 600, fontSize: 12.5 }}>
              Equipos en Línea / Registrados
            </span>
            <div className="icon-chip ok">
              <Server size={16} />
            </div>
          </div>
          <div className="stat-value" style={{ fontSize: 24, color: '#ecfdf5' }}>
            <span style={{ color: EMERALD_LIGHT }}>{summary.onlineNodes}</span>
            <span className="muted" style={{ fontSize: 16, fontWeight: 600 }}>
              {' '}
              / {summary.totalNodes} PCs
            </span>
          </div>
          <div className="between" style={{ gap: 6 }}>
            <span className="muted" style={{ fontSize: 11.5 }}>
              Recomendado hasta {summary.capacityRecommended}+ PCs
            </span>
            <span className="badge ok">
              {summary.totalNodes > 0
                ? `${Math.round((summary.onlineNodes / summary.totalNodes) * 100)}% activos`
                : 'Listo'}
            </span>
          </div>
        </div>

        {/* KPI 2: Almacenamiento Global */}
        <div
          className="card"
          style={{
            borderColor: 'rgba(56, 189, 248, 0.26)',
            background: 'linear-gradient(155deg, rgba(56, 189, 248, 0.09), rgba(17, 23, 35, 0.90))'
          }}
        >
          <div className="kpi-head">
            <span className="muted" style={{ fontWeight: 600, fontSize: 12.5 }}>
              Almacenamiento Global de Oficina
            </span>
            <div className="icon-chip">
              <HardDrive size={16} />
            </div>
          </div>
          <div className="stat-value" style={{ fontSize: 22 }}>
            <span style={{ color: CYAN }}>{fmtTB(summary.freeStorageTB)} TB</span>{' '}
            <span className="muted" style={{ fontSize: 13.5, fontWeight: 600 }}>
              libres
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div className="strength-bar" style={{ height: 6 }}>
              <div
                className="strength-fill"
                style={{
                  width: `${summary.usedStoragePct}%`,
                  background: getDiskBarColor(summary.usedStoragePct)
                }}
              />
            </div>
            <div className="between" style={{ fontSize: 11.5 }}>
              <span className="muted">{fmtTB(summary.totalStorageTB)} TB totales en flota</span>
              <span className="mono" style={{ fontSize: 11.5, color: 'var(--text)' }}>
                {summary.usedStoragePct}% usado
              </span>
            </div>
          </div>
        </div>

        {/* KPI 3: Potencia Global */}
        <div className="card">
          <div className="kpi-head">
            <span className="muted" style={{ fontWeight: 600, fontSize: 12.5 }}>
              Potencia Global de Cómputo
            </span>
            <div className="icon-chip ok" style={{ color: '#67e8f9', borderColor: 'rgba(103, 232, 249, 0.28)' }}>
              <Cpu size={16} />
            </div>
          </div>
          <div className="stat-value" style={{ fontSize: 20 }}>
            <span>{Math.round(summary.totalRamGB)} GB RAM</span>
            <span className="muted" style={{ fontSize: 14, fontWeight: 600 }}>
              {' '}
              · {summary.totalCpuCores} núcleos CPU
            </span>
          </div>
          <div className="between">
            <span className="muted" style={{ fontSize: 11.5 }}>
              {Math.max(1, Object.keys(deptCounts).filter((k) => k !== 'Todos').length)} departamento(s)
            </span>
            {summary.alertsCount > 0 ? (
              <span className="badge warn">
                <AlertTriangle size={11} /> {summary.alertsCount} alerta(s) disco
              </span>
            ) : (
              <span className="badge ok">
                <ShieldCheck size={11} /> Flota saludable
              </span>
            )}
          </div>
        </div>

        {/* KPI 4: Reportes de Auditoría */}
        <div className="card">
          <div className="kpi-head">
            <span className="muted" style={{ fontWeight: 600, fontSize: 12.5 }}>
              Reportes de Auditoría
            </span>
            <div className="icon-chip">
              <FileSpreadsheet size={16} />
            </div>
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            Exporta inventario completo de hardware, seriales, discos e IPs para gerencia o IT.
          </div>
          <div className="row" style={{ gap: 7, marginTop: 'auto' }}>
            <button
              type="button"
              className="btn btn-sm"
              style={{ flex: 1 }}
              disabled={exportingCsv || nodes.length === 0}
              onClick={handleExportCsv}
            >
              <Download size={13} color={EMERALD_LIGHT} />
              {exportingCsv ? 'Guardando...' : '📄 Exportar CSV/Excel'}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              style={{ flex: 1 }}
              disabled={exportingHtml || nodes.length === 0}
              onClick={handleExportHtml}
            >
              <Printer size={13} color={CYAN} />
              {exportingHtml ? 'Generando...' : '🖨️ Reporte HTML'}
            </button>
          </div>
        </div>
      </div>

      {/* Office Broadcast Alert Hero Bar */}
      <div
        className="card hero-card"
        style={{
          borderColor:
            broadcastPriority === 'Urgente'
              ? 'rgba(251, 191, 36, 0.45)'
              : 'rgba(16, 185, 129, 0.34)',
          background:
            broadcastPriority === 'Urgente'
              ? 'linear-gradient(135deg, rgba(251, 191, 36, 0.13), rgba(56, 189, 248, 0.08) 55%, rgba(17, 23, 35, 0.94))'
              : 'linear-gradient(135deg, rgba(16, 185, 129, 0.13), rgba(56, 189, 248, 0.09) 55%, rgba(17, 23, 35, 0.94))'
        }}
      >
        <div className="between">
          <div className="row" style={{ gap: 10 }}>
            <div className={`icon-chip ${broadcastPriority === 'Urgente' ? 'warn' : 'ok'}`}>
              <Megaphone size={16} />
            </div>
            <div>
              <h3 style={{ fontSize: 14.5 }}>Anuncio Global en Pantalla (Office Broadcast Alert)</h3>
              <div className="muted" style={{ fontSize: 12 }}>
                Envía una notificación instantánea de Windows en pantalla a{' '}
                <strong style={{ color: EMERALD_LIGHT }}>{onlineTargetNodes.length}</strong> equipo(s) en línea.
              </div>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setBroadcastOpen((v) => !v)}
          >
            {broadcastOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {broadcastOpen ? 'Contraer' : 'Redactar anuncio'}
          </button>
        </div>

        {broadcastOpen && (
          <form onSubmit={handleBroadcast} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(180px, 1.1fr) minmax(240px, 2fr) 150px auto',
                gap: 10,
                alignItems: 'end'
              }}
            >
              <div className="field">
                <label>Título del anuncio</label>
                <input
                  type="text"
                  placeholder="Ej: Reunión en 5 min / Mantenimiento"
                  value={broadcastTitle}
                  onChange={(e) => setBroadcastTitle(e.target.value)}
                />
              </div>

              <div className="field">
                <label>Mensaje para todas las pantallas</label>
                <input
                  type="text"
                  placeholder="Escribe el aviso que aparecerá en todas las PCs de la oficina..."
                  value={broadcastMessage}
                  onChange={(e) => setBroadcastMessage(e.target.value)}
                />
              </div>

              <div className="field">
                <label>Prioridad</label>
                <select
                  value={broadcastPriority}
                  onChange={(e) => setBroadcastPriority(e.target.value)}
                >
                  <option value="Normal">Normal</option>
                  <option value="Urgente">Urgente</option>
                </select>
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={sendingBroadcast || !broadcastMessage.trim() || onlineTargetNodes.length === 0}
                style={{
                  height: 39,
                  background:
                    broadcastPriority === 'Urgente'
                      ? 'linear-gradient(135deg, #fde047, #f59e0b)'
                      : 'linear-gradient(135deg, #34d399, #10b981 50%, #38bdf8)',
                  color: '#05111f'
                }}
              >
                <Send size={14} />
                {sendingBroadcast ? 'Enviando...' : '📢 Enviar anuncio a todas las PCs en línea'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Department Filter Pills & Search */}
      <div className="card" style={{ gap: 12 }}>
        <div className="between" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 6, flex: 1 }}>
            {departmentsList.map((dept) => {
              const active = selectedDept === dept;
              const count = deptCounts[dept] || 0;
              return (
                <button
                  key={dept}
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setSelectedDept(dept)}
                  style={
                    active
                      ? {
                          background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.24), rgba(56, 189, 248, 0.20))',
                          borderColor: 'rgba(52, 211, 153, 0.55)',
                          color: '#ecfdf5'
                        }
                      : undefined
                  }
                >
                  <span>{dept}</span>
                  <span
                    className="mono"
                    style={{
                      fontSize: 11,
                      padding: '1px 6px',
                      borderRadius: 999,
                      background: active ? 'rgba(16, 185, 129, 0.28)' : 'rgba(148, 163, 184, 0.14)',
                      color: active ? '#a7f3d0' : 'var(--muted)'
                    }}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="row" style={{ gap: 8, minWidth: 310 }}>
            <div style={{ position: 'relative', flex: 1 }}>
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
                placeholder="Buscar hostname, IP, usuario, serial, CPU..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ paddingLeft: 32, paddingRight: searchQuery ? 30 : 12 }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="input-eye"
                  title="Limpiar búsqueda"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setOnlyOnline((v) => !v)}
              style={
                onlyOnline
                  ? {
                      borderColor: 'rgba(52, 211, 153, 0.55)',
                      background: 'rgba(16, 185, 129, 0.18)',
                      color: '#a7f3d0'
                    }
                  : undefined
              }
            >
              <span className={`dot ${onlyOnline ? 'ok' : ''}`} />
              Solo en línea
            </button>
          </div>
        </div>

        <div className="between" style={{ fontSize: 12 }}>
          <span className="muted">
            Mostrando <strong style={{ color: 'var(--text)' }}>{filteredNodes.length}</strong> de{' '}
            <strong style={{ color: 'var(--text)' }}>{nodes.length}</strong> equipo(s) registrados
          </span>
          {onSelectPeersForBulk && filteredNodes.filter((n) => n.online).length > 1 && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => onSelectPeersForBulk(filteredNodes.filter((n) => n.online).map((n) => n.raw))}
              style={{
                borderColor: 'rgba(56, 189, 248, 0.36)',
                color: '#bae6fd'
              }}
            >
              <Zap size={13} color={CYAN} />
              Enviar archivos a {filteredNodes.filter((n) => n.online).length} PCs filtradas
            </button>
          )}
        </div>
      </div>

      {/* Fleet Nodes Grid */}
      {filteredNodes.length === 0 ? (
        <div className="card" style={{ alignItems: 'center', textAlign: 'center', padding: '36px 24px' }}>
          <div
            className="icon-chip ok"
            style={{ width: 46, height: 46, borderRadius: 14, marginBottom: 4 }}
          >
            <Users size={22} />
          </div>
          <h3 style={{ justifyContent: 'center' }}>
            {nodes.length === 0
              ? 'Todavía no hay computadoras registradas en tu flota'
              : 'Ningún equipo coincide con los filtros actuales'}
          </h3>
          <p className="muted" style={{ maxWidth: 520, margin: 0 }}>
            {nodes.length === 0
              ? 'Escanea tu red LAN y Tailscale, recolecta el inventario de esta PC o importa los archivos Inventario-*.json generados con el Kit USB en las demás computadoras.'
              : 'Prueba cambiando el departamento seleccionado, desactivando "Solo en línea" o limpiando la búsqueda.'}
          </p>
          <div className="row" style={{ marginTop: 8 }}>
            {nodes.length === 0 ? (
              <>
                <button type="button" className="btn btn-primary" onClick={handleScanNow}>
                  <RefreshCw size={14} /> Escanear LAN + Tailscale
                </button>
                <button type="button" className="btn" onClick={handleCollectLocal}>
                  <Monitor size={14} /> Recolectar mi PC
                </button>
                <button type="button" className="btn" onClick={handleImportUsb}>
                  <Usb size={14} /> Importar desde USB
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setSelectedDept('Todos');
                  setSearchQuery('');
                  setOnlyOnline(false);
                }}
              >
                Restablecer filtros
              </button>
            )}
          </div>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(490px, 1fr))',
            gap: 14
          }}
        >
          {filteredNodes.map((node) => {
            const isEditing = editingNodeId === node.id;
            const isConfirmingRemove = confirmRemoveId === node.id;
            const isLocalNode =
              node.isLocal ||
              (config.nodeName && node.hostname.toLowerCase() === String(config.nodeName).toLowerCase());

            return (
              <div
                key={node.id}
                className="card"
                style={{
                  gap: 12,
                  borderColor: node.online
                    ? 'rgba(52, 211, 153, 0.28)'
                    : 'var(--border)',
                  background: node.online
                    ? 'linear-gradient(160deg, rgba(16, 185, 129, 0.06), rgba(17, 23, 35, 0.90) 42%)'
                    : 'var(--panel)'
                }}
              >
                {/* Node Top Header */}
                <div className="between" style={{ alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <span
                        className={`dot ${node.online ? 'ok' : ''}`}
                        title={node.online ? 'En línea' : 'Sin conexión'}
                      />
                      <span
                        style={{
                          fontSize: 16,
                          fontWeight: 700,
                          letterSpacing: '-0.015em',
                          color: '#f8fafc'
                        }}
                      >
                        {node.hostname}
                      </span>
                      {node.label && (
                        <span className="muted" style={{ fontSize: 12 }}>
                          ({node.label})
                        </span>
                      )}
                      {isLocalNode && (
                        <span
                          className="badge"
                          style={{
                            background: 'rgba(56, 189, 248, 0.16)',
                            borderColor: 'rgba(56, 189, 248, 0.36)',
                            color: '#bae6fd'
                          }}
                        >
                          Esta PC
                        </span>
                      )}
                    </div>

                    <div className="row" style={{ gap: 6 }}>
                      <span className={`badge ${node.online ? 'ok' : ''}`}>
                        {node.online ? 'En línea' : 'Sin conexión'}
                      </span>
                      <span
                        className="badge"
                        style={{
                          background: 'rgba(16, 185, 129, 0.14)',
                          borderColor: 'rgba(16, 185, 129, 0.36)',
                          color: '#6ee7b7'
                        }}
                      >
                        <Building2 size={11} /> {node.department}
                      </span>
                      <span className="badge accent">{node.role}</span>
                      {node.lastSeen && (
                        <span className="muted" style={{ fontSize: 11 }}>
                          Visto: {fmtClock(node.lastSeen)}
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => (isEditing ? setEditingNodeId(null) : startEditNode(node))}
                    title="Editar departamento, rol o etiqueta"
                  >
                    <Pencil size={12} color={CYAN} />
                    {isEditing ? 'Cerrar' : 'Editar'}
                  </button>
                </div>

                {/* Inline Dept/Role Editor */}
                {isEditing && (
                  <div
                    className="step-card"
                    style={{
                      borderColor: 'rgba(56, 189, 248, 0.35)',
                      background: 'rgba(10, 15, 24, 0.88)',
                      gap: 10
                    }}
                  >
                    <div className="grid-2" style={{ gap: 10 }}>
                      <div className="field">
                        <label>Departamento</label>
                        <select
                          value={
                            EDITABLE_DEPARTMENTS.includes(editForm.department)
                              ? editForm.department
                              : 'General'
                          }
                          onChange={(e) =>
                            setEditForm((f) => ({ ...f, department: e.target.value }))
                          }
                        >
                          {EDITABLE_DEPARTMENTS.map((d) => (
                            <option key={d} value={d}>
                              {d}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="field">
                        <label>Rol en la Oficina</label>
                        <select
                          value={
                            DEFAULT_ROLES.includes(editForm.role)
                              ? editForm.role
                              : DEFAULT_ROLES[1]
                          }
                          onChange={(e) =>
                            setEditForm((f) => ({ ...f, role: e.target.value }))
                          }
                        >
                          {DEFAULT_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid-2" style={{ gap: 10 }}>
                      <div className="field">
                        <label>Etiqueta / Puesto (opcional)</label>
                        <input
                          type="text"
                          placeholder="Ej: Isla Diseño 02 / Gerencia"
                          value={editForm.label}
                          onChange={(e) =>
                            setEditForm((f) => ({ ...f, label: e.target.value }))
                          }
                        />
                      </div>

                      <div className="field">
                        <label>Notas de soporte / inventario</label>
                        <input
                          type="text"
                          placeholder="Ej: SSD nuevo, UPS conectado..."
                          value={editForm.notes}
                          onChange={(e) =>
                            setEditForm((f) => ({ ...f, notes: e.target.value }))
                          }
                        />
                      </div>
                    </div>

                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => setEditingNodeId(null)}
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        disabled={savingMeta}
                        onClick={() => handleSaveNodeMeta(node.id)}
                      >
                        <Check size={13} />
                        {savingMeta ? 'Guardando...' : 'Guardar cambios'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Identity & Network Info */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    gap: '6px 12px',
                    padding: '10px 12px',
                    borderRadius: 11,
                    background: 'rgba(10, 15, 24, 0.72)',
                    border: '1px solid var(--border)',
                    fontSize: 12.5
                  }}
                >
                  <div className="row" style={{ gap: 6 }}>
                    <span className="muted" style={{ fontSize: 11.5 }}>Usuario:</span>
                    <span style={{ fontWeight: 600 }}>{node.user}</span>
                  </div>

                  <div className="row" style={{ gap: 6 }}>
                    <span className="muted" style={{ fontSize: 11.5 }}>MAC:</span>
                    <span className="mono" style={{ fontSize: 11.5, color: '#cbd5e1' }}>
                      {node.mac || 'No detectada'}
                    </span>
                  </div>

                  <div className="row" style={{ gap: 6 }}>
                    <Network size={12} color={EMERALD_LIGHT} />
                    <span className="muted" style={{ fontSize: 11.5 }}>LAN:</span>
                    {node.lanIp ? (
                      <button
                        type="button"
                        onClick={() => handleCopyText(node.lanIp, 'IP LAN')}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          color: '#a7f3d0',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4
                        }}
                        className="mono"
                        title="Copiar IP LAN"
                      >
                        {node.lanIp} <Copy size={11} />
                      </button>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </div>

                  <div className="row" style={{ gap: 6 }}>
                    <ShieldCheck size={12} color={CYAN} />
                    <span className="muted" style={{ fontSize: 11.5 }}>Tailscale:</span>
                    {node.tailscaleIp ? (
                      <button
                        type="button"
                        onClick={() => handleCopyText(node.tailscaleIp, 'IP Tailscale')}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          color: '#7dd3fc',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4
                        }}
                        className="mono"
                        title="Copiar IP Tailscale"
                      >
                        {node.tailscaleIp} <Copy size={11} />
                      </button>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </div>
                </div>

                {/* Hardware Specs Row */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    gap: '6px 12px',
                    fontSize: 12
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <Cpu size={13} color={CYAN} style={{ flexShrink: 0 }} />
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                      title={`${node.cpuModel}${node.cpuCores ? ` (${node.cpuCores} núcleos)` : ''}`}
                    >
                      {node.cpuModel}
                      {node.cpuCores ? ` · ${node.cpuCores}c` : ''}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <MemoryStick size={13} color={EMERALD_LIGHT} style={{ flexShrink: 0 }} />
                    <span>
                      <strong>{node.ramGB > 0 ? `${Math.round(node.ramGB)} GB` : '—'}</strong> RAM
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <Monitor size={13} color="#94a3b8" style={{ flexShrink: 0 }} />
                    <span
                      className="muted"
                      style={{
                        fontSize: 12,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                      title={node.gpu || 'GPU no reportada'}
                    >
                      GPU: {node.gpu || 'Integrada / N/D'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <Server size={13} color="#94a3b8" style={{ flexShrink: 0 }} />
                    <span
                      className="muted"
                      style={{
                        fontSize: 12,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                      title={`${node.modelDisplay || 'Equipo'} ${node.serial ? `| S/N: ${node.serial}` : ''}`}
                    >
                      {node.modelDisplay || 'PC Windows'}
                      {node.serial ? ` · S/N: ${node.serial}` : ''}
                    </span>
                  </div>
                </div>

                {/* Per-disk mini bars */}
                {node.disks.length > 0 && (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(145px, 1fr))',
                      gap: 8
                    }}
                  >
                    {node.disks.map((d) => {
                      const barColor = getDiskBarColor(d.usedPct);
                      return (
                        <div
                          key={d.drive}
                          style={{
                            padding: '7px 9px',
                            borderRadius: 9,
                            background: 'rgba(11, 16, 26, 0.72)',
                            border: '1px solid var(--border)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 4
                          }}
                        >
                          <div className="between" style={{ gap: 4 }}>
                            <span
                              className="mono"
                              style={{ fontSize: 12, fontWeight: 700, color: '#f8fafc' }}
                              title={d.label || d.drive}
                            >
                              {d.drive}
                              {d.label ? ` ${d.label.slice(0, 8)}` : ''}
                            </span>
                            <span
                              className="mono"
                              style={{
                                fontSize: 11,
                                color: d.usedPct >= 90 ? 'var(--danger)' : 'var(--muted)'
                              }}
                            >
                              {d.usedPct}%
                            </span>
                          </div>
                          <div className="strength-bar" style={{ height: 5 }}>
                            <div
                              className="strength-fill"
                              style={{
                                width: `${d.usedPct}%`,
                                background: barColor
                              }}
                            />
                          </div>
                          <div className="muted" style={{ fontSize: 10.5 }}>
                            {fmtGB(d.freeGB)} libres / {fmtGB(d.totalGB)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {node.notes && !isEditing && (
                  <div className="muted" style={{ fontSize: 11.5, fontStyle: 'italic' }}>
                    Nota: {node.notes}
                  </div>
                )}

                {/* 1-Click Actions Row */}
                <div
                  className="row"
                  style={{
                    gap: 6,
                    paddingTop: 6,
                    borderTop: '1px solid var(--border)',
                    marginTop: 'auto'
                  }}
                >
                  <button
                    type="button"
                    className="btn btn-sm"
                    style={{
                      background: 'rgba(16, 185, 129, 0.14)',
                      borderColor: 'rgba(52, 211, 153, 0.36)',
                      color: '#a7f3d0'
                    }}
                    onClick={() => {
                      if (onSelectPeersForBulk) {
                        onSelectPeersForBulk([node.raw]);
                      } else if (onOpenTab) {
                        onOpenTab('bulk');
                      }
                    }}
                  >
                    <Zap size={12} /> ⚡ Enviar archivos
                  </button>

                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={!node.peerUrl}
                    onClick={() => openScreenModal(node)}
                  >
                    <Camera size={12} color={CYAN} /> 📸 Ver Pantalla
                  </button>

                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={!node.primaryIp}
                    onClick={() => handleLaunchRdp(node)}
                  >
                    <Monitor size={12} /> 🖥️ RDP
                  </button>

                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={!node.primaryIp}
                    onClick={() => handleOpenSmb(node)}
                  >
                    <FolderOpen size={12} /> 📂 Red SMB
                  </button>

                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => (isEditing ? setEditingNodeId(null) : startEditNode(node))}
                  >
                    <Pencil size={12} /> ✏️ Depto
                  </button>

                  {!isConfirmingRemove ? (
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      style={{ marginLeft: 'auto' }}
                      onClick={() => setConfirmRemoveId(node.id)}
                    >
                      <Trash2 size={12} /> 🗑️ Quitar
                    </button>
                  ) : (
                    <div className="row" style={{ marginLeft: 'auto', gap: 5 }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        disabled={removingId === node.id}
                        onClick={() => handleRemoveNode(node)}
                      >
                        {removingId === node.id ? 'Quitando...' : 'Confirmar'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => setConfirmRemoveId(null)}
                      >
                        No
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Remote Screen Preview Modal */}
      {screenModalNode && (
        <div
          onClick={closeScreenModal}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(4, 7, 13, 0.78)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24
          }}
        >
          <div
            className="card"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(960px, 94vw)',
              maxHeight: '90vh',
              borderColor: 'rgba(56, 189, 248, 0.36)',
              background: '#0d1320',
              gap: 14
            }}
          >
            <div className="between">
              <div className="row" style={{ gap: 10 }}>
                <div className="icon-chip">
                  <Camera size={16} />
                </div>
                <div>
                  <h3 style={{ fontSize: 15.5 }}>
                    Pantalla Remota — {screenModalNode.hostname}
                  </h3>
                  <div className="muted mono" style={{ fontSize: 11.5 }}>
                    {screenModalNode.peerUrl}
                    {screenData?.capturedAt ? ` · Actualizado: ${fmtClock(screenData.capturedAt)}` : ''}
                  </div>
                </div>
              </div>

              <div className="row" style={{ gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setScreenAutoLive((v) => !v)}
                  style={
                    screenAutoLive
                      ? {
                          background: 'rgba(16, 185, 129, 0.2)',
                          borderColor: 'rgba(52, 211, 153, 0.5)',
                          color: '#a7f3d0'
                        }
                      : undefined
                  }
                >
                  <span className={`dot ${screenAutoLive ? 'ok' : ''}`} />
                  {screenAutoLive ? 'En vivo (3.5s)' : 'Auto-actualizar'}
                </button>

                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={screenLoading}
                  onClick={() => fetchScreenForNode(screenModalNode, false)}
                >
                  <RefreshCw size={13} />
                  {screenLoading ? 'Capturando...' : 'Capturar ahora'}
                </button>

                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={closeScreenModal}
                >
                  <X size={14} /> Cerrar
                </button>
              </div>
            </div>

            {screenError && (
              <div className="banner error">
                {screenError}
              </div>
            )}

            <div
              style={{
                background: '#060910',
                border: '1px solid var(--border)',
                borderRadius: 12,
                minHeight: 320,
                maxHeight: '68vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden'
              }}
            >
              {screenData?.dataUrl ? (
                <img
                  src={screenData.dataUrl}
                  alt={`Pantalla de ${screenModalNode.hostname}`}
                  style={{
                    maxWidth: '100%',
                    maxHeight: '68vh',
                    objectFit: 'contain',
                    display: 'block'
                  }}
                />
              ) : (
                <div className="muted" style={{ padding: 30, textAlign: 'center' }}>
                  {screenLoading
                    ? 'Solicitando captura de pantalla al equipo remoto...'
                    : 'Sin imagen disponible. Verifica que Esteban Mesh Office esté activo en el equipo.'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

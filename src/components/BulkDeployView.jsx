import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  CheckSquare,
  FileCode2,
  Files,
  FolderOpen,
  FolderPlus,
  HardDrive,
  KeyRound,
  Layers,
  Package,
  Rocket,
  Server,
  ShieldCheck,
  Square,
  Terminal,
  Trash2,
  Upload,
  Usb,
  X
} from 'lucide-react';

const DEPARTMENTS = [
  'General',
  'Diseño',
  'Administración',
  'Ventas',
  'Producción',
  'Dirección',
  'Soporte IT'
];

const ROLES = [
  'Estación de Trabajo',
  'Diseñador / Producción',
  'Administración',
  'Ventas / Comercial',
  'Soporte IT',
  'Servidor / Consola Central'
];

const EMERALD_LIGHT = '#34d399';
const CYAN = '#38bdf8';

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
  return { id, hostname, online, department, role, ip, isLocal: Boolean(n.isLocal) };
}

function normalizeResultRow(r, index) {
  const item = r || {};
  const ok = Boolean(item.ok ?? item.success ?? (!item.error && item.status !== 'error' && item.status !== 'failed'));
  const bytesSent = Number(item.bytesSent ?? item.bytes ?? item.totalBytes ?? 0);
  const speedMBs =
    item.speedMBs ??
    item.mbPerSec ??
    item.rateMBs ??
    (item.durationMs > 0 && bytesSent > 0 ? bytesSent / (1024 * 1024) / (item.durationMs / 1000) : null);
  const shaVerified = item.sha256Verified ?? item.verified ?? (ok && !item.error);
  const filesCount = item.filesSent ?? item.filesCount ?? item.files?.length ?? null;
  return {
    key: item.peerId || item.id || item.hostname || `res-${index}`,
    hostname: item.hostname || item.nodeName || item.peerName || item.peerId || `Equipo #${index + 1}`,
    ip: item.ip || item.lanIp || item.target || '',
    ok,
    bytesSent,
    speedMBs,
    shaVerified: Boolean(shaVerified),
    filesCount,
    durationMs: Number(item.durationMs || 0),
    error: item.error || item.message || ''
  };
}

export default function BulkDeployView({
  api,
  state,
  flash,
  preselectedPeerIds = []
}) {
  const config = state?.config || {};
  const env = state?.env || {};
  const shares = Array.isArray(config.shares) ? config.shares : [];
  const usbDrives = Array.isArray(env.usbDrives) ? env.usbDrives : [];
  const tcpPort = Number(config.port || 4890);
  const udpPort = Number(config.udpPort || 4891);

  const fleetNodes = useMemo(() => {
    const raw = Array.isArray(state?.fleet?.nodes) ? state.fleet.nodes : [];
    return raw.map(normalizeNode).sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return a.hostname.localeCompare(b.hostname);
    });
  }, [state?.fleet?.nodes]);

  // Card 1: Mass Disk Sharing (RBAC)
  const [diskShareMode, setDiskShareMode] = useState('rw');
  const [sharingAllDisks, setSharingAllDisks] = useState(false);

  // Card 2: Bulk File Distribution
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [destinationSubfolder, setDestinationSubfolder] = useState('Entregas-Oficina');
  const [selectedPeerIds, setSelectedPeerIds] = useState(() =>
    Array.isArray(preselectedPeerIds) ? [...new Set(preselectedPeerIds.filter(Boolean))] : []
  );
  const [distributing, setDistributing] = useState(false);
  const [liveProgress, setLiveProgress] = useState(null);
  const [distributionResults, setDistributionResults] = useState([]);

  // Sync preselectedPeerIds when navigating from FleetView
  useEffect(() => {
    if (Array.isArray(preselectedPeerIds) && preselectedPeerIds.length > 0) {
      setSelectedPeerIds([...new Set(preselectedPeerIds.filter(Boolean))]);
    }
  }, [preselectedPeerIds]);

  // Listen to live bulk progress events if exposed in preload
  useEffect(() => {
    if (!api?.onBulkProgress) return undefined;
    const unsubscribe = api.onBulkProgress((evt) => {
      if (!evt) return;
      setLiveProgress(evt);
    });
    return typeof unsubscribe === 'function' ? unsubscribe : undefined;
  }, [api]);

  // Card 3: Enterprise Deploy Kit Generator
  const [kitWorkspaceName, setKitWorkspaceName] = useState(
    () => config.workspaceName || 'VisualCorp Oficina'
  );
  const [kitDepartment, setKitDepartment] = useState('General');
  const [kitRole, setKitRole] = useState('Estación de Trabajo');
  const [kitAutoShareDisks, setKitAutoShareDisks] = useState(true);
  const [kitIncludeMasterKey, setKitIncludeMasterKey] = useState(true);
  const [kitTargetDir, setKitTargetDir] = useState(() => {
    if (usbDrives[0]?.root) {
      return `${String(usbDrives[0].root).replace(/\\+$/, '')}\\Esteban-Mesh-Office-Deploy`;
    }
    return '';
  });
  const [generatingKit, setGeneratingKit] = useState(false);
  const [generatedKitResult, setGeneratedKitResult] = useState(null);

  useEffect(() => {
    if (!kitTargetDir && usbDrives[0]?.root) {
      setKitTargetDir(`${String(usbDrives[0].root).replace(/\\+$/, '')}\\Esteban-Mesh-Office-Deploy`);
    }
  }, [usbDrives, kitTargetDir]);

  const totalSelectedSize = useMemo(
    () => selectedFiles.reduce((acc, f) => acc + (Number(f.size) || 0), 0),
    [selectedFiles]
  );

  // Handlers: Card 1
  const handleShareAllDisks = async () => {
    if (!api?.shareAllFixedDisks) {
      flash?.('error', 'La compartición masiva de discos no está disponible.');
      return;
    }
    setSharingAllDisks(true);
    try {
      const res = await api.shareAllFixedDisks({ mode: diskShareMode });
      const added = res?.added?.length ?? res?.count ?? res?.shares?.length;
      flash?.(
        'ok',
        added != null
          ? `Discos fijos compartidos en modo ${diskShareMode.toUpperCase()} (${added} recurso(s) activo(s)).`
          : `Todos los discos fijos fueron compartidos en modo ${diskShareMode.toUpperCase()}.`
      );
    } catch (err) {
      flash?.('error', err?.message || 'No se pudieron compartir todos los discos fijos.');
    } finally {
      setSharingAllDisks(false);
    }
  };

  const handleOpenFolder = async (folderPath) => {
    if (!folderPath || !api?.openLocalFolder) return;
    try {
      await api.openLocalFolder(folderPath);
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo abrir la carpeta.');
    }
  };

  // Handlers: Card 2
  const handlePickBulkFiles = async () => {
    if (!api?.pickBulkFiles) {
      flash?.('error', 'El selector de archivos masivos no está disponible.');
      return;
    }
    try {
      const res = await api.pickBulkFiles();
      const rawList = Array.isArray(res) ? res : Array.isArray(res?.files) ? res.files : [];
      if (rawList.length === 0) return;

      setSelectedFiles((prev) => {
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
      flash?.('ok', `${rawList.length} archivo(s) agregado(s) a la cola de distribución.`);
    } catch (err) {
      flash?.('error', err?.message || 'No se pudieron seleccionar los archivos.');
    }
  };

  const togglePeerSelection = (peerId) => {
    setSelectedPeerIds((prev) =>
      prev.includes(peerId) ? prev.filter((id) => id !== peerId) : [...prev, peerId]
    );
  };

  const selectAllOnline = () => {
    const ids = fleetNodes.filter((n) => n.online).map((n) => n.id);
    setSelectedPeerIds(ids);
  };

  const selectDesignOnly = () => {
    const ids = fleetNodes
      .filter((n) => {
        const dept = n.department
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase();
        return dept.includes('diseno');
      })
      .map((n) => n.id);
    setSelectedPeerIds(ids);
    if (ids.length === 0) {
      flash?.('info', 'No hay computadoras asignadas al departamento "Diseño" todavía.');
    }
  };

  const handleBulkDistribute = async () => {
    if (!api?.bulkDistributeFiles) {
      flash?.('error', 'El motor de distribución masiva no está disponible.');
      return;
    }
    if (selectedFiles.length === 0) {
      flash?.('error', 'Primero selecciona al menos un archivo en el Paso 1.');
      return;
    }
    if (selectedPeerIds.length === 0) {
      flash?.('error', 'Selecciona al menos una computadora destino en el Paso 2.');
      return;
    }

    setDistributing(true);
    setLiveProgress(null);
    setDistributionResults([]);

    try {
      const res = await api.bulkDistributeFiles({
        filePaths: selectedFiles.map((f) => f.path),
        targetPeerIds: selectedPeerIds,
        destinationSubfolder: destinationSubfolder.trim() || 'Entregas-Oficina'
      });

      const rawResults = Array.isArray(res)
        ? res
        : Array.isArray(res?.results)
          ? res.results
          : Array.isArray(res?.peers)
            ? res.peers
            : [];
      const normalized = rawResults.map(normalizeResultRow);
      setDistributionResults(normalized);

      const okCount = normalized.filter((r) => r.ok).length;
      const failCount = normalized.length - okCount;
      if (failCount === 0 && okCount > 0) {
        flash?.('ok', `Distribución SHA-256 completada con éxito en ${okCount} computadora(s).`);
      } else if (okCount > 0) {
        flash?.('info', `Distribución finalizada: ${okCount} OK, ${failCount} con errores.`);
      } else if (normalized.length > 0) {
        flash?.('error', `Falló el envío en ${failCount} computadora(s). Revisa el detalle en la tabla.`);
      } else {
        flash?.('ok', 'Distribución masiva procesada.');
      }
    } catch (err) {
      flash?.('error', err?.message || 'Error al distribuir archivos en paralelo.');
    } finally {
      setDistributing(false);
    }
  };

  // Handlers: Card 3
  const handlePickKitFolder = async () => {
    const picker = api?.pickSaveFolder;
    if (!picker) {
      flash?.('error', 'El selector de carpetas no está disponible.');
      return;
    }
    try {
      const res = await picker();
      const picked =
        typeof res === 'string'
          ? res
          : res?.folderPath || res?.path || res?.filePath || '';
      if (picked) setKitTargetDir(picked);
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo seleccionar la carpeta destino.');
    }
  };

  const handleGenerateDeployKit = async () => {
    if (!api?.exportEnterpriseDeployKit) {
      flash?.('error', 'El generador de Kit Empresarial no está disponible.');
      return;
    }
    const workspaceName = kitWorkspaceName.trim() || config.workspaceName || 'VisualCorp Oficina';
    setGeneratingKit(true);
    try {
      const res = await api.exportEnterpriseDeployKit({
        targetDir: kitTargetDir.trim() || undefined,
        workspaceName,
        defaultDepartment: kitDepartment,
        defaultRole: kitRole,
        autoShareAllDisks: kitAutoShareDisks,
        includeMasterKey: kitIncludeMasterKey
      });
      if (res?.canceled) return;
      const outDir = res?.outputDir || res?.kitDir || res?.targetDir || res?.path || kitTargetDir;
      setGeneratedKitResult({
        outputDir: outDir,
        files: Array.isArray(res?.files) ? res.files : [],
        generatedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
      flash?.('ok', `Kit Empresarial generado en: ${outDir || 'carpeta seleccionada'}`);
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo generar el Kit Empresarial.');
    } finally {
      setGeneratingKit(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Page Header */}
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
              <Layers size={12} /> Enterprise Provisioning
            </span>
            <span className="badge accent">
              <ShieldCheck size={12} /> Puerto TCP {tcpPort} · Descubrimiento automático UDP {udpPort}
            </span>
          </div>
          <h1>Despliegue Masivo, Discos y Kit Empresarial</h1>
          <p>
            Comparte discos completos con control de permisos RBAC, distribuye archivos pesados a 10+ PCs en
            paralelo con verificación SHA-256 y genera el Kit USB auto-configurable para toda tu oficina.
          </p>
        </div>
      </div>

      {/* CARD 1: Mass Disk Sharing & RBAC */}
      <div
        className="card"
        style={{
          borderColor: 'rgba(16, 185, 129, 0.30)',
          background: 'linear-gradient(155deg, rgba(16, 185, 129, 0.08), rgba(17, 23, 35, 0.90) 45%)'
        }}
      >
        <div className="between">
          <div className="row" style={{ gap: 10 }}>
            <div className="icon-chip ok">
              <HardDrive size={17} />
            </div>
            <div>
              <h2>💾 Compartición Masiva de Discos Completos y Roles (RBAC)</h2>
              <div className="muted" style={{ fontSize: 12.5 }}>
                Expón al instante todos los volúmenes locales fijos de esta computadora al espacio de trabajo con el
                nivel de acceso elegido.
              </div>
            </div>
          </div>

          <span className="badge accent">
            <ShieldCheck size={12} /> Puerto TCP {tcpPort} · Descubrimiento automático UDP {udpPort}
          </span>
        </div>

        <div
          className="step-card"
          style={{
            borderColor: 'rgba(52, 211, 153, 0.28)',
            background: 'rgba(10, 15, 24, 0.78)'
          }}
        >
          <div className="between" style={{ gap: 12 }}>
            <div className="field" style={{ minWidth: 260, flex: '0 1 320px' }}>
              <label>Permiso RBAC para todos los discos compartidos</label>
              <select
                value={diskShareMode}
                onChange={(e) => setDiskShareMode(e.target.value)}
              >
                <option value="rw">Lectura y escritura (RW) — Equipos autorizados</option>
                <option value="ro">Solo lectura (RO) — Consulta segura sin borrado</option>
              </select>
            </div>

            <button
              type="button"
              className="btn btn-primary btn-lg"
              disabled={sharingAllDisks}
              onClick={handleShareAllDisks}
              style={{
                background: 'linear-gradient(135deg, #34d399, #10b981 48%, #38bdf8)',
                color: '#041311',
                boxShadow: '0 6px 22px rgba(16, 185, 129, 0.28)'
              }}
            >
              <HardDrive size={16} />
              {sharingAllDisks
                ? 'Compartiendo discos...'
                : '💾 Compartir TODOS los discos fijos (C:, D:, E:) en 1 clic'}
            </button>
          </div>
        </div>

        {/* Currently shared disks/folders */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="between">
            <span style={{ fontSize: 13, fontWeight: 650 }}>
              Discos y carpetas compartidas actualmente ({shares.length})
            </span>
            <span className="muted" style={{ fontSize: 12 }}>
              Espacio: <strong style={{ color: '#e2e8f0' }}>{config.workspaceName || 'Oficina'}</strong>
            </span>
          </div>

          {shares.length === 0 ? (
            <div className="muted" style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(10,15,24,0.5)' }}>
              Aún no hay discos o carpetas compartidas. Usa el botón superior para compartir C:, D:, E: en 1 clic.
            </div>
          ) : (
            <div className="grid-2" style={{ gap: 9 }}>
              {shares.map((sh) => {
                const isRw = String(sh.mode || 'rw').toLowerCase() === 'rw';
                const enabled = sh.enabled !== false;
                return (
                  <div key={sh.id || sh.path} className="list-item" style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                      <div className="row" style={{ gap: 7 }}>
                        <span className={`dot ${enabled ? 'ok' : ''}`} />
                        <span style={{ fontWeight: 650, fontSize: 13.5 }}>{sh.name || sh.path}</span>
                        <span className={`badge ${isRw ? 'ok' : 'accent'}`}>
                          {isRw ? 'RW · Lectura/Escritura' : 'RO · Solo Lectura'}
                        </span>
                      </div>
                      <span
                        className="mono muted"
                        style={{
                          fontSize: 11.5,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                        title={sh.path}
                      >
                        {sh.path}
                      </span>
                    </div>

                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => handleOpenFolder(sh.path)}
                      title="Abrir en Explorador de Windows"
                    >
                      <FolderOpen size={13} color={CYAN} /> Abrir
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* CARD 2: High-Volume Parallel File Distribution */}
      <div
        className="card"
        style={{
          borderColor: 'rgba(56, 189, 248, 0.30)',
          background: 'linear-gradient(155deg, rgba(56, 189, 248, 0.08), rgba(17, 23, 35, 0.90) 45%)'
        }}
      >
        <div className="between">
          <div className="row" style={{ gap: 10 }}>
            <div className="icon-chip">
              <Rocket size={17} />
            </div>
            <div>
              <h2>🚀 Distribución Masiva de Alto Volumen (1-a-10+ Computadoras en Paralelo)</h2>
              <div className="muted" style={{ fontSize: 12.5 }}>
                Envía instaladores, bibliotecas de diseño, proyectos o respaldos simultáneamente a múltiples PCs con
                comprobación criptográfica SHA-256.
              </div>
            </div>
          </div>

          <span className="badge ok">
            <ShieldCheck size={12} /> Streaming paralelo + SHA-256
          </span>
        </div>

        <div className="grid-2" style={{ gap: 14, alignItems: 'start' }}>
          {/* Step 1: Pick files */}
          <div className="step-card" style={{ gap: 10 }}>
            <div className="between">
              <span style={{ fontWeight: 700, fontSize: 13.5, color: CYAN }}>
                Paso 1 · Seleccionar archivos a distribuir
              </span>
              {selectedFiles.length > 0 && (
                <span className="badge accent">
                  {selectedFiles.length} archivo(s) · {fmtBytes(totalSelectedSize)}
                </span>
              )}
            </div>

            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn"
                onClick={handlePickBulkFiles}
                style={{
                  borderColor: 'rgba(56, 189, 248, 0.42)',
                  background: 'rgba(56, 189, 248, 0.12)',
                  color: '#e0f2fe'
                }}
              >
                <Upload size={14} /> Seleccionar archivos (múltiples)
              </button>
              {selectedFiles.length > 0 && (
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  onClick={() => setSelectedFiles([])}
                >
                  <Trash2 size={13} /> Vaciar lista
                </button>
              )}
            </div>

            {selectedFiles.length === 0 ? (
              <div
                className="muted"
                style={{
                  padding: '16px 12px',
                  borderRadius: 10,
                  border: '1px dashed rgba(148, 163, 184, 0.25)',
                  textAlign: 'center',
                  fontSize: 12.5
                }}
              >
                <Files size={18} style={{ opacity: 0.6, marginBottom: 4 }} />
                <div>Aún no hay archivos seleccionados. Puedes elegir ZIPs, PSDs, instaladores o videos pesados.</div>
              </div>
            ) : (
              <div className="list" style={{ maxHeight: 220, overflowY: 'auto' }}>
                {selectedFiles.map((file) => (
                  <div key={file.path} className="list-item" style={{ padding: '8px 10px' }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontSize: 12.5,
                          fontWeight: 600,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                        title={file.path}
                      >
                        {file.name}
                      </div>
                      <div className="mono muted" style={{ fontSize: 11 }}>
                        {fmtBytes(file.size)}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{ padding: '4px 7px' }}
                      onClick={() =>
                        setSelectedFiles((prev) => prev.filter((f) => f.path !== file.path))
                      }
                      title="Quitar archivo"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="field" style={{ marginTop: 4 }}>
              <label>Subcarpeta destino en cada PC receptora</label>
              <div style={{ position: 'relative' }}>
                <FolderPlus
                  size={14}
                  style={{
                    position: 'absolute',
                    left: 11,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--muted)'
                  }}
                />
                <input
                  type="text"
                  value={destinationSubfolder}
                  onChange={(e) => setDestinationSubfolder(e.target.value)}
                  placeholder="Entregas-Oficina"
                  style={{ paddingLeft: 32 }}
                />
              </div>
            </div>
          </div>

          {/* Step 2: Select Target PCs */}
          <div className="step-card" style={{ gap: 10 }}>
            <div className="between">
              <span style={{ fontWeight: 700, fontSize: 13.5, color: EMERALD_LIGHT }}>
                Paso 2 · Elegir computadoras destino
              </span>
              <span className="badge ok">
                {selectedPeerIds.length} / {fleetNodes.length} seleccionadas
              </span>
            </div>

            <div className="row" style={{ gap: 6 }}>
              <button
                type="button"
                className="btn btn-sm"
                onClick={selectAllOnline}
                style={{
                  borderColor: 'rgba(52, 211, 153, 0.36)',
                  color: '#a7f3d0'
                }}
              >
                Seleccionar todas en línea
              </button>
              <button type="button" className="btn btn-sm" onClick={selectDesignOnly}>
                Solo Diseño
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setSelectedPeerIds([])}
              >
                Limpiar
              </button>
            </div>

            {fleetNodes.length === 0 ? (
              <div
                className="muted"
                style={{
                  padding: '16px 12px',
                  borderRadius: 10,
                  border: '1px dashed rgba(148, 163, 184, 0.25)',
                  textAlign: 'center',
                  fontSize: 12.5
                }}
              >
                No hay equipos en la flota todavía. Escanea la red en la Consola de Flota primero.
              </div>
            ) : (
              <div className="list" style={{ maxHeight: 268, overflowY: 'auto' }}>
                {fleetNodes.map((node) => {
                  const checked = selectedPeerIds.includes(node.id);
                  return (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => togglePeerSelection(node.id)}
                      className="list-item"
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        cursor: 'pointer',
                        padding: '9px 11px',
                        borderColor: checked ? 'rgba(52, 211, 153, 0.55)' : 'var(--border)',
                        background: checked
                          ? 'rgba(16, 185, 129, 0.13)'
                          : 'var(--panel-2)',
                        color: 'var(--text)'
                      }}
                    >
                      <div className="row" style={{ gap: 9, flex: 1, minWidth: 0 }}>
                        {checked ? (
                          <CheckSquare size={16} color={EMERALD_LIGHT} />
                        ) : (
                          <Square size={16} color="var(--muted)" />
                        )}
                        <span className={`dot ${node.online ? 'ok' : ''}`} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 650, fontSize: 13 }}>{node.hostname}</div>
                          <div className="mono muted" style={{ fontSize: 11 }}>
                            {node.ip || 'Sin IP'} · {node.department}
                          </div>
                        </div>
                      </div>
                      <span className={`badge ${node.online ? 'ok' : ''}`}>
                        {node.online ? 'En línea' : 'Offline'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Step 3: Launch button */}
        <div className="between" style={{ gap: 12, paddingTop: 4 }}>
          <div className="muted" style={{ fontSize: 12.5 }}>
            {selectedFiles.length > 0 && selectedPeerIds.length > 0
              ? `Listo para transferir ${selectedFiles.length} archivo(s) (${fmtBytes(totalSelectedSize)}) en paralelo hacia "${destinationSubfolder || 'Entregas-Oficina'}".`
              : 'Selecciona archivos y equipos destino para iniciar el envío paralelo con verificación SHA-256.'}
          </div>

          <button
            type="button"
            className="btn btn-primary btn-lg"
            disabled={distributing || selectedFiles.length === 0 || selectedPeerIds.length === 0}
            onClick={handleBulkDistribute}
            style={{
              background: 'linear-gradient(135deg, #38bdf8, #10b981 55%, #34d399)',
              color: '#041311',
              boxShadow: '0 6px 22px rgba(56, 189, 248, 0.28)'
            }}
          >
            <Rocket size={16} />
            {distributing
              ? 'Distribuyendo en paralelo...'
              : `🚀 Distribuir a ${selectedPeerIds.length} computadora${selectedPeerIds.length === 1 ? '' : 's'} con verificación SHA-256`}
          </button>
        </div>

        {/* Live Progress Banner */}
        {distributing && liveProgress && (
          <div className="banner">
            <div className="between" style={{ marginBottom: 6 }}>
              <span>
                Enviando a <strong>{liveProgress.hostname || liveProgress.peerId || 'flota'}</strong>
                {liveProgress.fileName ? ` · ${liveProgress.fileName}` : ''}
              </span>
              {liveProgress.percent != null && (
                <span className="mono">{Math.round(liveProgress.percent)}%</span>
              )}
            </div>
            {liveProgress.percent != null && (
              <div className="strength-bar" style={{ height: 6 }}>
                <div
                  className="strength-fill"
                  style={{
                    width: `${Math.max(0, Math.min(100, Math.round(liveProgress.percent)))}%`,
                    background: 'linear-gradient(90deg, #38bdf8, #34d399)'
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* Transfer Results Table */}
        {distributionResults.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="between">
              <span style={{ fontWeight: 650, fontSize: 13.5 }}>
                Resultados de distribución por computadora
              </span>
              <span className="badge ok">
                {distributionResults.filter((r) => r.ok).length} / {distributionResults.length} exitosas
              </span>
            </div>

            <div
              style={{
                overflowX: 'auto',
                borderRadius: 12,
                border: '1px solid var(--border)',
                background: 'rgba(10, 15, 24, 0.85)'
              }}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr
                    style={{
                      textAlign: 'left',
                      borderBottom: '1px solid var(--border)',
                      color: 'var(--muted)',
                      fontSize: 11.5
                    }}
                  >
                    <th style={{ padding: '10px 12px' }}>Computadora</th>
                    <th style={{ padding: '10px 12px' }}>Bytes enviados</th>
                    <th style={{ padding: '10px 12px' }}>Velocidad</th>
                    <th style={{ padding: '10px 12px' }}>Verificación / Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {distributionResults.map((row) => (
                    <tr
                      key={row.key}
                      style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.08)' }}
                    >
                      <td style={{ padding: '9px 12px' }}>
                        <div style={{ fontWeight: 650 }}>{row.hostname}</div>
                        {row.ip && (
                          <div className="mono muted" style={{ fontSize: 11 }}>
                            {row.ip}
                          </div>
                        )}
                      </td>
                      <td className="mono" style={{ padding: '9px 12px' }}>
                        {fmtBytes(row.bytesSent)}
                        {row.filesCount != null ? ` (${row.filesCount} arch.)` : ''}
                      </td>
                      <td className="mono" style={{ padding: '9px 12px', color: CYAN }}>
                        {fmtSpeed(row.speedMBs)}
                      </td>
                      <td style={{ padding: '9px 12px' }}>
                        {row.ok ? (
                          <span className="badge ok">
                            <CheckCircle2 size={12} /> {row.shaVerified ? 'SHA-256 OK' : 'Transferido'}
                          </span>
                        ) : (
                          <span className="badge danger" title={row.error}>
                            <AlertCircle size={12} /> {row.error || 'Error de transferencia'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* CARD 3: Enterprise Deploy Kit & Inventory Collector Generator */}
      <div
        className="card hero-card"
        style={{
          borderColor: 'rgba(16, 185, 129, 0.36)',
          background:
            'linear-gradient(135deg, rgba(16, 185, 129, 0.13), rgba(56, 189, 248, 0.09) 52%, rgba(17, 23, 35, 0.94))'
        }}
      >
        <div className="between">
          <div className="row" style={{ gap: 10 }}>
            <div className="icon-chip ok">
              <Package size={17} />
            </div>
            <div>
              <h2>🤖 Generador del Programa Recolector y Kit de Auto-Configuración Empresarial (USB / Red)</h2>
              <div className="muted" style={{ fontSize: 12.5 }}>
                Crea una carpeta lista para pendrive USB o recurso compartido de red y despliega Esteban Mesh Office
                en 10+ PCs sin configuración manual.
              </div>
            </div>
          </div>

          <span className="badge ok">
            <Usb size={12} /> Cero fricción · USB / Red
          </span>
        </div>

        {/* Kit Config Form */}
        <div className="grid-3" style={{ gap: 12 }}>
          <div className="field">
            <label>Nombre de la Empresa / Espacio de Trabajo</label>
            <input
              type="text"
              placeholder="Ej: VisualCorp Oficina"
              value={kitWorkspaceName}
              onChange={(e) => setKitWorkspaceName(e.target.value)}
            />
          </div>

          <div className="field">
            <label>Departamento por defecto</label>
            <select
              value={kitDepartment}
              onChange={(e) => setKitDepartment(e.target.value)}
            >
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Rol por defecto de las PCs</label>
            <select value={kitRole} onChange={(e) => setKitRole(e.target.value)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Policy Checkboxes */}
        <div className="grid-2" style={{ gap: 12 }}>
          <label
            className="checkbox-row step-card"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              padding: '11px 13px'
            }}
          >
            <input
              type="checkbox"
              checked={kitAutoShareDisks}
              onChange={(e) => setKitAutoShareDisks(e.target.checked)}
            />
            <HardDrive size={15} color={EMERALD_LIGHT} style={{ flexShrink: 0 }} />
            <span>Auto-compartir todos los discos fijos al instalar en cada PC</span>
          </label>

          <label
            className="checkbox-row step-card"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              padding: '11px 13px'
            }}
          >
            <input
              type="checkbox"
              checked={kitIncludeMasterKey}
              onChange={(e) => setKitIncludeMasterKey(e.target.checked)}
            />
            <KeyRound size={15} color={CYAN} style={{ flexShrink: 0 }} />
            <span>Incluir clave maestra cifrada del espacio de trabajo</span>
          </label>
        </div>

        {/* Target USB / Folder Picker */}
        <div className="field">
          <label>Carpeta destino o Unidad USB (se creará Esteban-Mesh-Office-Deploy\)</label>
          <div className="row" style={{ gap: 8 }}>
            <input
              type="text"
              style={{ flex: 1 }}
              placeholder="Ej: E:\Esteban-Mesh-Office-Deploy (o deja vacío para elegir al generar)"
              value={kitTargetDir}
              onChange={(e) => setKitTargetDir(e.target.value)}
            />
            <button type="button" className="btn" onClick={handlePickKitFolder}>
              <FolderOpen size={14} color={CYAN} /> Examinar carpeta
            </button>
          </div>

          {usbDrives.length > 0 && (
            <div className="row" style={{ gap: 6, marginTop: 4 }}>
              <span className="muted" style={{ fontSize: 11.5 }}>
                Unidades USB detectadas:
              </span>
              {usbDrives.map((u) => {
                const base = String(u.root || u.driveLetter || '').replace(/\\+$/, '');
                const full = `${base}\\Esteban-Mesh-Office-Deploy`;
                const selected = kitTargetDir.toLowerCase() === full.toLowerCase();
                return (
                  <button
                    key={base}
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setKitTargetDir(full)}
                    style={
                      selected
                        ? {
                            borderColor: 'rgba(52, 211, 153, 0.55)',
                            background: 'rgba(16, 185, 129, 0.18)',
                            color: '#a7f3d0'
                          }
                        : undefined
                    }
                  >
                    <Usb size={12} color={EMERALD_LIGHT} />
                    USB {base} {u.label ? `(${u.label})` : ''}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Big Primary Generate Button */}
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="muted" style={{ fontSize: 12 }}>
            <Building2 size={13} style={{ verticalAlign: 'middle', marginRight: 5 }} />
            Política empaquetada: <strong>{kitWorkspaceName || 'Oficina'}</strong> · Depto:{' '}
            <strong>{kitDepartment}</strong> · TCP {tcpPort} / UDP {udpPort}
          </div>

          <button
            type="button"
            className="btn btn-primary btn-lg"
            disabled={generatingKit}
            onClick={handleGenerateDeployKit}
            style={{
              background: 'linear-gradient(135deg, #34d399, #10b981 48%, #38bdf8)',
              color: '#041311',
              boxShadow: '0 8px 26px rgba(16, 185, 129, 0.32)'
            }}
          >
            <Package size={16} />
            {generatingKit
              ? 'Generando Kit Empresarial...'
              : '🤖 Generar Kit Empresarial (Auto-Configurador + Recolector)'}
          </button>
        </div>

        {/* Generated Result Banner */}
        {generatedKitResult && (
          <div className="banner ok">
            <div className="between" style={{ gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7 }}>
                  <CheckCircle2 size={16} />
                  Kit Empresarial generado con éxito ({generatedKitResult.generatedAt})
                </div>
                <div className="mono" style={{ fontSize: 12, color: '#ecfdf5' }}>
                  {generatedKitResult.outputDir}
                </div>
              </div>

              {generatedKitResult.outputDir && (
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{
                    background: 'rgba(16, 185, 129, 0.24)',
                    borderColor: 'rgba(52, 211, 153, 0.5)',
                    color: '#ecfdf5'
                  }}
                  onClick={() => handleOpenFolder(generatedKitResult.outputDir)}
                >
                  <FolderOpen size={14} /> Abrir carpeta del Kit
                </button>
              )}
            </div>
          </div>
        )}

        {/* Included 2 Programs Explanation */}
        <div className="grid-2" style={{ gap: 12 }}>
          <div className={`step-card ${generatedKitResult ? 'done' : ''}`}>
            <div className="row" style={{ gap: 8 }}>
              <div className="icon-chip ok" style={{ width: 28, height: 28 }}>
                <Terminal size={14} />
              </div>
              <span className="mono" style={{ fontWeight: 700, fontSize: 12.5, color: '#a7f3d0' }}>
                1-AUTO-CONFIGURAR-OFICINA.cmd
              </span>
            </div>
            <div className="muted" style={{ fontSize: 12.5 }}>
              Instala la aplicación, abre automáticamente las reglas de Firewall (TCP {tcpPort} / UDP {udpPort}),
              aplica la configuración de empresa, comparte los discos y registra la PC automáticamente en la flota.
            </div>
          </div>

          <div className={`step-card ${generatedKitResult ? 'done' : ''}`}>
            <div className="row" style={{ gap: 8 }}>
              <div className="icon-chip" style={{ width: 28, height: 28 }}>
                <FileCode2 size={14} />
              </div>
              <span className="mono" style={{ fontWeight: 700, fontSize: 12.5, color: '#bae6fd' }}>
                2-SOLO-RECOLECTAR-INVENTARIO.cmd
              </span>
            </div>
            <div className="muted" style={{ fontSize: 12.5 }}>
              Programa ultraligero sin instalación que extrae todo el hardware, seriales, discos y datos de red de las
              10+ PCs a <span className="mono">JSON + CSV</span> en 2 segundos para importarlo luego desde la Consola
              de Flota.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

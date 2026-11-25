import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Cpu,
  Gauge,
  HardDrive,
  MemoryStick,
  Monitor,
  RefreshCw,
  RotateCcw,
  Save,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Wifi,
  WifiOff,
  Zap
} from 'lucide-react';

const DEFAULT_THRESHOLDS = {
  cpuPercent: 85,
  ramPercent: 85,
  diskPercent: 90,
  diskBusyMBs: 150
};

const REFRESH_INTERVAL_MS = 12000;

function clampPercent(val) {
  const n = Number(val);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function fmtGB(bytes, digits = 1) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '0 GB';
  const gb = n / (1024 ** 3);
  if (gb >= 1000) {
    return `${gb.toFixed(0)} GB`;
  }
  return `${gb.toFixed(digits)} GB`;
}

function fmtMBs(val) {
  const n = Number(val);
  if (val == null || !Number.isFinite(n)) return '—';
  if (n >= 100) return `${Math.round(n)} MB/s`;
  return `${n.toFixed(1)} MB/s`;
}

function fmtClock(isoOrDate) {
  if (!isoOrDate) return '';
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function getBarColor(percent, limit = 85) {
  const p = Number(percent) || 0;
  if (p >= limit) return 'var(--danger)';
  if (p >= Math.max(55, limit - 15)) return 'var(--warn)';
  return 'var(--ok)';
}

function getSeverityBadge(severity) {
  const s = String(severity || '').toLowerCase();
  if (s === 'danger' || s === 'critical' || s === 'error' || s === 'high') return 'danger';
  if (s === 'warn' || s === 'warning' || s === 'medium') return 'warn';
  return 'accent';
}

function UsageBar({ label, valueLabel, subLabel, percent, threshold, icon }) {
  const pct = clampPercent(percent);
  const color = getBarColor(pct, threshold);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div className="between" style={{ gap: 6 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600 }}>
          {icon}
          <span>{label}</span>
        </span>
        <span className="mono" style={{ fontSize: 12, color: pct >= threshold ? 'var(--danger)' : 'var(--text)' }}>
          {valueLabel}
        </span>
      </div>
      <div className="strength-bar" style={{ height: 6 }}>
        <div
          className="strength-fill"
          style={{
            width: `${pct}%`,
            background: color
          }}
        />
      </div>
      {subLabel && (
        <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.35 }}>
          {subLabel}
        </div>
      )}
    </div>
  );
}

export default function MetricsView({ api, flash }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [benchmarking, setBenchmarking] = useState(false);
  const [savingThresholds, setSavingThresholds] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [showThresholds, setShowThresholds] = useState(false);

  const [thresholdForm, setThresholdForm] = useState(DEFAULT_THRESHOLDS);
  const thresholdsDirtyRef = useRef(false);
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);

  const syncThresholdsFromData = useCallback((res) => {
    if (!res?.thresholds || thresholdsDirtyRef.current) return;
    setThresholdForm({
      cpuPercent: Number(res.thresholds.cpuPercent ?? DEFAULT_THRESHOLDS.cpuPercent),
      ramPercent: Number(res.thresholds.ramPercent ?? DEFAULT_THRESHOLDS.ramPercent),
      diskPercent: Number(res.thresholds.diskPercent ?? DEFAULT_THRESHOLDS.diskPercent),
      diskBusyMBs: Number(res.thresholds.diskBusyMBs ?? DEFAULT_THRESHOLDS.diskBusyMBs)
    });
  }, []);

  const fetchMetrics = useCallback(
    async ({ silent = false, includeDiskBench = false } = {}) => {
      if (!api?.getGlobalMetrics) {
        if (mountedRef.current) {
          setError('El módulo de métricas globales no está disponible en esta versión.');
          setLoading(false);
        }
        return;
      }
      if (inFlightRef.current && silent) return;
      inFlightRef.current = true;
      if (!silent && mountedRef.current) setRefreshing(true);

      try {
        const res = await api.getGlobalMetrics({ includeDiskBench });
        if (!mountedRef.current) return;
        setData(res);
        setError('');
        setLastUpdated(new Date());
        syncThresholdsFromData(res);
      } catch (err) {
        if (!mountedRef.current) return;
        const msg = err?.message || 'No se pudieron obtener las métricas de la red.';
        setError(msg);
        if (!silent && flash) flash('error', msg);
      } finally {
        inFlightRef.current = false;
        if (mountedRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [api, flash, syncThresholdsFromData]
  );

  useEffect(() => {
    mountedRef.current = true;
    fetchMetrics({ silent: false });
    const timer = setInterval(() => {
      fetchMetrics({ silent: true });
    }, REFRESH_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [fetchMetrics]);

  const handleRunBenchmark = async () => {
    if (!api?.runDiskBenchmark) return;
    setBenchmarking(true);
    try {
      const res = await api.runDiskBenchmark();
      if (!mountedRef.current) return;
      if (res) {
        setData(res);
        setLastUpdated(new Date());
        syncThresholdsFromData(res);
      }
      flash?.('ok', 'Prueba de velocidad de disco completada.');
    } catch (err) {
      flash?.('error', err?.message || 'Error al medir la velocidad de disco.');
    } finally {
      if (mountedRef.current) setBenchmarking(false);
    }
  };

  const handleSaveThresholds = async (e) => {
    e.preventDefault();
    if (!api?.updateMetricThresholds) return;
    const payload = {
      cpuPercent: Math.max(10, Math.min(100, Number(thresholdForm.cpuPercent) || DEFAULT_THRESHOLDS.cpuPercent)),
      ramPercent: Math.max(10, Math.min(100, Number(thresholdForm.ramPercent) || DEFAULT_THRESHOLDS.ramPercent)),
      diskPercent: Math.max(20, Math.min(100, Number(thresholdForm.diskPercent) || DEFAULT_THRESHOLDS.diskPercent)),
      diskBusyMBs: Math.max(5, Math.min(10000, Number(thresholdForm.diskBusyMBs) || DEFAULT_THRESHOLDS.diskBusyMBs))
    };
    setSavingThresholds(true);
    try {
      const res = await api.updateMetricThresholds(payload);
      if (!mountedRef.current) return;
      thresholdsDirtyRef.current = false;
      if (res) {
        setData(res);
        setLastUpdated(new Date());
        syncThresholdsFromData(res);
      } else {
        setThresholdForm(payload);
      }
      flash?.('ok', 'Umbrales de notificación de sobrecarga guardados.');
    } catch (err) {
      flash?.('error', err?.message || 'No se pudieron guardar los umbrales.');
    } finally {
      if (mountedRef.current) setSavingThresholds(false);
    }
  };

  const handleResetThresholds = () => {
    thresholdsDirtyRef.current = true;
    setThresholdForm(DEFAULT_THRESHOLDS);
  };

  const thresholds = data?.thresholds || DEFAULT_THRESHOLDS;
  const nodes = useMemo(() => {
    const raw = Array.isArray(data?.nodes) ? data.nodes : [];
    return [...raw].sort((a, b) => {
      if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1;
      if (a.online !== b.online) return a.online ? -1 : 1;
      return String(a.nodeName || '').localeCompare(String(b.nodeName || ''));
    });
  }, [data]);

  const busyNodes = useMemo(() => {
    if (Array.isArray(data?.busyNodes) && data.busyNodes.length > 0) {
      return data.busyNodes;
    }
    return nodes
      .filter((n) => n.metrics?.isBusy)
      .map((n) => ({
        nodeName: n.nodeName,
        busyReason: n.metrics?.busyReason || 'Recursos por encima del umbral configurado',
        alerts: n.metrics?.alerts || []
      }));
  }, [data, nodes]);

  const totalAlerts = useMemo(() => {
    const perNodeCount = nodes.reduce((acc, n) => acc + (n.metrics?.alerts?.length || 0), 0);
    if (perNodeCount > 0) return perNodeCount;
    return busyNodes.reduce((acc, b) => acc + Math.max(1, b.alerts?.length || 0), 0);
  }, [nodes, busyNodes]);

  const hasCriticalAlert = useMemo(() => {
    return (
      busyNodes.some((b) =>
        (b.alerts || []).some((a) => ['danger', 'critical', 'error', 'high'].includes(String(a.severity || '').toLowerCase()))
      ) ||
      nodes.some((n) =>
        (n.metrics?.alerts || []).some((a) => ['danger', 'critical', 'error', 'high'].includes(String(a.severity || '').toLowerCase()))
      )
    );
  }, [busyNodes, nodes]);

  const nodesOnline = data?.nodesOnline ?? nodes.filter((n) => n.online).length;
  const nodesTotal = data?.nodesTotal ?? nodes.length;
  const maxPlanDevices = data?.maxPlanDevices ?? 100;
  const availableSlots = data?.availableSlots ?? Math.max(0, maxPlanDevices - nodesTotal);

  const globalStorage = data?.globalStorage || { totalBytes: 0, freeBytes: 0, usedBytes: 0, percent: 0 };
  const globalStoragePct = clampPercent(globalStorage.percent);
  const avgCpu = clampPercent(data?.avgCpuPercent);
  const avgRam = clampPercent(data?.avgRamPercent);

  const avgLoadStatus = useMemo(() => {
    if (avgCpu >= thresholds.cpuPercent || avgRam >= thresholds.ramPercent) {
      return { tone: 'danger', label: 'Sobrecarga en red' };
    }
    if (avgCpu >= Math.max(60, thresholds.cpuPercent - 15) || avgRam >= Math.max(60, thresholds.ramPercent - 15)) {
      return { tone: 'warn', label: 'Carga moderada' };
    }
    return { tone: 'ok', label: 'Carga saludable' };
  }, [avgCpu, avgRam, thresholds.cpuPercent, thresholds.ramPercent]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Métricas de la red</h1>
          <p>
            Estado en tiempo real de CPU, RAM, discos y rendimiento de almacenamiento en todos los equipos de tu malla Esteban Cloud.
          </p>
        </div>
        <div className="row">
          <span className="badge" title="Actualización automática cada 6 segundos">
            <span className="dot ok" />
            <span>En vivo · 6s{lastUpdated ? ` · ${fmtClock(lastUpdated)}` : ''}</span>
          </span>
          <button
            type="button"
            className="btn"
            onClick={() => fetchMetrics({ silent: false })}
            disabled={refreshing || benchmarking}
          >
            <RefreshCw
              size={15}
              style={refreshing ? { animation: 'ec-spin 0.9s linear infinite' } : undefined}
            />
            Actualizar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleRunBenchmark}
            disabled={benchmarking}
          >
            <Gauge size={15} />
            {benchmarking ? 'Midiendo disco...' : 'Medir velocidad de disco'}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes ec-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

      {error && (
        <div className="banner error">
          <div className="between">
            <span className="row" style={{ gap: 8 }}>
              <AlertTriangle size={16} />
              <span>{error}</span>
            </span>
            <button type="button" className="btn btn-sm" onClick={() => fetchMetrics({ silent: false })}>
              Reintentar
            </button>
          </div>
        </div>
      )}

      {busyNodes.length > 0 && (
        <div
          className={`banner ${hasCriticalAlert ? 'error' : ''}`}
          role="alert"
          style={
            hasCriticalAlert
              ? undefined
              : {
                  background: 'rgba(251, 191, 36, 0.12)',
                  borderColor: 'rgba(251, 191, 36, 0.38)',
                  color: '#fde68a'
                }
          }
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
            <AlertTriangle
              size={18}
              style={{ flexShrink: 0, marginTop: 2, color: hasCriticalAlert ? 'var(--danger)' : 'var(--warn)' }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>
                Alerta de sobrecarga detectada en {busyNodes.length}{' '}
                {busyNodes.length === 1 ? 'equipo' : 'equipos'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {busyNodes.map((bn, idx) => (
                  <div key={`${bn.nodeName || idx}-${idx}`} className="row" style={{ gap: 8 }}>
                    <span className={`badge ${hasCriticalAlert ? 'danger' : 'warn'}`}>{bn.nodeName}</span>
                    <span style={{ fontSize: 13 }}>
                      {bn.busyReason ||
                        (bn.alerts || [])
                          .map((a) => a.message)
                          .filter(Boolean)
                          .join(' · ') ||
                        'Supera los umbrales de rendimiento configurados'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4 Global KPI Cards */}
      <div className="grid-4">
        <div className="card">
          <div className="kpi-head">
            <span className="muted">Equipos en red</span>
            <div className={`icon-chip ${nodesOnline > 0 ? 'ok' : 'warn'}`}>
              <Server size={15} />
            </div>
          </div>
          <div className="stat-value">
            {loading && !data ? '—' : `${nodesOnline} / ${nodesTotal}`}
          </div>
          <span className="badge accent" style={{ width: 'fit-content' }}>
            Hasta {maxPlanDevices} en Tailscale Personal · {availableSlots} disponibles
          </span>
        </div>

        <div className="card">
          <div className="kpi-head">
            <span className="muted">Almacenamiento global libre</span>
            <div className={`icon-chip ${globalStoragePct >= thresholds.diskPercent ? 'warn' : ''}`}>
              <HardDrive size={15} />
            </div>
          </div>
          <div className="stat-value" style={{ fontSize: 16.5 }}>
            {loading && !data ? '—' : `${fmtGB(globalStorage.freeBytes)} / ${fmtGB(globalStorage.totalBytes)}`}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div className="strength-bar" style={{ height: 6 }}>
              <div
                className="strength-fill"
                style={{
                  width: `${globalStoragePct}%`,
                  background: getBarColor(globalStoragePct, thresholds.diskPercent)
                }}
              />
            </div>
            <div className="between" style={{ fontSize: 11.5 }}>
              <span className="muted">{globalStoragePct}% en uso</span>
              <span className="muted mono">{fmtGB(globalStorage.usedBytes)} usados</span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="kpi-head">
            <span className="muted">CPU / RAM promedio de la red</span>
            <div className={`icon-chip ${avgLoadStatus.tone === 'ok' ? 'ok' : 'warn'}`}>
              <Cpu size={15} />
            </div>
          </div>
          <div className="stat-value" style={{ fontSize: 16.5 }}>
            {loading && !data ? '—' : `CPU ${avgCpu}% · RAM ${avgRam}%`}
          </div>
          <span className={`badge ${avgLoadStatus.tone}`} style={{ width: 'fit-content' }}>
            <Activity size={12} /> {avgLoadStatus.label}
          </span>
        </div>

        <div className="card">
          <div className="kpi-head">
            <span className="muted">Estado y alertas</span>
            <div
              className={`icon-chip ${totalAlerts === 0 ? 'ok' : 'warn'}`}
              style={
                totalAlerts > 0 && hasCriticalAlert
                  ? {
                      background: 'rgba(248, 113, 113, 0.14)',
                      borderColor: 'rgba(248, 113, 113, 0.34)',
                      color: 'var(--danger)'
                    }
                  : undefined
              }
            >
              {totalAlerts === 0 ? <ShieldCheck size={15} /> : <AlertTriangle size={15} />}
            </div>
          </div>
          <div
            className="stat-value"
            style={{
              color:
                totalAlerts === 0
                  ? 'var(--ok)'
                  : hasCriticalAlert
                    ? 'var(--danger)'
                    : 'var(--warn)'
            }}
          >
            {loading && !data
              ? '—'
              : totalAlerts === 0
                ? '0 alertas'
                : `${totalAlerts} ${totalAlerts === 1 ? 'alerta activa' : 'alertas activas'}`}
          </div>
          <span
            className={`badge ${totalAlerts === 0 ? 'ok' : hasCriticalAlert ? 'danger' : 'warn'}`}
            style={{ width: 'fit-content' }}
          >
            {totalAlerts === 0
              ? 'Todos los nodos estables'
              : `${busyNodes.length} ${busyNodes.length === 1 ? 'nodo sobrecargado' : 'nodos sobrecargados'}`}
          </span>
        </div>
      </div>

      {/* Per-computer Rich Cards */}
      {loading && !data ? (
        <div className="card">
          <div className="row">
            <RefreshCw size={16} style={{ animation: 'ec-spin 0.9s linear infinite', color: 'var(--accent)' }} />
            <span className="muted">Consultando métricas en vivo de los equipos de tu malla...</span>
          </div>
        </div>
      ) : nodes.length === 0 ? (
        <div className="card">
          <h2>Sin equipos detectados todavía</h2>
          <p className="muted" style={{ margin: 0 }}>
            Cuando el servidor local o los nodos Tailscale estén activos, aparecerán aquí con sus métricas de CPU, RAM, velocidad de disco y unidades.
          </p>
        </div>
      ) : (
        <div className="grid-2">
          {nodes.map((node, index) => {
            const m = node.metrics || null;
            const isBusy = Boolean(m?.isBusy);
            const cpuPct = clampPercent(m?.cpu?.percent);
            const ramPct = clampPercent(m?.memory?.percent);
            const diskSpeed = m?.diskSpeed || {};
            const liveMBs = Number(diskSpeed.liveMBs);
            const isDiskHot = Number.isFinite(liveMBs) && liveMBs >= thresholds.diskBusyMBs;
            const disks = Array.isArray(m?.disks) ? m.disks : [];
            const nodeAlerts = Array.isArray(m?.alerts) ? m.alerts : [];

            return (
              <div
                key={`${node.nodeName || node.ip || index}`}
                className="card"
                style={{
                  borderColor: isBusy
                    ? 'rgba(248, 113, 113, 0.44)'
                    : !node.online
                      ? 'rgba(148, 163, 184, 0.14)'
                      : node.isLocal
                        ? 'rgba(56, 189, 248, 0.28)'
                        : undefined,
                  opacity: node.online ? 1 : 0.78
                }}
              >
                {/* Node Header */}
                <div className="between" style={{ alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
                    <div className="row" style={{ gap: 7 }}>
                      <Monitor size={17} color={node.online ? 'var(--accent)' : 'var(--muted)'} />
                      <strong style={{ fontSize: 15.5, letterSpacing: '-0.01em' }}>
                        {node.nodeName || 'Nodo sin nombre'}
                      </strong>
                      <span className={`badge ${node.isLocal ? 'accent' : ''}`}>
                        {node.isLocal ? 'Local' : 'Remoto'}
                      </span>
                      <span className={`badge ${node.online ? 'ok' : 'danger'}`}>
                        {node.online ? <Wifi size={11} /> : <WifiOff size={11} />}
                        {node.online ? 'En línea' : 'Sin conexión'}
                      </span>
                      {isBusy && (
                        <span className="badge danger">
                          <AlertTriangle size={11} /> Sobrecargado
                        </span>
                      )}
                    </div>
                    <div className="row muted mono" style={{ fontSize: 12, gap: 10 }}>
                      <span>{node.ip || 'Sin IP Tailscale'}</span>
                      {node.online && node.latencyMs != null && (
                        <span>· {Math.round(node.latencyMs)} ms</span>
                      )}
                      {node.version && <span>· v{node.version}</span>}
                    </div>
                  </div>
                </div>

                {/* Error or Offline message */}
                {(!node.online || node.error) && !m ? (
                  <div
                    style={{
                      padding: '12px 13px',
                      borderRadius: 12,
                      background: 'rgba(10, 15, 24, 0.72)',
                      border: '1px solid var(--border)',
                      color: 'var(--muted)',
                      fontSize: 13
                    }}
                  >
                    {node.error || 'Este equipo no responde en la malla Tailscale en este momento.'}
                  </div>
                ) : (
                  <>
                    {/* CPU & RAM */}
                    <div className="grid-2" style={{ gap: 12 }}>
                      <div
                        style={{
                          padding: '11px 12px',
                          borderRadius: 12,
                          background: 'var(--panel-2)',
                          border: '1px solid var(--border)'
                        }}
                      >
                        <UsageBar
                          label="CPU"
                          valueLabel={`${cpuPct}%`}
                          subLabel={
                            m?.cpu?.cores
                              ? `${m.cpu.cores} núcleos${m.cpu.model ? ` · ${m.cpu.model}` : ''}`
                              : m?.cpu?.model || 'Procesador'
                          }
                          percent={cpuPct}
                          threshold={thresholds.cpuPercent}
                          icon={<Cpu size={14} color="var(--accent)" />}
                        />
                      </div>

                      <div
                        style={{
                          padding: '11px 12px',
                          borderRadius: 12,
                          background: 'var(--panel-2)',
                          border: '1px solid var(--border)'
                        }}
                      >
                        <UsageBar
                          label="RAM"
                          valueLabel={`${ramPct}%`}
                          subLabel={
                            m?.memory?.totalBytes
                              ? `${fmtGB(m.memory.usedBytes)} / ${fmtGB(m.memory.totalBytes)} (${fmtGB(m.memory.freeBytes)} libres)`
                              : 'Memoria del sistema'
                          }
                          percent={ramPct}
                          threshold={thresholds.ramPercent}
                          icon={<MemoryStick size={14} color="var(--accent)" />}
                        />
                      </div>
                    </div>

                    {/* Disk Speed Panel */}
                    <div
                      style={{
                        padding: '11px 13px',
                        borderRadius: 12,
                        background: 'rgba(10, 15, 24, 0.68)',
                        border: `1px solid ${isDiskHot ? 'rgba(251, 191, 36, 0.36)' : 'var(--border)'}`,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 9
                      }}
                    >
                      <div className="between">
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 650 }}>
                          <Zap size={14} color={isDiskHot ? 'var(--warn)' : 'var(--accent)'} />
                          Velocidad de disco
                        </span>
                        <span className="muted" style={{ fontSize: 11.5 }}>
                          {diskSpeed.testedAt ? `Medido ${fmtClock(diskSpeed.testedAt)}` : 'Sin benchmark reciente'}
                        </span>
                      </div>
                      <div className="grid-3" style={{ gap: 8 }}>
                        <div
                          style={{
                            padding: '7px 9px',
                            borderRadius: 9,
                            background: 'rgba(17, 23, 35, 0.85)',
                            border: '1px solid var(--border)'
                          }}
                        >
                          <div className="muted" style={{ fontSize: 11 }}>Lectura</div>
                          <div className="mono" style={{ fontWeight: 700, fontSize: 13.5, marginTop: 2 }}>
                            {fmtMBs(diskSpeed.readMBs)}
                          </div>
                        </div>
                        <div
                          style={{
                            padding: '7px 9px',
                            borderRadius: 9,
                            background: 'rgba(17, 23, 35, 0.85)',
                            border: '1px solid var(--border)'
                          }}
                        >
                          <div className="muted" style={{ fontSize: 11 }}>Escritura</div>
                          <div className="mono" style={{ fontWeight: 700, fontSize: 13.5, marginTop: 2 }}>
                            {fmtMBs(diskSpeed.writeMBs)}
                          </div>
                        </div>
                        <div
                          style={{
                            padding: '7px 9px',
                            borderRadius: 9,
                            background: isDiskHot ? 'rgba(251, 191, 36, 0.1)' : 'rgba(17, 23, 35, 0.85)',
                            border: `1px solid ${isDiskHot ? 'rgba(251, 191, 36, 0.35)' : 'var(--border)'}`
                          }}
                        >
                          <div className="muted" style={{ fontSize: 11 }}>Actividad en vivo</div>
                          <div
                            className="mono"
                            style={{
                              fontWeight: 700,
                              fontSize: 13.5,
                              marginTop: 2,
                              color: isDiskHot ? 'var(--warn)' : 'var(--text)'
                            }}
                          >
                            {fmtMBs(diskSpeed.liveMBs)}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Per-drive Storage Bars */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div className="between">
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 650 }}>
                          <HardDrive size={14} color="var(--accent)" />
                          Almacenamiento por unidad
                        </span>
                        {m?.storageSummary?.totalBytes > 0 && (
                          <span className="muted mono" style={{ fontSize: 11.5 }}>
                            Total libre: {fmtGB(m.storageSummary.freeBytes)} / {fmtGB(m.storageSummary.totalBytes)}
                          </span>
                        )}
                      </div>

                      {disks.length === 0 ? (
                        <div className="muted" style={{ fontSize: 12.5 }}>
                          Sin unidades reportadas por este equipo.
                        </div>
                      ) : (
                        <div className="list" style={{ gap: 7 }}>
                          {disks.map((d, di) => {
                            const dPct = clampPercent(d.percent);
                            const dColor = getBarColor(dPct, thresholds.diskPercent);
                            return (
                              <div
                                key={`${d.drive || di}-${di}`}
                                style={{
                                  padding: '9px 11px',
                                  borderRadius: 10,
                                  background: 'var(--panel-2)',
                                  border: '1px solid var(--border)',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: 5
                                }}
                              >
                                <div className="between" style={{ gap: 8 }}>
                                  <div className="row" style={{ gap: 6 }}>
                                    <span className="mono" style={{ fontWeight: 700, fontSize: 13 }}>
                                      {d.drive}
                                    </span>
                                    {d.label && (
                                      <span className="muted" style={{ fontSize: 12 }}>
                                        {d.label}
                                      </span>
                                    )}
                                    {d.fs && (
                                      <span className="badge" style={{ padding: '1px 6px', fontSize: 10.5 }}>
                                        {d.fs}
                                      </span>
                                    )}
                                  </div>
                                  <span className="mono" style={{ fontSize: 12 }}>
                                    <strong style={{ color: dPct >= thresholds.diskPercent ? 'var(--danger)' : 'var(--ok)' }}>
                                      {fmtGB(d.freeBytes)} libres
                                    </strong>{' '}
                                    <span className="muted">/ {fmtGB(d.totalBytes)} ({dPct}%)</span>
                                  </span>
                                </div>
                                <div className="strength-bar" style={{ height: 5 }}>
                                  <div
                                    className="strength-fill"
                                    style={{ width: `${dPct}%`, background: dColor }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Node-level alerts */}
                    {nodeAlerts.length > 0 && (
                      <div className="list" style={{ gap: 6, marginTop: 2 }}>
                        {nodeAlerts.map((al, ai) => {
                          const tone = getSeverityBadge(al.severity);
                          return (
                            <div
                              key={ai}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                padding: '7px 10px',
                                borderRadius: 9,
                                fontSize: 12.5,
                                background:
                                  tone === 'danger'
                                    ? 'rgba(248, 113, 113, 0.11)'
                                    : tone === 'warn'
                                      ? 'rgba(251, 191, 36, 0.11)'
                                      : 'rgba(56, 189, 248, 0.1)',
                                border:
                                  tone === 'danger'
                                    ? '1px solid rgba(248, 113, 113, 0.3)'
                                    : tone === 'warn'
                                      ? '1px solid rgba(251, 191, 36, 0.3)'
                                      : '1px solid rgba(56, 189, 248, 0.25)'
                              }}
                            >
                              <AlertTriangle
                                size={14}
                                color={tone === 'danger' ? 'var(--danger)' : tone === 'warn' ? 'var(--warn)' : 'var(--accent)'}
                              />
                              <span>{al.message}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Collapsible Overload Notification Thresholds Card */}
      <div className="card">
        <button
          type="button"
          onClick={() => setShowThresholds((v) => !v)}
          aria-expanded={showThresholds}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            background: 'none',
            border: 'none',
            padding: 0,
            color: 'var(--text)',
            cursor: 'pointer',
            gap: 12,
            textAlign: 'left'
          }}
        >
          <div className="row" style={{ gap: 10 }}>
            <div className="icon-chip">
              <SlidersHorizontal size={15} />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 650 }}>Umbrales de notificación de sobrecarga</div>
              <div className="muted" style={{ fontSize: 12.5 }}>
                Configura cuándo resaltar un equipo como sobrecargado y disparar alertas en la red.
              </div>
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <span className="badge mono">CPU ≥ {thresholds.cpuPercent}%</span>
            <span className="badge mono">RAM ≥ {thresholds.ramPercent}%</span>
            <span className="badge mono">Disco ≥ {thresholds.diskPercent}%</span>
            <span className="badge mono">E/S ≥ {thresholds.diskBusyMBs} MB/s</span>
            {showThresholds ? <ChevronUp size={17} color="var(--muted)" /> : <ChevronDown size={17} color="var(--muted)" />}
          </div>
        </button>

        {showThresholds && (
          <form
            onSubmit={handleSaveThresholds}
            style={{
              borderTop: '1px solid var(--border)',
              paddingTop: 14,
              display: 'flex',
              flexDirection: 'column',
              gap: 14
            }}
          >
            <div className="grid-4">
              <div className="field">
                <label htmlFor="ec-th-cpu">CPU máxima (%)</label>
                <input
                  id="ec-th-cpu"
                  type="number"
                  min={10}
                  max={100}
                  value={thresholdForm.cpuPercent}
                  onChange={(e) => {
                    thresholdsDirtyRef.current = true;
                    setThresholdForm((prev) => ({ ...prev, cpuPercent: e.target.value }));
                  }}
                />
              </div>

              <div className="field">
                <label htmlFor="ec-th-ram">RAM máxima (%)</label>
                <input
                  id="ec-th-ram"
                  type="number"
                  min={10}
                  max={100}
                  value={thresholdForm.ramPercent}
                  onChange={(e) => {
                    thresholdsDirtyRef.current = true;
                    setThresholdForm((prev) => ({ ...prev, ramPercent: e.target.value }));
                  }}
                />
              </div>

              <div className="field">
                <label htmlFor="ec-th-disk">Uso de disco (%)</label>
                <input
                  id="ec-th-disk"
                  type="number"
                  min={20}
                  max={100}
                  value={thresholdForm.diskPercent}
                  onChange={(e) => {
                    thresholdsDirtyRef.current = true;
                    setThresholdForm((prev) => ({ ...prev, diskPercent: e.target.value }));
                  }}
                />
              </div>

              <div className="field">
                <label htmlFor="ec-th-io">Disco ocupado (MB/s)</label>
                <input
                  id="ec-th-io"
                  type="number"
                  min={5}
                  max={10000}
                  value={thresholdForm.diskBusyMBs}
                  onChange={(e) => {
                    thresholdsDirtyRef.current = true;
                    setThresholdForm((prev) => ({ ...prev, diskBusyMBs: e.target.value }));
                  }}
                />
              </div>
            </div>

            <div className="between">
              <span className="muted" style={{ fontSize: 12.5 }}>
                Estos umbrales se aplican a todos los equipos monitoreados en la malla.
              </span>
              <div className="row">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={handleResetThresholds}
                  disabled={savingThresholds}
                >
                  <RotateCcw size={13} /> Valores recomendados
                </button>
                <button
                  type="submit"
                  className="btn btn-sm btn-primary"
                  disabled={savingThresholds}
                >
                  <Save size={13} /> {savingThresholds ? 'Guardando...' : 'Guardar umbrales'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </>
  );
}

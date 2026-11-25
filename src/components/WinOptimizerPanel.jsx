import React, { useEffect, useMemo, useState } from 'react';
import {
  Zap,
  ShieldCheck,
  Trash2,
  Download,
  Copy,
  Play,
  RotateCcw,
  FileCode2,
  CheckCircle2,
  AlertCircle,
  Package
} from 'lucide-react';

const CATEGORY_META = [
  { id: 'all', label: 'Todas' },
  { id: 'performance', label: '⚡ Rendimiento & RAM' },
  { id: 'privacy', label: '🛡️ Privacidad & Telemetría' },
  { id: 'cleanup', label: '🧹 Limpieza & Mantenimiento' },
  { id: 'apps', label: '📦 Apps Winget' }
];

export default function WinOptimizerPanel({ api, flash }) {
  const [catalog, setCatalog] = useState({ tweaks: [], presets: [] });
  const [category, setCategory] = useState('all');
  const [selectedIds, setSelectedIds] = useState([]);
  const [mode, setMode] = useState('apply');
  const [preview, setPreview] = useState({ script: '', requiresAdmin: false, selectedCount: 0 });
  const [showScript, setShowScript] = useState(true);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState(null);

  useEffect(() => {
    if (!api?.winOptGetCatalog) return;
    api.winOptGetCatalog()
      .then((data) => {
        if (data && Array.isArray(data.tweaks)) {
          setCatalog(data);
          const eco = (data.presets || []).find((p) => p.id === 'eco-office');
          if (eco && Array.isArray(eco.tweakIds)) {
            setSelectedIds(eco.tweakIds);
          }
        }
      })
      .catch(() => {});
  }, [api]);

  useEffect(() => {
    if (!api?.winOptPreviewScript) return;
    if (selectedIds.length === 0) {
      setPreview({ script: '', requiresAdmin: false, selectedCount: 0 });
      return;
    }
    let cancelled = false;
    api.winOptPreviewScript({ tweakIds: selectedIds, mode })
      .then((res) => {
        if (!cancelled && res) setPreview(res);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [api, selectedIds, mode]);

  const visibleTweaks = useMemo(() => {
    if (category === 'all') return catalog.tweaks || [];
    return (catalog.tweaks || []).filter((t) => t.category === category);
  }, [catalog.tweaks, category]);

  const toggleId = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const applyPreset = (preset) => {
    setMode('apply');
    setSelectedIds([...(preset.tweakIds || [])]);
    flash?.('ok', `Perfil "${preset.name}" cargado (${preset.tweakIds.length} acciones).`);
  };

  const handleCopyScript = async () => {
    if (!preview.script) return;
    try {
      await api.copyText(preview.script);
      flash?.('ok', 'Script PowerShell (.ps1) copiado al portapapeles.');
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo copiar el script.');
    }
  };

  const handleExportScript = async () => {
    if (!api?.winOptExportScript || selectedIds.length === 0) return;
    try {
      const res = await api.winOptExportScript({ tweakIds: selectedIds, mode });
      if (res && !res.canceled) {
        flash?.('ok', `Script exportado en ${res.destPath}`);
      }
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo exportar el script.');
    }
  };

  const handleExecute = async (execMode) => {
    if (!api?.winOptExecute || selectedIds.length === 0) return;
    const effectiveMode = execMode || mode;
    if (effectiveMode === 'revert') {
      if (!window.confirm('¿Restaurar los valores por defecto de los ajustes reversibles seleccionados?')) return;
    } else if (preview.requiresAdmin) {
      if (!window.confirm(`Se ejecutarán ${selectedIds.length} optimizaciones (Windows solicitará permiso UAC de Administrador). ¿Continuar?`)) return;
    }
    setRunning(true);
    setRunResult(null);
    try {
      const res = await api.winOptExecute({ tweakIds: selectedIds, mode: effectiveMode });
      setRunResult(res);
      if (res?.ok) {
        flash?.('ok', effectiveMode === 'revert' ? 'Ajustes restaurados correctamente.' : `WinScript aplicado (${res.selectedCount} acciones).`);
      } else {
        flash?.('error', res?.error || 'Ejecución finalizada con advertencias. Revisa el registro.');
      }
    } catch (err) {
      flash?.('error', err?.message || 'Error al ejecutar WinScript.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
            <Zap size={18} color="#34d399" /> WinScript Studio — Optimizador Windows Transparente
          </h2>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 12.5 }}>
            Selecciona optimizaciones de rendimiento, privacidad, limpieza y apps Winget. Revisa el script <code>.ps1</code> antes de ejecutarlo o expórtalo para toda tu oficina.
          </p>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className="badge accent">{selectedIds.length} seleccionadas</span>
          <span className={`badge ${preview.requiresAdmin ? 'warn' : 'ok'}`}>
            {preview.requiresAdmin ? 'Requiere Admin (UAC)' : 'Sin Admin (Seguro)'}
          </span>
        </div>
      </div>

      {/* Presets 1-clic */}
      <div className="grid-3">
        {(catalog.presets || []).map((preset) => (
          <div key={preset.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
            <div className="between">
              <strong style={{ fontSize: 13 }}>{preset.name}</strong>
              <span className="badge">{preset.tweakIds.length}</span>
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>{preset.description}</p>
            <button type="button" className="btn btn-sm" onClick={() => applyPreset(preset)}>
              Cargar perfil
            </button>
          </div>
        ))}
      </div>

      {/* Filtros por categoría */}
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {CATEGORY_META.map((cat) => (
          <button
            key={cat.id}
            type="button"
            className={`btn btn-sm ${category === cat.id ? 'btn-primary' : ''}`}
            onClick={() => setCategory(cat.id)}
          >
            {cat.label}
          </button>
        ))}
        <button type="button" className="btn btn-sm" onClick={() => setSelectedIds([])}>
          Limpiar selección
        </button>
      </div>

      {/* Lista de tweaks */}
      <div className="grid-2" style={{ gap: 8 }}>
        {visibleTweaks.map((tweak) => {
          const checked = selectedIds.includes(tweak.id);
          return (
            <label
              key={tweak.id}
              className="list-item"
              style={{
                cursor: 'pointer',
                alignItems: 'flex-start',
                gap: 10,
                borderColor: checked ? 'rgba(16, 185, 129, 0.55)' : undefined
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleId(tweak.id)}
                style={{ marginTop: 3 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                  <strong style={{ fontSize: 13 }}>{tweak.title}</strong>
                  <span className="badge accent">{tweak.impact}</span>
                  {tweak.requiresAdmin && <span className="badge warn">Admin</span>}
                  {tweak.reversible && <span className="badge ok">Reversible</span>}
                </div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>{tweak.description}</div>
              </div>
            </label>
          );
        })}
      </div>

      {/* Barra de acciones */}
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={running || selectedIds.length === 0}
          onClick={() => { setMode('apply'); handleExecute('apply'); }}
        >
          <Play size={14} /> {running ? 'Ejecutando...' : `Aplicar seleccionadas (${selectedIds.length})`}
        </button>
        <button
          type="button"
          className="btn"
          disabled={running || selectedIds.length === 0}
          onClick={() => { setMode('revert'); handleExecute('revert'); }}
        >
          <RotateCcw size={14} /> Restaurar reversibles
        </button>
        <button
          type="button"
          className="btn"
          disabled={selectedIds.length === 0}
          onClick={handleExportScript}
        >
          <Download size={14} /> Exportar .ps1
        </button>
        <button
          type="button"
          className="btn"
          disabled={!preview.script}
          onClick={handleCopyScript}
        >
          <Copy size={14} /> Copiar script
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setShowScript((v) => !v)}
        >
          <FileCode2 size={14} /> {showScript ? 'Ocultar vista previa .ps1' : 'Ver vista previa .ps1'}
        </button>
      </div>

      {/* Vista previa transparente del script PowerShell */}
      {showScript && preview.script && (
        <div>
          <div className="muted" style={{ fontSize: 11.5, marginBottom: 4 }}>
            Vista previa auditable del script PowerShell ({mode === 'revert' ? 'Restauración' : 'Optimización'}):
          </div>
          <pre className="log-box" style={{ maxHeight: 220, overflow: 'auto', margin: 0, whiteSpace: 'pre-wrap' }}>
            {preview.script}
          </pre>
        </div>
      )}

      {/* Resultado de ejecución */}
      {runResult && (
        <div className={`banner ${runResult.ok ? 'ok' : 'error'}`} style={{ margin: 0 }}>
          <div className="row" style={{ gap: 6, marginBottom: 6 }}>
            {runResult.ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
            <strong>{runResult.ok ? 'Optimización completada' : 'Finalizado con advertencias/error'}</strong>
          </div>
          <pre className="log-box" style={{ maxHeight: 180, overflow: 'auto', margin: 0, whiteSpace: 'pre-wrap' }}>
            {runResult.output || runResult.error || 'Sin salida.'}
          </pre>
        </div>
      )}
    </div>
  );
}

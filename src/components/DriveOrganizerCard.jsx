import React, { useMemo, useState } from 'react';
import {
  HardDrive,
  FolderOpen,
  Zap,
  Link2,
  Trash2,
  Pencil,
  Bookmark,
  RefreshCw,
  Layers
} from 'lucide-react';

const GROUP_PRESETS = ['General', 'Dirección', 'Administración', 'Contabilidad', 'Diseño', 'Ventas', 'Servidores', 'Backups'];
const COLOR_DOTS = {
  emerald: '#34d399',
  cyan: '#38bdf8',
  violet: '#a78bfa',
  amber: '#fbbf24',
  rose: '#fb7185'
};

export default function DriveOrganizerCard({
  api,
  state,
  activeSession,
  busy,
  setBusy,
  setState,
  flash,
  onQuickConnectAndMount,
  onOptimizeRoute,
  renderRouteBadge
}) {
  const mounts = Array.isArray(state?.mounts) ? state.mounts : [];
  const driveLettersInfo = state?.driveLetters || { letters: [], freeLetters: [], nextFreeLetter: 'Z:' };
  const config = state?.config || {};
  const driveProfiles = Array.isArray(config.driveProfiles) ? config.driveProfiles : [];

  const [mountMode, setMountMode] = useState('letter');
  const [selectedLetter, setSelectedLetter] = useState('AUTO');
  const [shareSubpath, setShareSubpath] = useState('');
  const [alias, setAlias] = useState('');
  const [group, setGroup] = useState('General');
  const [color, setColor] = useState(config.uiTheme === 'cyan' ? 'cyan' : 'emerald');
  const [showMatrix, setShowMatrix] = useState(true);
  const [editingDrive, setEditingDrive] = useState(null);
  const [editAlias, setEditAlias] = useState('');
  const [editGroup, setEditGroup] = useState('General');
  const [reassignTarget, setReassignTarget] = useState({});

  const groupedMounts = useMemo(() => {
    const map = new Map();
    for (const m of mounts) {
      const g = m.group || 'General';
      if (!map.has(g)) map.set(g, []);
      map.get(g).push(m);
    }
    return Array.from(map.entries());
  }, [mounts]);

  const handleMountNow = async () => {
    if (!activeSession) {
      flash('error', 'Conéctate primero a un equipo remoto para montar sus discos.');
      return;
    }
    setBusy(true);
    try {
      const computedAlias =
        alias.trim() ||
        (shareSubpath
          ? `[${activeSession.nodeName}] ${shareSubpath}`
          : `${activeSession.nodeName}`);
      const res = await api.mountDrive({
        sessionId: activeSession.sessionId,
        driveLetter: selectedLetter,
        mountMode,
        shareSubpath,
        alias: computedAlias,
        group: group.trim() || 'General',
        color
      });
      setState(res.state);
      const m = res.mounted;
      const reassignNote = m.autoReassignedFrom
        ? ` (${m.autoReassignedFrom} estaba ocupada → asignada ${m.drive} automáticamente)`
        : '';
      flash('ok', `Montado "${m.alias || m.label}" en ${m.drive}${reassignNote}.`);
      setAlias('');
    } catch (err) {
      flash('error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleReassign = async (m, nextDest) => {
    if (!nextDest || nextDest === m.drive) return;
    setBusy(true);
    try {
      const isFolder = nextDest === 'FOLDER';
      const res = await api.reassignDriveLetter({
        sessionId: activeSession?.sessionId,
        currentDrive: m.drive,
        newDriveLetter: isFolder ? 'AUTO' : nextDest,
        mountMode: isFolder ? 'folder' : 'letter'
      });
      setState(res.state);
      flash('ok', `Unidad movida de ${m.drive} → ${res.mounted.drive}.`);
    } catch (err) {
      flash('error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveOrg = async (m) => {
    try {
      const next = await api.updateMountOrg({
        targetDrive: m.drive,
        alias: editAlias.trim() || m.alias || m.label,
        group: editGroup.trim() || 'General',
        color: m.color || 'emerald'
      });
      setState(next);
      setEditingDrive(null);
      flash('ok', 'Organización del disco actualizada.');
    } catch (err) {
      flash('error', err.message);
    }
  };

  return (
    <div className="card" style={{ gap: 14 }}>
      <div className="between">
        <div>
          <h2><Layers size={17} /> Organizador de Discos y Letras (D: a Z: + Carpetas Ilimitadas)</h2>
          <p className="muted" style={{ margin: '3px 0 0', fontSize: 12.5 }}>
            Evita choques cuando varias PCs usan la misma letra: asigna cualquier letra libre (<code>D:</code>–<code>Z:</code>), usa <strong>Auto-Letra Libre</strong> o monta en <strong>Carpeta Unificada</strong> para 10–50+ computadoras sin límite de 26 letras.
          </p>
        </div>
        <div className="row">
          <span className="badge ok">{driveLettersInfo.freeLetters?.length || 0} letras libres</span>
          {driveLettersInfo.nextFreeLetter && (
            <span className="badge accent">Siguiente libre: {driveLettersInfo.nextFreeLetter}</span>
          )}
          <button type="button" className="btn btn-sm" onClick={() => setShowMatrix((v) => !v)}>
            {showMatrix ? 'Ocultar mapa D:–Z:' : 'Ver mapa D:–Z:'}
          </button>
        </div>
      </div>

      {showMatrix && driveLettersInfo.letters?.length > 0 && (
        <div>
          <div className="drive-grid">
            <button
              type="button"
              className={`drive-chip ${mountMode === 'letter' && selectedLetter === 'AUTO' ? 'selected' : ''}`}
              onClick={() => { setMountMode('letter'); setSelectedLetter('AUTO'); }}
              title="Elige automáticamente la primera letra libre sin chocar con otras PCs ni USBs"
            >
              AUTO
              <span>Libre</span>
            </button>
            <button
              type="button"
              className={`drive-chip ${mountMode === 'folder' ? 'selected' : ''}`}
              onClick={() => setMountMode('folder')}
              title="Monta como carpeta local dentro de tu carpeta de red (sin límite de 26 letras)"
            >
              📁 DIR
              <span>∞ Sin letra</span>
            </button>
            {driveLettersInfo.letters.map((item) => {
              const isSelected = mountMode === 'letter' && selectedLetter === item.letter;
              const cls = item.status === 'mounted-by-app'
                ? 'mounted'
                : item.status === 'system-busy'
                  ? 'busy'
                  : '';
              return (
                <button
                  key={item.letter}
                  type="button"
                  className={`drive-chip ${cls} ${isSelected ? 'selected' : ''}`}
                  title={`${item.letter} — ${item.label}${item.nodeName ? ` (${item.nodeName})` : ''}`}
                  onClick={() => {
                    if (item.status === 'mounted-by-app') {
                      api.openDrive(item.letter);
                      return;
                    }
                    setMountMode('letter');
                    setSelectedLetter(item.letter);
                  }}
                >
                  {item.letter}
                  <span>
                    {item.status === 'mounted-by-app'
                      ? 'App'
                      : item.status === 'system-busy'
                        ? 'Ocup.'
                        : 'Libre'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {activeSession ? (
        <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
          <div className="between">
            <div>
              <strong>Conectado a: {activeSession.nodeName}</strong>
              <div className="row" style={{ gap: 8, marginTop: 3 }}>
                <span className="muted mono">{activeSession.baseUrl}</span>
                {renderRouteBadge && renderRouteBadge(activeSession.routeInfo)}
              </div>
            </div>
            <div className="row">
              <button type="button" className="btn btn-sm" onClick={onOptimizeRoute} disabled={busy}>
                <Zap size={13} /> Optimizar Ruta
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  try {
                    const host = new URL(activeSession.baseUrl).hostname;
                    api.openSmbShare(host);
                  } catch {}
                }}
              >
                <FolderOpen size={13} /> SMB
              </button>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={async () => setState(await api.disconnectClient(activeSession.sessionId))}
              >
                Desconectar
              </button>
            </div>
          </div>

          <div className="grid-4">
            <div className="field">
              <label>Modo y Destino</label>
              <select
                value={mountMode === 'folder' ? 'FOLDER' : selectedLetter}
                onChange={(e) => {
                  if (e.target.value === 'FOLDER') {
                    setMountMode('folder');
                  } else {
                    setMountMode('letter');
                    setSelectedLetter(e.target.value);
                  }
                }}
              >
                <option value="AUTO">⚡ Auto-Letra Libre ({driveLettersInfo.nextFreeLetter || 'Auto'})</option>
                <option value="FOLDER">📁 Carpeta Unificada (Sin gastar letra · ∞)</option>
                {(driveLettersInfo.letters || []).map((l) => (
                  <option key={l.letter} value={l.letter}>
                    {l.letter} {l.free ? '— Libre' : l.status === 'mounted-by-app' ? `— Montada (${l.label})` : '— Ocupada (auto-reubica)'}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Qué montar de {activeSession.nodeName}</label>
              <select value={shareSubpath} onChange={(e) => setShareSubpath(e.target.value)}>
                <option value="">Todas las carpetas del equipo</option>
                {(activeSession.shares || []).map((s) => (
                  <option key={s.id} value={s.name}>
                    Solo "{s.name}" ({s.effectiveMode?.toUpperCase()})
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Departamento / Grupo</label>
              <input
                type="text"
                list="emo-mount-groups"
                value={group}
                onChange={(e) => setGroup(e.target.value)}
                placeholder="Ej. Contabilidad, Diseño"
              />
              <datalist id="emo-mount-groups">
                {GROUP_PRESETS.map((g) => <option key={g} value={g} />)}
              </datalist>
            </div>

            <div className="field">
              <label>Nombre / Alias (distingue PCs)</label>
              <input
                type="text"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                placeholder={`Ej. [${activeSession.nodeName}] ${shareSubpath || 'Disco'}`}
              />
            </div>
          </div>

          <div className="between">
            <div className="row" style={{ gap: 6 }}>
              <span className="muted" style={{ fontSize: 12 }}>Etiqueta de color:</span>
              {Object.entries(COLOR_DOTS).map(([k, hex]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setColor(k)}
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: hex,
                    border: color === k ? '2px solid #fff' : '2px solid transparent',
                    cursor: 'pointer'
                  }}
                  title={k}
                />
              ))}
            </div>
            <button type="button" className="btn btn-primary" onClick={handleMountNow} disabled={busy}>
              <HardDrive size={15} />{' '}
              {mountMode === 'folder'
                ? 'Montar en Carpeta Unificada'
                : `Montar en ${selectedLetter === 'AUTO' ? `Letra Libre (${driveLettersInfo.nextFreeLetter || 'Auto'})` : selectedLetter}`}
            </button>
          </div>
        </div>
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          Selecciona abajo cualquier equipo guardado o llave detectada y pulsa <strong>⚡ Conectar + Montar Libre</strong> para montarlo en 1 clic sin choques de letra.
        </p>
      )}

      {groupedMounts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {groupedMounts.map(([grpName, items]) => (
            <div key={grpName} className="list">
              <div className="mount-group-header">
                <FolderOpen size={13} /> Grupo: {grpName} ({items.length})
              </div>
              {items.map((m) => (
                <div key={m.drive} className="list-item" style={{ flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    {editingDrive === m.drive ? (
                      <div className="row" style={{ gap: 6 }}>
                        <input
                          type="text"
                          style={{ width: 190 }}
                          value={editAlias}
                          onChange={(e) => setEditAlias(e.target.value)}
                          placeholder="Alias"
                        />
                        <input
                          type="text"
                          list="emo-mount-groups"
                          style={{ width: 140 }}
                          value={editGroup}
                          onChange={(e) => setEditGroup(e.target.value)}
                          placeholder="Grupo"
                        />
                        <button type="button" className="btn btn-sm btn-primary" onClick={() => handleSaveOrg(m)}>
                          Guardar
                        </button>
                        <button type="button" className="btn btn-sm" onClick={() => setEditingDrive(null)}>
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="row" style={{ gap: 8 }}>
                          <span
                            style={{
                              width: 10,
                              height: 10,
                              borderRadius: '50%',
                              background: COLOR_DOTS[m.color] || COLOR_DOTS.emerald,
                              display: 'inline-block'
                            }}
                          />
                          <strong>{m.drive}</strong>
                          <span>— {m.alias || m.label}</span>
                          {m.nodeName && <span className="badge">{m.nodeName}</span>}
                          <span className="badge accent">{m.mountMode === 'folder' ? 'Carpeta' : 'Letra'}</span>
                        </div>
                        <div className="muted mono" style={{ fontSize: 11.5, marginTop: 2 }}>{m.url}</div>
                      </>
                    )}
                  </div>

                  <div className="row" style={{ gap: 6 }}>
                    <select
                      style={{ width: 128, padding: '5px 8px', fontSize: 12 }}
                      value={reassignTarget[m.drive] || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setReassignTarget((prev) => ({ ...prev, [m.drive]: '' }));
                        if (val) handleReassign(m, val);
                      }}
                      disabled={busy}
                      title="Cambiar de letra o mover a carpeta en caliente si otra PC necesita esta letra"
                    >
                      <option value="">Cambiar letra...</option>
                      <option value="AUTO">⚡ Otra libre ({driveLettersInfo.nextFreeLetter || 'Auto'})</option>
                      {m.mountMode !== 'folder' && <option value="FOLDER">📁 Pasar a Carpeta</option>}
                      {(driveLettersInfo.freeLetters || []).map((fl) => (
                        <option key={fl} value={fl}>Mover a {fl}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn btn-sm"
                      title="Editar nombre y grupo"
                      onClick={() => {
                        setEditingDrive(m.drive);
                        setEditAlias(m.alias || m.label || '');
                        setEditGroup(m.group || 'General');
                      }}
                    >
                      <Pencil size={13} />
                    </button>
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => api.openDrive(m.drive)}>
                      Abrir
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={async () => setState(await api.unmountDrive(m.drive))}
                    >
                      Desmontar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {(config.savedPeers?.length > 0 || driveProfiles.length > 0) && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {config.savedPeers?.length > 0 && (
            <div>
              <h3 style={{ marginBottom: 8 }}><Bookmark size={14} /> Equipos guardados (Conexión + Montaje rápido)</h3>
              <div className="list">
                {config.savedPeers.map((peer) => (
                  <div key={peer.id} className="list-item" style={{ padding: '9px 12px', flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{peer.nodeName || peer.label}</div>
                      <div className="muted mono" style={{ fontSize: 11.5 }}>
                        {peer.tailscaleIp || peer.lanIp || 'Auto'} · {peer.keyId}
                      </div>
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={busy}
                        onClick={() => onQuickConnectAndMount(peer, { autoMount: false })}
                      >
                        <Link2 size={13} /> Conectar
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        disabled={busy}
                        onClick={() => onQuickConnectAndMount(peer, { autoMount: true })}
                      >
                        <Zap size={13} /> Conectar + Montar Libre
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={async () => setState(await api.removePeer(peer.id))}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {driveProfiles.length > 0 && (
            <div>
              <h3 style={{ marginBottom: 6, fontSize: 13.5 }}>Perfiles de organización recordados ({driveProfiles.length})</h3>
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                {driveProfiles.slice(0, 12).map((prof) => (
                  <span key={prof.id} className="badge" style={{ padding: '5px 9px', gap: 6 }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: COLOR_DOTS[prof.color] || COLOR_DOTS.emerald
                      }}
                    />
                    <strong>[{prof.group}]</strong> {prof.alias} ({prof.mountMode === 'folder' ? 'Carpeta' : prof.preferredDrive})
                    <button
                      type="button"
                      style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 0, marginLeft: 3 }}
                      title="Olvidar perfil"
                      onClick={async () => setState(await api.removeDriveProfile(prof.id))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import React, { useEffect, useState, useMemo } from 'react';
import {
  Globe,
  Cpu,
  KeyRound,
  Package,
  Play,
  Send,
  Plus,
  Copy,
  Trash2,
  ExternalLink,
  Zap,
  Sparkles,
  CheckCircle2,
  RefreshCw,
  FolderOpen
} from 'lucide-react';

export default function MiniInternetPackagesView({ api, state, flash, onSessionConnected }) {
  const [networks, setNetworks] = useState(state?.miniInternet?.networks || []);
  const [packages, setPackages] = useState(state?.miniInternet?.packages || []);
  const [memoryStats, setMemoryStats] = useState(state?.memoryStats || null);
  const [selectedNetId, setSelectedNetId] = useState('');
  const [targetPeerUrl, setTargetPeerUrl] = useState('local');
  const [busy, setBusy] = useState(false);

  const [pairingInvite, setPairingInvite] = useState(null);
  const [pairCodeInput, setPairCodeInput] = useState('');
  const [pairHostInput, setPairHostInput] = useState('');

  const [showNewNet, setShowNewNet] = useState(false);
  const [netDomain, setNetDomain] = useState('');
  const [netName, setNetName] = useState('');
  const [netEmoji, setNetEmoji] = useState('🚀');
  const [netDesc, setNetDesc] = useState('');

  const [showNewPkg, setShowNewPkg] = useState(false);
  const [pkgTitle, setPkgTitle] = useState('');
  const [pkgDesc, setPkgDesc] = useState('');
  const [pkgNetId, setPkgNetId] = useState('net-global');
  const [pkgType, setPkgType] = useState('powershell');
  const [pkgCommand, setPkgCommand] = useState('');
  const [pkgPaths, setPkgPaths] = useState('');
  const [pkgUrls, setPkgUrls] = useState('');
  const [pkgWinget, setPkgWinget] = useState('');

  const [lastExecLog, setLastExecLog] = useState('');

  const loadMiniState = async () => {
    try {
      const m = await api.getMiniInternetState();
      if (m) {
        if (Array.isArray(m.networks)) setNetworks(m.networks);
        if (Array.isArray(m.packages)) setPackages(m.packages);
        if (m.memoryStats) setMemoryStats(m.memoryStats);
      }
    } catch {}
  };

  useEffect(() => {
    loadMiniState();
  }, []);

  const onlinePeers = useMemo(() => {
    const out = [];
    const seen = new Set();
    const port = state?.config?.port || 4890;
    for (const n of (state?.fleet?.nodes || [])) {
      if (!n.online || n.isLocal) continue;
      const ip = n.lanIp || n.tailscaleIp;
      if (ip) {
        const u = `http://${ip}:${n.port || port}`;
        if (!seen.has(u)) {
          seen.add(u);
          out.push({ label: `${n.nodeName} (${ip})`, url: u });
        }
      }
    }
    for (const tp of (state?.env?.tailscale?.peers || [])) {
      if (tp.online && tp.ip && tp.os === 'windows') {
        const u = `http://${tp.ip}:${port}`;
        if (!seen.has(u)) {
          seen.add(u);
          out.push({ label: `${tp.hostName || tp.dnsName} (${tp.ip})`, url: u });
        }
      }
    }
    return out;
  }, [state]);

  const filteredPackages = useMemo(() => {
    if (!selectedNetId) return packages;
    return packages.filter((p) => p.networkId === selectedNetId);
  }, [packages, selectedNetId]);

  const handleOptimizeMemory = async () => {
    setBusy(true);
    try {
      const res = await api.optimizeMemoryNow();
      setMemoryStats(res);
      flash('ok', `RAM optimizada: ${res.beforeMB} MB → ${res.afterMB} MB (ahorrados ${res.savedMB} MB en ${res.processCount} procesos).`);
    } catch (err) {
      flash('error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleToggleUltraLight = async (checked) => {
    try {
      await api.setUltraLightMode(checked);
      flash('ok', checked ? 'Modo Ultra-Ligero en Bandeja activado (< 35 MB en segundo plano).' : 'Modo estándar activado.');
    } catch (err) {
      flash('error', err.message);
    }
  };

  const handleCreatePairingCode = async () => {
    setBusy(true);
    try {
      const inv = await api.createPairingCode();
      setPairingInvite(inv);
      flash('ok', `Código mágico generado: ${inv.code} (válido ${inv.ttlMinutes} min).`);
    } catch (err) {
      flash('error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleConnectWithCode = async (e) => {
    e.preventDefault();
    if (!pairCodeInput.trim()) return flash('error', 'Ingresa el código mágico (ej. EC-7K9P).');
    setBusy(true);
    try {
      const res = await api.connectWithPairingCode({
        code: pairCodeInput.trim(),
        targetHost: pairHostInput.trim() || undefined
      });
      setPairCodeInput('');
      flash('ok', `Conectado mágicamente a ${res.session.nodeName} sin pendrive (${res.session.baseUrl}).`);
      if (onSessionConnected) onSessionConnected(res);
    } catch (err) {
      flash('error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleExecutePackage = async (pkg, destination = targetPeerUrl) => {
    setBusy(true);
    try {
      const res = await api.executeSmartPackage({
        packageId: pkg.id,
        pkg,
        targetPeerUrl: destination
      });
      const lines = (res.results || []).map((r) =>
        r.ok
          ? `✅ [${r.target}] ${r.title}: ${(r.actionsTaken || ['OK']).join(' · ')}`
          : `❌ [${r.target}] Error: ${r.error}`
      );
      setLastExecLog(lines.join('\n'));
      const okCount = (res.results || []).filter((r) => r.ok).length;
      flash(okCount > 0 ? 'ok' : 'error', `Paquete "${pkg.title}" ejecutado (${okCount}/${(res.results || []).length} OK).`);
      loadMiniState();
    } catch (err) {
      flash('error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleCreateNetwork = async (e) => {
    e.preventDefault();
    if (!netName.trim()) return flash('error', 'Nombre de sub-red requerido.');
    setBusy(true);
    try {
      await api.upsertNetwork({
        domain: netDomain.trim() || `${netName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}.mesh`,
        name: netName.trim(),
        emoji: netEmoji.trim() || '🌐',
        description: netDesc.trim()
      });
      setNetDomain('');
      setNetName('');
      setNetDesc('');
      setShowNewNet(false);
      await loadMiniState();
      flash('ok', 'Sub-red creada en tu Mini-Internet.');
    } catch (err) {
      flash('error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleCreatePackage = async (e) => {
    e.preventDefault();
    if (!pkgTitle.trim()) return flash('error', 'Título del paquete requerido.');
    setBusy(true);
    try {
      await api.upsertPackage({
        title: pkgTitle.trim(),
        description: pkgDesc.trim(),
        networkId: pkgNetId,
        actionType: pkgType,
        command: pkgCommand.trim(),
        paths: pkgPaths.split(/\r?\n/).map((x) => x.trim()).filter(Boolean),
        urls: pkgUrls.split(/[\r\n,]+/).map((x) => x.trim()).filter(Boolean),
        wingetIds: pkgWinget.split(/[\r\n,]+/).map((x) => x.trim()).filter(Boolean),
        autoShareOnHost: true,
        createDesktopShortcut: true
      });
      setPkgTitle('');
      setPkgDesc('');
      setPkgCommand('');
      setPkgPaths('');
      setPkgUrls('');
      setPkgWinget('');
      setShowNewPkg(false);
      await loadMiniState();
      flash('ok', 'Paquete inteligente agregado al catálogo.');
    } catch (err) {
      flash('error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const ultraLight = Boolean(state?.config?.ultraLightTrayMode);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Mini-Internet Multi-Red, Ultra RAM y Paquetes 1-Clic</h1>
          <p>Conecta estaciones con un código de 6 caracteres sin USB, optimiza la RAM al extremo y despliega WinScript, Illustrator, Páginas Web y actualizaciones a 10+ PCs.</p>
        </div>
        <button className="btn" onClick={loadMiniState} disabled={busy}>
          <RefreshCw size={15} /> Actualizar
        </button>
      </div>

      <div className="grid-2">
        <div className="card hero-card">
          <div className="between">
            <h2><Cpu size={17} color="#34d399" /> Motor de Eficiencia Extrema de RAM</h2>
            <span className="badge ok">
              {memoryStats ? `${memoryStats.afterMB} MB en uso` : 'Activo'}
            </span>
          </div>
          <p className="muted" style={{ margin: '4px 0 8px' }}>
            Libera páginas de memoria inactivas con <code>Win32 EmptyWorkingSet</code> + recolección V8 y destruye la ventana gráfica al minimizar para bajar a <strong>&lt; 35 MB en bandeja</strong>.
          </p>
          {memoryStats && (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <span className="badge">Antes: {memoryStats.beforeMB} MB</span>
              <span className="badge ok">Actual: {memoryStats.afterMB} MB</span>
              <span className="badge accent">Ahorrado: {memoryStats.savedMB} MB</span>
              <span className="muted" style={{ fontSize: 12 }}>Procesos: {memoryStats.processCount}</span>
            </div>
          )}
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={ultraLight}
              onChange={(e) => handleToggleUltraLight(e.target.checked)}
            />
            <span>Modo Ultra-Ligero en Bandeja (liberar Chromium completo al cerrar a bandeja)</span>
          </label>
          <div className="row" style={{ marginTop: 6 }}>
            <button className="btn btn-primary" onClick={handleOptimizeMemory} disabled={busy}>
              <Zap size={15} /> Liberar RAM Ahora
            </button>
          </div>
        </div>

        <div className="card">
          <div className="between">
            <h2><KeyRound size={17} color="#67e8f9" /> Emparejamiento Mágico sin Pendrive</h2>
            <span className="badge accent">Estilo Magic Wormhole</span>
          </div>
          <p className="muted" style={{ margin: '4px 0 8px' }}>
            Conecta nuevas computadoras de la oficina dictando un código temporal <code>EC-XXXX</code> sin pendrive ni configuración manual.
          </p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <button className="btn btn-primary btn-sm" onClick={handleCreatePairingCode} disabled={busy}>
              <Sparkles size={14} /> Generar Código Mágico (Host)
            </button>
            {pairingInvite && (
              <div className="row" style={{ gap: 6, background: 'rgba(6, 78, 59, 0.45)', padding: '5px 10px', borderRadius: 8, border: '1px solid rgba(16, 185, 129, 0.4)' }}>
                <strong className="mono" style={{ fontSize: 16, color: '#6ee7b7', letterSpacing: 1 }}>{pairingInvite.code}</strong>
                <button className="btn btn-sm" onClick={() => { api.copyText(pairingInvite.code); flash('ok', `Código ${pairingInvite.code} copiado.`); }}>
                  <Copy size={12} />
                </button>
              </div>
            )}
          </div>
          <form onSubmit={handleConnectWithCode} className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <input
              type="text"
              style={{ width: 140, textTransform: 'uppercase' }}
              value={pairCodeInput}
              onChange={(e) => setPairCodeInput(e.target.value)}
              placeholder="Ej. EC-7K9P"
            />
            <input
              type="text"
              style={{ flex: 1, minWidth: 140 }}
              value={pairHostInput}
              onChange={(e) => setPairHostInput(e.target.value)}
              placeholder="IP opcional (vacío = auto-buscar en red)"
            />
            <button type="submit" className="btn btn-sm btn-primary" disabled={busy}>
              Conectar con código
            </button>
          </form>
        </div>
      </div>

      <div className="card">
        <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h2><Globe size={17} color="#34d399" /> Multi-Red Federada ("Mini-Internet Privado")</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Cada departamento o proyecto expone su propio portal intranet (<code>http://IP:{state?.config?.port || 4890}/net/...</code>) accesible en paralelo desde PC o celular.
            </p>
          </div>
          <div className="row" style={{ gap: 6 }}>
            {selectedNetId && (
              <button className="btn btn-sm" onClick={() => setSelectedNetId('')}>Ver todas</button>
            )}
            <button className="btn btn-sm btn-primary" onClick={() => setShowNewNet((v) => !v)}>
              <Plus size={14} /> Nueva Sub-Red
            </button>
          </div>
        </div>

        {showNewNet && (
          <form onSubmit={handleCreateNetwork} className="grid-2" style={{ marginTop: 10, padding: 12, background: 'rgba(15,23,42,0.5)', borderRadius: 10 }}>
            <div className="field">
              <label>Nombre visible</label>
              <input type="text" value={netName} onChange={(e) => setNetName(e.target.value)} placeholder="Ej. Red Clientes VIP" />
            </div>
            <div className="field">
              <label>Dominio interno (.mesh)</label>
              <input type="text" value={netDomain} onChange={(e) => setNetDomain(e.target.value)} placeholder="clientes.mesh" />
            </div>
            <div className="field">
              <label>Icono (Emoji)</label>
              <input type="text" value={netEmoji} onChange={(e) => setNetEmoji(e.target.value)} />
            </div>
            <div className="field">
              <label>Descripción</label>
              <input type="text" value={netDesc} onChange={(e) => setNetDesc(e.target.value)} placeholder="Qué recursos o PCs agrupa esta red" />
            </div>
            <div className="row">
              <button type="submit" className="btn btn-sm btn-primary">Guardar Sub-Red</button>
            </div>
          </form>
        )}

        <div className="grid-2" style={{ marginTop: 12 }}>
          {networks.map((net) => {
            const count = packages.filter((p) => p.networkId === net.id).length;
            const isSel = selectedNetId === net.id;
            return (
              <div
                key={net.id}
                className="list-item"
                style={{
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  gap: 8,
                  borderColor: isSel ? net.color : undefined,
                  background: isSel ? 'rgba(16, 185, 129, 0.08)' : undefined
                }}
              >
                <div className="between" style={{ gap: 8 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <strong style={{ fontSize: 15 }}>{net.emoji} {net.domain}</strong>
                    <span className="badge">{net.name}</span>
                  </div>
                  <span className="badge accent">{count} paq.</span>
                </div>
                <div className="muted" style={{ fontSize: 12.5 }}>{net.description}</div>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-sm"
                    onClick={() => setSelectedNetId(isSel ? '' : net.id)}
                  >
                    {isSel ? 'Mostrando paquetes' : 'Filtrar paquetes'}
                  </button>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => api.openMiniPortal({ networkId: net.id })}
                  >
                    <ExternalLink size={12} /> Abrir Portal Web
                  </button>
                  {net.id !== 'net-global' && !['net-design', 'net-work', 'net-help'].includes(net.id) && (
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={async () => { await api.deleteNetwork(net.id); loadMiniState(); }}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h2><Package size={17} color="#67e8f9" /> Paquetes Inteligentes 1-Clic (Automatización, Illustrator, Web y Apps)</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Despliega WinScript, recursos de Adobe Illustrator en Drive, páginas web de Esteban o actualizaciones automáticas en toda la flota de PCs.
            </p>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <select value={targetPeerUrl} onChange={(e) => setTargetPeerUrl(e.target.value)} style={{ minWidth: 210 }}>
              <option value="local">💻 Ejecutar en esta PC ({state?.config?.nodeName})</option>
              <option value="all">🌐 Todas las PCs en Línea ({onlinePeers.length})</option>
              {onlinePeers.map((p) => (
                <option key={p.url} value={p.url}>🖥️ Remoto: {p.label}</option>
              ))}
            </select>
            <button className="btn btn-sm btn-primary" onClick={() => setShowNewPkg((v) => !v)}>
              <Plus size={14} /> Nuevo Paquete
            </button>
          </div>
        </div>

        {showNewPkg && (
          <form onSubmit={handleCreatePackage} className="grid-2" style={{ marginTop: 12, padding: 12, background: 'rgba(15,23,42,0.5)', borderRadius: 10 }}>
            <div className="field">
              <label>Nombre del paquete</label>
              <input type="text" value={pkgTitle} onChange={(e) => setPkgTitle(e.target.value)} placeholder="Ej. Pack Photoshop + Mockups" />
            </div>
            <div className="field">
              <label>Tipo de ejecución</label>
              <select value={pkgType} onChange={(e) => setPkgType(e.target.value)}>
                <option value="powershell">PowerShell / Script Automatización</option>
                <option value="drive-folder">Carpeta de Drive / Plugins / Biblioteca</option>
                <option value="web-bundle">Páginas Web / Portfolio / Ayuda</option>
                <option value="winget-bundle">Instalador Lote Winget IDs</option>
              </select>
            </div>
            <div className="field">
              <label>Sub-Red destino</label>
              <select value={pkgNetId} onChange={(e) => setPkgNetId(e.target.value)}>
                {networks.map((n) => <option key={n.id} value={n.id}>{n.emoji} {n.domain}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Descripción</label>
              <input type="text" value={pkgDesc} onChange={(e) => setPkgDesc(e.target.value)} placeholder="Qué hace este paquete al desplegarlo" />
            </div>
            {pkgType === 'powershell' && (
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <label>Comando PowerShell</label>
                <textarea className="mono" value={pkgCommand} onChange={(e) => setPkgCommand(e.target.value)} placeholder="irm https://... | iex o winget install ..." />
              </div>
            )}
            {pkgType === 'drive-folder' && (
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <label>Rutas de carpetas en Drive o PC (una por línea)</label>
                <textarea className="mono" value={pkgPaths} onChange={(e) => setPkgPaths(e.target.value)} placeholder="G:\Mi unidad\..." />
              </div>
            )}
            {(pkgType === 'web-bundle' || pkgType === 'drive-folder') && (
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <label>URLs web incluidas (opcional, separadas por coma o línea)</label>
                <input type="text" value={pkgUrls} onChange={(e) => setPkgUrls(e.target.value)} placeholder="https://estebanico.com" />
              </div>
            )}
            {pkgType === 'winget-bundle' && (
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <label>IDs de Winget separados por coma</label>
                <input type="text" value={pkgWinget} onChange={(e) => setPkgWinget(e.target.value)} placeholder="flick9000.WinScript, 7zip.7zip" />
              </div>
            )}
            <div className="row">
              <button type="submit" className="btn btn-sm btn-primary">Guardar Paquete</button>
            </div>
          </form>
        )}

        <div className="list" style={{ marginTop: 12 }}>
          {filteredPackages.map((p) => {
            const net = networks.find((n) => n.id === p.networkId);
            return (
              <div key={p.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 14.5 }}>{p.title}</strong>
                    {net && <span className="badge">{net.emoji} {net.domain}</span>}
                    <span className="badge accent">{p.actionType}</span>
                  </div>
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    <button
                      className="btn btn-sm"
                      disabled={busy}
                      onClick={() => handleExecutePackage(p, 'local')}
                    >
                      <Play size={12} /> Ejecutar Aquí
                    </button>
                    <button
                      className="btn btn-sm btn-primary"
                      disabled={busy}
                      onClick={() => handleExecutePackage(p, targetPeerUrl)}
                    >
                      <Send size={12} /> {targetPeerUrl === 'local' ? 'Desplegar' : 'Enviar a Malla'}
                    </button>
                    {!p.builtin && (
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={async () => { await api.deletePackage(p.id); loadMiniState(); }}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="muted" style={{ fontSize: 12.5 }}>{p.description}</div>
                {p.command && (
                  <div className="mono" style={{ fontSize: 11.5, background: 'rgba(15,23,42,0.6)', padding: '6px 10px', borderRadius: 6, color: '#6ee7b7', wordBreak: 'break-all' }}>
                    PS&gt; {p.command}
                  </div>
                )}
                {(p.paths || []).length > 0 && (
                  <div className="muted mono" style={{ fontSize: 11.5 }}>
                    <FolderOpen size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                    {(p.paths || []).join(' · ')}
                  </div>
                )}
                {(p.urls || []).length > 0 && (
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    {(p.urls || []).map((u) => (
                      <button key={u} className="btn btn-sm" onClick={() => api.openExternal(u)}>
                        <ExternalLink size={11} /> {u}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {lastExecLog && (
          <div style={{ marginTop: 12 }}>
            <h3><CheckCircle2 size={15} color="#34d399" /> Resultado del último despliegue</h3>
            <div className="log-box">{lastExecLog}</div>
          </div>
        )}
      </div>
    </>
  );
}

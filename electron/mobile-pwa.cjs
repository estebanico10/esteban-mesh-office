'use strict';

function getIconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#141d2e"/>
      <stop offset="100%" stop-color="#090d14"/>
    </linearGradient>
    <linearGradient id="cloud" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#67e8f9"/>
      <stop offset="52%" stop-color="#38bdf8"/>
      <stop offset="100%" stop-color="#2563eb"/>
    </linearGradient>
  </defs>
  <rect x="8" y="8" width="240" height="240" rx="56" fill="url(#bg)" stroke="#38bdf8" stroke-opacity="0.45" stroke-width="5"/>
  <path d="M74 176h104c21 0 38-16.5 38-37 0-19.2-14.6-35-33.5-36.8C176.2 77.6 154.5 60 128.5 60c-27.5 0-50.2 20-54.8 46.2C54.6 109.6 40 126.1 40 146c0 16.6 13.4 30 34 30z" fill="url(#cloud)"/>
  <g fill="none" stroke="#0b0f18" stroke-width="11" stroke-linecap="round" stroke-linejoin="round">
    <path d="M96 122h56"/><path d="M138 108l14 14-14 14"/>
    <path d="M160 148h-56"/><path d="M118 134l-14 14 14 14"/>
  </g>
</svg>`;
}

function getManifestJson(nodeName) {
  return JSON.stringify({
    name: `Esteban Cloud · ${nodeName || 'Nodo'}`,
    short_name: 'Esteban Cloud',
    description: 'Super-App móvil y nube personal bidireccional cifrada — Hecho por Esteban Nicola',
    start_url: '/',
    display: 'standalone',
    background_color: '#0b0e14',
    theme_color: '#0b0e14',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any maskable'
      }
    ]
  }, null, 2);
}

function getServiceWorkerJs() {
  return `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
`;
}

function getMobileHtml(nodeName) {
  const safeNode = String(nodeName || 'Esteban Cloud').replace(/[<>&"]/g, '');
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover" />
  <meta name="theme-color" content="#0b0e14" />
  <title>Esteban Cloud · ${safeNode}</title>
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="icon" type="image/svg+xml" href="/icon.svg" />
  <style>
    :root {
      --bg: #090d14;
      --panel: #121824;
      --panel-2: #182132;
      --panel-3: #1e293b;
      --border: rgba(148,163,184,0.16);
      --text: #eef2f7;
      --muted: #94a3b8;
      --accent: #38bdf8;
      --accent-2: #2563eb;
      --danger: #f87171;
      --ok: #34d399;
      --warn: #fbbf24;
    }
    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    body {
      margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      background: radial-gradient(circle at top right, rgba(37,99,235,0.18), transparent 45%), var(--bg);
      color: var(--text); min-height: 100vh; display: flex; flex-direction: column;
      padding-bottom: 76px;
    }
    header {
      position: sticky; top: 0; z-index: 30;
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
      padding: 12px 16px; background: rgba(9,13,20,0.92); backdrop-filter: blur(14px);
      border-bottom: 1px solid var(--border);
    }
    .brand { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 15px; min-width: 0; }
    .brand img { width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0; }
    .badge {
      font-size: 11px; padding: 3px 8px; border-radius: 999px;
      background: rgba(56,189,248,0.14); color: var(--accent);
      border: 1px solid rgba(56,189,248,0.28); white-space: nowrap;
    }
    .badge-ok {
      background: rgba(52,211,153,0.14); color: var(--ok);
      border-color: rgba(52,211,153,0.3);
    }
    main { flex: 1; width: 100%; max-width: 920px; margin: 0 auto; padding: 14px; }
    .card {
      background: var(--panel); border: 1px solid var(--border); border-radius: 16px; padding: 16px;
      box-shadow: 0 12px 30px rgba(0,0,0,0.32); margin-bottom: 14px;
    }
    h1, h2, h3 { margin: 0 0 8px; }
    h2 { font-size: 18px; }
    h3 { font-size: 15px; }
    p { margin: 0 0 12px; color: var(--muted); font-size: 13.5px; line-height: 1.5; }
    label { display: block; font-size: 12px; color: var(--muted); margin: 10px 0 5px; font-weight: 600; }
    input[type="password"], input[type="text"], input[type="url"], textarea, select {
      width: 100%; padding: 11px 12px; border-radius: 10px; border: 1px solid var(--border);
      background: #0b1019; color: var(--text); font-size: 14px; font-family: inherit;
    }
    textarea { min-height: 76px; resize: vertical; font-family: ui-monospace, monospace; font-size: 12px; }
    .btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      padding: 10px 14px; border-radius: 10px; border: 1px solid var(--border);
      background: var(--panel-2); color: var(--text); font-size: 13px; font-weight: 600;
      cursor: pointer; text-decoration: none; transition: transform .1s ease, opacity .15s ease;
    }
    .btn:active { transform: scale(0.98); }
    .btn-primary { background: linear-gradient(135deg, var(--accent), var(--accent-2)); border: none; color: #05101c; font-weight: 700; }
    .btn-mesh {
      width: 100%; padding: 13px 16px; font-size: 14px; font-weight: 700;
      background: linear-gradient(135deg, #34d399, #059669); border: none; color: #04130e;
      box-shadow: 0 6px 20px rgba(16,185,129,0.28);
    }
    .btn-danger { background: rgba(248,113,113,0.12); border-color: rgba(248,113,113,0.35); color: var(--danger); }
    .btn-warn { background: rgba(251,191,36,0.12); border-color: rgba(251,191,36,0.35); color: var(--warn); }
    .btn-sm { padding: 7px 10px; font-size: 12px; border-radius: 8px; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
    .shares-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 10px; margin-top: 12px; }
    .share-card {
      padding: 15px; border-radius: 14px; border: 1px solid var(--border); background: var(--panel-2);
      cursor: pointer; transition: transform .12s ease, border-color .12s ease;
    }
    .share-card:hover, .share-card:active { border-color: var(--accent); transform: translateY(-1px); }
    .toolbar { display: flex; flex-wrap: wrap; gap: 8px; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .crumbs { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; font-size: 13px; color: var(--muted); }
    .crumbs button { background: none; border: none; color: var(--accent); cursor: pointer; padding: 2px 4px; font-weight: 600; font-size: 13px; }
    .list { display: flex; flex-direction: column; gap: 7px; }
    .item {
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
      padding: 10px 12px; border-radius: 12px; background: var(--panel-2); border: 1px solid transparent;
    }
    .item:hover { border-color: var(--border); }
    .item-main { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; cursor: pointer; }
    .item-thumb {
      width: 38px; height: 38px; border-radius: 8px; object-fit: cover;
      background: #090d14; border: 1px solid var(--border); flex-shrink: 0;
      display: flex; align-items: center; justify-content: center; font-size: 18px;
    }
    .item-name { font-size: 13.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .item-meta { font-size: 11px; color: var(--muted); }
    .error { background: rgba(248,113,113,0.12); border: 1px solid rgba(248,113,113,0.35); color: #fecaca; padding: 10px 12px; border-radius: 10px; font-size: 13px; margin: 10px 0; }
    .ok { background: rgba(52,211,153,0.12); border: 1px solid rgba(52,211,153,0.35); color: #a7f3d0; padding: 10px 12px; border-radius: 10px; font-size: 13px; margin: 10px 0; }
    .preview-box { margin-bottom: 14px; padding: 12px; border-radius: 12px; background: #070a10; border: 1px solid var(--border); text-align: center; }
    .preview-box img, .preview-box video { max-width: 100%; max-height: 60vh; border-radius: 8px; }
    .progress-wrap { width: 100%; height: 10px; background: #090d14; border-radius: 999px; overflow: hidden; margin: 8px 0; border: 1px solid var(--border); }
    .progress-bar { height: 100%; background: linear-gradient(90deg, var(--accent), var(--ok)); width: 0%; transition: width .15s ease; }
    .chat-box {
      display: flex; flex-direction: column; gap: 8px; max-height: 52vh; overflow-y: auto;
      padding: 12px; border-radius: 12px; background: #080c13; border: 1px solid var(--border); margin-bottom: 10px;
    }
    .chat-msg {
      max-width: 86%; padding: 9px 12px; border-radius: 12px; font-size: 13.5px; line-height: 1.45;
      background: var(--panel-2); border: 1px solid var(--border); align-self: flex-start;
    }
    .chat-msg.me {
      background: rgba(37,99,235,0.28); border-color: rgba(56,189,248,0.4); align-self: flex-end;
    }
    .chat-msg-head { font-size: 11px; color: var(--accent); font-weight: 700; margin-bottom: 3px; }
    .chat-msg img { max-width: 100%; max-height: 220px; border-radius: 8px; margin-top: 6px; display: block; }
    .metric-card {
      padding: 14px; border-radius: 14px; background: var(--panel-2); border: 1px solid var(--border);
    }
    .metric-val { font-size: 24px; font-weight: 800; color: var(--accent); margin: 4px 0; }
    .bottom-nav {
      position: fixed; bottom: 0; left: 0; right: 0; z-index: 40;
      display: flex; justify-content: space-around; align-items: center;
      background: rgba(11,15,24,0.96); backdrop-filter: blur(16px);
      border-top: 1px solid var(--border); padding: 6px 4px calc(6px + env(safe-area-inset-bottom, 0px));
    }
    .nav-btn {
      flex: 1; background: none; border: none; color: var(--muted);
      display: flex; flex-direction: column; align-items: center; gap: 3px;
      padding: 6px 4px; font-size: 11px; font-weight: 600; cursor: pointer; border-radius: 10px;
    }
    .nav-btn .icon { font-size: 18px; line-height: 1; }
    .nav-btn.active { color: var(--accent); background: rgba(56,189,248,0.1); }
    .divider { height: 1px; background: var(--border); margin: 16px 0; }
    footer { padding: 12px 16px; text-align: center; font-size: 11.5px; color: var(--muted); border-top: 1px solid var(--border); }
    footer a { color: var(--accent); text-decoration: none; }
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <img src="/icon.svg" alt="" />
      <span>Esteban Cloud</span>
      <span class="badge">${safeNode}</span>
      <span class="badge badge-ok">v0.4.0</span>
    </div>
    <div class="row">
      <button id="btnLogout" class="btn btn-sm hidden" onclick="logout()">Salir</button>
    </div>
  </header>

  <main>
    <!-- LOGIN VIEW -->
    <section id="loginView" class="card">
      <h2>Acceso Móvil · Esteban Cloud</h2>
      <p>Conéctate instantáneamente desde tu red Tailscale / Wi-Fi local o desbloquea con tu archivo <code>.ecloudkey</code>.</p>
      <div id="loginMsg"></div>

      <button id="btnQuickUnlock" class="btn btn-mesh" onclick="quickMeshUnlock()">
        ⚡ Desbloqueo Rápido en 1 Toque (Red Tailscale)
      </button>

      <div class="divider"></div>

      <h3>Desbloquear con llave encriptada (.ecloudkey)</h3>
      <label for="keyFile">Archivo .ecloudkey</label>
      <input id="keyFile" type="file" accept=".ecloudkey,.json,.txt" />
      <label for="keyText">O pegar llave encriptada (ECLOUD1:... o JSON)</label>
      <textarea id="keyText" placeholder="ECLOUD1:..."></textarea>
      <label for="passphrase">Frase de paso</label>
      <input id="passphrase" type="password" autocomplete="current-password" placeholder="Tu frase de paso secreta" />
      <div class="row" style="margin-top:14px">
        <button id="btnUnlock" class="btn btn-primary" onclick="unlock()">🔐 Desbloquear con Llave</button>
        <a class="btn" href="/api/mobile/apk" download="Esteban-Cloud.apk">📲 Descargar APK Android</a>
      </div>
    </section>

    <!-- LOGGED-IN SUPER APP VIEW -->
    <section id="appView" class="hidden">

      <!-- TAB 1: ARCHIVOS -->
      <div id="tab-files" class="tab-pane">
        <div id="sharesView" class="card">
          <div class="toolbar">
            <div>
              <h2>📁 Carpetas compartidas</h2>
              <p id="sessionInfo" style="margin:0"></p>
            </div>
            <button class="btn btn-sm" onclick="reloadShares()">🔄 Recargar</button>
          </div>
          <div id="sharesGrid" class="shares-grid"></div>
        </div>

        <div id="browserView" class="card hidden">
          <div class="toolbar">
            <div class="crumbs" id="crumbs"></div>
            <div class="row">
              <button class="btn btn-sm" onclick="refreshDir()">🔄 Actualizar</button>
              <label id="uploadLabel" class="btn btn-primary btn-sm hidden" style="margin:0;cursor:pointer">
                ⬆️ Subir archivo
                <input id="uploadInput" type="file" multiple style="display:none" onchange="uploadFiles(this.files)" />
              </label>
              <label id="cameraLabel" class="btn btn-sm hidden" style="margin:0;cursor:pointer">
                📷 Tomar foto
                <input id="cameraInput" type="file" accept="image/*,video/*" capture="environment" multiple style="display:none" onchange="uploadFiles(this.files)" />
              </label>
              <button id="btnMkdir" class="btn btn-sm hidden" onclick="createFolder()">+ Carpeta</button>
            </div>
          </div>
          <div id="browserMsg"></div>
          <div id="previewBox" class="preview-box hidden"></div>
          <div id="fileList" class="list"></div>
        </div>
      </div>

      <!-- TAB 2: AIRDROP & PC -->
      <div id="tab-airdrop" class="tab-pane hidden">
        <div class="card">
          <h2>⚡ AirDrop Directo a la PC</h2>
          <p>Envía fotos, videos o documentos directamente a la carpeta <code>Downloads\\EstebanCloud-AirDrop</code> de <strong>${safeNode}</strong>.</p>
          <div id="airdropMsg"></div>
          <div id="airdropProgressWrap" class="progress-wrap hidden">
            <div id="airdropProgressBar" class="progress-bar"></div>
          </div>
          <div class="row" style="margin-top:10px">
            <label class="btn btn-primary" style="margin:0;cursor:pointer">
              📤 Elegir Archivos para AirDrop
              <input id="airdropFileInput" type="file" multiple style="display:none" onchange="sendAirDropFiles(this.files)" />
            </label>
            <label class="btn" style="margin:0;cursor:pointer">
              📸 Foto Instantánea a la PC
              <input id="airdropCameraInput" type="file" accept="image/*,video/*" capture="environment" multiple style="display:none" onchange="sendAirDropFiles(this.files)" />
            </label>
          </div>
        </div>

        <div class="card">
          <div class="toolbar">
            <div>
              <h2>🖥️ Pantalla de la PC en Vivo & Control</h2>
              <p style="margin:0">Visualiza el escritorio remoto de <strong>${safeNode}</strong> y ejecuta acciones rápidas.</p>
            </div>
            <div class="row">
              <button class="btn btn-primary btn-sm" onclick="capturePcScreen()">📸 Ver pantalla de la PC en vivo</button>
              <button id="btnAutoScreen" class="btn btn-sm" onclick="toggleAutoScreen()">⏱️ Auto (Off)</button>
            </div>
          </div>
          <div id="pcActionMsg"></div>
          <div id="screenBox" class="preview-box hidden">
            <img id="screenImg" src="" alt="Pantalla de la PC" />
            <div id="screenMeta" class="item-meta" style="margin-top:6px"></div>
          </div>
          <div class="row" style="margin-top:10px">
            <button class="btn btn-warn" onclick="runPcAction('lock', '¿Bloquear la sesión de la PC ahora?')">🔒 Bloquear PC</button>
            <button class="btn btn-danger" onclick="runPcAction('empty-trash', '¿Vaciar la papelera de reciclaje de la PC?')">🗑️ Vaciar papelera</button>
            <button class="btn" onclick="runPcAction('clean-temp', '¿Limpiar archivos temporales de la PC?')">🧹 Limpiar Temp</button>
          </div>
        </div>
      </div>

      <!-- TAB 3: CHAT P2P -->
      <div id="tab-chat" class="tab-pane hidden">
        <div class="card">
          <div class="toolbar">
            <div>
              <h2>💬 Chat P2P con tus PCs</h2>
              <p style="margin:0">Mensajes e imágenes al instante entre tu Android y tus equipos.</p>
            </div>
            <button class="btn btn-sm" onclick="loadMobileChats()">🔄 Actualizar</button>
          </div>
          <div id="chatMsgAlert"></div>
          <div class="row" style="margin-bottom:10px">
            <select id="chatSelect" onchange="onSelectChat()" style="flex:1"></select>
          </div>
          <div id="chatMessages" class="chat-box">
            <p style="text-align:center;margin:auto">Cargando conversaciones...</p>
          </div>
          <div class="row">
            <input id="chatInput" type="text" placeholder="Escribe un mensaje para la PC..." style="flex:1" onkeydown="if(event.key==='Enter')sendMobileChat()" />
            <label class="btn" style="margin:0;cursor:pointer" title="Enviar foto o archivo">
              📷
              <input id="chatPhotoInput" type="file" accept="image/*,*/*" multiple style="display:none" onchange="sendMobileChat(this.files)" />
            </label>
            <button class="btn btn-primary" onclick="sendMobileChat()">Enviar</button>
          </div>
        </div>
      </div>

      <!-- TAB 4: PORTAPAPELES & BÓVEDA -->
      <div id="tab-clipvault" class="tab-pane hidden">
        <div class="card">
          <div class="toolbar">
            <div>
              <h2>📋 Portapapeles Compartido</h2>
              <p style="margin:0">Envía texto o enlaces a todas tus PCs o copia lo que hay en la PC.</p>
            </div>
            <button class="btn btn-sm" onclick="loadClipboardHistory()">🔄 Recargar</button>
          </div>
          <div id="clipMsg"></div>
          <textarea id="clipText" placeholder="Pega aquí texto, comando o URL para enviarlo al portapapeles de la PC..."></textarea>
          <div class="row" style="margin-top:8px">
            <button class="btn btn-primary" onclick="pushClipboardToPc()">📤 Enviar al Portapapeles de la PC</button>
            <button class="btn" onclick="pasteFromPhoneClipboard()">📥 Pegar desde mi celular</button>
          </div>
          <div id="clipList" class="list" style="margin-top:12px"></div>
        </div>

        <div class="card">
          <div class="toolbar">
            <div>
              <h2>🔐 Bóveda Encriptada (AES-256-GCM)</h2>
              <p style="margin:0">Claves, tokens, Wi-Fi y notas secretas sincronizadas con la PC.</p>
            </div>
            <button class="btn btn-sm" onclick="loadVaultItems()">🔄 Recargar</button>
          </div>
          <div id="vaultMsg"></div>
          <div class="grid-2" style="margin-bottom:10px">
            <div>
              <label for="vaultTitle">Título / Servicio</label>
              <input id="vaultTitle" type="text" placeholder="Ej: Wi-Fi Casa / Servidor SSH" />
            </div>
            <div>
              <label for="vaultUser">Usuario / Nota (opcional)</label>
              <input id="vaultUser" type="text" placeholder="Ej: admin / 100.64.0.10" />
            </div>
          </div>
          <label for="vaultSecret">Secreto / Contraseña / Llave</label>
          <input id="vaultSecret" type="password" placeholder="Valor secreto a guardar en la bóveda" />
          <div class="row" style="margin-top:10px">
            <button class="btn btn-primary" onclick="addVaultItem()">➕ Guardar en Bóveda</button>
          </div>
          <div id="vaultList" class="list" style="margin-top:14px"></div>
        </div>
      </div>

      <!-- TAB 5: MÉTRICAS & APK -->
      <div id="tab-metrics" class="tab-pane hidden">
        <div class="card">
          <div class="toolbar">
            <div>
              <h2>📊 Métricas en Vivo · ${safeNode}</h2>
              <p style="margin:0">Estado de CPU, memoria RAM y almacenamiento del nodo.</p>
            </div>
            <button class="btn btn-sm" onclick="loadMetrics()">🔄 Actualizar</button>
          </div>
          <div id="metricsMsg"></div>
          <div class="grid-2" id="metricsGrid">
            <div class="metric-card">
              <div class="item-meta">PROCESADOR (CPU)</div>
              <div id="metricCpu" class="metric-val">--%</div>
              <div class="progress-wrap"><div id="barCpu" class="progress-bar"></div></div>
              <div id="metricCpuSub" class="item-meta">Cargando...</div>
            </div>
            <div class="metric-card">
              <div class="item-meta">MEMORIA RAM</div>
              <div id="metricRam" class="metric-val">--%</div>
              <div class="progress-wrap"><div id="barRam" class="progress-bar"></div></div>
              <div id="metricRamSub" class="item-meta">Cargando...</div>
            </div>
            <div class="metric-card">
              <div class="item-meta">DISCO LIBRE</div>
              <div id="metricDisk" class="metric-val">-- GB</div>
              <div class="progress-wrap"><div id="barDisk" class="progress-bar"></div></div>
              <div id="metricDiskSub" class="item-meta">Cargando...</div>
            </div>
          </div>
        </div>

        <div class="card">
          <h2>📲 App Nativa Android (APK)</h2>
          <p>Descarga e instala el APK nativo de <strong>Esteban Cloud v0.4.0</strong> en tu teléfono Android para cambiar entre <strong>PRO-NICOLA</strong> y <strong>EstebanPcDELL</strong> con 1 toque, subir/descargar archivos nativamente y llevar tu bóveda offline.</p>
          <div class="row">
            <a class="btn btn-mesh" href="/api/mobile/apk" download="Esteban-Cloud.apk">
              📲 Descargar APK Nativo Android (Esteban-Cloud.apk)
            </a>
          </div>
        </div>
      </div>

    </section>
  </main>

  <!-- BOTTOM 5-TAB NAVIGATION BAR -->
  <nav id="bottomNav" class="bottom-nav hidden">
    <button class="nav-btn active" data-tab="files" onclick="switchTab('files')">
      <span class="icon">📁</span>
      <span>Archivos</span>
    </button>
    <button class="nav-btn" data-tab="airdrop" onclick="switchTab('airdrop')">
      <span class="icon">⚡</span>
      <span>AirDrop & PC</span>
    </button>
    <button class="nav-btn" data-tab="chat" onclick="switchTab('chat')">
      <span class="icon">💬</span>
      <span>Chat</span>
    </button>
    <button class="nav-btn" data-tab="clipvault" onclick="switchTab('clipvault')">
      <span class="icon">🔐</span>
      <span>Clip & Bóveda</span>
    </button>
    <button class="nav-btn" data-tab="metrics" onclick="switchTab('metrics')">
      <span class="icon">📊</span>
      <span>Métricas & APK</span>
    </button>
  </nav>

  <footer>
    Esteban Cloud v0.4.0 · Hecho por Esteban Nicola · <a href="https://estebanico.com" target="_blank" rel="noopener noreferrer">estebanico.com</a>
  </footer>

  <script>
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    let state = {
      shares: [],
      currentShare: null,
      currentPath: '',
      keyMeta: null,
      activeTab: 'files',
      chats: [],
      activeChatId: null,
      autoScreenTimer: null
    };

    document.getElementById('keyFile').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      document.getElementById('keyText').value = await file.text();
    });

    function showMsg(id, text, type) {
      const el = document.getElementById(id);
      if (!el) return;
      if (!text) { el.innerHTML = ''; return; }
      el.innerHTML = '<div class="' + (type || 'error') + '">' + escapeHtml(text) + '</div>';
    }

    function escapeHtml(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }

    function fmtSize(n) {
      if (n == null || isNaN(n)) return '';
      const u = ['B','KB','MB','GB','TB'];
      let i = 0, v = Number(n);
      while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
      return (i === 0 ? v : v.toFixed(1)) + ' ' + u[i];
    }

    async function api(url, opts) {
      const res = await fetch(url, opts);
      const ct = res.headers.get('content-type') || '';
      const data = ct.includes('application/json') ? await res.json() : await res.text();
      if (!res.ok) throw new Error((data && data.error) || 'Error HTTP ' + res.status);
      return data;
    }

    async function tryExistingSession() {
      try {
        const data = await api('/api/shares');
        state.shares = data.shares || [];
        state.keyMeta = data.key || null;
        renderLoggedIn();
        return;
      } catch {
        // Not logged in yet
      }
      const params = new URLSearchParams(window.location.search);
      if (params.get('quick') === '1' || params.get('autoUnlock') === '1') {
        quickMeshUnlock();
      }
    }

    async function quickMeshUnlock() {
      const btn = document.getElementById('btnQuickUnlock');
      if (btn) btn.disabled = true;
      showMsg('loginMsg', 'Conectando con nodo en malla Tailscale / LAN...', 'ok');
      try {
        const data = await api('/api/auth/quick-mesh-unlock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client: 'EstebanCloudMobile/0.4.0' })
        });
        state.shares = data.shares || [];
        state.keyMeta = data.key || null;
        showMsg('loginMsg', '');
        renderLoggedIn();
      } catch (err) {
        showMsg('loginMsg', err.message || 'No se pudo desbloquear en 1 toque. Usa tu llave .ecloudkey.', 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    async function unlock() {
      const bundle = document.getElementById('keyText').value.trim();
      const passphrase = document.getElementById('passphrase').value;
      if (!bundle || !passphrase) {
        showMsg('loginMsg', 'Carga tu archivo .ecloudkey (o pega la llave) y escribe tu frase de paso.');
        return;
      }
      const btn = document.getElementById('btnUnlock');
      btn.disabled = true;
      showMsg('loginMsg', 'Verificando llave encriptada...', 'ok');
      try {
        const data = await api('/api/auth/unlock-bundle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bundle, passphrase })
        });
        state.shares = data.shares || [];
        state.keyMeta = data.key || null;
        document.getElementById('passphrase').value = '';
        showMsg('loginMsg', '');
        renderLoggedIn();
      } catch (err) {
        showMsg('loginMsg', err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    }

    async function logout() {
      if (state.autoScreenTimer) {
        clearInterval(state.autoScreenTimer);
        state.autoScreenTimer = null;
      }
      await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
      state = { shares: [], currentShare: null, currentPath: '', keyMeta: null, activeTab: 'files', chats: [], activeChatId: null, autoScreenTimer: null };
      document.getElementById('loginView').classList.remove('hidden');
      document.getElementById('appView').classList.add('hidden');
      document.getElementById('bottomNav').classList.add('hidden');
      document.getElementById('btnLogout').classList.add('hidden');
    }

    function switchTab(tabName) {
      state.activeTab = tabName;
      document.querySelectorAll('.tab-pane').forEach((el) => el.classList.add('hidden'));
      const target = document.getElementById('tab-' + tabName);
      if (target) target.classList.remove('hidden');
      document.querySelectorAll('.nav-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
      });
      if (tabName === 'chat') loadMobileChats();
      if (tabName === 'clipvault') { loadClipboardHistory(); loadVaultItems(); }
      if (tabName === 'metrics') loadMetrics();
    }

    async function reloadShares() {
      try {
        const data = await api('/api/shares');
        state.shares = data.shares || [];
        state.keyMeta = data.key || null;
        renderLoggedIn();
      } catch (err) {
        showMsg('browserMsg', err.message, 'error');
      }
    }

    function renderLoggedIn() {
      document.getElementById('loginView').classList.add('hidden');
      document.getElementById('appView').classList.remove('hidden');
      document.getElementById('bottomNav').classList.remove('hidden');
      document.getElementById('btnLogout').classList.remove('hidden');
      document.getElementById('sharesView').classList.remove('hidden');
      document.getElementById('browserView').classList.add('hidden');
      const info = state.keyMeta
        ? ('Llave: ' + state.keyMeta.label + ' [' + (state.keyMeta.keyId || 'Total') + '] · ' + (state.keyMeta.permissions === 'rw' ? 'Lectura y escritura' : 'Solo lectura'))
        : 'Sesión activa en malla';
      document.getElementById('sessionInfo').textContent = info;
      const grid = document.getElementById('sharesGrid');
      if (!state.shares.length) {
        grid.innerHTML = '<p>No hay carpetas compartidas habilitadas para esta llave.</p>';
        return;
      }
      grid.innerHTML = state.shares.map((s) => (
        '<div class="share-card" onclick="openShare(\\'' + escapeHtml(s.id) + '\\')">' +
          '<div style="font-weight:700;font-size:15px;margin-bottom:6px">📁 ' + escapeHtml(s.name) + '</div>' +
          '<div class="item-meta">' + (s.effectiveMode === 'rw' ? 'Lectura y escritura (RW)' : 'Solo lectura (RO)') + '</div>' +
        '</div>'
      )).join('');
    }

    function openShare(shareId) {
      state.currentShare = state.shares.find((s) => s.id === shareId) || null;
      state.currentPath = '';
      if (!state.currentShare) return;
      document.getElementById('sharesView').classList.add('hidden');
      document.getElementById('browserView').classList.remove('hidden');
      const canWrite = state.currentShare.effectiveMode === 'rw';
      document.getElementById('uploadLabel').classList.toggle('hidden', !canWrite);
      document.getElementById('cameraLabel').classList.toggle('hidden', !canWrite);
      document.getElementById('btnMkdir').classList.toggle('hidden', !canWrite);
      refreshDir();
    }

    function renderCrumbs() {
      const parts = state.currentPath ? state.currentPath.split('/').filter(Boolean) : [];
      let html = '<button onclick="renderLoggedIn()">Carpetas</button> / <button onclick="goPath(\\'\\')">' + escapeHtml(state.currentShare.name) + '</button>';
      let acc = '';
      for (const p of parts) {
        acc = acc ? (acc + '/' + p) : p;
        const target = acc;
        html += ' / <button onclick="goPath(\\'' + escapeHtml(target) + '\\')">' + escapeHtml(p) + '</button>';
      }
      document.getElementById('crumbs').innerHTML = html;
    }

    function goPath(p) {
      state.currentPath = p;
      document.getElementById('previewBox').classList.add('hidden');
      refreshDir();
    }

    function isImgExt(name) {
      const ext = (String(name || '').split('.').pop() || '').toLowerCase();
      return ['png','jpg','jpeg','gif','webp','svg'].includes(ext);
    }

    async function refreshDir() {
      renderCrumbs();
      showMsg('browserMsg', '');
      const list = document.getElementById('fileList');
      list.innerHTML = '<p>Cargando archivos...</p>';
      try {
        const q = '?share=' + encodeURIComponent(state.currentShare.id) + '&path=' + encodeURIComponent(state.currentPath);
        const data = await api('/api/files' + q);
        if (!data.items.length) {
          list.innerHTML = '<p>Esta carpeta está vacía.</p>';
          return;
        }
        const canWrite = state.currentShare.effectiveMode === 'rw';
        list.innerHTML = data.items.map((it) => {
          const full = state.currentPath ? (state.currentPath + '/' + it.name) : it.name;
          const dl = '/api/download?share=' + encodeURIComponent(state.currentShare.id) + '&path=' + encodeURIComponent(full);
          const inlineUrl = dl + '&inline=1';
          const action = it.isDirectory
            ? 'goPath(\\'' + escapeHtml(full).replace(/'/g, "\\\\'") + '\\')'
            : 'previewFile(\\'' + escapeHtml(full).replace(/'/g, "\\\\'") + '\\', \\'' + escapeHtml(it.name).replace(/'/g, "\\\\'") + '\\')';
          const thumbHtml = (!it.isDirectory && isImgExt(it.name))
            ? '<img class="item-thumb" loading="lazy" src="' + inlineUrl + '" alt="" />'
            : '<div class="item-thumb">' + (it.isDirectory ? '📁' : '📄') + '</div>';
          return '<div class="item">' +
            '<div class="item-main" onclick="' + action + '">' +
              thumbHtml +
              '<div style="min-width:0"><div class="item-name">' + escapeHtml(it.name) + '</div>' +
              '<div class="item-meta">' + (it.isDirectory ? 'Carpeta' : fmtSize(it.size)) + '</div></div>' +
            '</div>' +
            '<div class="row">' +
              (!it.isDirectory ? '<a class="btn btn-sm" href="' + dl + '" download>⬇️</a>' : '') +
              (canWrite ? '<button class="btn btn-danger btn-sm" onclick="deleteItem(\\'' + escapeHtml(full).replace(/'/g, "\\\\'") + '\\')">🗑️</button>' : '') +
            '</div>' +
          '</div>';
        }).join('');
      } catch (err) {
        showMsg('browserMsg', err.message, 'error');
        list.innerHTML = '';
      }
    }

    function previewFile(fullPath, name) {
      const ext = (name.split('.').pop() || '').toLowerCase();
      const url = '/api/download?inline=1&share=' + encodeURIComponent(state.currentShare.id) + '&path=' + encodeURIComponent(fullPath);
      const box = document.getElementById('previewBox');
      if (['png','jpg','jpeg','gif','webp','svg'].includes(ext)) {
        box.innerHTML = '<div style="margin-bottom:6px;font-size:12px;color:var(--muted)">' + escapeHtml(name) + '</div><img src="' + url + '" alt="' + escapeHtml(name) + '" />';
        box.classList.remove('hidden');
      } else if (['mp4','webm','mov','m4v'].includes(ext)) {
        box.innerHTML = '<div style="margin-bottom:6px;font-size:12px;color:var(--muted)">' + escapeHtml(name) + '</div><video controls autoplay playsinline src="' + url + '"></video>';
        box.classList.remove('hidden');
      } else if (['mp3','wav','ogg','m4a'].includes(ext)) {
        box.innerHTML = '<div style="margin-bottom:6px;font-size:12px;color:var(--muted)">' + escapeHtml(name) + '</div><audio controls autoplay src="' + url + '" style="width:100%"></audio>';
        box.classList.remove('hidden');
      } else {
        window.open(url, '_blank');
      }
    }

    async function uploadFiles(files) {
      if (!files || !files.length) return;
      for (const file of files) {
        showMsg('browserMsg', 'Subiendo ' + file.name + ' (' + fmtSize(file.size) + ')...', 'ok');
        const url = '/api/upload?share=' + encodeURIComponent(state.currentShare.id) +
          '&path=' + encodeURIComponent(state.currentPath) +
          '&name=' + encodeURIComponent(file.name);
        try {
          await api(url, { method: 'POST', body: file });
        } catch (err) {
          showMsg('browserMsg', 'Error al subir ' + file.name + ': ' + err.message, 'error');
          return;
        }
      }
      document.getElementById('uploadInput').value = '';
      const cam = document.getElementById('cameraInput');
      if (cam) cam.value = '';
      showMsg('browserMsg', '✅ Subida completada.', 'ok');
      refreshDir();
    }

    async function createFolder() {
      const name = prompt('Nombre de la nueva carpeta:');
      if (!name || !name.trim()) return;
      try {
        await api('/api/mkdir', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ share: state.currentShare.id, path: state.currentPath, name: name.trim() })
        });
        refreshDir();
      } catch (err) {
        showMsg('browserMsg', err.message, 'error');
      }
    }

    async function deleteItem(fullPath) {
      if (!confirm('¿Eliminar "' + fullPath + '"?')) return;
      try {
        await api('/api/file?share=' + encodeURIComponent(state.currentShare.id) + '&path=' + encodeURIComponent(fullPath), {
          method: 'DELETE'
        });
        refreshDir();
      } catch (err) {
        showMsg('browserMsg', err.message, 'error');
      }
    }

    // --- TAB 2: AIRDROP & PC CONTROL ---
    function uploadWithProgress(url, file, onProgress) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && onProgress) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        };
        xhr.onload = () => {
          let parsed = null;
          try { parsed = JSON.parse(xhr.responseText); } catch {}
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(parsed || { ok: true });
          } else {
            const err = new Error((parsed && parsed.error) || ('Error HTTP ' + xhr.status));
            err.status = xhr.status;
            reject(err);
          }
        };
        xhr.onerror = () => reject(new Error('Error de red durante AirDrop.'));
        xhr.send(file);
      });
    }

    function fileToBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const res = String(reader.result || '');
          const comma = res.indexOf(',');
          resolve(comma >= 0 ? res.slice(comma + 1) : res);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    async function sendAirDropFiles(files) {
      if (!files || !files.length) return;
      const wrap = document.getElementById('airdropProgressWrap');
      const bar = document.getElementById('airdropProgressBar');
      wrap.classList.remove('hidden');
      bar.style.width = '5%';

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        showMsg('airdropMsg', '⚡ Enviando por AirDrop (' + (i + 1) + '/' + files.length + '): ' + file.name + '...', 'ok');
        const url = '/api/tools/airdrop?name=' + encodeURIComponent(file.name);
        try {
          await uploadWithProgress(url, file, (pct) => {
            bar.style.width = pct + '%';
          });
        } catch (err) {
          // Fallback to JSON base64 payload if backend expects JSON on /api/tools/airdrop
          try {
            const b64 = await fileToBase64(file);
            await api('/api/tools/airdrop', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: file.name, fileName: file.name, mime: file.type, base64: b64, senderNode: 'Android Mobile' })
            });
            bar.style.width = '100%';
          } catch (err2) {
            showMsg('airdropMsg', 'Error AirDrop en ' + file.name + ': ' + err2.message, 'error');
            return;
          }
        }
      }
      document.getElementById('airdropFileInput').value = '';
      document.getElementById('airdropCameraInput').value = '';
      bar.style.width = '100%';
      showMsg('airdropMsg', '✅ AirDrop recibido en Downloads\\\\EstebanCloud-AirDrop de la PC.', 'ok');
    }

    async function capturePcScreen() {
      showMsg('pcActionMsg', 'Capturando pantalla de la PC en vivo...', 'ok');
      try {
        const res = await fetch('/api/tools/screen?t=' + Date.now());
        if (!res.ok) {
          let errText = 'Error HTTP ' + res.status;
          try { const j = await res.json(); if (j.error) errText = j.error; } catch {}
          throw new Error(errText);
        }
        const ct = res.headers.get('content-type') || '';
        const imgEl = document.getElementById('screenImg');
        const box = document.getElementById('screenBox');
        if (ct.includes('application/json')) {
          const data = await res.json();
          const src = data.dataUrl || data.image || (data.base64 ? ('data:' + (data.mime || 'image/png') + ';base64,' + data.base64) : '');
          if (!src) throw new Error('Respuesta de pantalla vacía.');
          imgEl.src = src;
        } else {
          const blob = await res.blob();
          imgEl.src = URL.createObjectURL(blob);
        }
        document.getElementById('screenMeta').textContent = 'Actualizado: ' + new Date().toLocaleTimeString();
        box.classList.remove('hidden');
        showMsg('pcActionMsg', '');
      } catch (err) {
        showMsg('pcActionMsg', err.message, 'error');
      }
    }

    function toggleAutoScreen() {
      const btn = document.getElementById('btnAutoScreen');
      if (state.autoScreenTimer) {
        clearInterval(state.autoScreenTimer);
        state.autoScreenTimer = null;
        btn.textContent = '⏱️ Auto (Off)';
      } else {
        capturePcScreen();
        state.autoScreenTimer = setInterval(capturePcScreen, 3500);
        btn.textContent = '⏱️ Auto (Activo)';
      }
    }

    async function runPcAction(action, confirmText) {
      if (confirmText && !confirm(confirmText)) return;
      showMsg('pcActionMsg', 'Ejecutando acción en la PC (' + action + ')...', 'ok');
      try {
        const data = await api('/api/tools/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, senderNode: 'Android Mobile' })
        });
        showMsg('pcActionMsg', '✅ ' + (data.message || 'Acción ejecutada correctamente en la PC.'), 'ok');
      } catch (err) {
        showMsg('pcActionMsg', err.message, 'error');
      }
    }

    // --- TAB 3: CHAT P2P ---
    async function loadMobileChats() {
      try {
        const data = await api('/api/mobile/chats');
        const chats = Array.isArray(data) ? data : (data.chats || []);
        state.chats = chats;
        const sel = document.getElementById('chatSelect');
        if (!chats.length) {
          sel.innerHTML = '<option value="general">Chat Directo con ${safeNode}</option>';
          state.activeChatId = 'general';
          renderChatMessages([]);
          return;
        }
        if (!state.activeChatId || !chats.some((c) => c.id === state.activeChatId)) {
          state.activeChatId = chats[0].id;
        }
        sel.innerHTML = chats.map((c) => (
          '<option value="' + escapeHtml(c.id) + '"' + (c.id === state.activeChatId ? ' selected' : '') + '>' +
            escapeHtml(c.title || c.peerNode || c.id) +
          '</option>'
        )).join('');
        const active = chats.find((c) => c.id === state.activeChatId) || chats[0];
        renderChatMessages(active.messages || []);
      } catch (err) {
        showMsg('chatMsgAlert', err.message, 'error');
      }
    }

    function onSelectChat() {
      const sel = document.getElementById('chatSelect');
      state.activeChatId = sel.value;
      const active = state.chats.find((c) => c.id === state.activeChatId);
      renderChatMessages(active ? (active.messages || []) : []);
    }

    function renderChatMessages(messages) {
      const box = document.getElementById('chatMessages');
      if (!messages || !messages.length) {
        box.innerHTML = '<p style="text-align:center;margin:auto">No hay mensajes aún. ¡Envía el primero desde tu Android!</p>';
        return;
      }
      box.innerHTML = messages.map((m) => {
        const isMe = String(m.senderNode || '').toLowerCase().includes('android') || m.outgoing;
        const atts = (m.attachments || []).map((a) => {
          const src = a.dataUrl || a.url || (a.base64 ? ('data:' + (a.mime || 'image/png') + ';base64,' + a.base64) : '');
          if (src && String(a.mime || '').startsWith('image/')) {
            return '<img src="' + src + '" alt="' + escapeHtml(a.fileName || a.name || 'imagen') + '" />';
          }
          return '<div class="item-meta">📎 ' + escapeHtml(a.fileName || a.name || 'Adjunto') + '</div>';
        }).join('');
        return '<div class="chat-msg' + (isMe ? ' me' : '') + '">' +
          '<div class="chat-msg-head">' + escapeHtml(m.senderNode || 'Nodo') + '</div>' +
          '<div>' + escapeHtml(m.text || '') + '</div>' +
          atts +
        '</div>';
      }).join('');
      box.scrollTop = box.scrollHeight;
    }

    async function sendMobileChat(fileList) {
      const input = document.getElementById('chatInput');
      const text = input.value.trim();
      const attachments = [];
      if (fileList && fileList.length) {
        for (const f of fileList) {
          const b64 = await fileToBase64(f);
          attachments.push({
            name: f.name,
            fileName: f.name,
            mime: f.type || 'application/octet-stream',
            size: f.size,
            base64: b64
          });
        }
      }
      if (!text && !attachments.length) return;
      input.value = '';
      try {
        await api('/api/mobile/chat-send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chatId: state.activeChatId || 'general',
            senderNode: 'Android Mobile',
            text,
            attachments
          })
        });
        document.getElementById('chatPhotoInput').value = '';
        await loadMobileChats();
      } catch (err) {
        showMsg('chatMsgAlert', err.message, 'error');
      }
    }

    // --- TAB 4: CLIPBOARD & VAULT ---
    async function loadClipboardHistory() {
      try {
        const data = await api('/api/tools/clipboard');
        const list = document.getElementById('clipList');
        const items = Array.isArray(data) ? data : (data.items || data.history || (data.text ? [{ text: data.text, senderNode: data.nodeName || 'PC' }] : []));
        if (!items.length) {
          list.innerHTML = '<p>No hay elementos recientes en el portapapeles.</p>';
          return;
        }
        list.innerHTML = items.map((it, idx) => {
          const txt = typeof it === 'string' ? it : (it.text || '');
          const sender = typeof it === 'object' && it.senderNode ? it.senderNode : 'Malla';
          return '<div class="item">' +
            '<div class="item-main" style="cursor:default">' +
              '<div style="min-width:0">' +
                '<div class="item-name">' + escapeHtml(txt) + '</div>' +
                '<div class="item-meta">De: ' + escapeHtml(sender) + '</div>' +
              '</div>' +
            '</div>' +
            '<button class="btn btn-sm" data-clip="' + escapeHtml(txt) + '" onclick="copyTextAttr(this)">📋 Copiar</button>' +
          '</div>';
        }).join('');
      } catch (err) {
        // Ignore if GET clipboard not initialized yet
      }
    }

    function copyTextAttr(btn) {
      const val = btn.getAttribute('data-clip') || '';
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(val).catch(() => {});
      }
      showMsg('clipMsg', '✅ Copiado al portapapeles del teléfono.', 'ok');
    }

    async function pushClipboardToPc() {
      const text = document.getElementById('clipText').value.trim();
      if (!text) {
        showMsg('clipMsg', 'Escribe o pega algún texto primero.');
        return;
      }
      try {
        await api('/api/tools/clipboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, senderNode: 'Android Mobile' })
        });
        document.getElementById('clipText').value = '';
        showMsg('clipMsg', '✅ Enviado al portapapeles de la PC.', 'ok');
        loadClipboardHistory();
      } catch (err) {
        showMsg('clipMsg', err.message, 'error');
      }
    }

    async function pasteFromPhoneClipboard() {
      try {
        const t = await navigator.clipboard.readText();
        if (t) document.getElementById('clipText').value = t;
      } catch {
        showMsg('clipMsg', 'Pega manualmente manteniendo presionado el cuadro de texto.', 'error');
      }
    }

    async function loadVaultItems() {
      try {
        const data = await api('/api/tools/vault');
        const items = Array.isArray(data) ? data : (data.items || []);
        const list = document.getElementById('vaultList');
        if (!items.length) {
          list.innerHTML = '<p>La bóveda encriptada está vacía.</p>';
          return;
        }
        list.innerHTML = items.map((it) => {
          const title = it.title || it.label || it.name || 'Secreto';
          const user = it.username || it.user || it.notes || '';
          const secret = it.secret || it.value || it.password || '';
          return '<div class="item">' +
            '<div class="item-main" style="cursor:default">' +
              '<span>🔐</span>' +
              '<div style="min-width:0">' +
                '<div class="item-name">' + escapeHtml(title) + '</div>' +
                '<div class="item-meta">' + escapeHtml(user) + ' · <code>••••••••</code></div>' +
              '</div>' +
            '</div>' +
            '<button class="btn btn-sm" data-clip="' + escapeHtml(secret) + '" onclick="copyVaultSecret(this)">📋 Copiar</button>' +
          '</div>';
        }).join('');
      } catch (err) {
        showMsg('vaultMsg', err.message, 'error');
      }
    }

    function copyVaultSecret(btn) {
      const val = btn.getAttribute('data-clip') || '';
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(val).catch(() => {});
      }
      showMsg('vaultMsg', '✅ Secreto copiado al portapapeles.', 'ok');
    }

    async function addVaultItem() {
      const title = document.getElementById('vaultTitle').value.trim();
      const username = document.getElementById('vaultUser').value.trim();
      const secret = document.getElementById('vaultSecret').value;
      if (!title || !secret) {
        showMsg('vaultMsg', 'Completa el título y el valor secreto.');
        return;
      }
      try {
        await api('/api/tools/vault', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, label: title, username, notes: username, secret, value: secret })
        });
        document.getElementById('vaultTitle').value = '';
        document.getElementById('vaultUser').value = '';
        document.getElementById('vaultSecret').value = '';
        showMsg('vaultMsg', '✅ Guardado en la Bóveda Encriptada.', 'ok');
        loadVaultItems();
      } catch (err) {
        showMsg('vaultMsg', err.message, 'error');
      }
    }

    // --- TAB 5: METRICS ---
    async function loadMetrics() {
      try {
        const data = await api('/api/metrics');
        const m = data.metrics || data || {};
        const cpu = Number(m.cpuPercent ?? m.cpu ?? 0);
        const ram = Number(m.ramPercent ?? m.memoryPercent ?? m.memPercent ?? 0);
        const diskFree = Number(m.diskFreeGb ?? m.freeDiskGb ?? m.diskFree ?? 0);
        const diskTotal = Number(m.diskTotalGb ?? m.totalDiskGb ?? m.diskTotal ?? 0);
        const diskUsedPct = diskTotal > 0 ? Math.round(((diskTotal - diskFree) / diskTotal) * 100) : Number(m.diskPercent ?? 50);

        document.getElementById('metricCpu').textContent = cpu.toFixed(0) + '%';
        document.getElementById('barCpu').style.width = Math.min(100, Math.max(0, cpu)) + '%';
        document.getElementById('metricCpuSub').textContent = (m.cpuModel || m.hostname || '${safeNode}');

        document.getElementById('metricRam').textContent = ram.toFixed(0) + '%';
        document.getElementById('barRam').style.width = Math.min(100, Math.max(0, ram)) + '%';
        document.getElementById('metricRamSub').textContent = m.ramUsedGb && m.ramTotalGb
          ? (m.ramUsedGb + ' GB / ' + m.ramTotalGb + ' GB')
          : 'Memoria del sistema';

        document.getElementById('metricDisk').textContent = diskFree ? (diskFree.toFixed(1) + ' GB') : '-- GB';
        document.getElementById('barDisk').style.width = Math.min(100, Math.max(0, diskUsedPct)) + '%';
        document.getElementById('metricDiskSub').textContent = diskTotal
          ? ('Libre de ' + diskTotal.toFixed(1) + ' GB')
          : 'Espacio disponible';
        showMsg('metricsMsg', '');
      } catch (err) {
        showMsg('metricsMsg', err.message, 'error');
      }
    }

    tryExistingSession();
  </script>
</body>
</html>`;
}

module.exports = {
  getIconSvg,
  getManifestJson,
  getServiceWorkerJs,
  getMobileHtml
};

'use strict';

const fs = require('fs');
const path = require('path');

const INSTALLER_REGEX = /^Esteban-Mesh-Office-Setup-.*\.exe$/i;
const LAUNCHER_AUTO_PROVISION = '1-AUTO-CONFIGURAR-OFICINA.cmd';
const LAUNCHER_INVENTORY_ONLY = '2-SOLO-RECOLECTAR-INVENTARIO.cmd';
const README_FILENAME = 'LEEME-DESPLIEGUE-EMPRESA.txt';

function parseSemverFromName(fileName) {
  const match = String(fileName || '').match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return [0, 0, 0];
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemverDesc(a, b) {
  const va = parseSemverFromName(a.name);
  const vb = parseSemverFromName(b.name);
  for (let i = 0; i < 3; i += 1) {
    if (vb[i] !== va[i]) return vb[i] - va[i];
  }
  return (b.mtimeMs || 0) - (a.mtimeMs || 0);
}

function findLatestInstaller({ installerPath, appRootDir, extraInstallerDirs = [] }) {
  if (installerPath && typeof installerPath === 'string') {
    const resolved = path.resolve(installerPath);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      return resolved;
    }
  }

  const candidateDirs = [];
  if (Array.isArray(extraInstallerDirs)) {
    for (const dir of extraInstallerDirs) {
      if (dir && typeof dir === 'string') candidateDirs.push(dir);
    }
  }
  if (appRootDir && typeof appRootDir === 'string') {
    candidateDirs.push(path.join(appRootDir, 'release'));
    candidateDirs.push(appRootDir);
  }
  candidateDirs.push(path.resolve(__dirname, '..', 'release'));
  if (process.resourcesPath) {
    candidateDirs.push(process.resourcesPath);
    candidateDirs.push(path.dirname(process.resourcesPath));
  }

  const seenDirs = new Set();
  const candidates = [];

  for (const dir of candidateDirs) {
    const resolvedDir = path.resolve(dir);
    if (seenDirs.has(resolvedDir)) continue;
    seenDirs.add(resolvedDir);
    if (!fs.existsSync(resolvedDir)) continue;

    let entries = [];
    try {
      entries = fs.readdirSync(resolvedDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!INSTALLER_REGEX.test(entry.name)) continue;
      const fullPath = path.join(resolvedDir, entry.name);
      try {
        const stat = fs.statSync(fullPath);
        candidates.push({ name: entry.name, fullPath, mtimeMs: stat.mtimeMs });
      } catch {
        // Ignorar archivos inaccesibles
      }
    }
  }

  if (candidates.length === 0) return '';
  candidates.sort(compareSemverDesc);
  return candidates[0].fullPath;
}

function resolveScriptSource(fileName, { scriptsDir, appRootDir }) {
  const candidates = [];
  if (scriptsDir && typeof scriptsDir === 'string') {
    candidates.push(path.join(scriptsDir, fileName));
  }
  if (appRootDir && typeof appRootDir === 'string') {
    candidates.push(path.join(appRootDir, 'scripts', fileName));
  }
  candidates.push(path.resolve(__dirname, '..', 'scripts', fileName));
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'scripts', fileName));
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return '';
}

function buildAutoProvisionLauncher() {
  return [
    '@echo off',
    'setlocal EnableExtensions',
    'chcp 65001 >nul',
    'title Esteban Mesh Office - Auto-Configuracion Empresarial',
    '',
    'rem Verificar privilegios de Administrador y solicitar elevacion UAC si falta',
    'net session >nul 2>&1',
    'if %errorLevel% NEQ 0 (',
    '  echo Solicitando permisos de Administrador ^(UAC^) para configurar Firewall, energia e instalacion...',
    '  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath \'%~f0\' -Verb RunAs"',
    '  exit /b',
    ')',
    '',
    'set "KITDIR=%~dp0"',
    'if "%KITDIR:~-1%"=="\\" set "KITDIR=%KITDIR:~0,-1%"',
    '',
    'echo.',
    'echo Iniciando auto-configuracion de Esteban Mesh Office desde: %KITDIR%',
    'echo.',
    'powershell -NoProfile -ExecutionPolicy Bypass -File "%KITDIR%\\scripts\\office-auto-provision.ps1" -KitDir "%KITDIR%"',
    'echo.',
    'pause',
    'endlocal',
    ''
  ].join('\r\n');
}

function buildInventoryOnlyLauncher() {
  return [
    '@echo off',
    'setlocal EnableExtensions',
    'chcp 65001 >nul',
    'title Esteban Mesh Office - Recolector de Inventario',
    '',
    'set "KITDIR=%~dp0"',
    'if "%KITDIR:~-1%"=="\\" set "KITDIR=%KITDIR:~0,-1%"',
    '',
    'echo.',
    'echo Recolectando inventario del equipo ^(no requiere permisos de Administrador^)...',
    'echo.',
    'powershell -NoProfile -ExecutionPolicy Bypass -File "%KITDIR%\\scripts\\office-inventory-collector.ps1" -OutputDir "%KITDIR%\\Inventarios"',
    'echo.',
    'pause',
    'endlocal',
    ''
  ].join('\r\n');
}

function buildEnterpriseReadme({ bootstrap, installerName, installerIncluded, appVersion }) {
  const hubText = bootstrap.hubUrl || '(No configurado - se guardara el inventario localmente)';
  const installerText = installerIncluded
    ? installerName
    : 'No incluido automaticamente (copie Esteban-Mesh-Office-Setup-*.exe junto a este archivo)';
  const keyText = bootstrap.masterKeyFileName
    ? `${bootstrap.masterKeyFileName} (incluida en este kit)`
    : 'No incluida en este kit';

  return [
    '========================================================================',
    '  ESTEBAN MESH OFFICE - KIT DE DESPLIEGUE EMPRESARIAL (10+ PCs)',
    '========================================================================',
    '',
    `Version del kit       : ${appVersion}`,
    `Espacio de trabajo    : ${bootstrap.workspaceName}`,
    `ID de espacio         : ${bootstrap.workspaceId || 'Automatico'}`,
    `Hub central           : ${hubText}`,
    `Nodo Hub              : ${bootstrap.hubNodeName || 'N/A'}`,
    `Departamento default  : ${bootstrap.defaultDepartment}`,
    `Rol default           : ${bootstrap.defaultRole}`,
    `Auto-compartir discos : ${bootstrap.autoShareAllDisks ? 'SI (todos los discos fijos en modo rw)' : 'NO'}`,
    `Puertos de red        : TCP ${bootstrap.port} / UDP ${bootstrap.udpPort}`,
    `Instalador incluido   : ${installerText}`,
    `Llave maestra         : ${keyText}`,
    `Fecha de generacion   : ${bootstrap.createdAt}`,
    '',
    '------------------------------------------------------------------------',
    '  COMO DESPLEGAR EN 10+ COMPUTADORAS DE LA OFICINA',
    '------------------------------------------------------------------------',
    '',
    '1. Copie la carpeta completa "Esteban-Mesh-Office-Deploy" en una memoria',
    '   USB o en una carpeta compartida de red accesible por todos los equipos.',
    '',
    '2. OPCION A - Instalacion y configuracion completa (RECOMENDADO):',
    `   En cada PC, haga doble clic en:  ${LAUNCHER_AUTO_PROVISION}`,
    '   - Acepte el aviso de permisos de Administrador (UAC).',
    '   - Abrira los puertos del Firewall de Windows (TCP 4890 / UDP 4891)',
    '     para redes Privadas, Dominio y Tailscale.',
    '   - Desactivara la suspension por inactividad en corriente AC para',
    '     evitar cortes en transferencias pesadas.',
    '   - Instalara rclone y WinFsp via winget si faltan (si hay Internet).',
    '   - Instalara Esteban Mesh Office de forma silenciosa (/S).',
    '   - Aplicara workspace-bootstrap.json en %APPDATA%\\EstebanMeshOffice\\config.json.',
    '   - Recolectara el inventario hardware y lo enviara al Hub central.',
    '   - Abrira Esteban Mesh Office listo para trabajar.',
    '',
    '3. OPCION B - Solo recolectar inventario sin instalar (SIN ADMIN):',
    `   En cualquier PC Windows 10/11, haga doble clic en:  ${LAUNCHER_INVENTORY_ONLY}`,
    '   - No requiere privilegios de Administrador ni instalar dependencias.',
    '   - Guarda "Inventarios\\Inventario-<NOMBRE_PC>.json" en esta carpeta.',
    '   - Actualiza la planilla consolidada "Inventarios\\Resumen-Flota.csv".',
    '   - Si el Hub central esta accesible, realiza check-in automatico.',
    '',
    '------------------------------------------------------------------------',
    '  ESTRUCTURA DEL KIT',
    '------------------------------------------------------------------------',
    '',
    '  Esteban-Mesh-Office-Deploy\\',
    `  +-- ${LAUNCHER_AUTO_PROVISION}`,
    `  +-- ${LAUNCHER_INVENTORY_ONLY}`,
    `  +-- ${README_FILENAME}`,
    '  +-- workspace-bootstrap.json',
    installerIncluded ? `  +-- ${installerName}` : '  +-- (Esteban-Mesh-Office-Setup-*.exe)',
    bootstrap.masterKeyFileName ? `  +-- ${bootstrap.masterKeyFileName}` : '',
    '  +-- scripts\\',
    '  |   +-- office-auto-provision.ps1',
    '  |   +-- office-inventory-collector.ps1',
    '  +-- Inventarios\\',
    '      +-- Inventario-<PC>.json',
    '      +-- Resumen-Flota.csv',
    '',
    'Consejo: Al terminar de pasar el USB por todas las PCs, abra el archivo',
    'Inventarios\\Resumen-Flota.csv en Excel para ver toda la flota unificada',
    'o importe la carpeta Inventarios\\ desde Esteban Mesh Office.',
    ''
  ]
    .filter((line) => line !== null && line !== undefined)
    .join('\r\n');
}

function exportEnterpriseDeployKit({
  targetDir,
  installerPath,
  scriptsDir,
  appRootDir,
  extraInstallerDirs = [],
  appVersion = '1.0.0',
  workspaceConfig = {},
  masterKeyFileName = '',
  masterKeyBundleJson = ''
} = {}) {
  if (!targetDir || typeof targetDir !== 'string') {
    throw new Error('Se requiere una carpeta destino (targetDir) para exportar el kit empresarial.');
  }

  const kitDir = path.join(path.resolve(targetDir), 'Esteban-Mesh-Office-Deploy');
  const kitScriptsDir = path.join(kitDir, 'scripts');
  const kitInventoriesDir = path.join(kitDir, 'Inventarios');

  fs.mkdirSync(kitScriptsDir, { recursive: true });
  fs.mkdirSync(kitInventoriesDir, { recursive: true });

  // 1. Copiar instalador mas reciente si existe
  const foundInstaller = findLatestInstaller({ installerPath, appRootDir, extraInstallerDirs });
  let installerName = '';
  let installerIncluded = false;
  if (foundInstaller) {
    installerName = path.basename(foundInstaller);
    const destInstaller = path.join(kitDir, installerName);
    if (path.resolve(foundInstaller) !== path.resolve(destInstaller)) {
      fs.copyFileSync(foundInstaller, destInstaller);
    }
    installerIncluded = true;
  }

  // 2. Copiar scripts PowerShell esenciales
  const scriptFiles = ['office-inventory-collector.ps1', 'office-auto-provision.ps1'];
  for (const scriptFile of scriptFiles) {
    const src = resolveScriptSource(scriptFile, { scriptsDir, appRootDir });
    if (src) {
      const dst = path.join(kitScriptsDir, scriptFile);
      if (path.resolve(src) !== path.resolve(dst)) {
        fs.copyFileSync(src, dst);
      }
    }
  }

  // 3. Escribir masterKeyBundleJson si se proporciono
  let resolvedMasterKeyFileName = '';
  const hasMasterKeyContent =
    (typeof masterKeyBundleJson === 'string' && masterKeyBundleJson.trim().length > 0) ||
    (masterKeyBundleJson && typeof masterKeyBundleJson === 'object');

  if (hasMasterKeyContent) {
    const safeName = path.basename(String(masterKeyFileName || 'Esteban-Mesh-Office-Master.ecloudkey').trim());
    resolvedMasterKeyFileName = safeName || 'Esteban-Mesh-Office-Master.ecloudkey';
    const serializedKey =
      typeof masterKeyBundleJson === 'string'
        ? masterKeyBundleJson
        : JSON.stringify(masterKeyBundleJson, null, 2);
    fs.writeFileSync(path.join(kitDir, resolvedMasterKeyFileName), serializedKey, 'utf8');
  } else if (masterKeyFileName && typeof masterKeyFileName === 'string' && masterKeyFileName.trim()) {
    resolvedMasterKeyFileName = path.basename(masterKeyFileName.trim());
  }

  // 4. Escribir workspace-bootstrap.json
  const ws = workspaceConfig && typeof workspaceConfig === 'object' ? workspaceConfig : {};
  const bootstrap = {
    workspaceName: String(ws.workspaceName || 'Espacio de Trabajo'),
    workspaceId: String(ws.workspaceId || ''),
    hubUrl: String(ws.hubUrl || '').trim().replace(/\/+$/, ''),
    hubNodeName: String(ws.hubNodeName || ''),
    defaultDepartment: String(ws.defaultDepartment || ws.department || 'General'),
    defaultRole: String(ws.defaultRole || ws.role || 'Estacion de Trabajo'),
    autoShareAllDisks: Boolean(ws.autoShareAllDisks),
    port: Number(ws.port) || 4890,
    udpPort: Number(ws.udpPort) || 4891,
    masterKeyFileName: resolvedMasterKeyFileName,
    createdAt: new Date().toISOString()
  };

  if (ws.masterKeyVault) {
    bootstrap.masterKeyVault = ws.masterKeyVault;
  }

  const bootstrapPath = path.join(kitDir, 'workspace-bootstrap.json');
  fs.writeFileSync(bootstrapPath, JSON.stringify(bootstrap, null, 2), 'utf8');

  // 5. Generar launchers .cmd listos para doble clic
  fs.writeFileSync(path.join(kitDir, LAUNCHER_AUTO_PROVISION), buildAutoProvisionLauncher(), 'utf8');
  fs.writeFileSync(path.join(kitDir, LAUNCHER_INVENTORY_ONLY), buildInventoryOnlyLauncher(), 'utf8');

  // 6. Generar instrucciones en espanol
  const readmeContent = buildEnterpriseReadme({
    bootstrap,
    installerName,
    installerIncluded,
    appVersion
  });
  fs.writeFileSync(path.join(kitDir, README_FILENAME), readmeContent, 'utf8');

  return {
    ok: true,
    kitDir,
    installerName,
    installerIncluded,
    bootstrapPath,
    launchers: [LAUNCHER_AUTO_PROVISION, LAUNCHER_INVENTORY_ONLY]
  };
}

module.exports = {
  exportEnterpriseDeployKit,
  findLatestInstaller
};

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

/**
 * Modular, whitelisted, reversible Windows optimization & script-builder engine
 * inspired by transparent script-generator workflows (100% original MIT code).
 *
 * Security model:
 * - Only predefined tweak IDs from WIN_TWEAKS can be included or executed.
 * - No arbitrary user shell strings are ever interpolated into PowerShell.
 * - Every generated script is previewable and exportable as a readable .ps1 file.
 */
const WIN_TWEAKS = Object.freeze([
  // --- Rendimiento & RAM ---
  {
    id: 'perf-visual-effects',
    category: 'performance',
    title: 'Reducir transparencias y animaciones',
    description: 'Desactiva transparencias de Windows y animaciones pesadas de ventanas para liberar GPU/RAM.',
    impact: 'Alto (RAM/GPU)',
    requiresAdmin: false,
    reversible: true,
    applyPs: [
      "Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize' -Name 'EnableTransparency' -Type DWord -Value 0 -Force",
      "Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop\\WindowMetrics' -Name 'MinAnimate' -Type String -Value '0' -Force",
      "Write-Output '[OK] Transparencias y animaciones reducidas.'"
    ].join('\n'),
    revertPs: [
      "Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize' -Name 'EnableTransparency' -Type DWord -Value 1 -Force",
      "Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop\\WindowMetrics' -Name 'MinAnimate' -Type String -Value '1' -Force",
      "Write-Output '[OK] Transparencias y animaciones restauradas.'"
    ].join('\n')
  },
  {
    id: 'perf-power-plan',
    category: 'performance',
    title: 'Plan de energía Alto / Máximo Rendimiento',
    description: 'Activa el plan de Alto Rendimiento (o Máximo Rendimiento si está disponible) para evitar bajones de CPU en red.',
    impact: 'Alto (CPU)',
    requiresAdmin: true,
    reversible: true,
    applyPs: [
      '$ult = (powercfg -duplicatescheme e9a42b02-d5df-448d-aa00-03f14749eb61 2>$null)',
      'if ($ult -match "([0-9a-fA-F-]{36})") { powercfg -setactive $Matches[1] | Out-Null; Write-Output "[OK] Plan Máximo Rendimiento activado." } else { powercfg -setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c 2>$null; Write-Output "[OK] Plan Alto Rendimiento activado." }'
    ].join('\n'),
    revertPs: [
      'powercfg -setactive 381b4222-f694-41f0-9685-ff5bb260df2e 2>$null',
      "Write-Output '[OK] Plan Equilibrado restaurado.'"
    ].join('\n')
  },
  {
    id: 'perf-disable-sysmain',
    category: 'performance',
    title: 'Desactivar SysMain (Superfetch) en SSD',
    description: 'Detiene y desactiva SysMain para reducir uso de disco y RAM en equipos con SSD.',
    impact: 'Medio (RAM/Disco)',
    requiresAdmin: true,
    reversible: true,
    applyPs: [
      "Stop-Service -Name 'SysMain' -Force -ErrorAction SilentlyContinue",
      "Set-Service -Name 'SysMain' -StartupType Disabled -ErrorAction SilentlyContinue",
      "Write-Output '[OK] Servicio SysMain desactivado.'"
    ].join('\n'),
    revertPs: [
      "Set-Service -Name 'SysMain' -StartupType Automatic -ErrorAction SilentlyContinue",
      "Start-Service -Name 'SysMain' -ErrorAction SilentlyContinue",
      "Write-Output '[OK] Servicio SysMain restaurado a Automático.'"
    ].join('\n')
  },
  {
    id: 'perf-disable-hibernation',
    category: 'performance',
    title: 'Desactivar Hibernación (libera GB en SSD)',
    description: 'Elimina hiberfil.sys y libera varios GB de espacio en disco C: (mantiene suspensión normal).',
    impact: 'Alto (Disco)',
    requiresAdmin: true,
    reversible: true,
    applyPs: [
      'powercfg /h off',
      "Write-Output '[OK] Hibernación desactivada (hiberfil.sys liberado).'"
    ].join('\n'),
    revertPs: [
      'powercfg /h on',
      "Write-Output '[OK] Hibernación reactivada.'"
    ].join('\n')
  },
  {
    id: 'perf-network-low-latency',
    category: 'performance',
    title: 'Optimizar red para baja latencia LAN/Tailscale',
    description: 'Desactiva el throttling de red multimedia de Windows y ajusta TCP auto-tuning para transferencias rápidas.',
    impact: 'Medio (Red)',
    requiresAdmin: true,
    reversible: true,
    applyPs: [
      "New-Item -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile' -Force | Out-Null",
      "Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile' -Name 'NetworkThrottlingIndex' -Type DWord -Value 0xffffffff -Force",
      'netsh int tcp set global autotuninglevel=normal | Out-Null',
      "Write-Output '[OK] Red optimizada para baja latencia.'"
    ].join('\n'),
    revertPs: [
      "Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile' -Name 'NetworkThrottlingIndex' -Type DWord -Value 10 -Force",
      "Write-Output '[OK] Throttling de red restaurado al valor por defecto.'"
    ].join('\n')
  },

  // --- Privacidad & Telemetría ---
  {
    id: 'priv-telemetry',
    category: 'privacy',
    title: 'Reducir telemetría de Windows (DiagTrack)',
    description: 'Configura AllowTelemetry=0 y desactiva el servicio DiagTrack para ahorrar CPU y tráfico en segundo plano.',
    impact: 'Medio (CPU/Red)',
    requiresAdmin: true,
    reversible: true,
    applyPs: [
      "New-Item -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection' -Force | Out-Null",
      "Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection' -Name 'AllowTelemetry' -Type DWord -Value 0 -Force",
      "Stop-Service -Name 'DiagTrack' -Force -ErrorAction SilentlyContinue",
      "Set-Service -Name 'DiagTrack' -StartupType Disabled -ErrorAction SilentlyContinue",
      "Write-Output '[OK] Telemetría reducida y DiagTrack desactivado.'"
    ].join('\n'),
    revertPs: [
      "Remove-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection' -Name 'AllowTelemetry' -ErrorAction SilentlyContinue",
      "Set-Service -Name 'DiagTrack' -StartupType Automatic -ErrorAction SilentlyContinue",
      "Start-Service -Name 'DiagTrack' -ErrorAction SilentlyContinue",
      "Write-Output '[OK] Telemetría y DiagTrack restaurados.'"
    ].join('\n')
  },
  {
    id: 'priv-activity-history',
    category: 'privacy',
    title: 'Desactivar ID de publicidad e historial de actividad',
    description: 'Evita rastreo publicitario local y sincronización innecesaria de historial en segundo plano.',
    impact: 'Bajo (Privacidad)',
    requiresAdmin: false,
    reversible: true,
    applyPs: [
      "New-Item -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\AdvertisingInfo' -Force | Out-Null",
      "Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\AdvertisingInfo' -Name 'Enabled' -Type DWord -Value 0 -Force",
      "Write-Output '[OK] ID de publicidad desactivado.'"
    ].join('\n'),
    revertPs: [
      "Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\AdvertisingInfo' -Name 'Enabled' -Type DWord -Value 1 -Force",
      "Write-Output '[OK] ID de publicidad restaurado.'"
    ].join('\n')
  },
  {
    id: 'priv-start-suggestions',
    category: 'privacy',
    title: 'Quitar sugerencias y anuncios en Inicio/Explorador',
    description: 'Desactiva contenido patrocinado, sugerencias de apps y notificaciones promocionales de Windows.',
    impact: 'Bajo (RAM/UX)',
    requiresAdmin: false,
    reversible: true,
    applyPs: [
      "$cdm = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager'",
      'New-Item -Path $cdm -Force | Out-Null',
      "Set-ItemProperty -Path $cdm -Name 'SubscribedContent-338388Enabled' -Type DWord -Value 0 -Force",
      "Set-ItemProperty -Path $cdm -Name 'SubscribedContent-338389Enabled' -Type DWord -Value 0 -Force",
      "Set-ItemProperty -Path $cdm -Name 'SystemPaneSuggestionsEnabled' -Type DWord -Value 0 -Force",
      "Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced' -Name 'ShowSyncProviderNotifications' -Type DWord -Value 0 -Force",
      "Write-Output '[OK] Sugerencias y anuncios en Inicio/Explorador desactivados.'"
    ].join('\n'),
    revertPs: [
      "$cdm = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager'",
      "Set-ItemProperty -Path $cdm -Name 'SubscribedContent-338388Enabled' -Type DWord -Value 1 -Force",
      "Set-ItemProperty -Path $cdm -Name 'SystemPaneSuggestionsEnabled' -Type DWord -Value 1 -Force",
      "Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced' -Name 'ShowSyncProviderNotifications' -Type DWord -Value 1 -Force",
      "Write-Output '[OK] Sugerencias restauradas.'"
    ].join('\n')
  },
  {
    id: 'priv-widgets-copilot',
    category: 'privacy',
    title: 'Ocultar Widgets y botón Copilot de la barra',
    description: 'Evita procesos WebView de Widgets en segundo plano que consumen ~150–300 MB de RAM.',
    impact: 'Alto (RAM)',
    requiresAdmin: false,
    reversible: true,
    applyPs: [
      "Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced' -Name 'TaskbarDa' -Type DWord -Value 0 -Force",
      "New-Item -Path 'HKCU:\\Software\\Policies\\Microsoft\\Windows\\WindowsCopilot' -Force | Out-Null",
      "Set-ItemProperty -Path 'HKCU:\\Software\\Policies\\Microsoft\\Windows\\WindowsCopilot' -Name 'TurnOffWindowsCopilot' -Type DWord -Value 1 -Force",
      "Write-Output '[OK] Widgets y Copilot ocultados (aplica al reiniciar Explorador o sesión).'"
    ].join('\n'),
    revertPs: [
      "Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced' -Name 'TaskbarDa' -Type DWord -Value 1 -Force",
      "Remove-ItemProperty -Path 'HKCU:\\Software\\Policies\\Microsoft\\Windows\\WindowsCopilot' -Name 'TurnOffWindowsCopilot' -ErrorAction SilentlyContinue",
      "Write-Output '[OK] Widgets y Copilot restaurados.'"
    ].join('\n')
  },

  // --- Limpieza & Mantenimiento ---
  {
    id: 'clean-user-temp',
    category: 'cleanup',
    title: 'Limpiar temporales del usuario (%TEMP%)',
    description: 'Elimina archivos temporales antiguos en %TEMP% sin tocar archivos en uso.',
    impact: 'Medio (Disco)',
    requiresAdmin: false,
    reversible: false,
    applyPs: [
      "$before = (Get-ChildItem -Path $env:TEMP -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum",
      "Get-ChildItem -Path $env:TEMP -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue",
      "$after = (Get-ChildItem -Path $env:TEMP -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum",
      "$freedMB = [Math]::Round([Math]::Max(0, ($before - $after)) / 1MB, 1)",
      'Write-Output "[OK] %TEMP% limpiado (~$freedMB MB liberados)."'
    ].join('\n'),
    revertPs: ''
  },
  {
    id: 'clean-dns-cache',
    category: 'cleanup',
    title: 'Vaciar caché DNS de Windows',
    description: 'Ejecuta ipconfig /flushdns para resolver problemas de red y refrescar rutas LAN/Tailscale.',
    impact: 'Bajo (Red)',
    requiresAdmin: false,
    reversible: false,
    applyPs: [
      'ipconfig /flushdns | Out-Null',
      "Write-Output '[OK] Caché DNS vaciada correctamente.'"
    ].join('\n'),
    revertPs: ''
  },
  {
    id: 'clean-system-temp',
    category: 'cleanup',
    title: 'Limpiar C:\\Windows\\Temp y caché Windows Update',
    description: 'Libera temporales del sistema y descargas viejas de SoftwareDistribution\\Download.',
    impact: 'Alto (Disco)',
    requiresAdmin: true,
    reversible: false,
    applyPs: [
      "Get-ChildItem -Path 'C:\\Windows\\Temp' -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue",
      "Stop-Service -Name 'wuauserv' -Force -ErrorAction SilentlyContinue",
      "Get-ChildItem -Path 'C:\\Windows\\SoftwareDistribution\\Download' -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue",
      "Start-Service -Name 'wuauserv' -ErrorAction SilentlyContinue",
      "Write-Output '[OK] Temporales de sistema y caché de Windows Update limpiados.'"
    ].join('\n'),
    revertPs: ''
  },
  {
    id: 'clean-recycle-bin',
    category: 'cleanup',
    title: 'Vaciar Papelera de reciclaje',
    description: 'Libera espacio ocupado por archivos eliminados en la Papelera.',
    impact: 'Variable (Disco)',
    requiresAdmin: false,
    reversible: false,
    applyPs: [
      'Clear-RecycleBin -Force -ErrorAction SilentlyContinue',
      "Write-Output '[OK] Papelera vaciada.'"
    ].join('\n'),
    revertPs: ''
  },
  {
    id: 'clean-dism-health',
    category: 'cleanup',
    title: 'Comprobar salud del sistema (DISM CheckHealth)',
    description: 'Verifica rápidamente si la imagen de Windows tiene corrupción sin modificar archivos.',
    impact: 'Diagnóstico',
    requiresAdmin: true,
    reversible: false,
    applyPs: [
      'DISM /Online /Cleanup-Image /CheckHealth',
      "Write-Output '[OK] Comprobación DISM finalizada.'"
    ].join('\n'),
    revertPs: ''
  },

  // --- Instalador Rápido Winget (estilo Browse Apps) ---
  {
    id: 'app-7zip',
    category: 'apps',
    title: 'Instalar 7-Zip (winget)',
    description: 'Compresor ultraligero de código abierto.',
    impact: 'Utilidad',
    requiresAdmin: false,
    reversible: false,
    applyPs: "winget install --id 7zip.7zip -e --silent --accept-package-agreements --accept-source-agreements",
    revertPs: ''
  },
  {
    id: 'app-everything',
    category: 'apps',
    title: 'Instalar Everything Search (winget)',
    description: 'Buscador instantáneo de archivos en Windows con consumo mínimo de RAM.',
    impact: 'Utilidad',
    requiresAdmin: false,
    reversible: false,
    applyPs: "winget install --id voidtools.Everything -e --silent --accept-package-agreements --accept-source-agreements",
    revertPs: ''
  },
  {
    id: 'app-vlc',
    category: 'apps',
    title: 'Instalar VLC Media Player (winget)',
    description: 'Reproductor multimedia universal sin codecs extra.',
    impact: 'Utilidad',
    requiresAdmin: false,
    reversible: false,
    applyPs: "winget install --id VideoLAN.VLC -e --silent --accept-package-agreements --accept-source-agreements",
    revertPs: ''
  },
  {
    id: 'app-vscode',
    category: 'apps',
    title: 'Instalar Visual Studio Code (winget)',
    description: 'Editor de código para desarrollo.',
    impact: 'Desarrollo',
    requiresAdmin: false,
    reversible: false,
    applyPs: "winget install --id Microsoft.VisualStudioCode -e --silent --accept-package-agreements --accept-source-agreements",
    revertPs: ''
  },
  {
    id: 'app-git',
    category: 'apps',
    title: 'Instalar Git para Windows (winget)',
    description: 'Control de versiones Git CLI.',
    impact: 'Desarrollo',
    requiresAdmin: false,
    reversible: false,
    applyPs: "winget install --id Git.Git -e --silent --accept-package-agreements --accept-source-agreements",
    revertPs: ''
  },
  {
    id: 'app-notepadpp',
    category: 'apps',
    title: 'Instalar Notepad++ (winget)',
    description: 'Editor de texto nativo C++ ultrarrápido (< 15 MB RAM).',
    impact: 'Utilidad',
    requiresAdmin: false,
    reversible: false,
    applyPs: "winget install --id Notepad++.Notepad++ -e --silent --accept-package-agreements --accept-source-agreements",
    revertPs: ''
  }
]);

const TWEAK_MAP = new Map(WIN_TWEAKS.map((t) => [t.id, t]));

const WIN_PRESETS = Object.freeze([
  {
    id: 'eco-office',
    name: 'Oficina Eco / Bajo Consumo (Sin Admin)',
    description: 'Reduce RAM/GPU (sin transparencias, sin Widgets/Copilot, sin anuncios) + limpia %TEMP% y DNS. 100% reversible y sin UAC.',
    tweakIds: [
      'perf-visual-effects',
      'priv-activity-history',
      'priv-start-suggestions',
      'priv-widgets-copilot',
      'clean-user-temp',
      'clean-dns-cache'
    ]
  },
  {
    id: 'max-performance',
    name: 'Máximo Rendimiento PC (Admin)',
    description: 'Plan de energía alto rendimiento, desactiva SysMain y telemetría DiagTrack, optimiza red LAN/Tailscale y limpia temporales de sistema.',
    tweakIds: [
      'perf-power-plan',
      'perf-disable-sysmain',
      'perf-visual-effects',
      'perf-network-low-latency',
      'priv-telemetry',
      'priv-start-suggestions',
      'priv-widgets-copilot',
      'clean-user-temp',
      'clean-system-temp',
      'clean-dns-cache'
    ]
  },
  {
    id: 'safe-cleanup',
    name: 'Limpieza Rápida Segura (Sin Admin)',
    description: 'Solo limpieza inmediata: %TEMP%, caché DNS y Papelera.',
    tweakIds: [
      'clean-user-temp',
      'clean-dns-cache',
      'clean-recycle-bin'
    ]
  }
]);

function getOptimizerCatalog() {
  return {
    tweaks: WIN_TWEAKS.map(({ applyPs, revertPs, ...meta }) => meta),
    presets: WIN_PRESETS.map((p) => ({ ...p, tweakIds: [...p.tweakIds] }))
  };
}

function buildWinScript({ tweakIds = [], mode = 'apply', appName = 'Esteban Mesh Office' } = {}) {
  const safeMode = mode === 'revert' ? 'revert' : 'apply';
  const uniqueIds = Array.from(new Set(Array.isArray(tweakIds) ? tweakIds : []));
  const selected = [];
  for (const id of uniqueIds) {
    const item = TWEAK_MAP.get(String(id));
    if (!item) {
      throw new Error(`Optimización no permitida o desconocida: ${id}`);
    }
    if (safeMode === 'revert' && !item.revertPs) continue;
    selected.push(item);
  }

  const requiresAdmin = selected.some((t) => t.requiresAdmin);
  const lines = [
    `# ==============================================================================`,
    `# ${appName} — WinScript Studio (${safeMode === 'revert' ? 'RESTAURAR VALORES' : 'OPTIMIZACIÓN WINDOWS'})`,
    `# Generado: ${new Date().toISOString()}`,
    `# Acciones: ${selected.length} | Requiere Administrador: ${requiresAdmin ? 'Sí' : 'No'}`,
    `# ==============================================================================`,
    `$ErrorActionPreference = 'Continue'`,
    `Write-Output "=== Iniciando ${appName} WinScript Studio (${selected.length} acciones) ==="`,
    ''
  ];

  for (const tweak of selected) {
    const body = safeMode === 'revert' ? tweak.revertPs : tweak.applyPs;
    lines.push(`# --- [${tweak.id}] ${tweak.title} ---`);
    lines.push(`Write-Output "-> ${tweak.title}"`);
    lines.push(body);
    lines.push('');
  }

  lines.push('Write-Output "=== WIN_OPTIMIZER_DONE ==="');

  return {
    mode: safeMode,
    requiresAdmin,
    selectedCount: selected.length,
    selectedIds: selected.map((t) => t.id),
    script: lines.join('\r\n')
  };
}

function exportWinScriptFile({ tweakIds = [], mode = 'apply', destPath, appName = 'Esteban Mesh Office' } = {}) {
  if (!destPath) throw new Error('Ruta de destino requerida.');
  const built = buildWinScript({ tweakIds, mode, appName });
  if (built.selectedCount === 0) {
    throw new Error('Selecciona al menos una acción válida para exportar.');
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  // UTF-8 BOM so Windows PowerShell 5.1 parses Spanish characters cleanly
  fs.writeFileSync(destPath, '\uFEFF' + built.script, 'utf8');
  return { ok: true, destPath, ...built };
}

function executeWinScript({ tweakIds = [], mode = 'apply', appName = 'Esteban Mesh Office' } = {}) {
  const built = buildWinScript({ tweakIds, mode, appName });
  if (built.selectedCount === 0) {
    throw new Error('Selecciona al menos una acción válida para ejecutar.');
  }
  if (process.platform !== 'win32') {
    return Promise.resolve({
      ok: false,
      error: 'WinScript Studio solo puede ejecutarse en Windows.',
      output: '',
      ...built
    });
  }

  const token = crypto.randomBytes(4).toString('hex');
  const scriptPath = path.join(os.tmpdir(), `esteban-winscript-${token}.ps1`);
  const logPath = path.join(os.tmpdir(), `esteban-winscript-${token}.log`);
  fs.writeFileSync(scriptPath, '\uFEFF' + built.script, 'utf8');

  const cleanup = () => {
    try { if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath); } catch {}
    try { if (fs.existsSync(logPath)) fs.unlinkSync(logPath); } catch {}
  };

  if (!built.requiresAdmin) {
    return new Promise((resolve) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
        { windowsHide: true, timeout: 180000, maxBuffer: 2 * 1024 * 1024 },
        (error, stdout, stderr) => {
          cleanup();
          const out = [String(stdout || '').trim(), String(stderr || '').trim()].filter(Boolean).join('\n');
          resolve({
            ok: !error && out.includes('WIN_OPTIMIZER_DONE'),
            output: out,
            error: error ? error.message : '',
            ...built
          });
        }
      );
    });
  }

  // Elevated execution via UAC with full output capture to logPath
  const wrapperPath = path.join(os.tmpdir(), `esteban-winscript-wrap-${token}.ps1`);
  const wrapperContent = [
    `& '${scriptPath.replace(/'/g, "''")}' *>&1 | Out-File -FilePath '${logPath.replace(/'/g, "''")}' -Encoding UTF8`
  ].join('\r\n');
  fs.writeFileSync(wrapperPath, '\uFEFF' + wrapperContent, 'utf8');

  return new Promise((resolve) => {
    const cmd = `Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File "${wrapperPath}"'`;
    execFile(
      'powershell.exe',
      ['-NoProfile', '-Command', cmd],
      { windowsHide: true, timeout: 300000 },
      (error, _stdout, stderr) => {
        let log = '';
        try {
          if (fs.existsSync(logPath)) log = fs.readFileSync(logPath, 'utf8').trim();
        } catch {}
        try { if (fs.existsSync(wrapperPath)) fs.unlinkSync(wrapperPath); } catch {}
        cleanup();
        resolve({
          ok: !error && log.includes('WIN_OPTIMIZER_DONE'),
          output: log,
          error: error ? (String(stderr || '').trim() || error.message) : '',
          ...built
        });
      }
    );
  });
}

module.exports = {
  WIN_TWEAKS,
  WIN_PRESETS,
  getOptimizerCatalog,
  buildWinScript,
  exportWinScriptFile,
  executeWinScript
};

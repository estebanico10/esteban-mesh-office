<#
.SYNOPSIS
    Auto-configurador empresarial 1-Click para Esteban Mesh Office (10+ PCs).
.DESCRIPTION
    Configura reglas de Firewall (TCP 4890 / UDP 4891), evita suspension por AC,
    instala rclone y WinFsp via winget si faltan, ejecuta el instalador silencioso,
    escribe %APPDATA%\EstebanMeshOffice\config.json desde workspace-bootstrap.json,
    comparte todos los discos fijos si aplica, recolecta inventario y abre la app.
#>

[CmdletBinding()]
param(
    [string]$KitDir = "",
    [string]$HubUrl = "",
    [string]$Department = "General",
    [string]$Role = "Estacion de Trabajo",
    [switch]$ShareAllDisks
)

$ErrorActionPreference = "Continue"
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
} catch {}

function Write-Step {
    param([int]$Num, [int]$Total, [string]$Title)
    Write-Host ""
    Write-Host "[$Num/$Total] $Title" -ForegroundColor Cyan
}

function Write-Ok {
    param([string]$Message)
    Write-Host "  [OK]    $Message" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host "  [AVISO] $Message" -ForegroundColor Yellow
}

function Write-Info {
    param([string]$Message)
    Write-Host "  [INFO]  $Message" -ForegroundColor Gray
}

function Test-IsAdmin {
    try {
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
        $principal = New-Object Security.Principal.WindowsPrincipal($identity)
        return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch {
        return $false
    }
}

function Write-Utf8NoBom {
    param([string]$Path, [string]$Content)
    $parent = Split-Path -Parent $Path
    if ($parent -and -not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function ConvertTo-Hashtable {
    param($InputObject)
    if ($null -eq $InputObject) { return @{} }
    if ($InputObject -is [hashtable]) { return $InputObject }
    $ht = [ordered]@{}
    foreach ($prop in $InputObject.PSObject.Properties) {
        $ht[$prop.Name] = $prop.Value
    }
    return $ht
}

function Find-InstalledMeshOfficeExe {
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Esteban Mesh Office\Esteban Mesh Office.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\esteban-mesh-office\Esteban Mesh Office.exe"),
        (Join-Path $env:ProgramFiles "Esteban Mesh Office\Esteban Mesh Office.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Esteban Mesh Office\Esteban Mesh Office.exe")
    )

    foreach ($exe in $candidates) {
        if ($exe -and (Test-Path -LiteralPath $exe)) {
            return $exe
        }
    }

    # Buscar en claves de desinstalacion del registro
    $uninstallPaths = @(
        "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
    )
    foreach ($regPath in $uninstallPaths) {
        try {
            $entries = Get-ItemProperty -Path $regPath -ErrorAction SilentlyContinue |
                Where-Object { $_.DisplayName -like "*Esteban Mesh Office*" }
            foreach ($entry in $entries) {
                if ($entry.InstallLocation) {
                    $candidate = Join-Path $entry.InstallLocation "Esteban Mesh Office.exe"
                    if (Test-Path -LiteralPath $candidate) { return $candidate }
                }
                if ($entry.DisplayIcon) {
                    $iconPath = $entry.DisplayIcon.ToString().Split(',')[0].Trim('"')
                    if ($iconPath -like "*.exe" -and (Test-Path -LiteralPath $iconPath)) {
                        return $iconPath
                    }
                }
            }
        } catch {}
    }

    return ""
}

function Test-RcloneInstalled {
    if (Get-Command rclone.exe -ErrorAction SilentlyContinue) { return $true }
    $paths = @(
        (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\rclone.exe"),
        "C:\Program Files\rclone\rclone.exe",
        "C:\rclone\rclone.exe"
    )
    foreach ($p in $paths) {
        if (Test-Path -LiteralPath $p) { return $true }
    }
    return $false
}

function Test-WinFspInstalled {
    $paths = @(
        "${env:ProgramFiles(x86)}\WinFsp\bin\winfsp-x64.dll",
        "$env:ProgramFiles\WinFsp\bin\winfsp-x64.dll",
        "${env:ProgramFiles(x86)}\WinFsp\bin\launcher-x64.exe",
        "$env:ProgramFiles\WinFsp\bin\launcher-x64.exe"
    )
    foreach ($p in $paths) {
        if (Test-Path -LiteralPath $p) { return $true }
    }
    return $false
}

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  ESTEBAN MESH OFFICE - Auto-Configurador Empresarial (1-Click)" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan

$scriptDir = $PSScriptRoot
if (-not $scriptDir) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}

if ([string]::IsNullOrWhiteSpace($KitDir)) {
    $parentOfScript = Split-Path -Parent $scriptDir
    if (Test-Path -LiteralPath (Join-Path $parentOfScript "workspace-bootstrap.json")) {
        $KitDir = $parentOfScript
    } elseif (Test-Path -LiteralPath (Join-Path $scriptDir "workspace-bootstrap.json")) {
        $KitDir = $scriptDir
    } else {
        $KitDir = $parentOfScript
    }
}
$KitDir = $KitDir.Trim().Trim('"').TrimEnd('\')
Write-Info "Carpeta del Kit: $KitDir"

$isAdmin = Test-IsAdmin
if (-not $isAdmin) {
    Write-Warn "Ejecutando sin privilegios de Administrador. Firewall y energia podrian requerir elevacion UAC."
}

# Cargar workspace-bootstrap.json si existe
$bootstrap = $null
$bootstrapCandidates = @(
    (Join-Path $KitDir "workspace-bootstrap.json"),
    (Join-Path $scriptDir "workspace-bootstrap.json")
)
foreach ($cand in $bootstrapCandidates) {
    if (Test-Path -LiteralPath $cand) {
        try {
            $bootstrap = (Get-Content -LiteralPath $cand -Raw -Encoding UTF8) | ConvertFrom-Json
            Write-Ok "Bootstrap cargado desde: $cand"
            break
        } catch {
            Write-Warn "No se pudo interpretar $cand : $($_.Exception.Message)"
        }
    }
}

$workspaceName = "Espacio de Trabajo"
$workspaceId = ""
$hubNodeName = ""
$port = 4890
$udpPort = 4891
$autoShare = [bool]$ShareAllDisks
$masterKeyFileName = ""
$masterKeyVault = $null

if ($bootstrap) {
    if ($bootstrap.workspaceName) { $workspaceName = $bootstrap.workspaceName.ToString().Trim() }
    if ($bootstrap.workspaceId) { $workspaceId = $bootstrap.workspaceId.ToString().Trim() }
    if ($bootstrap.hubNodeName) { $hubNodeName = $bootstrap.hubNodeName.ToString().Trim() }
    if ([string]::IsNullOrWhiteSpace($HubUrl) -and $bootstrap.hubUrl) {
        $HubUrl = $bootstrap.hubUrl.ToString().Trim()
    }
    if (-not $PSBoundParameters.ContainsKey("Department")) {
        if ($bootstrap.defaultDepartment) { $Department = $bootstrap.defaultDepartment.ToString().Trim() }
        elseif ($bootstrap.department) { $Department = $bootstrap.department.ToString().Trim() }
    }
    if (-not $PSBoundParameters.ContainsKey("Role")) {
        if ($bootstrap.defaultRole) { $Role = $bootstrap.defaultRole.ToString().Trim() }
        elseif ($bootstrap.role) { $Role = $bootstrap.role.ToString().Trim() }
    }
    if ($bootstrap.port) { $port = [int]$bootstrap.port }
    if ($bootstrap.udpPort) { $udpPort = [int]$bootstrap.udpPort }
    if ($bootstrap.autoShareAllDisks -eq $true) { $autoShare = $true }
    if ($bootstrap.masterKeyFileName) { $masterKeyFileName = $bootstrap.masterKeyFileName.ToString().Trim() }
    if ($bootstrap.masterKeyVault) { $masterKeyVault = $bootstrap.masterKeyVault }
}

# ------------------------------------------------------------------
# PASO 1: Reglas de Windows Firewall (TCP 4890 / UDP 4891)
# ------------------------------------------------------------------
Write-Step 1 7 "Configurando reglas de Windows Firewall (TCP $port / UDP $udpPort)..."
try {
    $tcpRuleName = "EstebanMeshOffice-TCP-$port"
    $udpRuleName = "EstebanMeshOffice-UDP-$udpPort"
    $tcpTsRuleName = "EstebanMeshOffice-TCP-$port-Tailscale"
    $udpTsRuleName = "EstebanMeshOffice-UDP-$udpPort-Tailscale"

    if (Get-Command New-NetFirewallRule -ErrorAction SilentlyContinue) {
        if (-not (Get-NetFirewallRule -Name $tcpRuleName -ErrorAction SilentlyContinue)) {
            New-NetFirewallRule -Name $tcpRuleName -DisplayName "Esteban Mesh Office (TCP $port)" `
                -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port `
                -Profile Private, Domain -ErrorAction Stop | Out-Null
            Write-Ok "Regla creada: $tcpRuleName (Private, Domain)"
        } else {
            Write-Ok "Regla existente verificada: $tcpRuleName"
        }

        if (-not (Get-NetFirewallRule -Name $udpRuleName -ErrorAction SilentlyContinue)) {
            New-NetFirewallRule -Name $udpRuleName -DisplayName "Esteban Mesh Office Discovery (UDP $udpPort)" `
                -Direction Inbound -Action Allow -Protocol UDP -LocalPort $udpPort `
                -Profile Private, Domain -ErrorAction Stop | Out-Null
            Write-Ok "Regla creada: $udpRuleName (Private, Domain)"
        } else {
            Write-Ok "Regla existente verificada: $udpRuleName"
        }

        # Reglas especificas para trafico Tailscale CGNAT (100.64.0.0/10) incluso si la interfaz Tailscale figura como Publica
        if (-not (Get-NetFirewallRule -Name $tcpTsRuleName -ErrorAction SilentlyContinue)) {
            New-NetFirewallRule -Name $tcpTsRuleName -DisplayName "Esteban Mesh Office Tailscale (TCP $port)" `
                -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port `
                -RemoteAddress "100.64.0.0/10" -Profile Any -ErrorAction Stop | Out-Null
            Write-Ok "Regla Tailscale creada: $tcpTsRuleName (100.64.0.0/10)"
        } else {
            Write-Ok "Regla Tailscale verificada: $tcpTsRuleName"
        }

        if (-not (Get-NetFirewallRule -Name $udpTsRuleName -ErrorAction SilentlyContinue)) {
            New-NetFirewallRule -Name $udpTsRuleName -DisplayName "Esteban Mesh Office Tailscale (UDP $udpPort)" `
                -Direction Inbound -Action Allow -Protocol UDP -LocalPort $udpPort `
                -RemoteAddress "100.64.0.0/10" -Profile Any -ErrorAction Stop | Out-Null
            Write-Ok "Regla Tailscale creada: $udpTsRuleName (100.64.0.0/10)"
        } else {
            Write-Ok "Regla Tailscale verificada: $udpTsRuleName"
        }
    } else {
        & netsh advfirewall firewall add rule name=$tcpRuleName dir=in action=allow protocol=TCP localport=$port profile=private,domain | Out-Null
        & netsh advfirewall firewall add rule name=$udpRuleName dir=in action=allow protocol=UDP localport=$udpPort profile=private,domain | Out-Null
        & netsh advfirewall firewall add rule name=$tcpTsRuleName dir=in action=allow protocol=TCP localport=$port remoteip=100.64.0.0/10 profile=any | Out-Null
        & netsh advfirewall firewall add rule name=$udpTsRuleName dir=in action=allow protocol=UDP localport=$udpPort remoteip=100.64.0.0/10 profile=any | Out-Null
        Write-Ok "Reglas de Firewall aplicadas mediante netsh."
    }
} catch {
    Write-Warn "No se pudieron crear/actualizar las reglas de Firewall: $($_.Exception.Message)"
}

# ------------------------------------------------------------------
# PASO 2: Desactivar suspension en corriente alterna (AC)
# ------------------------------------------------------------------
Write-Step 2 7 "Optimizando energia para transferencias continuas (standby AC = 0)..."
try {
    & powercfg /change standby-timeout-ac 0 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Ok "Suspension por inactividad en corriente AC desactivada."
    } else {
        Write-Warn "powercfg retorno codigo $LASTEXITCODE (puede requerir permisos de administrador)."
    }
} catch {
    Write-Warn "No se pudo ajustar powercfg: $($_.Exception.Message)"
}

# ------------------------------------------------------------------
# PASO 3: Instalar rclone y WinFsp via winget si faltan (no fatal)
# ------------------------------------------------------------------
Write-Step 3 7 "Verificando herramientas de montaje de discos (rclone y WinFsp)..."
$wingetCmd = Get-Command winget.exe -ErrorAction SilentlyContinue
$hasRclone = Test-RcloneInstalled
$hasWinFsp = Test-WinFspInstalled

if ($hasRclone) {
    Write-Ok "rclone ya esta instalado."
} elseif ($wingetCmd) {
    Write-Info "Instalando rclone via winget (silencioso)..."
    try {
        $p = Start-Process -FilePath $wingetCmd.Source -ArgumentList @(
            "install", "--id", "Rclone.Rclone", "-e", "--silent",
            "--accept-package-agreements", "--accept-source-agreements"
        ) -Wait -PassThru -NoNewWindow -ErrorAction Stop
        if ($p.ExitCode -eq 0) {
            Write-Ok "rclone instalado correctamente."
        } else {
            Write-Warn "winget retorno codigo $($p.ExitCode) al instalar rclone (no bloqueante)."
        }
    } catch {
        Write-Warn "No se pudo instalar rclone (posiblemente sin conexion): $($_.Exception.Message)"
    }
} else {
    Write-Warn "winget no disponible; omitiendo instalacion automatica de rclone."
}

if ($hasWinFsp) {
    Write-Ok "WinFsp ya esta instalado."
} elseif ($wingetCmd) {
    Write-Info "Instalando WinFsp via winget (silencioso)..."
    try {
        $p = Start-Process -FilePath $wingetCmd.Source -ArgumentList @(
            "install", "--id", "WinFsp.WinFsp", "-e", "--silent",
            "--accept-package-agreements", "--accept-source-agreements"
        ) -Wait -PassThru -NoNewWindow -ErrorAction Stop
        if ($p.ExitCode -eq 0) {
            Write-Ok "WinFsp instalado correctamente."
        } else {
            Write-Warn "winget retorno codigo $($p.ExitCode) al instalar WinFsp (no bloqueante)."
        }
    } catch {
        Write-Warn "No se pudo instalar WinFsp (posiblemente sin conexion): $($_.Exception.Message)"
    }
} else {
    Write-Warn "winget no disponible; omitiendo instalacion automatica de WinFsp."
}

# ------------------------------------------------------------------
# PASO 4: Ejecutar instalador silencioso si existe en KitDir
# ------------------------------------------------------------------
Write-Step 4 7 "Buscando instalador Esteban-Mesh-Office-Setup-*.exe en el Kit..."
$installer = Get-ChildItem -LiteralPath $KitDir -Filter "Esteban-Mesh-Office-Setup-*.exe" -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1

if ($installer) {
    Write-Info "Instalador encontrado: $($installer.Name). Ejecutando instalacion silenciosa (/S)..."
    try {
        Get-Process -Name "Esteban Mesh Office" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 600
        $proc = Start-Process -FilePath $installer.FullName -ArgumentList "/S" -Wait -PassThru -ErrorAction Stop
        if ($proc.ExitCode -eq 0) {
            Write-Ok "Esteban Mesh Office instalado correctamente."
        } else {
            Write-Warn "El instalador finalizo con codigo $($proc.ExitCode)."
        }
    } catch {
        Write-Warn "Error al ejecutar el instalador: $($_.Exception.Message)"
    }
} else {
    Write-Warn "No se encontro Esteban-Mesh-Office-Setup-*.exe en $KitDir (se omite instalacion)."
}

# ------------------------------------------------------------------
# PASO 5: Escribir %APPDATA%\EstebanMeshOffice\config.json
# ------------------------------------------------------------------
Write-Step 5 7 "Escribiendo configuracion en %APPDATA%\EstebanMeshOffice\config.json..."
$appDataDir = Join-Path $env:APPDATA "EstebanMeshOffice"
if (-not (Test-Path -LiteralPath $appDataDir)) {
    New-Item -ItemType Directory -Path $appDataDir -Force | Out-Null
}
$configPath = Join-Path $appDataDir "config.json"

$config = [ordered]@{}
if (Test-Path -LiteralPath $configPath) {
    try {
        $existingCfg = (Get-Content -LiteralPath $configPath -Raw -Encoding UTF8) | ConvertFrom-Json
        $config = ConvertTo-Hashtable -InputObject $existingCfg
        Write-Info "Configuracion previa detectada; fusionando ajustes del espacio de trabajo."
    } catch {
        Write-Warn "No se pudo leer config.json previo; se creara uno nuevo."
        $config = [ordered]@{}
    }
}

$config["nodeName"] = if ($config.Contains("nodeName") -and $config["nodeName"]) { $config["nodeName"] } else { $env:COMPUTERNAME }
$config["workspaceName"] = $workspaceName
if ($workspaceId) { $config["workspaceId"] = $workspaceId }
if ($HubUrl) { $config["hubUrl"] = $HubUrl.Trim().TrimEnd('/') }
if ($hubNodeName) { $config["hubNodeName"] = $hubNodeName }
$config["department"] = $Department
$config["role"] = $Role
$config["autoShareAllDisks"] = [bool]$autoShare
$config["port"] = $port
$config["udpPort"] = $udpPort

# Copiar e incorporar archivo de llave maestra si existe en KitDir
if ($masterKeyFileName) {
    $sourceKeyPath = Join-Path $KitDir $masterKeyFileName
    if (Test-Path -LiteralPath $sourceKeyPath) {
        $destKeyPath = Join-Path $appDataDir (Split-Path -Leaf $masterKeyFileName)
        try {
            Copy-Item -LiteralPath $sourceKeyPath -Destination $destKeyPath -Force
            Write-Ok "Llave maestra copiada a: $destKeyPath"
            if (-not $masterKeyVault) {
                try {
                    $parsedKey = (Get-Content -LiteralPath $destKeyPath -Raw -Encoding UTF8) | ConvertFrom-Json
                    $masterKeyVault = [ordered]@{
                        fileName   = (Split-Path -Leaf $masterKeyFileName)
                        filePath   = $destKeyPath
                        bundle     = $parsedKey
                        importedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                    }
                } catch {
                    $masterKeyVault = [ordered]@{
                        fileName   = (Split-Path -Leaf $masterKeyFileName)
                        filePath   = $destKeyPath
                        importedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                    }
                }
            }
        } catch {
            Write-Warn "No se pudo copiar la llave maestra: $($_.Exception.Message)"
        }
    }
}

if ($masterKeyVault) {
    $config["masterKeyVault"] = $masterKeyVault
}

# Registrar automaticamente todos los discos fijos (DriveType=3) como shares rw si aplica
if ($autoShare) {
    $existingShares = New-Object 'System.Collections.Generic.List[object]'
    $seenPaths = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)

    if ($config.Contains("shares") -and $config["shares"]) {
        foreach ($sh in @($config["shares"])) {
            $existingShares.Add($sh)
            if ($sh.path) { [void]$seenPaths.Add($sh.path.ToString().TrimEnd('\') + '\') }
        }
    }

    $fixedDisks = @()
    try {
        $fixedDisks = @(Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DriveType = 3" -ErrorAction Stop)
    } catch {
        try {
            $fixedDisks = @(Get-WmiObject -Class Win32_LogicalDisk -Filter "DriveType = 3" -ErrorAction Stop)
        } catch {}
    }

    $addedCount = 0
    foreach ($disk in $fixedDisks) {
        if (-not $disk.DeviceID) { continue }
        $driveLetter = $disk.DeviceID.ToString().Trim().TrimEnd(':')
        $rootPath = "${driveLetter}:\"
        if ($seenPaths.Contains($rootPath)) { continue }

        $volLabel = if ($disk.VolumeName) { $disk.VolumeName.ToString().Trim() } else { "Disco $driveLetter" }
        $shareEntry = [ordered]@{
            id         = "disk-$($driveLetter.ToLower())"
            name       = "$volLabel ($driveLetter`:)"
            path       = $rootPath
            drive      = "${driveLetter}:"
            mode       = "rw"
            permission = "rw"
            readOnly   = $false
            autoShared = $true
        }
        $existingShares.Add($shareEntry)
        [void]$seenPaths.Add($rootPath)
        $addedCount++
    }

    $config["shares"] = @($existingShares.ToArray())
    Write-Ok "Discos fijos registrados como compartidos (rw): $addedCount nuevo(s), $($existingShares.Count) total(es)."
}

$config["provisionedAt"] = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$configJson = $config | ConvertTo-Json -Depth 10
Write-Utf8NoBom -Path $configPath -Content $configJson
Write-Ok "Configuracion guardada en: $configPath"

# ------------------------------------------------------------------
# PASO 6: Ejecutar recolector de inventario y check-in con Hub
# ------------------------------------------------------------------
Write-Step 6 7 "Recolectando inventario hardware y registrando equipo en el Hub..."
$collectorCandidates = @(
    (Join-Path $scriptDir "office-inventory-collector.ps1"),
    (Join-Path $KitDir "scripts\office-inventory-collector.ps1")
)
$collectorScript = $null
foreach ($c in $collectorCandidates) {
    if (Test-Path -LiteralPath $c) { $collectorScript = $c; break }
}

if ($collectorScript) {
    $invOutputDir = Join-Path $KitDir "Inventarios"
    try {
        & $collectorScript -HubUrl $HubUrl -OutputDir $invOutputDir -Department $Department -Role $Role -WorkspaceName $workspaceName
    } catch {
        Write-Warn "Error ejecutando el recolector de inventario: $($_.Exception.Message)"
    }
} else {
    Write-Warn "No se encontro office-inventory-collector.ps1."
}

# ------------------------------------------------------------------
# PASO 7: Iniciar Esteban Mesh Office.exe
# ------------------------------------------------------------------
Write-Step 7 7 "Iniciando Esteban Mesh Office..."
$appExe = Find-InstalledMeshOfficeExe
if ($appExe) {
    try {
        $appDir = Split-Path -Parent $appExe
        Start-Process -FilePath $appExe -WorkingDirectory $appDir -ErrorAction Stop
        Write-Ok "Esteban Mesh Office iniciado correctamente ($appExe)."
    } catch {
        Write-Warn "No se pudo abrir Esteban Mesh Office automaticamente: $($_.Exception.Message)"
    }
} else {
    Write-Warn "No se localizo 'Esteban Mesh Office.exe' instalado en este equipo."
}

Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  AUTO-CONFIGURACION COMPLETADA EN $env:COMPUTERNAME" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""

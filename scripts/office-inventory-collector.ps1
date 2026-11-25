<#
.SYNOPSIS
    Recolector de inventario hardware/software sin instalacion para Esteban Mesh Office.
.DESCRIPTION
    Funciona en cualquier PC Windows 10/11 sin dependencias externas.
    Recolecta hardware, discos, red (LAN/MAC/Tailscale) y aplicaciones instaladas,
    guarda el JSON individual, actualiza Resumen-Flota.csv y opcionalmente reporta
    al Hub central mediante POST /api/fleet/checkin.
#>

[CmdletBinding()]
param(
    [string]$HubUrl = "",
    [string]$OutputDir = "",
    [string]$Department = "General",
    [string]$Role = "Estacion de Trabajo",
    [string]$WorkspaceName = "Espacio de Trabajo"
)

$ErrorActionPreference = "Continue"
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
} catch {}

function Write-Info {
    param([string]$Message)
    Write-Host "[INFO]  $Message" -ForegroundColor Cyan
}

function Write-Ok {
    param([string]$Message)
    Write-Host "[OK]    $Message" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host "[AVISO] $Message" -ForegroundColor Yellow
}

function Write-Err {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Get-CimSafe {
    param(
        [string]$ClassName,
        [string]$Filter = ""
    )
    try {
        if ($Filter) {
            return Get-CimInstance -ClassName $ClassName -Filter $Filter -ErrorAction Stop
        }
        return Get-CimInstance -ClassName $ClassName -ErrorAction Stop
    } catch {
        try {
            if ($Filter) {
                return Get-WmiObject -Class $ClassName -Filter $Filter -ErrorAction Stop
            }
            return Get-WmiObject -Class $ClassName -ErrorAction Stop
        } catch {
            return $null
        }
    }
}

function Write-Utf8NoBom {
    param(
        [string]$Path,
        [string]$Content
    )
    $parent = Split-Path -Parent $Path
    if ($parent -and -not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Get-TailscaleIpAddress {
    param([string[]]$AllIpv4Addresses)

    # 1. Intentar CLI de Tailscale si esta disponible
    $tsCandidates = @(
        "tailscale.exe",
        "$env:ProgramFiles\Tailscale\tailscale.exe",
        "${env:ProgramFiles(x86)}\Tailscale\tailscale.exe"
    )
    $tsExe = $null
    foreach ($candidate in $tsCandidates) {
        if ($candidate -eq "tailscale.exe") {
            $cmd = Get-Command tailscale.exe -ErrorAction SilentlyContinue
            if ($cmd) { $tsExe = $cmd.Source; break }
        } elseif (Test-Path -LiteralPath $candidate) {
            $tsExe = $candidate
            break
        }
    }

    if ($tsExe) {
        try {
            $rawIp = & $tsExe ip -4 2>$null
            if ($LASTEXITCODE -eq 0 -and $rawIp) {
                $firstLine = ($rawIp | Select-Object -First 1).ToString().Trim()
                if ($firstLine -match '^\d{1,3}(\.\d{1,3}){3}$') {
                    return $firstLine
                }
            }
        } catch {}

        try {
            $rawStatus = & $tsExe status --json 2>$null
            if ($LASTEXITCODE -eq 0 -and $rawStatus) {
                $parsed = ($rawStatus -join "`n") | ConvertFrom-Json
                if ($parsed -and $parsed.Self -and $parsed.Self.TailscaleIPs) {
                    foreach ($ip in $parsed.Self.TailscaleIPs) {
                        if ($ip -match '^\d{1,3}(\.\d{1,3}){3}$') {
                            return $ip
                        }
                    }
                }
            }
        } catch {}
    }

    # 2. Fallback: detectar rango CGNAT de Tailscale (100.64.0.0/10 -> 100.64.x.x - 100.127.x.x)
    foreach ($ip in $AllIpv4Addresses) {
        if ($ip -match '^100\.(\d+)\.\d+\.\d+$') {
            $secondOctet = [int]$Matches[1]
            if ($secondOctet -ge 64 -and $secondOctet -le 127) {
                return $ip
            }
        }
    }

    return ""
}

function Get-InstalledApplications {
    param([int]$MaxCount = 40)

    $regPaths = @(
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*"
    )

    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    $apps = New-Object 'System.Collections.Generic.List[string]'

    foreach ($regPath in $regPaths) {
        try {
            $items = Get-ItemProperty -Path $regPath -ErrorAction SilentlyContinue
            foreach ($item in $items) {
                if (-not $item.DisplayName) { continue }
                if ($item.SystemComponent -eq 1) { continue }
                if ($item.ReleaseType -eq "Update" -or $item.ReleaseType -eq "Hotfix") { continue }

                $name = $item.DisplayName.ToString().Trim()
                if ([string]::IsNullOrWhiteSpace($name)) { continue }
                if ($name -match '^(KB\d+|Update for |Security Update for |Hotfix for )') { continue }

                if ($seen.Add($name)) {
                    $apps.Add($name)
                }
            }
        } catch {}
    }

    $sorted = $apps | Sort-Object
    if ($sorted.Count -gt $MaxCount) {
        return @($sorted | Select-Object -First $MaxCount)
    }
    return @($sorted)
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  ESTEBAN MESH OFFICE - Recolector de Inventario de Flota" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# Resolver rutas base y cargar workspace-bootstrap.json si existe
$scriptDir = $PSScriptRoot
if (-not $scriptDir) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}
$parentDir = Split-Path -Parent $scriptDir

$bootstrapCandidates = @(
    (Join-Path $scriptDir "workspace-bootstrap.json"),
    (Join-Path $parentDir "workspace-bootstrap.json")
)

$bootstrap = $null
$bootstrapPath = ""
foreach ($candidate in $bootstrapCandidates) {
    if (Test-Path -LiteralPath $candidate) {
        try {
            $rawBootstrap = Get-Content -LiteralPath $candidate -Raw -Encoding UTF8
            $bootstrap = $rawBootstrap | ConvertFrom-Json
            $bootstrapPath = $candidate
            break
        } catch {
            Write-Warn "No se pudo leer $candidate : $($_.Exception.Message)"
        }
    }
}

if ($bootstrap) {
    Write-Info "Configuracion bootstrap detectada: $bootstrapPath"
    if ([string]::IsNullOrWhiteSpace($HubUrl) -and $bootstrap.hubUrl) {
        $HubUrl = $bootstrap.hubUrl.ToString().Trim()
    }
    if (-not $PSBoundParameters.ContainsKey("Department")) {
        if ($bootstrap.defaultDepartment) {
            $Department = $bootstrap.defaultDepartment.ToString().Trim()
        } elseif ($bootstrap.department) {
            $Department = $bootstrap.department.ToString().Trim()
        }
    }
    if (-not $PSBoundParameters.ContainsKey("Role")) {
        if ($bootstrap.defaultRole) {
            $Role = $bootstrap.defaultRole.ToString().Trim()
        } elseif ($bootstrap.role) {
            $Role = $bootstrap.role.ToString().Trim()
        }
    }
    if (-not $PSBoundParameters.ContainsKey("WorkspaceName") -and $bootstrap.workspaceName) {
        $WorkspaceName = $bootstrap.workspaceName.ToString().Trim()
    }
}

if ([string]::IsNullOrWhiteSpace($OutputDir)) {
    $OutputDir = Join-Path $parentDir "Inventarios"
}
$OutputDir = $OutputDir.Trim().Trim('"').TrimEnd('\')
if (-not (Test-Path -LiteralPath $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

Write-Info "Recolectando datos del sistema en $env:COMPUTERNAME..."

# Sistema Operativo y Uptime
$os = Get-CimSafe -ClassName "Win32_OperatingSystem" | Select-Object -First 1
$osCaption = if ($os -and $os.Caption) { $os.Caption.ToString().Trim() } else { [System.Environment]::OSVersion.VersionString }
$osBuild = if ($os -and $os.BuildNumber) { $os.BuildNumber.ToString().Trim() } else { [System.Environment]::OSVersion.Version.Build.ToString() }

$uptimeHours = 0.0
try {
    if ($os -and $os.LastBootUpTime) {
        $bootTime = $os.LastBootUpTime
        if ($bootTime -is [string]) {
            $bootTime = [System.Management.ManagementDateTimeConverter]::ToDateTime($bootTime)
        }
        $uptimeHours = [Math]::Round(((Get-Date) - $bootTime).TotalHours, 2)
    } else {
        $uptimeHours = [Math]::Round(([Environment]::TickCount64 / 3600000.0), 2)
    }
} catch {
    $uptimeHours = 0.0
}

# Hardware: Fabricante, Modelo, Numero de Serie
$cs = Get-CimSafe -ClassName "Win32_ComputerSystem" | Select-Object -First 1
$bios = Get-CimSafe -ClassName "Win32_BIOS" | Select-Object -First 1
$manufacturer = if ($cs -and $cs.Manufacturer) { $cs.Manufacturer.ToString().Trim() } else { "Desconocido" }
$model = if ($cs -and $cs.Model) { $cs.Model.ToString().Trim() } else { "Desconocido" }
$serialNumber = if ($bios -and $bios.SerialNumber) { $bios.SerialNumber.ToString().Trim() } else { "N/A" }

# CPU
$cpus = @(Get-CimSafe -ClassName "Win32_Processor")
$cpuModel = if ($cpus.Count -gt 0 -and $cpus[0].Name) {
    ($cpus[0].Name.ToString() -replace '\s+', ' ').Trim()
} else {
    "Desconocido"
}
$cpuCores = 0
foreach ($cpu in $cpus) {
    if ($cpu.NumberOfLogicalProcessors) {
        $cpuCores += [int]$cpu.NumberOfLogicalProcessors
    } elseif ($cpu.NumberOfCores) {
        $cpuCores += [int]$cpu.NumberOfCores
    }
}
if ($cpuCores -le 0) {
    $cpuCores = [int][Environment]::ProcessorCount
}

# RAM
$ramTotalGB = 0.0
$ramFreeGB = 0.0
$ramPercent = 0.0
try {
    if ($cs -and $cs.TotalPhysicalMemory) {
        $ramTotalGB = [Math]::Round(([double]$cs.TotalPhysicalMemory / 1GB), 2)
    } elseif ($os -and $os.TotalVisibleMemorySize) {
        $ramTotalGB = [Math]::Round(([double]$os.TotalVisibleMemorySize / 1MB), 2)
    }
    if ($os -and $os.FreePhysicalMemory) {
        $ramFreeGB = [Math]::Round(([double]$os.FreePhysicalMemory / 1MB), 2)
    }
    if ($ramTotalGB -gt 0) {
        $usedRam = [Math]::Max(0.0, ($ramTotalGB - $ramFreeGB))
        $ramPercent = [Math]::Round(($usedRam / $ramTotalGB) * 100.0, 1)
    }
} catch {}

# GPU
$gpus = @(Get-CimSafe -ClassName "Win32_VideoController")
$gpuNames = @()
foreach ($gpu in $gpus) {
    if ($gpu -and $gpu.Name) {
        $gName = $gpu.Name.ToString().Trim()
        if ($gName -and $gpuNames -notcontains $gName) {
            $gpuNames += $gName
        }
    }
}
$gpuModel = if ($gpuNames.Count -gt 0) { $gpuNames -join " + " } else { "Desconocida" }

# Red: IPs activas, MACs fisicas (Wake-on-LAN) y Tailscale IP
$allIpv4 = New-Object 'System.Collections.Generic.List[string]'
$lanIpsList = New-Object 'System.Collections.Generic.List[string]'
$macList = New-Object 'System.Collections.Generic.List[string]'

try {
    $netConfigs = @(Get-CimSafe -ClassName "Win32_NetworkAdapterConfiguration" -Filter "IPEnabled = TRUE")
    foreach ($nc in $netConfigs) {
        if ($nc.IPAddress) {
            foreach ($ip in $nc.IPAddress) {
                $ipStr = $ip.ToString().Trim()
                if ($ipStr -match '^\d{1,3}(\.\d{1,3}){3}$' -and $ipStr -notlike '127.*' -and $ipStr -notlike '169.254.*') {
                    if (-not $allIpv4.Contains($ipStr)) {
                        $allIpv4.Add($ipStr)
                    }
                }
            }
        }
    }
} catch {}

# Recopilar MACs de adaptadores fisicos para Wake-on-LAN
try {
    $physicalNics = @(Get-CimSafe -ClassName "Win32_NetworkAdapter" -Filter "PhysicalAdapter = TRUE")
    foreach ($nic in $physicalNics) {
        if (-not $nic.MACAddress) { continue }
        $desc = if ($nic.Description) { $nic.Description.ToString() } else { "" }
        if ($desc -match '(Virtual|Hyper-V|VMware|VirtualBox|Loopback|WAN Miniport|Bluetooth|Tailscale|WireGuard|TAP-|Wintun)') {
            continue
        }
        $mac = $nic.MACAddress.ToString().Trim().ToUpper()
        if ($mac -and -not $macList.Contains($mac)) {
            $macList.Add($mac)
        }
    }
} catch {}

if ($macList.Count -eq 0) {
    try {
        $fallbackConfigs = @(Get-CimSafe -ClassName "Win32_NetworkAdapterConfiguration" -Filter "IPEnabled = TRUE")
        foreach ($nc in $fallbackConfigs) {
            if ($nc.MACAddress) {
                $mac = $nc.MACAddress.ToString().Trim().ToUpper()
                if ($mac -and -not $macList.Contains($mac)) {
                    $macList.Add($mac)
                }
            }
        }
    } catch {}
}

$tailscaleIp = Get-TailscaleIpAddress -AllIpv4Addresses $allIpv4.ToArray()

foreach ($ip in $allIpv4) {
    if ($tailscaleIp -and $ip -eq $tailscaleIp) { continue }
    $isCgnat = $false
    if ($ip -match '^100\.(\d+)\.\d+\.\d+$') {
        $oct2 = [int]$Matches[1]
        if ($oct2 -ge 64 -and $oct2 -le 127) { $isCgnat = $true }
    }
    if (-not $isCgnat -and -not $lanIpsList.Contains($ip)) {
        $lanIpsList.Add($ip)
    }
}

# Discos (fijos: DriveType=3, removibles: DriveType=2)
$disksList = New-Object 'System.Collections.Generic.List[object]'
$rawDisks = @(Get-CimSafe -ClassName "Win32_LogicalDisk" -Filter "DriveType = 2 OR DriveType = 3")
foreach ($d in $rawDisks) {
    if (-not $d -or -not $d.DeviceID) { continue }
    $totalBytes = if ($d.Size) { [double]$d.Size } else { 0.0 }
    $freeBytes = if ($d.FreeSpace) { [double]$d.FreeSpace } else { 0.0 }
    if ($totalBytes -le 0) { continue }

    $totalGB = [Math]::Round($totalBytes / 1GB, 2)
    $freeGB = [Math]::Round($freeBytes / 1GB, 2)
    $usedGB = [Math]::Max(0.0, ($totalGB - $freeGB))
    $usedPercent = if ($totalGB -gt 0) { [Math]::Round(($usedGB / $totalGB) * 100.0, 1) } else { 0.0 }
    $dType = if ([int]$d.DriveType -eq 3) { "Fixed" } elseif ([int]$d.DriveType -eq 2) { "Removable" } else { "Other" }

    $disksList.Add([ordered]@{
        drive       = $d.DeviceID.ToString().Trim()
        label       = if ($d.VolumeName) { $d.VolumeName.ToString().Trim() } else { "" }
        fs          = if ($d.FileSystem) { $d.FileSystem.ToString().Trim() } else { "Unknown" }
        totalGB     = $totalGB
        freeGB      = $freeGB
        usedPercent = $usedPercent
        driveType   = $dType
    })
}

# Aplicaciones instaladas (hasta 40)
$topApps = @(Get-InstalledApplications -MaxCount 40)
$collectedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")

$inventory = [ordered]@{
    nodeName      = $env:COMPUTERNAME
    windowsUser   = $env:USERNAME
    department    = $Department
    role          = $Role
    workspaceName = $WorkspaceName
    osCaption     = $osCaption
    osBuild       = $osBuild
    manufacturer  = $manufacturer
    model         = $model
    serialNumber  = $serialNumber
    cpuModel      = $cpuModel
    cpuCores      = $cpuCores
    ramTotalGB    = $ramTotalGB
    ramFreeGB     = $ramFreeGB
    ramPercent    = $ramPercent
    gpuModel      = $gpuModel
    lanIps        = @($lanIpsList.ToArray())
    macAddresses  = @($macList.ToArray())
    tailscaleIp   = $tailscaleIp
    disks         = @($disksList.ToArray())
    topApps       = @($topApps)
    uptimeHours   = $uptimeHours
    collectedAt   = $collectedAt
}

# Guardar JSON individual
$jsonFileName = "Inventario-$($env:COMPUTERNAME).json"
$jsonPath = Join-Path $OutputDir $jsonFileName
$jsonContent = $inventory | ConvertTo-Json -Depth 6
Write-Utf8NoBom -Path $jsonPath -Content $jsonContent
Write-Ok "Inventario JSON guardado en: $jsonPath"

# Actualizar Resumen-Flota.csv (insertar o actualizar fila por nodeName)
$csvPath = Join-Path $OutputDir "Resumen-Flota.csv"
$totalDiskGB = 0.0
$freeDiskGB = 0.0
$diskSummaryParts = @()
foreach ($disk in $disksList) {
    $totalDiskGB += [double]$disk.totalGB
    $freeDiskGB += [double]$disk.freeGB
    $diskSummaryParts += "$($disk.drive) $($disk.freeGB)/$($disk.totalGB)GB ($($disk.driveType))"
}

$newRow = [PSCustomObject]@{
    NodeName      = $inventory.nodeName
    WindowsUser   = $inventory.windowsUser
    Department    = $inventory.department
    Role          = $inventory.role
    WorkspaceName = $inventory.workspaceName
    OsCaption     = $inventory.osCaption
    OsBuild       = $inventory.osBuild
    Manufacturer  = $inventory.manufacturer
    Model         = $inventory.model
    SerialNumber  = $inventory.serialNumber
    CpuModel      = $inventory.cpuModel
    CpuCores      = $inventory.cpuCores
    RamTotalGB    = $inventory.ramTotalGB
    RamFreeGB     = $inventory.ramFreeGB
    RamPercent    = $inventory.ramPercent
    GpuModel      = $inventory.gpuModel
    LanIps        = ($inventory.lanIps -join "; ")
    TailscaleIp   = $inventory.tailscaleIp
    MacAddresses  = ($inventory.macAddresses -join "; ")
    DiskSummary   = ($diskSummaryParts -join " | ")
    TotalDiskGB   = [Math]::Round($totalDiskGB, 2)
    FreeDiskGB    = [Math]::Round($freeDiskGB, 2)
    UptimeHours   = $inventory.uptimeHours
    CollectedAt   = $inventory.collectedAt
}

try {
    $rows = @()
    if (Test-Path -LiteralPath $csvPath) {
        $existing = @(Import-Csv -LiteralPath $csvPath -ErrorAction SilentlyContinue)
        $rows = @($existing | Where-Object { $_.NodeName -and $_.NodeName -ne $env:COMPUTERNAME })
    }
    $rows += $newRow
    $rows = @($rows | Sort-Object -Property NodeName)
    $rows | Export-Csv -LiteralPath $csvPath -NoTypeInformation -Encoding UTF8
    Write-Ok "Resumen de flota actualizado en: $csvPath ($($rows.Count) equipo(s))"
} catch {
    Write-Warn "No se pudo actualizar Resumen-Flota.csv: $($_.Exception.Message)"
}

# Reporte automatico al Hub central si HubUrl esta configurado
if (-not [string]::IsNullOrWhiteSpace($HubUrl)) {
    $cleanHubUrl = $HubUrl.Trim().TrimEnd('/')
    $checkinUrl = "$cleanHubUrl/api/fleet/checkin"
    Write-Info "Enviando inventario al Hub central: $checkinUrl ..."
    try {
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls11 -bor [Net.SecurityProtocolType]::Tls
        } catch {}

        $utf8Bytes = [System.Text.Encoding]::UTF8.GetBytes($jsonContent)
        $response = Invoke-RestMethod -Uri $checkinUrl -Method Post -Body $utf8Bytes -ContentType "application/json; charset=utf-8" -TimeoutSec 12 -ErrorAction Stop
        Write-Ok "Check-in exitoso en el Hub central ($checkinUrl). Equipo registrado en la flota."
        if ($response -and $response.message) {
            Write-Ok "Respuesta del Hub: $($response.message)"
        }
    } catch {
        Write-Warn "No se pudo conectar con el Hub ($checkinUrl): $($_.Exception.Message)"
        Write-Warn "El inventario quedo guardado localmente en $jsonPath para importacion posterior."
    }
} else {
    Write-Warn "No se configuro HubUrl (modo sin conexion). Inventario guardado unicamente en disco local."
}

# Resumen visual en consola
Write-Host ""
Write-Host "------------------ RESUMEN DEL EQUIPO ------------------" -ForegroundColor Green
Write-Host ("  Equipo       : {0} ({1})" -f $inventory.nodeName, $inventory.windowsUser)
Write-Host ("  Espacio      : {0} | Depto: {1} | Rol: {2}" -f $inventory.workspaceName, $inventory.department, $inventory.role)
Write-Host ("  SO           : {0} (Build {1})" -f $inventory.osCaption, $inventory.osBuild)
Write-Host ("  Hardware     : {0} {1} (S/N: {2})" -f $inventory.manufacturer, $inventory.model, $inventory.serialNumber)
Write-Host ("  CPU / GPU    : {0} ({1} hilos) | {2}" -f $inventory.cpuModel, $inventory.cpuCores, $inventory.gpuModel)
Write-Host ("  RAM          : {0} GB totales ({1} GB libres, {2}% en uso)" -f $inventory.ramTotalGB, $inventory.ramFreeGB, $inventory.ramPercent)
Write-Host ("  Red LAN      : {0}" -f ($(if ($inventory.lanIps.Count -gt 0) { $inventory.lanIps -join ", " } else { "Sin IP LAN" })))
Write-Host ("  Tailscale IP : {0}" -f ($(if ($inventory.tailscaleIp) { $inventory.tailscaleIp } else { "No detectado" })))
Write-Host ("  MACs (WoL)   : {0}" -f ($(if ($inventory.macAddresses.Count -gt 0) { $inventory.macAddresses -join ", " } else { "N/A" })))
Write-Host ("  Discos       : {0}" -f ($(if ($diskSummaryParts.Count -gt 0) { $diskSummaryParts -join " | " } else { "Ninguno" })))
Write-Host ("  Apps (Top)   : {0} programas detectados" -f $inventory.topApps.Count)
Write-Host "--------------------------------------------------------" -ForegroundColor Green
Write-Host ""

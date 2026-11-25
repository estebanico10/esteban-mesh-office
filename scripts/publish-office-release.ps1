<#
.SYNOPSIS
    Pipeline automatizado de compilacion, instalacion, sincronizacion y lanzamiento
    para Esteban Mesh Office.
.DESCRIPTION
    1. Ejecuta npm test.
    2. Compila npm run dist:win (release\Esteban-Mesh-Office-Setup-<ver>.exe) y genera release\SHA256SUMS.txt.
    3. Instala silenciosamente (/S) en el equipo local.
    4. Sincroniza codigo fuente e instalador a E:\CODE\ESTEBAN MESH OFFICE\ si existe E:\.
    5. Lanza Esteban Mesh Office.exe en el escritorio interactivo real mediante Scheduled Task (-LogonType Interactive)
       y elimina la tarea temporal limpiamente.
#>

[CmdletBinding()]
param(
    [switch]$SkipTests,
    [switch]$SkipInstall,
    [switch]$SkipSync,
    [switch]$SkipLaunch
)

$ErrorActionPreference = "Stop"
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
} catch {}

function Write-Phase {
    param([int]$Step, [int]$Total, [string]$Title)
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host "  [$Step/$Total] $Title" -ForegroundColor Cyan
    Write-Host "================================================================" -ForegroundColor Cyan
}

function Write-Ok {
    param([string]$Msg)
    Write-Host "[OK]    $Msg" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Msg)
    Write-Host "[AVISO] $Msg" -ForegroundColor Yellow
}

function Write-Info {
    param([string]$Msg)
    Write-Host "[INFO]  $Msg" -ForegroundColor Gray
}

function Write-Utf8NoBom {
    param([string]$Path, [string]$Content)
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Find-InstalledMeshOfficeExe {
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Esteban Mesh Office\Esteban Mesh Office.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\esteban-mesh-office\Esteban Mesh Office.exe"),
        (Join-Path $env:ProgramFiles "Esteban Mesh Office\Esteban Mesh Office.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Esteban Mesh Office\Esteban Mesh Office.exe")
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            return $candidate
        }
    }
    return ""
}

$scriptDir = $PSScriptRoot
if (-not $scriptDir) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}
$projectRoot = Split-Path -Parent $scriptDir
$packageJsonPath = Join-Path $projectRoot "package.json"

if (-not (Test-Path -LiteralPath $packageJsonPath)) {
    throw "No se encontro package.json en $projectRoot"
}

$pkg = (Get-Content -LiteralPath $packageJsonPath -Raw -Encoding UTF8) | ConvertFrom-Json
$version = $pkg.version
$releaseDir = Join-Path $projectRoot "release"
$expectedInstaller = Join-Path $releaseDir "Esteban-Mesh-Office-Setup-$version.exe"

Write-Host ""
Write-Host "Publicando Esteban Mesh Office v$version" -ForegroundColor Green
Write-Info "Directorio del proyecto: $projectRoot"

Push-Location -LiteralPath $projectRoot
try {
    # ------------------------------------------------------------------
    # PASO 1: Ejecutar npm test
    # ------------------------------------------------------------------
    Write-Phase 1 5 "Ejecutando pruebas unitarias (npm test)"
    if ($SkipTests) {
        Write-Warn "Pruebas omitidas por -SkipTests."
    } else {
        & npm test
        if ($LASTEXITCODE -ne 0) {
            throw "npm test fallo con codigo de salida $LASTEXITCODE."
        }
        Write-Ok "Todas las pruebas pasaron correctamente."
    }

    # ------------------------------------------------------------------
    # PASO 2: Compilar instalador Windows + generar SHA256SUMS.txt
    # ------------------------------------------------------------------
    Write-Phase 2 5 "Compilando instalador NSIS (npm run dist:win) y SHA256SUMS.txt"
    & npm run dist:win
    if ($LASTEXITCODE -ne 0) {
        throw "npm run dist:win fallo con codigo de salida $LASTEXITCODE."
    }

    if (-not (Test-Path -LiteralPath $expectedInstaller)) {
        $fallback = Get-ChildItem -LiteralPath $releaseDir -Filter "Esteban-Mesh-Office-Setup-*.exe" -File -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if (-not $fallback) {
            throw "No se encontro el instalador generado en $releaseDir."
        }
        $expectedInstaller = $fallback.FullName
    }

    $installerInfo = Get-Item -LiteralPath $expectedInstaller
    Write-Ok "Instalador compilado: $($installerInfo.Name) ($([Math]::Round($installerInfo.Length / 1MB, 2)) MB)"

    # Generar release\SHA256SUMS.txt
    $hashTargets = @()
    $hashTargets += Get-ChildItem -LiteralPath $releaseDir -Filter "Esteban-Mesh-Office-Setup-*.exe" -File -ErrorAction SilentlyContinue
    $hashTargets += Get-ChildItem -LiteralPath $releaseDir -Filter "*.blockmap" -File -ErrorAction SilentlyContinue
    $hashTargets += Get-ChildItem -LiteralPath $releaseDir -Filter "latest.yml" -File -ErrorAction SilentlyContinue
    $hashTargets = $hashTargets | Sort-Object Name -Unique

    $sumLines = New-Object 'System.Collections.Generic.List[string]'
    foreach ($file in $hashTargets) {
        $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        $sumLines.Add("$hash  $($file.Name)")
    }
    $shaSumsPath = Join-Path $releaseDir "SHA256SUMS.txt"
    Write-Utf8NoBom -Path $shaSumsPath -Content (($sumLines -join "`r`n") + "`r`n")
    Write-Ok "Archivo de firmas SHA-256 generado: $shaSumsPath"

    # ------------------------------------------------------------------
    # PASO 3: Instalar silenciosamente (/S) en este equipo
    # ------------------------------------------------------------------
    Write-Phase 3 5 "Instalando silenciosamente (/S) en el equipo local"
    if ($SkipInstall) {
        Write-Warn "Instalacion local omitida por -SkipInstall."
    } else {
        Write-Info "Cerrando instancias previas de Esteban Mesh Office si existen..."
        Get-Process -Name "Esteban Mesh Office" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 800

        Write-Info "Ejecutando: $($installerInfo.FullName) /S"
        $installProc = Start-Process -FilePath $installerInfo.FullName -ArgumentList "/S" -Wait -PassThru
        if ($installProc.ExitCode -ne 0) {
            throw "La instalacion silenciosa fallo con codigo $($installProc.ExitCode)."
        }
        Write-Ok "Instalacion local completada correctamente."
    }

    # ------------------------------------------------------------------
    # PASO 4: Sincronizar fuente + instalador a E:\CODE\ESTEBAN MESH OFFICE\
    # ------------------------------------------------------------------
    Write-Phase 4 5 "Sincronizando codigo fuente e instalador a E:\CODE\ESTEBAN MESH OFFICE\"
    if ($SkipSync) {
        Write-Warn "Sincronizacion omitida por -SkipSync."
    } elseif (Test-Path -LiteralPath "E:\") {
        $syncDest = "E:\CODE\ESTEBAN MESH OFFICE"
        if (-not (Test-Path -LiteralPath $syncDest)) {
            New-Item -ItemType Directory -Path $syncDest -Force | Out-Null
        }

        Write-Info "Sincronizando codigo fuente (excluyendo node_modules, .git y win-unpacked)..."
        $rcArgs = @(
            $projectRoot,
            $syncDest,
            "/MIR",
            "/R:2",
            "/W:1",
            "/NFL",
            "/NDL",
            "/NP",
            "/XD", "node_modules", ".git", "win-unpacked", ".vite",
            "/XF", "*.log"
        )
        & robocopy @rcArgs | Out-Null
        $rcCode = $LASTEXITCODE
        if ($rcCode -ge 8) {
            throw "robocopy fallo al sincronizar fuente con codigo $rcCode."
        }

        $syncReleaseDir = Join-Path $syncDest "release"
        if (-not (Test-Path -LiteralPath $syncReleaseDir)) {
            New-Item -ItemType Directory -Path $syncReleaseDir -Force | Out-Null
        }
        Copy-Item -LiteralPath $installerInfo.FullName -Destination (Join-Path $syncReleaseDir $installerInfo.Name) -Force
        Copy-Item -LiteralPath $shaSumsPath -Destination (Join-Path $syncReleaseDir "SHA256SUMS.txt") -Force

        Write-Ok "Sincronizacion completada en: $syncDest"
    } else {
        Write-Warn "Unidad E:\ no detectada; se omite la sincronizacion externa."
    }

    # ------------------------------------------------------------------
    # PASO 5: Lanzar app en escritorio interactivo real via Scheduled Task
    # ------------------------------------------------------------------
    Write-Phase 5 5 "Lanzando Esteban Mesh Office en el escritorio interactivo real"
    if ($SkipLaunch) {
        Write-Warn "Lanzamiento omitido por -SkipLaunch."
    } else {
        $appExe = Find-InstalledMeshOfficeExe
        if (-not $appExe) {
            throw "No se encontro 'Esteban Mesh Office.exe' tras la instalacion."
        }
        $appWorkDir = Split-Path -Parent $appExe
        $taskName = "EstebanMeshOffice-Launch-$(Get-Date -Format 'yyyyMMddHHmmss')"
        $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

        Write-Info "Registrando tarea interactiva temporal '$taskName' para $currentUser..."
        $action = New-ScheduledTaskAction -Execute $appExe -WorkingDirectory $appWorkDir
        $principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

        $registered = $false
        try {
            Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Settings $settings -Force | Out-Null
            $registered = $true
            Start-ScheduledTask -TaskName $taskName
            Start-Sleep -Seconds 2
            Write-Ok "Esteban Mesh Office lanzado en el escritorio interactivo ($appExe)."
        } finally {
            if ($registered) {
                try {
                    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
                    Write-Info "Tarea temporal '$taskName' eliminada limpiamente."
                } catch {
                    Write-Warn "No se pudo eliminar la tarea temporal '$taskName': $($_.Exception.Message)"
                }
            }
        }
    }

    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host "  RELEASE COMPLETADO: Esteban Mesh Office v$version" -ForegroundColor Green
    Write-Host "  Instalador : $($installerInfo.FullName)" -ForegroundColor Green
    Write-Host "  SHA256SUMS : $shaSumsPath" -ForegroundColor Green
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host ""
} finally {
    Pop-Location
}

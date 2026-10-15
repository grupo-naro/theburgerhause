<#
.SYNOPSIS
    Actualiza el programa (print-agent.cjs) con el de una versión nueva, conservando config.json y el historial.

.DESCRIPTION
    Descomprimí el ZIP de la versión nueva y corré este script desde esa carpeta (o indicá -ReleaseDir).
    Detiene la tarea, reemplaza print-agent.cjs, verifica con "check" y vuelve a iniciar la tarea. Si la verificación
    falla, vuelve a dejar el programa anterior. Códigos de salida: 0 ok | 1 inesperado | 2 la carpeta nueva no tiene
    print-agent.cjs | 3 falta ser Administrador | 5 Node.js no sirve | 6 falló la verificación | 7 no se conectó | 8 no hay instalación.
#>
[CmdletBinding()]
param(
    [string]$InstallDir = 'C:\BurgerHouseAgent',
    [string]$TaskName = 'BurgerHouseAgent',
    [string]$ReleaseDir = $PSScriptRoot,
    [string]$NodeExe,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

function Get-AgentVersion([string]$NodePath, [string]$Cjs, [string]$WorkDir) {
    $r = Invoke-Native $NodePath ('"' + $Cjs + '" --version') $WorkDir 20
    if ($r.ExitCode -eq 0) { return $r.Output.Trim() }
    return '(desconocida)'
}

try {
    $simulacion = ''
    if ($DryRun) { $simulacion = ' (SIMULACIÓN: no se cambia nada)' }
    Write-Host "Burger Hause Print Agent: actualización$simulacion" -ForegroundColor Cyan
    if (-not $DryRun) { Assert-Elevated }

    $paths = Get-AgentPaths $InstallDir
    $newCjs = Join-Path $ReleaseDir 'print-agent.cjs'
    if (-not (Test-Path -LiteralPath $paths.Cjs) -or -not (Test-Path -LiteralPath $paths.Config)) {
        Stop-WithError "No hay una instalación en '$($paths.Dir)'. Primero instalá con install.ps1 (guía: docs/ops/print-agent-install.md)." 8
    }
    if (-not (Test-Path -LiteralPath $newCjs)) {
        Stop-WithError "No se encontró print-agent.cjs en '$ReleaseDir'. Descomprimí el ZIP de la versión nueva y corré update.ps1 desde esa carpeta (o usá -ReleaseDir)." 2
    }
    $newCjs = (Resolve-Path -LiteralPath $newCjs).Path
    $node = Resolve-NodeExe $paths.PortableNode $NodeExe
    $oldVer = Get-AgentVersion $node.Path $paths.Cjs $paths.Dir
    $newVer = Get-AgentVersion $node.Path $newCjs $paths.Dir
    Write-Info "Versión instalada: $oldVer   |   versión nueva: $newVer"
    Write-Info "Se reemplaza: $($paths.Cjs)  con  $newCjs"
    Write-Info 'Se conservan: config.json, historial (data) y logs.'
    if ($DryRun) { Write-Host ''; Write-Host 'SIMULACIÓN terminada: no se cambió nada.' -ForegroundColor Green; exit 0 }

    $task = Get-AgentTask $TaskName
    $backup = [System.IO.File]::ReadAllBytes($paths.Cjs)
    Write-Step 'Actualizando'
    Stop-AgentTask $TaskName $paths.Cjs
    Start-Sleep -Milliseconds 800
    $replaced = $false
    try {
        Copy-Item -LiteralPath $newCjs -Destination $paths.Cjs -Force
        $replaced = $true
        $chk = Invoke-Native $node.Path ('"' + $paths.Cjs + '" check') $paths.Dir 60
        Write-Host (($chk.Output -replace 'bhst_[A-Za-z0-9_-]{8,}', 'bhst_***') -replace '(?m)^', '  ')
        if ($chk.ExitCode -ne 0) { throw 'CHECK_FAILED' }
        Write-Ok 'Verificación correcta con el programa nuevo'
    }
    catch {
        if ($replaced) { [System.IO.File]::WriteAllBytes($paths.Cjs, $backup) }
        if ($task) { try { Start-ScheduledTask -TaskName $TaskName } catch { } }
        if ($_.Exception.Message -eq 'CHECK_FAILED') {
            Stop-WithError "La verificación con el programa nuevo falló (arriba está el motivo). Se volvió a dejar el programa anterior ($oldVer) y la tarea sigue funcionando." 6
        }
        throw
    }

    if ($task) {
        $offset = Get-LogLength $paths.Log
        Start-ScheduledTask -TaskName $TaskName
        Write-Info 'Esperando que el agente se conecte (hasta 30 segundos)...'
        if (-not (Wait-AgentConnected $paths.Log $offset 30)) {
            Write-Warn "El programa se actualizó pero no se vio 'Agente conectado' en 30 s. Corré status.ps1 y mirá el log: $($paths.Log)"
            exit 7
        }
        Write-Ok 'El agente volvió a conectarse'
    }
    else { Write-Warn "La tarea '$TaskName' no está registrada: el programa se actualizó pero no se inició nada. Corré install.ps1 -Force para registrarla." }
    Write-Host ''
    Write-Host "Actualización terminada ($oldVer -> $newVer)." -ForegroundColor Green
    exit 0
}
catch {
    Write-Host ''
    Write-Host ("  [ERROR] Falló la actualización: " + ($_.Exception.Message -replace 'bhst_[A-Za-z0-9_-]{8,}', 'bhst_***')) -ForegroundColor Red
    exit 1
}

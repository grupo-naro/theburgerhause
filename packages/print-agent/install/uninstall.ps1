<#
.SYNOPSIS
    Desinstala el Burger Hause Print Agent: detiene y elimina la tarea programada; con -RemoveData borra también la carpeta.

.DESCRIPTION
    Sin -RemoveData se conservan config.json, el historial (data) y los logs, por si se vuelve a instalar.
    Con -RemoveData se borra TODA la carpeta de instalación (programa, config con el token, estado, logs y Node portable).
    Se puede correr varias veces sin problema. Códigos de salida: 0 ok | 1 inesperado | 2 carpeta que no es del agente | 3 falta ser Administrador.

.EXAMPLE
    .\uninstall.ps1
    .\uninstall.ps1 -RemoveData
#>
[CmdletBinding()]
param(
    [string]$InstallDir = 'C:\BurgerHouseAgent',
    [string]$TaskName = 'BurgerHouseAgent',
    [switch]$RemoveData,
    [switch]$Yes,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

try {
    $simulacion = ''
    if ($DryRun) { $simulacion = ' (SIMULACIÓN: no se cambia nada)' }
    Write-Host "Burger Hause Print Agent: desinstalación$simulacion" -ForegroundColor Cyan
    if (-not $DryRun) { Assert-Elevated }

    $paths = Get-AgentPaths $InstallDir
    $task = Get-AgentTask $TaskName
    $hasDir = Test-Path -LiteralPath $paths.Dir

    if ($RemoveData -and $hasDir) {
        $isAgentDir = (Test-Path -LiteralPath $paths.Cjs) -or (Test-Path -LiteralPath $paths.Config)
        $isRoot = ($paths.Dir.TrimEnd('\') -eq [System.IO.Path]::GetPathRoot($paths.Dir).TrimEnd('\'))
        if ($isRoot -or -not $isAgentDir) {
            Stop-WithError "'$($paths.Dir)' no parece una instalación del agente (no tiene print-agent.cjs ni config.json). No se borra nada por seguridad." 2
        }
    }

    if (-not $task -and -not $hasDir) {
        Write-Ok "La tarea '$TaskName' no estaba instalada y la carpeta '$($paths.Dir)' no existe: no hay nada para hacer."
        exit 0
    }

    Write-Step 'Plan'
    if ($task) { Write-Info "- Detener y eliminar la tarea programada '$TaskName'" } else { Write-Info "- La tarea '$TaskName' no existe (nada que eliminar)" }
    if ($RemoveData -and $hasDir) { Write-Info "- BORRAR la carpeta completa '$($paths.Dir)' (programa, config.json con el token, historial, logs)" }
    elseif ($hasDir) { Write-Info "- Se conservan los archivos de '$($paths.Dir)' (config, historial y logs). Para borrarlos: -RemoveData" }

    if ($DryRun) { Write-Host ''; Write-Host 'SIMULACIÓN terminada: no se cambió nada.' -ForegroundColor Green; exit 0 }

    if (-not $Yes) {
        $a = Read-Host -Prompt 'Escribí SI para continuar'
        if ($a -ne 'SI' -and $a -ne 'si' -and $a -ne 'Si') { Write-Info 'Cancelado: no se cambió nada.'; exit 0 }
    }

    Write-Step 'Desinstalando'
    Stop-AgentTask $TaskName $paths.Cjs
    if ($task) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false; Write-Ok "Tarea '$TaskName' eliminada" }
    if ($RemoveData -and $hasDir) {
        Remove-Item -LiteralPath $paths.Dir -Recurse -Force
        Write-Ok "Carpeta '$($paths.Dir)' borrada"
    }
    Write-Host ''
    Write-Host 'Desinstalación terminada.' -ForegroundColor Green
    Write-Info 'Recordatorio: en Admin > Estaciones, si esta PC ya no va a imprimir, rotá el token de la estación para que el viejo deje de servir.'
    exit 0
}
catch {
    Write-Host ''
    Write-Host ("  [ERROR] Falló la desinstalación: " + ($_.Exception.Message -replace 'bhst_[A-Za-z0-9_-]{8,}', 'bhst_***')) -ForegroundColor Red
    exit 1
}

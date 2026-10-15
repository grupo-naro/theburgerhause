<#
.SYNOPSIS
    Muestra el estado del Burger Hause Print Agent en esta PC (solo lectura).

.DESCRIPTION
    Tarea programada (estado y último resultado), si el proceso está corriendo, las últimas 20 líneas del log
    (los tokens ya salen tapados), el resultado de "check" y cuántos trabajos hay en la cola de la impresora.
    Para ver todo conviene abrir PowerShell como Administrador (config.json solo lo leen Administradores).
    Códigos de salida: 0 todo bien | 7 hay algo para revisar (tarea ausente/detenida o check falló) | 8 no hay instalación.
#>
[CmdletBinding()]
param(
    [string]$InstallDir = 'C:\BurgerHouseAgent',
    [string]$TaskName = 'BurgerHouseAgent',
    [string]$NodeExe,
    [int]$LogLines = 20
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

try {
    $paths = Get-AgentPaths $InstallDir
    $task = Get-AgentTask $TaskName
    if (-not $task -and -not (Test-Path -LiteralPath $paths.Cjs)) {
        Stop-WithError "No hay una instalación en '$($paths.Dir)' ni una tarea '$TaskName'. Instalala con install.ps1 (guía: docs/ops/print-agent-install.md)." 8
    }
    $problems = 0
    Write-Host "Burger Hause Print Agent: estado" -ForegroundColor Cyan
    if (-not (Test-Elevated)) { Write-Warn 'Esta ventana no es de Administrador: puede que no se pueda leer config.json ni correr el chequeo.' }

    Write-Step 'Tarea programada'
    if ($task) {
        $info = Get-ScheduledTaskInfo -TaskName $TaskName
        Write-Info "Nombre             : $TaskName"
        Write-Info "Estado             : $($task.State)"
        Write-Info "Última ejecución   : $($info.LastRunTime)"
        Write-Info "Último resultado   : $($info.LastTaskResult) (0 o 267009 = bien / corriendo)"
        if ($task.State -ne 'Running') { Write-Warn "La tarea no está corriendo. Para iniciarla: Start-ScheduledTask -TaskName $TaskName"; $problems++ }
    }
    else { Write-Warn "La tarea '$TaskName' no está registrada (¿se desinstaló, o falta correr install.ps1?)"; $problems++ }

    Write-Step 'Proceso'
    $procs = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($paths.Cjs) })
    if ($procs.Count -gt 0) { Write-Ok ("Corriendo (PID {0})" -f (($procs | ForEach-Object { $_.ProcessId }) -join ', ')) }
    else { Write-Warn 'No hay ningún proceso del agente corriendo.'; $problems++ }

    Write-Step "Últimas $LogLines líneas del log ($($paths.Log))"
    if (Test-Path -LiteralPath $paths.Log) {
        $lines = Get-Content -LiteralPath $paths.Log -Tail $LogLines -Encoding UTF8
        foreach ($l in $lines) { Write-Host ("  " + ($l -replace 'bhst_[A-Za-z0-9_-]{8,}', 'bhst_***')) }
    }
    else { Write-Info '(todavía no hay log)' }

    Write-Step 'Chequeo (print-agent check)'
    $config = $null
    $configOk = $false
    if (Test-Path -LiteralPath $paths.Config) {
        try { $config = Get-Content -LiteralPath $paths.Config -Raw -Encoding UTF8 | ConvertFrom-Json; $configOk = $true }
        catch { Write-Warn 'No se pudo leer config.json (¿falta abrir PowerShell como Administrador?).'; $problems++ }
    }
    else { Write-Warn "No existe $($paths.Config)"; $problems++ }
    if ($configOk -and (Test-Path -LiteralPath $paths.Cjs)) {
        $node = Resolve-NodeExe $paths.PortableNode $NodeExe
        $chk = Invoke-Native $node.Path ('"' + $paths.Cjs + '" check') $paths.Dir 60
        Write-Host (($chk.Output -replace 'bhst_[A-Za-z0-9_-]{8,}', 'bhst_***') -replace '(?m)^', '  ')
        if ($chk.ExitCode -ne 0) { Write-Warn 'El chequeo falló: mirá el motivo arriba.'; $problems++ } else { Write-Ok 'Chequeo correcto' }
    }

    Write-Step 'Cola de impresión'
    if ($configOk -and $config.PRINTER_BACKEND -eq 'windows' -and $config.PRINTER_NAME) {
        try {
            $jobs = @(Get-PrintJob -PrinterName $config.PRINTER_NAME -ErrorAction Stop)
            Write-Info ("Trabajos en la cola de '{0}': {1}" -f $config.PRINTER_NAME, $jobs.Count)
            if ($jobs.Count -gt 0) { Write-Warn 'Hay trabajos esperando en la cola de Windows (¿impresora apagada o sin papel?).' }
        }
        catch { Write-Info "No se pudo leer la cola de '$($config.PRINTER_NAME)': $($_.Exception.Message)" }
    }
    else { Write-Info '(no aplica: la impresora no es de Windows o no se pudo leer la configuración)' }

    Write-Host ''
    if ($problems -eq 0) { Write-Host 'Todo bien.' -ForegroundColor Green; exit 0 }
    Write-Host "Hay $problems cosa(s) para revisar (ver los avisos de arriba)." -ForegroundColor Yellow
    exit 7
}
catch {
    Write-Host ''
    Write-Host ("  [ERROR] " + ($_.Exception.Message -replace 'bhst_[A-Za-z0-9_-]{8,}', 'bhst_***')) -ForegroundColor Red
    exit 1
}

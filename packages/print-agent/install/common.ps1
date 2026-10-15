# Funciones compartidas por install.ps1, uninstall.ps1, status.ps1 y update.ps1 (Windows PowerShell 5.1).
# Este archivo se carga con ". .\common.ps1"; no se ejecuta solo.

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

# Códigos de salida (iguales en todos los scripts):
#   0 todo bien | 1 error inesperado | 2 parámetros inválidos | 3 falta ejecutar como Administrador
#   4 ya hay una instalación (usar -Force) | 5 Node.js no sirve | 6 falló la verificación (check / test-print)
#   7 no se pudo registrar/iniciar la tarea o el agente no se conectó | 8 no hay instalación

function Write-Step([string]$Text) { Write-Host ""; Write-Host "== $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "  [OK] $Text" -ForegroundColor Green }
function Write-Info([string]$Text) { Write-Host "  $Text" }
function Write-Warn([string]$Text) { Write-Host "  [AVISO] $Text" -ForegroundColor Yellow }

function Stop-WithError([string]$Text, [int]$Code) {
    Write-Host ""
    Write-Host "  [ERROR] $Text" -ForegroundColor Red
    exit $Code
}

function Test-Elevated {
    # BH_TEST_ELEVATED solo lo usan las pruebas automáticas para simular la situación.
    if ($env:BH_TEST_ELEVATED -eq '0') { return $false }
    if ($env:BH_TEST_ELEVATED -eq '1') { return $true }
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-ElevationMessage {
    return ("Este programa necesita permisos de Administrador. Abrí PowerShell como Administrador: " +
        "botón Inicio, escribí 'PowerShell', clic derecho en 'Windows PowerShell' > 'Ejecutar como administrador' > 'Sí'. " +
        "Después volvé a pegar el comando.")
}

function Assert-Elevated {
    if (-not (Test-Elevated)) { Stop-WithError (Get-ElevationMessage) 3 }
}

function Get-AgentPaths([string]$InstallDir) {
    $InstallDir = [System.IO.Path]::GetFullPath($InstallDir)
    return @{
        Dir          = $InstallDir
        Cjs          = Join-Path $InstallDir 'print-agent.cjs'
        Config       = Join-Path $InstallDir 'config.json'
        Data         = Join-Path $InstallDir 'data'
        Logs         = Join-Path $InstallDir 'data\logs'
        Log          = Join-Path $InstallDir 'data\logs\agent.log'
        PortableNode = Join-Path $InstallDir 'node\node.exe'
    }
}

# Ejecuta un programa y devuelve ExitCode + Output (stdout y stderr juntos). No tira excepción por stderr.
function Invoke-Native([string]$File, [string]$Arguments, [string]$WorkDir, [int]$TimeoutSec = 60) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $File
    $psi.Arguments = $Arguments
    $psi.WorkingDirectory = $WorkDir
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
    $p = New-Object System.Diagnostics.Process
    $p.StartInfo = $psi
    [void]$p.Start()
    $outTask = $p.StandardOutput.ReadToEndAsync()
    $errTask = $p.StandardError.ReadToEndAsync()
    if (-not $p.WaitForExit($TimeoutSec * 1000)) {
        try { $p.Kill() } catch { }
        return @{ ExitCode = 124; Output = "Tiempo agotado ($TimeoutSec s)" }
    }
    $p.WaitForExit()
    return @{ ExitCode = $p.ExitCode; Output = (($outTask.Result + $errTask.Result).Trim()) }
}

# Busca Node: 1) <InstallDir>\node\node.exe (portable)  2) -NodeExe  3) node en el PATH. Exige versión >= 20.
function Resolve-NodeExe([string]$PortableNode, [string]$NodeExe) {
    $candidate = $null
    if (Test-Path -LiteralPath $PortableNode) { $candidate = $PortableNode }
    elseif ($NodeExe) {
        if (-not (Test-Path -LiteralPath $NodeExe)) { Stop-WithError "No existe el archivo indicado en -NodeExe: $NodeExe" 5 }
        $candidate = (Resolve-Path -LiteralPath $NodeExe).Path
    }
    else {
        $cmd = Get-Command node -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($cmd) { $candidate = $cmd.Source }
    }
    if (-not $candidate) {
        Stop-WithError ("No se encontró Node.js. Instalá Node.js 20 LTS (o copiá la versión portable a '" + (Split-Path (Split-Path $PortableNode)) + "\node') " +
            "y volvé a correr este programa. Pasos en la guía de instalación (docs/ops/print-agent-install.md).") 5
    }
    $r = Invoke-Native $candidate '--version' (Split-Path -Parent $candidate) 20
    $ver = $r.Output.Trim()
    if ($r.ExitCode -ne 0 -or $ver -notmatch '^v(\d+)\.') {
        Stop-WithError "No se pudo averiguar la versión de Node.js en '$candidate' (respondió: $ver)." 5
    }
    if ([int]$Matches[1] -lt 20) {
        Stop-WithError "Hace falta Node.js 20 o superior y '$candidate' es $ver. Instalá Node.js 20 LTS (o copiá la versión portable a la carpeta node) y volvé a intentar." 5
    }
    return @{ Path = $candidate; Version = $ver }
}

# Deja en la carpeta/archivo solo SYSTEM y Administradores (por SID: funciona en cualquier idioma de Windows).
function Set-SecureAcl([string]$Path, [bool]$IsDir) {
    $perm = 'F'
    if ($IsDir) { $perm = '(OI)(CI)F' }
    $r = Invoke-Native 'icacls.exe' ('"' + $Path + '" /inheritance:r /grant:r "*S-1-5-18:' + $perm + '" "*S-1-5-32-544:' + $perm + '"') ([System.IO.Path]::GetDirectoryName($Path)) 30
    if ($r.ExitCode -ne 0) { throw "icacls falló sobre '$Path': $($r.Output)" }
}

function Get-AgentTask([string]$TaskName) {
    return Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}

# Detiene la tarea y cualquier node.exe que esté corriendo ESTE print-agent.cjs (se identifica por su ruta).
function Stop-AgentTask([string]$TaskName, [string]$Cjs) {
    $t = Get-AgentTask $TaskName
    if ($t) { try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue } catch { } }
    $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine.Contains($Cjs) }
    foreach ($p in $procs) { try { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue } catch { } }
}

function Get-LogLength([string]$LogPath) {
    if (Test-Path -LiteralPath $LogPath) { return (Get-Item -LiteralPath $LogPath).Length }
    return 0
}

# Espera hasta $TimeoutSec a que el log (desde $Offset) diga "Agente conectado".
function Wait-AgentConnected([string]$LogPath, [long]$Offset, [int]$TimeoutSec = 30) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (Test-Path -LiteralPath $LogPath) {
            try {
                $fs = [System.IO.File]::Open($LogPath, 'Open', 'Read', 'ReadWrite')
                try {
                    if ($fs.Length -gt $Offset) {
                        [void]$fs.Seek($Offset, 'Begin')
                        $text = (New-Object System.IO.StreamReader($fs, [System.Text.Encoding]::UTF8)).ReadToEnd()
                        if ($text -match 'Agente conectado') { return $true }
                    }
                } finally { $fs.Dispose() }
            } catch { }
        }
        Start-Sleep -Milliseconds 700
    }
    return $false
}

function ConvertTo-XmlText([string]$s) { return [System.Security.SecurityElement]::Escape($s) }

# Definición de la tarea programada. NO contiene el token: el programa lo lee de config.json (con ACL restringida).
function New-AgentTaskXml([string]$NodePath, [string]$CjsPath, [string]$WorkDir) {
    $n = ConvertTo-XmlText $NodePath
    $a = ConvertTo-XmlText ('"' + $CjsPath + '" run')
    $w = ConvertTo-XmlText $WorkDir
    return @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Burger Hause Print Agent: imprime los tickets y comandas de este local. Arranca con Windows y se reinicia solo.</Description>
  </RegistrationInfo>
  <Triggers>
    <BootTrigger>
      <Enabled>true</Enabled>
      <Delay>PT30S</Delay>
    </BootTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>S-1-5-18</UserId>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>999</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>$n</Command>
      <Arguments>$a</Arguments>
      <WorkingDirectory>$w</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@
}

<#
.SYNOPSIS
    Instala el Burger Hause Print Agent en esta PC como tarea programada (arranca con Windows y se reinicia solo).

.DESCRIPTION
    Pasos: copia el programa, guarda config.json (con permisos solo para SYSTEM y Administradores), busca Node.js 20+,
    verifica el token con "print-agent check" ANTES de registrar nada, opcionalmente imprime un ticket de prueba,
    registra la tarea programada (BootTrigger +30 s, SYSTEM, reinicio cada 1 min), la inicia y espera la conexión.

    Códigos de salida: 0 ok | 1 error inesperado | 2 parámetros inválidos | 3 falta ser Administrador |
    4 ya hay una instalación (usar -Force) | 5 Node.js no sirve | 6 falló check/test-print | 7 no se pudo registrar/iniciar
    la tarea o no se conectó | 8 (otros scripts) no hay instalación.

.EXAMPLE
    .\install.ps1 -ServerUrl https://pedidos.ejemplo.com -PrinterName "POS-80"
    (pide el token en pantalla, sin mostrarlo)

.EXAMPLE
    .\install.ps1 -ServerUrl https://pedidos.ejemplo.com -PrinterName "POS-80" -PaperWidth 58 -DryRun
    (muestra qué haría, sin cambiar nada)
#>
[CmdletBinding()]
param(
    [string]$InstallDir = 'C:\BurgerHouseAgent',
    [string]$ServerUrl,
    [string]$Token,
    [string]$PrinterName,
    [int]$PaperWidth = 80,
    [string]$CodePage = 'cp858',
    [string]$NodeExe,
    [string]$TaskName = 'BurgerHouseAgent',
    [ValidateSet('windows', 'file')][string]$Backend = 'windows',  # 'file' solo para pruebas/desarrollo
    [string]$OutputDir,                                             # solo con -Backend file
    [switch]$TestPrint,
    [switch]$NoPrompt,
    [switch]$AllowInsecure,
    [switch]$DryRun,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$PrinterNamePattern = '^(?:\\\\[\p{L}\p{N}._-]+\\)?[\p{L}\p{N}][\p{L}\p{N} _.\-()#/&+'',]{0,99}$'

function Read-SecretToken {
    $secure = Read-Host -Prompt 'Pegá el token de la estación (bhst_...; no se ve mientras lo pegás) y apretá Enter' -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Select-Printer {
    $names = @()
    try { $names = @(Get-Printer -ErrorAction Stop | Select-Object -ExpandProperty Name) } catch { $names = @() }
    if ($names.Count -eq 0) { Stop-WithError "No se encontró ninguna impresora instalada en Windows. Instalá la impresora (con su driver) y probá imprimir la página de prueba de Windows; después volvé a correr este programa." 2 }
    $default = $null
    try { $default = (Get-CimInstance Win32_Printer -Filter 'Default=TRUE' -ErrorAction Stop | Select-Object -First 1).Name } catch { $default = $null }
    Write-Info "Impresoras instaladas en esta PC:"
    for ($i = 0; $i -lt $names.Count; $i++) {
        $mark = ''
        if ($names[$i] -eq $default) { $mark = '   (predeterminada)' }
        Write-Info ("  {0}) {1}{2}" -f ($i + 1), $names[$i], $mark)
    }
    $answer = Read-Host -Prompt 'Escribí el NÚMERO de la impresora de tickets (Enter = la predeterminada)'
    if ([string]::IsNullOrWhiteSpace($answer)) {
        if ($default) { return $default }
        Stop-WithError "No hay impresora predeterminada: volvé a correr el programa y elegí un número de la lista." 2
    }
    $n = 0
    if (-not [int]::TryParse($answer.Trim(), [ref]$n) -or $n -lt 1 -or $n -gt $names.Count) {
        Stop-WithError "'$answer' no es un número de la lista (1 a $($names.Count))." 2
    }
    return $names[$n - 1]
}

function Confirm-Yes([string]$Question) {
    $a = Read-Host -Prompt "$Question (s/N)"
    return ($a -match '^(s|si|sí|y|yes)$')
}

try {
    $simulacion = ''
    if ($DryRun) { $simulacion = ' (SIMULACIÓN: no se cambia nada)' }
    Write-Host "Burger Hause Print Agent: instalación$simulacion" -ForegroundColor Cyan

    # ---- 1. Validar parámetros (antes de tocar nada) ----
    Write-Step 'Revisando los datos'
    if ($PaperWidth -ne 58 -and $PaperWidth -ne 80) { Stop-WithError "El ancho de papel debe ser 58 o 80 (milímetros); recibí $PaperWidth." 2 }
    if ($CodePage -notin @('cp858', 'cp437', 'cp850', 'wpc1252')) { Stop-WithError "La página de códigos '$CodePage' no existe. Opciones: cp858, cp437, cp850, wpc1252." 2 }
    if (-not $ServerUrl) { Stop-WithError "Falta -ServerUrl (la dirección https:// del sistema, por ejemplo https://pedidos.ejemplo.com)." 2 }
    $ServerUrl = $ServerUrl.Trim().TrimEnd('/')
    $uri = $null
    if (-not [Uri]::TryCreate($ServerUrl, [UriKind]::Absolute, [ref]$uri) -or ($uri.Scheme -ne 'https' -and $uri.Scheme -ne 'http')) {
        Stop-WithError "La dirección del servidor no es válida: debe empezar con https:// (por ejemplo https://pedidos.ejemplo.com)." 2
    }
    if ($uri.Scheme -eq 'http') {
        $isLocal = ($uri.Host -eq 'localhost' -or $uri.Host -eq '127.0.0.1')
        if (-not ($isLocal -and $AllowInsecure)) {
            Stop-WithError "La dirección del servidor debe empezar con https://. (http:// solo se acepta para localhost y con -AllowInsecure, y únicamente para pruebas.)" 2
        }
    }
    if (-not $Token) {
        if ($DryRun -or $NoPrompt) {
            if ($DryRun) { $Token = 'bhst_' + ('X' * 43) }
            else { Stop-WithError "Falta -Token (el token de la estación, bhst_..., de Admin > Estaciones)." 2 }
        }
        else { $Token = Read-SecretToken }
    }
    $Token = $Token.Trim()
    if ($Token -notmatch '^bhst_[A-Za-z0-9_-]{43}$') {
        Stop-WithError "El token no tiene el formato esperado (bhst_ seguido de 43 caracteres). Copialo completo desde Admin > Estaciones; solo se muestra una vez, si se perdió generá uno nuevo." 2
    }
    if ($Backend -eq 'windows' -and $PrinterName -and $PrinterName -notmatch $PrinterNamePattern) {
        Stop-WithError "El nombre de la impresora no es válido (solo letras, números, espacios y . _ - ( ) # / & + ' , y debe empezar con letra o número). Renombrá la impresora en Configuración > Impresoras y escáneres." 2
    }
    if ($Backend -eq 'file' -and -not $OutputDir) { Stop-WithError "Con -Backend file hace falta -OutputDir (carpeta donde se guardan los trabajos)." 2 }
    Write-Ok 'Datos válidos'

    # ---- 2. Administrador ----
    if (-not (Test-Elevated)) {
        if ($DryRun -and $env:BH_TEST_ELEVATED -ne '0') {
            Write-Warn 'Esta ventana NO es de Administrador. La simulación sigue, pero la instalación real exige PowerShell como Administrador.'
        }
        else { Stop-WithError (Get-ElevationMessage) 3 }
    }

    $paths = Get-AgentPaths $InstallDir
    $existing = (Test-Path -LiteralPath $paths.Config) -or (Test-Path -LiteralPath $paths.Cjs) -or ($null -ne (Get-AgentTask $TaskName))
    if ($existing -and -not $Force) {
        Stop-WithError "Ya hay una instalación de '$TaskName' en '$($paths.Dir)'. Para reinstalar o actualizar la configuración volvé a correr el mismo comando agregando -Force (se conserva el historial de impresiones). Para solo cambiar el programa usá update.ps1." 4
    }

    # ---- 3. Programa y Node ----
    Write-Step 'Buscando el programa y Node.js'
    $source = Join-Path $PSScriptRoot 'print-agent.cjs'
    if (-not (Test-Path -LiteralPath $source)) { $source = Join-Path $PSScriptRoot '..\dist\print-agent.cjs' }
    if (Test-Path -LiteralPath $source) { $source = (Resolve-Path -LiteralPath $source).Path; Write-Ok "Programa: $source" }
    elseif ($DryRun) { Write-Warn "No se encontró print-agent.cjs junto al script (en la instalación real es obligatorio)." }
    else { Stop-WithError "No se encontró print-agent.cjs junto a install.ps1. Descomprimí el ZIP completo y corré el script desde esa carpeta." 1 }

    $node = Resolve-NodeExe $paths.PortableNode $NodeExe
    Write-Ok "Node.js $($node.Version): $($node.Path)"

    # ---- 4. Impresora ----
    $printer = $PrinterName
    if ($Backend -eq 'windows' -and -not $printer) {
        if ($DryRun -or $NoPrompt) {
            if ($DryRun) { Write-Warn 'Falta -PrinterName: en la instalación real se mostraría la lista de impresoras para elegir una.'; $printer = '<impresora elegida>' }
            else { Stop-WithError "Falta -PrinterName (nombre exacto de la impresora en Windows)." 2 }
        }
        else { Write-Step 'Eligiendo la impresora'; $printer = Select-Printer }
    }

    # ---- 5. Plan ----
    $config = [ordered]@{
        SERVER_URL      = $ServerUrl
        STATION_TOKEN   = $Token
        PAPER_WIDTH     = $PaperWidth
        CODEPAGE        = $CodePage
        PRINTER_BACKEND = $Backend
        DATA_DIR        = $paths.Data
    }
    if ($Backend -eq 'windows') { $config['PRINTER_NAME'] = $printer }
    else { $config['OUTPUT_DIR'] = $OutputDir }
    if ($AllowInsecure) { $config['ALLOW_INSECURE'] = '1' }

    $xml = New-AgentTaskXml $node.Path $paths.Cjs $paths.Dir
    Write-Step 'Plan'
    Write-Info "Carpeta de instalación : $($paths.Dir)"
    Write-Info "Tarea programada      : $TaskName (al iniciar Windows, +30 s, usuario SYSTEM, reinicio cada 1 min)"
    Write-Info "Configuración (config.json, sin mostrar el token):"
    foreach ($k in $config.Keys) {
        $v = $config[$k]
        if ($k -eq 'STATION_TOKEN') { $v = 'bhst_*** (oculto)' }
        Write-Info ("  {0} = {1}" -f $k, $v)
    }
    Write-Info ("Permisos: icacls `"{0}`" /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F   (solo SYSTEM y Administradores)" -f $paths.Dir)
    Write-Info ("Permisos: icacls `"{0}`" /inheritance:r /grant:r *S-1-5-18:F *S-1-5-32-544:F" -f $paths.Config)

    if ($DryRun) {
        Write-Info ''
        Write-Info 'Definición de la tarea programada (XML):'
        Write-Host $xml
        Write-Host ''
        Write-Host 'SIMULACIÓN terminada: no se creó ninguna carpeta, archivo ni tarea.' -ForegroundColor Green
        exit 0
    }

    Assert-Elevated

    # ---- 6. Copiar archivos y configuración (con rollback si algo falla antes de registrar la tarea) ----
    Write-Step 'Copiando archivos'
    $dirExisted = Test-Path -LiteralPath $paths.Dir
    $oldConfig = $null
    $oldCjs = $null
    if (Test-Path -LiteralPath $paths.Config) { $oldConfig = [System.IO.File]::ReadAllBytes($paths.Config) }
    if (Test-Path -LiteralPath $paths.Cjs) { $oldCjs = [System.IO.File]::ReadAllBytes($paths.Cjs) }
    $registered = $false
    try {
        if ($Force) { Stop-AgentTask $TaskName $paths.Cjs }
        [void](New-Item -ItemType Directory -Force -Path $paths.Dir, $paths.Data, $paths.Logs)
        Set-SecureAcl $paths.Dir $true
        Copy-Item -LiteralPath $source -Destination $paths.Cjs -Force
        $json = $config | ConvertTo-Json
        [System.IO.File]::WriteAllText($paths.Config, $json, (New-Object System.Text.UTF8Encoding($false)))
        Set-SecureAcl $paths.Config $false
        Write-Ok "Archivos en $($paths.Dir) (config.json solo legible por Administradores y SYSTEM)"

        # ---- 7. Verificación ANTES de registrar la tarea ----
        Write-Step 'Verificando la configuración y la conexión con el servidor'
        $chk = Invoke-Native $node.Path ('"' + $paths.Cjs + '" check') $paths.Dir 60
        Write-Host ($chk.Output -replace 'bhst_[A-Za-z0-9_-]{8,}', 'bhst_***')
        if ($chk.ExitCode -ne 0) {
            Stop-WithError "La verificación falló (arriba está el motivo). No se instaló nada: corregí el dato indicado y volvé a correr el comando." 6
        }
        Write-Ok 'Servidor y token verificados'

        $doTest = $TestPrint.IsPresent
        if (-not $doTest -and -not $NoPrompt) { $doTest = Confirm-Yes 'Imprimir un ticket de prueba ahora' }
        if ($doTest) {
            Write-Step 'Ticket de prueba'
            $tp = Invoke-Native $node.Path ('"' + $paths.Cjs + '" test-print') $paths.Dir 90
            Write-Host ($tp.Output -replace 'bhst_[A-Za-z0-9_-]{8,}', 'bhst_***')
            if ($tp.ExitCode -ne 0) { Stop-WithError "No se pudo imprimir el ticket de prueba (arriba está el motivo). No se instaló nada." 6 }
            Write-Ok 'Ticket de prueba enviado: revisá el papel (acentos, negrita, corte)'
        }

        # ---- 8. Registrar e iniciar la tarea ----
        Write-Step 'Registrando la tarea programada'
        if (Get-AgentTask $TaskName) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }
        [void](Register-ScheduledTask -TaskName $TaskName -Xml $xml -Force)
        $registered = $true
        Write-Ok "Tarea '$TaskName' registrada"

        $offset = Get-LogLength $paths.Log
        Start-ScheduledTask -TaskName $TaskName
        Write-Info 'Esperando que el agente se conecte (hasta 30 segundos)...'
        if (-not (Wait-AgentConnected $paths.Log $offset 30)) {
            Write-Warn "La tarea quedó instalada pero no se vio 'Agente conectado' en 30 s. Mirá el log: $($paths.Log) y corré status.ps1."
            exit 7
        }
        Write-Ok 'El agente está conectado al servidor'
    }
    catch {
        if (-not $registered) {
            # Sin tarea registrada: volver al estado anterior (no dejar una instalación a medias).
            try {
                if ($dirExisted) {
                    if ($null -ne $oldConfig) { [System.IO.File]::WriteAllBytes($paths.Config, $oldConfig) } elseif (Test-Path -LiteralPath $paths.Config) { Remove-Item -LiteralPath $paths.Config -Force }
                    if ($null -ne $oldCjs) { [System.IO.File]::WriteAllBytes($paths.Cjs, $oldCjs) } elseif (Test-Path -LiteralPath $paths.Cjs) { Remove-Item -LiteralPath $paths.Cjs -Force }
                }
                elseif (Test-Path -LiteralPath $paths.Dir) { Remove-Item -LiteralPath $paths.Dir -Recurse -Force }
            }
            catch { }
        }
        throw
    }

    Write-Host ''
    Write-Host '=== Instalación terminada ===' -ForegroundColor Green
    Write-Info "Tarea programada : $TaskName (arranca sola con Windows y se reinicia si se cae)"
    Write-Info "Carpeta          : $($paths.Dir)"
    Write-Info "Log              : $($paths.Log)"
    Write-Info "Ver el estado    : .\status.ps1 -InstallDir `"$($paths.Dir)`" -TaskName $TaskName"
    Write-Info 'Siguiente paso   : en la Caja, aprobar un pedido de prueba y comprobar que salen los dos tickets.'
    exit 0
}
catch {
    # Los errores de validación ya salieron con Stop-WithError (exit); esto cubre lo inesperado.
    $msg = ($_.Exception.Message -replace 'bhst_[A-Za-z0-9_-]{8,}', 'bhst_***')
    Write-Host ''
    Write-Host "  [ERROR] Falló la instalación: $msg" -ForegroundColor Red
    Write-Host '  No quedó nada a medias: la tarea no se registró. Revisá el mensaje, corregí y volvé a correr el comando.' -ForegroundColor Red
    exit 1
}

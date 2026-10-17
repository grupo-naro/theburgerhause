# Burger Hause Print Agent

Programa Node.js que corre en cada PC del local con una impresora térmica USB. Se conecta HACIA AFUERA al
servidor (no abre puertos), recibe los trabajos de impresión (ticket de delivery y ticket del cliente con logo) por Server-Sent Events, los
traduce a ESC/POS y los imprime con el driver normal de Windows (modo RAW). Confirma cada trabajo al servidor.

El protocolo del lado servidor está en `docs/ops/print-agent-protocol.md`. **Para instalarlo en las PCs del local:
`docs/ops/print-agent-install.md`** (guía paso a paso para quien instala).

Garantías operativas:

- **Nunca imprime dos veces el mismo `job.id`**, ni siquiera después de reiniciar: los últimos 500 ids impresos
  se guardan en `DATA_DIR/state.json` (escritura atómica) *antes* de confirmar.
- **Las confirmaciones (`done`) no se pierden**: se guardan en disco y se reintentan (1 s → 30 s, respeta
  `Retry-After`) hasta que el servidor las recibe, también después de reiniciar el agente.
- Un trabajo a la vez, en orden de llegada; 20 s de tiempo máximo por impresión (si vence, se informa `failed`).
- Nunca se loguean documentos ni tokens (los tokens se enmascaran en cualquier salida).

## Requisitos

- Node.js 20 o superior en CADA PC (el programa es un único archivo, sin `node_modules`): el Node del sistema o un
  `node.exe` portable en `C:\BurgerHouseAgent\node\node.exe` (el instalador prefiere el portable si existe).
- Windows 10/11 con la impresora instalada con su driver normal (sirve incluso "Generic / Text Only").
  No hace falta Zadig/WinUSB ni cambiar el driver.

## Generar el archivo único

Desde la raíz del repo:

```
pnpm --filter @burgerhause/print-agent build     # tsc (chequeo + dist/lib)
pnpm --filter @burgerhause/print-agent bundle    # dist/print-agent.cjs (todo incluido)
```

Para instalar en un local no se copia a mano: se genera la release (ver abajo) y se usa `install.ps1`.

## Release e instalación (ZIP)

```
pnpm --filter @burgerhause/print-agent release
```

Corre `build` + `bundle` y deja en `packages/print-agent/release/` (ignorada por git) la carpeta
`burgerhause-print-agent-<versión>/`, el `.zip` y un `.zip.sha256`. Contenido: `print-agent.cjs`, `install.ps1`,
`uninstall.ps1`, `status.ps1`, `update.ps1`, `common.ps1`, `config.example.json` y `LEEME.txt`. Los scripts (PowerShell 5.1,
UTF-8 con BOM) viven en `install/`; las pruebas (`install/*.test.ts`) corren los scripts en simulación (`-DryRun`) y
solo en Windows.

En cada PC, PowerShell **como Administrador** en la carpeta descomprimida:

```
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -ServerUrl https://<servidor> -PrinterName "<impresora>"
```

Verifica con `check` ANTES de registrar nada, protege `config.json` con ACL (SYSTEM + Administradores) y registra la tarea
programada `BurgerHouseAgent` (al iniciar Windows, SYSTEM, reinicio automático). `status.ps1`, `update.ps1` y `uninstall.ps1`
completan el ciclo. Detalle, parámetros, códigos de salida y solución de problemas: `docs/ops/print-agent-install.md`.

## Configuración

Variables de entorno **o** un `config.json` junto al programa (el entorno gana). Ejemplo de `config.json`:

```json
{
  "SERVER_URL": "https://pedidos.example.com",
  "STATION_TOKEN": "bhst_...",
  "PAPER_WIDTH": 80,
  "CODEPAGE": "cp858",
  "PRINTER_BACKEND": "windows",
  "PRINTER_NAME": "POS-80"
}
```

| Clave | Obligatoria | Valores / por defecto |
| --- | --- | --- |
| `SERVER_URL` | sí | URL `https://…`. `http://` solo para `localhost`, o con `ALLOW_INSECURE=1` (no recomendado) |
| `STATION_TOKEN` | sí | `bhst_` + 43 caracteres; se genera y rota en Admin → Estaciones y se muestra una sola vez |
| `PAPER_WIDTH` | no | `80` (por defecto, 48 columnas) o `58` (32 columnas). Con tamaño doble el ancho efectivo es la mitad |
| `CODEPAGE` | no | `cp858` (por defecto) · `cp437` · `cp850` · `wpc1252` |
| `PRINTER_BACKEND` | no | `windows` (por defecto en Windows) · `tcp` · `file` · `console` |
| `PRINTER_NAME` | si `windows` | Nombre exacto de la impresora en Windows. Acepta acentos y ñ, espacios, `. _ - ( ) # / & + ' ,` (máx. 100), debe empezar con letra o número, y admite impresoras compartidas `\\PC\NOMBRE` |
| `PRINTER_HOST`, `PRINTER_PORT` | si `tcp` | IP/host de la impresora de red; puerto 9100 por defecto |
| `OUTPUT_DIR` | no (`file`) | Carpeta donde `file` guarda los trabajos (`job-<id>-<n>.bin`); por defecto `DATA_DIR/output` |
| `DATA_DIR` | no | Estado y logs. Por defecto `%PROGRAMDATA%\BurgerHouseAgent` en Windows, `./data` en otros sistemas |
| `LOG_LEVEL` | no | `debug` · `info` (por defecto) · `warn` · `error` |
| `ALLOW_INSECURE` | no | `1` permite `http://` fuera de localhost |

Los errores de configuración se muestran todos juntos, en español, nombrando la clave.

## Backends de impresión

- `windows`: impresión RAW por el spooler de Windows. Sin módulos nativos: ejecuta un script de PowerShell
  *constante* (se escribe en `DATA_DIR\scripts\raw-print-<hash>.ps1` y se verifica su hash en cada uso) que llama a
  `winspool.drv` (`OpenPrinter`, `StartDocPrinter` con datatype `RAW`, `WritePrinter`…). El nombre de la impresora y
  la ruta de los datos se pasan como **parámetros** (nunca se interpolan en el script) y el nombre se valida antes.
  El archivo temporal con los bytes se borra siempre. Tiempo máximo 15 s (se mata el proceso).
  Cada impresión arranca PowerShell y compila el P/Invoke (1–3 s en una PC lenta): es normal.

  **Importante: el Spooler de Windows acepta trabajos aunque la impresora USB esté desenchufada, apagada o sin papel.**
  `WritePrinter` termina bien y el trabajo queda en la cola de Windows; saldría después, de golpe, cuando la impresora
  vuelva. Por eso, antes de `StartDocPrinter`, el script lee el estado de la impresora (`GetPrinter` nivel 2, `PRINTER_INFO_2`
  `Status`/`Attributes`, por P/Invoke: funciona en Windows PowerShell 5.1 sin módulos extra) y **se niega a imprimir** si está
  *desconectada* (`WORK_OFFLINE` / `OFFLINE`), *sin papel* (`PAPER_OUT`), con papel atascado o con problema de papel, con error,
  *no disponible*, con la tapa abierta o esperando intervención. El agente responde `failed` con un mensaje como
  «La impresora no está lista: desconectada, sin papel»; el servidor reintenta hasta 3 veces y después se enciende la alerta
  roja de la Caja. El ahorro de energía (`POWER_SAVE`), ocupada, imprimiendo, etc. NO bloquean.

  Qué garantiza y qué NO: detecta lo que el driver/Spooler **informa**. Si el driver siempre dice "estado 0" (algunos drivers
  genéricos o puertos USB virtuales lo hacen), el trabajo se imprime igual (no se bloquea por falta de información) y
  **no hay forma de saber** desde el software si salió papel. Tampoco detecta un corte de papel o un atasco que la impresora
  no comunique a Windows. Esto solo se puede confirmar con la impresora real: ver la lista de verificación (pasos 7 y 11).
- `tcp`: socket directo a una impresora de red (puerto 9100).
- `file`: escribe los bytes ESC/POS a archivos (desarrollo, pruebas, diagnóstico). Nunca sobrescribe.
- `console`: vista previa de texto en la consola (solo desarrollo).

## Comandos

```
node print-agent.cjs run          # (por defecto) conecta e imprime
node print-agent.cjs test-print   # imprime un ticket de prueba; no necesita servidor
node print-agent.cjs check        # valida la config, lista impresoras de Windows y prueba la conexión
node print-agent.cjs --help
```

### Cómo encontrar el nombre de la impresora

```
node print-agent.cjs check
```

con `PRINTER_BACKEND=windows` lista las impresoras instaladas (`Get-Printer`) con su driver y puerto, y avisa si
`PRINTER_NAME` no coincide con ninguna. A mano: `powershell -Command "Get-Printer | Format-Table Name,DriverName,PortName"`.
Si el nombre tiene caracteres no permitidos (comillas, `;`, `|`, `%`, `< >`, `*`, `?`, o empieza con `-`), renombrá la
impresora en *Configuración → Impresoras y escáneres*.

`check` además hace un heartbeat al servidor: confirma que la URL y el token sirven y que la estación queda activa.
`check` solo envía un heartbeat: no abre el stream (para no desplazar a un agente que ya esté corriendo), así que no muestra
el nombre de la estación, solo la hora del servidor.

### Ticket de prueba

```
set PRINTER_BACKEND=windows
set PRINTER_NAME=POS-80
node print-agent.cjs test-print
```

Imprime el **logo** (raster `GS v 0`), acentos (`áéíóú ÁÉÍÓÚ ñ Ñ ü ¿ ¡ °`), negrita, tamaño doble, una línea larga para ver el
ajuste de palabras, divisores, `GRACIAS POR TU COMPRA` y el corte. Si el logo no sale (aparece el nombre en letras grandes),
la impresora no soporta `GS v 0`; el resto del ticket sale igual.

### El logo

`src/logo-data.ts` está **generado** y commiteado (`pnpm --filter @burgerhause/print-agent logo`, opcional `-- --preview <carpeta>` para
ver los PNG): 144×144 puntos para 58 mm y 192×192 para 80 mm, desde `public/logo.png` (círculo, fondo blanco = papel). Un bloque
desconocido del servidor se ignora; un bitmap inválido cae al texto.

## Ancho de papel: 58 vs 80 mm

`PAPER_WIDTH=58` → 32 columnas (16 en tamaño doble); `80` → 48 columnas (24 en tamaño doble). Si el ticket de
prueba se corta o sobra margen, probá el otro valor.

## Si los acentos salen mal

Probar en este orden con `test-print`: `CODEPAGE=cp858` (por defecto) → `cp437` → `cp850` → `wpc1252`. Cada impresora
trae distintas páginas de códigos; lo que se imprime debe verse `á é í ó ú ñ Ñ ¿ ¡`. Con `cp437` las mayúsculas
acentuadas (Á Í Ó Ú) salen sin tilde (esa página no las tiene). Los caracteres que ninguna página tiene se imprimen como `?`.
Si salen símbolos raros en lugar de letras, la impresora no entiende `ESC t n`: avisar al soporte con el modelo.

## Logs y estado

- Logs: `DATA_DIR\logs\agent.log` (rota a 1 MB, máximo 5 archivos) y la consola.
- Estado: `DATA_DIR\state.json` (ids impresos y confirmaciones pendientes). Si está corrupto, el agente lo aparta como
  `state.corrupt-<fecha>.json` y arranca limpio.
- Mensajes importantes:
  - `Token inválido o rotado: generá uno nuevo en Admin → Estaciones`: el servidor responde 401. El agente reintenta con
    espera creciente (5 s … 5 min) y se recupera solo cuando el token es válido.
  - `Otro agente se conectó para esta estación…`: hay otro proceso/PC con el mismo token. Este agente espera 60 s antes
    de reintentar (para no pelear). Revisá que solo haya un agente por estación.

## Servicio de Windows

Se instala como **tarea programada** (sin binarios externos) con `install/install.ps1`: disparador al iniciar Windows
(+30 s) más un vigilante cada 5 min (repetición infinita; no hace nada si el agente corre), cuenta SYSTEM, sin límite
de tiempo, reinicio cada 1 min (hasta 999 veces), instancia única. Ver la guía de
instalación. Al recibir `SIGINT`/`SIGTERM` (Ctrl+C) el agente termina el trabajo en curso y guarda el estado.

## Uso como biblioteca

```ts
import { startAgent } from "@burgerhause/print-agent";
const agent = startAgent(config, { backend, clock, rng, logger, fetch }); // todo inyectable
await agent.stop();
```

Lo usan las pruebas y el e2e (`e2e/print-agent-real.spec.ts`).

## Verificación manual con la impresora real (el modelo aún no está confirmado)

Marcar cada punto en la PC del local, con la impresora real:

1. [ ] Instalar el driver normal de la impresora (o "Generic / Text Only"); imprimir la página de prueba de Windows.
2. [ ] `node print-agent.cjs check` lista la impresora y `PRINTER_NAME` coincide.
3. [ ] `node print-agent.cjs test-print` imprime: título grande, negrita, tamaño doble, divisores, **corte**.
4. [ ] Acentos correctos (`á é í ó ú ñ Ñ ¿ ¡ °`); si no, probar `CODEPAGE` (cp858 → cp437 → cp850 → wpc1252).
5. [ ] El texto no se corta en el borde: probar `PAPER_WIDTH` 58/80 según el papel real.
6. [ ] El corte es parcial y deja el ticket colgando; el avance de papel antes del corte no desperdicia mucho.
7. [ ] Impresora desenchufada o apagada: correr `test-print`. Observar (a) el mensaje en consola/`agent.log`
   («La impresora no está lista: desconectada», o «No se encontró la impresora …» si Windows ya no la lista), (b) que la
   **cola de impresión de Windows** (*Impresoras y escáneres → la impresora → Abrir cola*) **no** acumula el trabajo, y (c) que no
   se cuelga (máx. 15 s). Volver a enchufarla y repetir: imprime. Si la cola SÍ acumula trabajos y el agente dice "impreso",
   el driver no informa su estado: anotar el modelo/driver (el chequeo previo no puede ayudar con ese driver).
8. [ ] Con `SERVER_URL`/`STATION_TOKEN` reales: `check` → `Servidor: OK`. Luego `run`, aprobar un pedido en la Caja:
   salen los tickets (en Delivery: el ticket de delivery y el del cliente con logo; en Mostrador: el del cliente) y los chips de la Caja pasan a "Impresión: ok".
9. [ ] Cerrar la Caja de otra PC no afecta; apagar internet 1 minuto y volver: el agente reconecta solo y no repite tickets.
10. [ ] Reiniciar el agente (Ctrl+C y volver a correr) no reimprime nada.
11. [ ] Dejar la impresora sin papel (o con la tapa abierta) y aprobar un pedido en la Caja. Observar: (a) la línea de log
   «Falló la impresión … La impresora no está lista: sin papel» en cada intento (cada ~10 s), (b) la cola de Windows sin
   trabajos acumulados, (c) la alerta roja en la Caja **después del 3.er intento fallido**, (d) al poner papel y tocar
   "Reimprimir", salen los tickets una sola vez. Si el log dice «Trabajo impreso» con la impresora sin papel, el driver no
   informa el estado (ver paso 7).
12. [ ] Medir cuánto tarda `test-print` en la PC MÁS LENTA del local (cada impresión arranca PowerShell y compila C#). Si pasa
   de ~6 s, avisar: habría que cambiar a un helper persistente (no se hace antes de medirlo).
13. [ ] Reiniciar la PC en frío (apagar y encender) y verificar que el agente vuelve a estar activo SOLO, sin que nadie inicie
   sesión ni abra nada a mano (tarea programada / servicio), y que el indicador de impresora de la Caja pasa a "lista".
14. [ ] Anotar el modelo de la impresora, driver y `CODEPAGE` que funcionó (pregunta abierta 2 del spec).

## Desarrollo

```
pnpm --filter @burgerhause/print-agent test        # pruebas del paquete
pnpm --filter @burgerhause/print-agent typecheck
pnpm --filter @burgerhause/print-agent lint
RAW_PRINTER_NAME="POS-80" pnpm --filter @burgerhause/print-agent test   # además imprime una prueba RAW real (Windows)
```

`pnpm test` en la raíz corre también estas pruebas y el contrato con el servidor
(`packages/print-agent/contract.test.ts`).

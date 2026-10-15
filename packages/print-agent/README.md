# Burger Hause Print Agent

Programa Node.js que corre en cada PC del local con una impresora térmica USB. Se conecta HACIA AFUERA al
servidor (no abre puertos), recibe los trabajos de impresión (cocina y ticket) por Server-Sent Events, los
traduce a ESC/POS y los imprime con el driver normal de Windows (modo RAW). Confirma cada trabajo al servidor.

El protocolo del lado servidor está en `docs/ops/print-agent-protocol.md`.

Garantías operativas:

- **Nunca imprime dos veces el mismo `job.id`**, ni siquiera después de reiniciar: los últimos 500 ids impresos
  se guardan en `DATA_DIR/state.json` (escritura atómica) *antes* de confirmar.
- **Las confirmaciones (`done`) no se pierden**: se guardan en disco y se reintentan (1 s → 30 s, respeta
  `Retry-After`) hasta que el servidor las recibe, también después de reiniciar el agente.
- Un trabajo a la vez, en orden de llegada; 20 s de tiempo máximo por impresión (si vence, se informa `failed`).
- Nunca se loguean documentos ni tokens (los tokens se enmascaran en cualquier salida).

## Requisitos

- Node.js 20 o superior en la PC (solo eso: el programa es un único archivo, sin `node_modules`).
- Windows 10/11 con la impresora instalada con su driver normal (sirve incluso "Generic / Text Only").
  No hace falta Zadig/WinUSB ni cambiar el driver.

## Generar el archivo único

Desde la raíz del repo:

```
pnpm --filter @burgerhause/print-agent build     # tsc (chequeo + dist/lib)
pnpm --filter @burgerhause/print-agent bundle    # dist/print-agent.cjs (todo incluido)
```

Copiar `packages/print-agent/dist/print-agent.cjs` a la PC (por ejemplo `C:\BurgerHouseAgent\print-agent.cjs`).

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
| `PRINTER_NAME` | si `windows` | Nombre exacto de la impresora en Windows (letras, números, espacios y `. - _ ( ) # / & +`, máx. 100) |
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
Si el nombre tiene caracteres fuera del conjunto permitido (por ejemplo acentos), renombrá la impresora en
*Configuración → Impresoras y escáneres*.

`check` además hace un heartbeat al servidor: confirma que la URL y el token sirven y que la estación queda activa.
(No abre el stream, para no desplazar a un agente que ya esté corriendo.)

### Ticket de prueba

```
set PRINTER_BACKEND=windows
set PRINTER_NAME=POS-80
node print-agent.cjs test-print
```

Imprime título grande en negrita, acentos (`áéíóú ÁÉÍÓÚ ñ Ñ ü ¿ ¡ °`), negrita, tamaño doble, una línea larga para ver el
ajuste de palabras, divisores y el corte.

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

Esta tarea no instala el servicio. Mientras tanto se puede correr con una tarea programada "al iniciar sesión" o con un
`.bat` (`node C:\BurgerHouseAgent\print-agent.cjs`). Al recibir `SIGINT`/`SIGTERM` (Ctrl+C) termina el trabajo en curso y guarda el estado.

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
7. [ ] Desenchufar la impresora o apagarla y correr `test-print`: debe mostrar un error claro
   («La impresora no responde» / «No se encontró la impresora …»), no colgarse (máx. 15 s).
8. [ ] Con `SERVER_URL`/`STATION_TOKEN` reales: `check` → `Servidor: OK`. Luego `run`, aprobar un pedido en la Caja:
   salen la comanda de cocina y el ticket, y los chips de la Caja pasan a "Impresión: ok".
9. [ ] Cerrar la Caja de otra PC no afecta; apagar internet 1 minuto y volver: el agente reconecta solo y no repite tickets.
10. [ ] Reiniciar el agente (Ctrl+C y volver a correr) no reimprime nada.
11. [ ] Dejar sin papel: el pedido queda con error y aparece la alerta roja en la Caja tras 3 intentos; "Reimprimir" funciona.
12. [ ] Anotar el modelo de la impresora, driver y `CODEPAGE` que funcionó (pregunta abierta 2 del spec).

## Desarrollo

```
pnpm --filter @burgerhause/print-agent test        # pruebas del paquete
pnpm --filter @burgerhause/print-agent typecheck
pnpm --filter @burgerhause/print-agent lint
RAW_PRINTER_NAME="POS-80" pnpm --filter @burgerhause/print-agent test   # además imprime una prueba RAW real (Windows)
```

`pnpm test` en la raíz corre también estas pruebas y el contrato con el servidor
(`packages/print-agent/contract.test.ts`).

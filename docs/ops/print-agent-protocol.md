# Protocolo del Print Agent (lado servidor)

Un agente Node.js corre en cada PC con impresora térmica USB y se conecta HACIA AFUERA al servidor
(no hay puertos abiertos en el local). El servidor le entrega los trabajos de impresión (ticket de
delivery y ticket del cliente) por Server-Sent Events y el agente confirma cada uno con un POST. Código: `src/lib/print/*`,
rutas en `src/app/api/agent/*`. El agente en sí es `packages/print-agent`; **cómo instalarlo en las PCs del local
(tarea programada de Windows, release ZIP, planilla de las 9 PCs): [`print-agent-install.md`](./print-agent-install.md).**

```
approveOrder / reprint ── INSERT print_jobs (pending) + NOTIFY print_job_created {jobId, stationId}
                                   │
                  listener ─► bus en memoria ─► stream de la estación (si hay agente conectado)
                                                      │  claim atómico → event: job
                                                      ▼
                                        agente imprime ─► POST /api/agent/jobs/:id/ack
                                                      │  done | failed
                           NOTIFY orders_changed ◄────┘  (chips y alerta de la Caja en vivo)
```

Si NO hay agente conectado, los trabajos quedan `pending` y se entregan UNA vez, del más viejo al más
nuevo, cuando el agente (re)conecta: nada se pierde y nada se duplica.

## Qué se imprime y el documento (Task 10.2)

**No se imprime comanda de cocina**: la reemplazará la pantalla de cocina (KDS) de una fase posterior. El renderer
(`renderKitchenTicket`) sigue en `src/domain/print-document.ts` y el valor `kitchen` sigue siendo válido en
`print_jobs.type` (historial y KDS futuro), pero nada lo encola hoy.

| Estación que aprueba / vende | Trabajos por pedido | Orden |
| --- | --- | --- |
| **Delivery** (pedido web de delivery) | `customer` + `delivery` | cliente primero |
| **Mostrador** (retiro web o venta de mostrador) | `customer` | — |

- `delivery`: ticket "normal" que viaja con el pedido: número grande, DELIVERY, hora, cliente, WhatsApp, dirección, entre
  calles, aclaraciones, cada unidad con sus modificaciones y nota, subtotal/envío/total y el cobro
  (`Efectivo: cobrar $X` o `Pago: Transferencia (pagado)`). **Sin logo ni agradecimiento.**
- `customer`: logo (bloque `logo`) arriba, `THE BURGER HOUSE 828`, número y fecha, datos, `LLAMADOR n` en ventas de
  mostrador, items con precios, totales, línea de pago y, al final, `GRACIAS POR TU COMPRA` centrado en negrita antes del corte.
- La regla es por **tipo de estación** (no por rol): un admin que aprueba un delivery en una estación Mostrador imprime solo el
  ticket del cliente. Una venta de mostrador siempre imprime solo `customer`.
- Reimpresión (`which`): `customer`, `delivery` (solo pedidos web de delivery; si no, `VALIDATION`) o `both` (= lo que imprimiría
  aprobar en ESA estación). Los valores viejos `kitchen`/`ticket` ya no se aceptan al reimprimir.
- Migración `0005`: `print_job_type` suma `delivery` y `customer` (`kitchen`/`ticket` quedan por historial; un `ticket` viejo equivale a un `customer`).

### Bloques (`PrintBlock`)

`text` (`text`, `bold?`, `size?` 1|2, `align?` left|center), `divider`, `cut` y **`logo`** (sin campos). El servidor NO manda el bitmap:
el agente lo trae embebido (`packages/print-agent/src/logo-data.ts`, generado desde `public/logo.png` con `pnpm --filter
@burgerhause/print-agent logo`) y lo imprime como raster ESC/POS `GS v 0`, centrado: **144 px de ancho en 58 mm** (máx. 384) y
**192 px en 80 mm** (máx. 512), 1 bit con difusión Atkinson y recorte circular (el fondo es papel). Si el bitmap no sirve, el
agente imprime `THE BURGER HOUSE 828` grande y centrado: la impresión nunca falla por el logo.

**Compatibilidad entre versiones**: un agente nuevo salta los tipos de bloque que no conoce (acepta el documento y lo imprime
sin ellos). Un agente **anterior a la 10.2** valida el documento de forma estricta y **falla** el trabajo `customer` (error
"documento inválido", alerta roja en la Caja) porque no conoce `logo`: hay que **actualizar los agentes** (`update.ps1`,
ver `print-agent-install.md`) antes o junto con el deploy del servidor.

## Autenticación (todos los endpoints)

`Authorization: Bearer bhst_<token>`. El token (`bhst_` + 43 caracteres base64url) se genera/rota en
Admin → Estaciones y se muestra UNA vez; en la base solo se guarda su sha256 (`stations.token_hash`).

- Token ausente, mal formado, desconocido o ya rotado: SIEMPRE `401 {"error":"unauthorized"}` (mismo
  cuerpo y headers: no revela qué falló). Rotar invalida el token viejo al instante y además corta
  el stream que el token viejo ya tenía abierto (se verifica en cada tick, como máximo 10 s).
- Intentos fallidos limitados por IP del cliente (`clientIp`, último salto de `X-Forwarded-For`):
  30 por 10 minutos; el 31.º responde `429 {"error":"too_many_attempts"}` con `Retry-After`.
  Las autenticaciones correctas NUNCA gastan ese cupo y un token válido siempre pasa (las 9 PCs
  comparten la IP del local: un agente mal configurado no puede bloquear a los demás).
- No se leen ni se escriben cookies. No hay headers CORS (el agente no es un navegador).
- Nunca se loguean tokens, documentos ni payloads (solo textos fijos y el código de error de pg).
- El agente que recibe `401` debe dejar de reintentar rápido (token inválido): reintentos con
  backoff largo o avisar al operador.

## `GET /api/agent/stream` (SSE)

Headers: `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache, no-transform`,
`X-Accel-Buffering: no`.

| Frame | Contenido |
| --- | --- |
| `retry: 3000` | el cliente reconecta a los 3 s |
| `event: hello` | `{ stationId, stationName, serverTime, protocol: 1, maxAttempts: 3, stuckAfterMs: 30000 }` |
| `event: job` | `{ id, type: "delivery"\|"customer"\|"kitchen"\|"ticket", attempts, createdAt, document }`; `document` = `{ blocks: PrintBlock[] }` tal cual se guardó. `type` es informativo: el agente imprime el `document` sea cual sea |
| `event: replaced` | otro agente se conectó para esta estación: este stream se cierra a continuación. NO reconectar en bucle |
| `: ping` | comentario cada 25 s |

Al conectar y luego cada 10 s mientras siga conectado, el servidor: actualiza `stations.last_seen_at`,
verifica que el token siga vigente, corre `requeueStuckJobs` y reclama + envía los trabajos `pending`
de esa estación (más viejos primero, máximo 20 por reclamo). Un `print_job_created` de la estación
dispara un reclamo inmediato (sin esperar al tick), y un `resync` del listener (reconexión a Postgres)
también.

- **Un solo stream activo por estación.** Una conexión nueva REEMPLAZA a la anterior (la vieja recibe
  `event: replaced` y se cierra), así un agente viejo o duplicado nunca puede imprimir dos veces.
- Tope global de 50 streams (`429` con `Retry-After` si se pasa; reemplazar el stream propio no cuenta).
- **Reclamo atómico**: un único `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)`; dos
  reclamadores concurrentes nunca reciben el mismo trabajo. Pasa a `printing`, `attempts + 1`,
  `claimed_at = ahora`.
- **Contrapresión**: si el cliente es lento no se reclaman más trabajos de los que caben en su cola;
  se reanuda cuando drena. Si el stream se cierra con trabajos recién reclamados sin enviar, se
  devuelven a `pending` (con el intento reembolsado).
- Un `payload` guardado que ya no valida (zod) NO se envía: el trabajo pasa a `failed` con el error
  `payload inválido` y se notifica a la Caja.
- Al cerrarse (abort, cancel, reemplazo, token rotado) se liberan suscripciones al bus, timers y
  la entrada del registro.

### Trabajos sin confirmación

Un trabajo `printing` con `claimed_at` de hace más de 30 s se considera colgado: si `attempts < 3`
vuelve a `pending` (mismos `attempts`) y se re-entrega; si ya usó los 3 intentos pasa a `failed` con
`sin confirmación de la impresora` y se notifica. Por eso un trabajo que una conexión anterior reclamó y
nunca confirmó puede llegar de nuevo pasados 30 s: **el agente debe deduplicar por `job.id`** (Task 6.2).

## `POST /api/agent/jobs/:id/ack`

Body JSON (máx. 4 KB): `{ "status": "done" | "failed", "error"?: string }`. `error`: hasta 2000
caracteres aceptados, se le quitan los caracteres de control y se guarda recortado a 300.

| Caso | Respuesta |
| --- | --- |
| `done`, desde cualquier estado que no sea `done` (incluso `pending` tras un requeue o `failed` final: el papel existe) | `200 {"ok":true,"status":"done"}`; `printed_at = ahora`, `error = null` |
| `done` repetido | `200 {"ok":true,"status":"done"}` sin cambios (idempotente) |
| `failed` con el trabajo `printing` y `attempts < 3` | `200 {"ok":true,"status":"pending"}`; el `error` queda guardado; se re-entrega en un tick posterior (~10 s, no antes) |
| `failed` con `printing` y `attempts >= 3` | `200 {"ok":true,"status":"failed"}` (definitivo) |
| `failed` y el trabajo NO está `printing` | `409 {"error":"not_printing"}` |
| id desconocido, mal formado o de otra estación | `404 {"error":"not_found"}` (idéntico, sin pistas) |
| body inválido | `400 {"error":"invalid_body"}` |

Actualiza `last_seen_at`. **Notificaciones**: cuando un trabajo pasa a `done` o a `failed` definitivo
(también por timeout o payload inválido) se emite, después del COMMIT, `orders_changed`
`{ orderId, status: <estado ACTUAL del pedido>, event: "updated" }` para que la Caja refresque en vivo
los chips de impresión y la alerta roja. Un `failed` que vuelve a `pending` no notifica (todavía no falló).

## `POST /api/agent/heartbeat`

Cuerpo vacío (se ignora). Actualiza `last_seen_at`. `200 {"ok":true,"serverTime":"<ISO>"}`. Sirve
para que el indicador de impresora de la Caja siga en línea (ventana de 90 s) cuando el agente no
tiene stream abierto o para chequear el token.

## Nginx

La ruta del stream necesita sin buffering y con un timeout de lectura largo (el servidor manda un
ping cada 25 s). Deploy: Task 9.2.

```nginx
location /api/agent/stream {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header X-Forwarded-For $remote_addr;   # SOBRESCRIBE: clientIp usa el último salto
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
}
```

(`/api/agent/jobs/*` y `/api/agent/heartbeat` van por el `location /` normal, también con
`X-Forwarded-For $remote_addr`.)

## Modos de falla

| Falla | Qué pasa |
| --- | --- |
| Agente offline al aprobar | Los trabajos quedan `pending` y se entregan una vez, en orden, al conectar |
| Se corta el stream | El agente reconecta (3 s). Lo reclamado y no confirmado vuelve tras 30 s (deduplicar por `id`) |
| Dos agentes para la misma estación | El último que conecta gana; el anterior recibe `replaced` |
| La impresora falla | `ack failed` → hasta 3 intentos → `failed` definitivo + alerta roja en la Caja |
| El agente muere sin confirmar | A los 30 s se reencola (o falla definitivo al 3.er intento) |
| Se pierde un NOTIFY o cae el listener | El tick de 10 s y el `resync` re-reclaman: no se pierden trabajos |
| Postgres no responde durante un tick | Log fijo, el stream sigue y reintenta en el próximo tick |
| Se rota el token | El viejo da 401 al instante; su stream abierto se corta en el próximo tick |

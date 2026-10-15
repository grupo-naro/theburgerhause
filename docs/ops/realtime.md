# Tiempo real (Postgres LISTEN/NOTIFY a SSE)

Las pantallas de staff (caja, despacho) se refrescan solas cuando cambia un pedido. Los clientes
NO usan esto: la página de seguimiento hace polling (`/api/pedido/[token]/status`).

## Cómo funciona

```
transacción (createOrder, cambios de estado...)
  └─ notifyInTx(tx, canal, payload)      pg_notify dentro de la transacción: sale solo si hace COMMIT
        │
   Postgres  ──LISTEN──►  listener (src/lib/events/listener.ts)   UNA conexión dedicada por proceso
                                │  parsea + valida (parseEventPayload)
                                ▼
                           bus en memoria (src/lib/events/bus.ts)
                                ▼
                  GET /api/events (src/lib/events/sse.ts)  ──SSE──►  useLiveEvents (navegador)
                                                                         └─ LiveRefresh → router.refresh()
```

- `src/instrumentation.ts` arranca el listener una vez por servidor (solo runtime `nodejs`, y NUNCA
  durante `next build`: no abre conexiones a la base al compilar).
- El listener usa su propio `pg.Client` (`application_name = bh-listener`), no el pool, y está
  guardado en `globalThis` (HMR y arranques duplicados no abren una segunda conexión).
- El bus y los contadores de conexiones también viven en `globalThis`: Next puede empaquetar
  instrumentation y route handlers como módulos separados.

## Canales y payloads

| Canal | Payload | Quién lo recibe |
| --- | --- | --- |
| `orders_changed` | `{ orderId, status, event }` con `event` en `created \| status \| assigned \| settled \| updated` (un `event` desconocido se trata como `updated`) | navegadores de staff (`event: orders`) |
| `print_job_created` | `{ jobId, stationId }` | solo el servidor (bus). NO se reenvía a navegadores |

Los payloads son livianos (sin datos personales): el navegador, al recibir un evento, vuelve a pedir
los datos reales al servidor. `notifyInTx` rechaza payloads de 7000 bytes o más (Postgres corta en 8000).

## Protocolo SSE (`GET /api/events`)

Requiere sesión de staff (`admin`, `cajera`, `encargada_delivery`): 401 sin sesión, 403 con otro rol.

1. `retry: 3000` (el navegador reconecta solo a los 3 s)
2. `event: hello` con `{ serverTime, connectionId }`
3. `event: orders` por cada `orders_changed`; `event: resync` cuando el listener se reconectó
4. `: ping` cada 25 s (mantiene vivo el proxy)

- La sesión se revalida cada 60 s; si fue revocada, venció o el usuario se desactivó, el stream se cierra.
  (Revalidar renueva la expiración deslizante, igual que el uso normal.)
- Topes: 10 streams por usuario y 200 en total (429 al pasarse). Los contadores se liberan al abortar.
- Cliente lento: si su cola se llena se descartan eventos (no se acumulan) y se le manda UN `resync` después.
- Las respuestas llevan `Cache-Control: no-cache, no-transform` y `X-Accel-Buffering: no`.

## Modos de falla y cómo se cubren

| Falla | Qué pasa |
| --- | --- |
| Se cae la conexión del listener (reinicio de Postgres, red, `pg_terminate_backend`) | Reconecta con backoff 1 s, 2 s, 4 s... hasta 30 s. En CADA (re)conexión publica `resync`, así los clientes recargan lo que pudieron perderse mientras estaba caído. `listenerStatus()`: `connecting \| live \| down` |
| Se corta el stream del navegador | `EventSource` reconecta (3 s). Al volver a abrir, el hook llama `onResync` (refetch completo) |
| Sin conexión > 10 s | El indicador pasa a "Sin conexión" y arranca un sondeo de respaldo cada 15 s (`onResync`) hasta que vuelva el stream |
| Payload inválido en el canal | Se ignora (log fijo, sin contenido); el listener sigue |
| Rollback / COMMIT fallido | No se emite nada (NOTIFY es transaccional) |

Los logs usan textos fijos y el código de error de pg. Nunca imprimen cadenas de conexión ni payloads.

## Requisitos de Nginx

```
location /api/events {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
}
```

`proxy_buffering off` y `proxy_read_timeout 1h` son obligatorios (el header `X-Accel-Buffering: no`
ya lo pide la app por si falta lo primero). Con gzip activo, excluir `text/event-stream`.

## Supuesto de una sola instancia

El bus es en memoria: cada proceso Node escucha Postgres por su cuenta, así que varias instancias
también funcionarían (cada una recibe todos los NOTIFY), pero los topes de conexiones son por proceso.
Hoy hay una sola instancia.

## Depurar

```
psql "$DATABASE_URL" -c "LISTEN orders_changed;" -c "LISTEN print_job_created;"   # y esperar (en psql, \watch o un select 1 muestra las notificaciones)
psql "$DATABASE_URL" -c "select pg_notify('orders_changed', '{\"orderId\":1,\"status\":\"entregado\",\"event\":\"updated\"}')"
psql "$DATABASE_URL" -c "select pid, state from pg_stat_activity where application_name = 'bh-listener'"
curl -N -H "Cookie: bh_session=<token>" http://localhost:3000/api/events
```

Tip: para probar la reconexión, `select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'bh-listener'`;
los streams abiertos reciben `event: resync` en ~1 s.

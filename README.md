# The Burger House 828

Sistema de pedidos y despacho de The Burger House 828: tienda online para los clientes, caja y mostrador
para aprobar y cobrar, impresión automática de tickets, despacho con cadetes y rendición de efectivo.

El ciclo completo que cubre (criterio de éxito del MVP): pedido del cliente → aprobación en caja → tickets
impresos solos en la impresora USB de la PC correspondiente (Delivery: ticket de delivery + ticket del cliente con logo;
Mostrador: ticket del cliente; sin comanda de cocina hasta la pantalla KDS) → despacho → cadete → rendición del efectivo.

## Arquitectura

Un monolito, sin servicios extra:

- **Next.js 16 (App Router) + TypeScript**: tienda pública, pantallas de staff y API en el mismo proceso.
  Esta versión de Next tiene cambios incompatibles con lo habitual: leé `node_modules/next/dist/docs/` antes de
  tocar código de Next (ver `AGENTS.md`).
- **PostgreSQL + Drizzle ORM**: única fuente de verdad (migraciones en `src/db/migrations`).
- **Tiempo real por SSE**: las pantallas de staff se refrescan solas (Postgres `LISTEN/NOTIFY` → bus en memoria →
  `GET /api/events`). El cliente final hace polling de `/api/pedido/[token]/status`. Detalle: `docs/ops/realtime.md`.
- **Print Agent** (`packages/print-agent`): programa Node que corre en cada PC con impresora térmica. Se conecta hacia
  afuera por SSE, imprime ESC/POS y confirma cada trabajo. Protocolo: `docs/ops/print-agent-protocol.md`.

Diseño y plan (leer primero):

- `docs/superpowers/specs/2026-10-14-the-burger-hause-mvp-design.md`: alcance, máquina de estados, flujos.
- `docs/superpowers/specs/2026-10-14-the-burger-hause-ux-design.md`: diseño de la interfaz.
- `docs/superpowers/plans/2026-10-14-mvp-roadmap.md`: plan por sprints.

## Puesta en marcha local

Requisitos: Node.js 20 o superior (se desarrolla con 24), pnpm 10 y Docker.

```bash
docker compose up -d          # PostgreSQL 16 en localhost:15435 (usuario/clave/base: burgerhause)
cp .env.example .env          # y cambiá SESSION_SECRET (mínimo 32 caracteres)
pnpm install
pnpm db:migrate               # aplica las migraciones
pnpm db:seed                  # SOLO desarrollo: carga menú, categorías, modificadores y estaciones de DEMO
pnpm db:seed-admin            # crea el usuario admin (usuario "admin"; si no definís ADMIN_PASSWORD imprime una clave generada)
pnpm dev                      # http://localhost:3000
```

El Postgres de `docker-compose.yml` se publica en el puerto **15435** del host (no en el 5432), por eso el
`DATABASE_URL` de `.env.example` apunta ahí. `pnpm db:seed-admin` acepta `ADMIN_USERNAME` y `ADMIN_PASSWORD`.
Las demás cuentas (cajera, encargada) las crea el admin en `/admin/usuarios`.

### Variables de entorno

| Variable | Obligatoria | Para qué sirve |
| --- | --- | --- |
| `DATABASE_URL` | sí | Conexión a PostgreSQL (`postgres://...`). Los tests usan la base `burgerhause_test` del mismo servidor. |
| `SESSION_SECRET` | sí | Firma de las sesiones. Mínimo 32 caracteres. |
| `UPLOAD_DIR` | sí | Carpeta donde se guardan las fotos de productos subidas desde el admin. |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | no | Solo para `pnpm db:seed-admin`. |

Se validan al arrancar (`src/lib/env.ts`).

## Roles y pantallas

Roles de staff: `admin`, `cajera`, `encargada_delivery`. El cliente final no tiene cuenta. El login es en `/login`;
cajera y encargada eligen su **estación** (por ejemplo "Mostrador 1", "Delivery 1") en `/estacion`: de esa estación
salen las impresiones.

| Ruta | Quién | Qué hace |
| --- | --- | --- |
| `/` | público | Carta con búsqueda y categorías; hoja de producto con personalización por unidad. |
| `/carrito` | público | Carrito (guardado en el navegador). |
| `/checkout` | público | Delivery o retiro; efectivo o transferencia; crea el pedido. |
| `/pedido/[token]` | público | Seguimiento del pedido (línea de tiempo, datos de pago, contacto). |
| `/login`, `/estacion` | staff | Ingreso y elección de estación. |
| `/mostrador` (**Venta**) | cajera, admin | Punto de venta de mostrador con llamador (pager), cobro e impresión. |
| `/mostrador/pedidos` (**Mostrador**) | cajera, admin | Ventas de mostrador en curso: en cocina, listo → llamar, para retirar → entregado. |
| `/retiro` (**Retiro en local**) | cajera, admin | Pedidos web **de retiro**: por aprobar (verificación de transferencia / rechazo con motivo), en preparación, listos, para retirar con cobro al entregar, recientes, alerta de impresión fallida y reimpresión. |
| `/delivery` (**Gestión Delivery**) | encargada, admin | Pedidos web **de delivery** en pestañas: Por aprobar · En preparación · Listos / Despacho (asignar 1..N pedidos a un cadete) · En camino · Recientes. |
| `/delivery/rendicion` (**Rendición**) | encargada, admin | Saldo de cada cadete y rendición del efectivo (con faltante y comprobante). `/despacho/rendicion` redirige acá. |
| `/caja`, `/despacho` (**Vista general**, **Tablero general**) | admin | Vistas de solo lectura/gestión de todos los sectores. El resto del personal que entra por estas URLs viejas va a su espacio de trabajo. |

**Un espacio de trabajo por sector.** Los pedidos web se reparten por tipo: los de *delivery* solo aparecen (y solo se
pueden aprobar, rechazar, reimprimir, despachar y rendir) en estaciones **Delivery**; los de *retiro* y las ventas de
mostrador, en estaciones **Mostrador**. Se hace cumplir en el servidor (filtro por sector en las consultas y error
`WRONG_SECTOR` en las acciones, antes de escribir nada); el admin está exento. La cajera solo puede elegir estaciones
de Mostrador y la encargada de Delivery. La aprobación imprime en la estación que aprueba.
| `/admin` | admin | Panel. |
| `/admin/menu`, `/admin/modificadores` | admin | Productos, categorías, grupos de modificadores. |
| `/admin/usuarios`, `/admin/cadetes` | admin | Cuentas de staff y cadetes. |
| `/admin/estaciones` | admin | Estaciones y tokens del Print Agent. |
| `/admin/ajustes` | admin | Datos del local, costo de envío, datos bancarios, pedidos abiertos/cerrados. |

API (no es para uso humano): `/api/events` (SSE del staff), `/api/pedido/[token]/status`, `/api/uploads`,
`/uploads/...` (fotos) y `/api/agent/stream`, `/api/agent/heartbeat`, `/api/agent/jobs/[id]/ack` (Print Agent, con
token de estación).

## Tests

```bash
pnpm lint            # ESLint
pnpm test            # unitarios (Vitest): src/ y packages/ (incluye el Print Agent)
pnpm test:int        # integración contra PostgreSQL real (base burgerhause_test)
pnpm test:deploy     # artefactos de producción (deploy/): scripts, rollback, Nginx y backup/restore, en Docker
pnpm e2e             # Playwright: compila la app, la levanta en :3100 y corre todo
pnpm e2e:ui          # runner interactivo
pnpm verify:fast     # lint + unitarios + typecheck del agente + build
pnpm verify          # TODO: lint, unitarios, typecheck del agente, integración, build y e2e (ver abajo)
```

- `pnpm test:int` y `pnpm e2e` comparten la base `burgerhause_test` (se crea sola) y no pueden correr a la vez.
  Necesitan Docker con Postgres levantado (`docker compose up -d`). Para e2e instalá Chromium una vez:
  `pnpm exec playwright install chromium`.
- **`pnpm verify`** es el comando de la rama completa: corre todo en orden y corta en el primer error (el código de
  salida se propaga). Termina con `git status --porcelain`, que lista lo que quedó sin commitear. Tarda unos
  **11 minutos** (unos 10,5 medidos, de los cuales ~6 son los e2e) en esta máquina.
- Tests del agente: `pnpm --filter @burgerhause/print-agent test` (los corre también `pnpm test`) y
  `pnpm --filter @burgerhause/print-agent typecheck`.

### Convenciones de e2e

Leé `e2e/README.md`. Lo esencial:

- La carta pública se prerenderiza al compilar, así que la base de test se siembra **una sola vez, ANTES de
  `next build`** (`e2e/prepare-db-cli.ts`); el setup global no resiembra.
- Usuarios de prueba `admin`, `cajera`, `encargada` con sesión guardada (`storageState`); proyectos `desktop` y
  `mobile` (solo tests con `@mobile` en el título); un solo worker; sin esperas fijas.
- **Journeys** (`e2e/journey-*.spec.ts`): recorridos completos entre roles y con el Print Agent real en proceso:
  J1 pedido web con delivery (cliente, caja, impresión, despacho, cadete, rendición), J2 venta de mostrador con
  llamador, J3 retiro con efectivo + rechazo + rendición con faltante, J4 estación sin agente (caídas, reenvío sin
  duplicar papel, alerta de impresión fallida y reimpresión).

## Print Agent

Corre en cada PC del local con impresora térmica USB. Una estación = un token (se genera y rota en
`/admin/estaciones`). Garantías: nunca imprime dos veces el mismo trabajo (ni tras reiniciar) y no pierde
confirmaciones. Sin agente conectado los trabajos quedan pendientes y salen cuando vuelve; tras 3 fallos la caja
muestra una alerta con botón de reimpresión.

- Guía de instalación paso a paso: `docs/ops/print-agent-install.md`.
- Protocolo servidor-agente: `docs/ops/print-agent-protocol.md`.
- Paquete, build y release: `packages/print-agent/README.md`.

## Operación

Producción: una VPS Ubuntu con Nginx (TLS) → un solo proceso Next.js bajo systemd → PostgreSQL local. Todo está en
`deploy/` y la guía para quien administra el servidor es **`docs/ops/runbook.md`** (alta de la VPS desde cero,
deploy y rollback, backups y restauración, monitoreo, rotación de secretos, problemas comunes y contingencia).

```bash
pnpm db:init-prod                      # producción: solo los ajustes por defecto (local cerrado a pedidos); NUNCA db:seed
sudo ./deploy/scripts/deploy.sh        # en la VPS: migra → compila → reinicia → chequea /api/health → rollback automático
```

- `GET /api/health`: `200 {status:"ok",db:"ok",realtime,...}` o `503` si la base no responde (sin filtrar detalles).
- `pnpm db:seed` se niega a correr con `NODE_ENV=production` (salvo `ALLOW_DEMO_SEED=1`, solo para pruebas).
- La compilación pre-renderiza el menú: la base tiene que estar alcanzable **y migrada** al hacer `pnpm build`.
- Una sola instancia: el bus de eventos y los límites de intentos viven en memoria (no usar PM2 en cluster).
- `pnpm test:deploy` verifica en Docker lo que se puede sin la VPS real (sintaxis y comportamiento de Nginx, deploy con
  rollback, backup → restauración con conteo de filas). Lo que solo se prueba en la VPS está listado al principio de la
  sección 2 del runbook.

## Estructura

```
src/
  app/            rutas: (public) tienda, (staff) caja/mostrador/despacho/login, (admin) panel, api/
  components/     UI por área (menu, cart, checkout, tracking, caja, pos, despacho, rendicion, admin...)
  domain/         reglas puras: dinero, precios, estados del pedido, saldo de cadetes, documentos de impresión
  lib/            casos de uso y servicios (orders, print, events, auth, settlements, stations, uploads...)
  db/             esquema Drizzle, migraciones, seed
  test-support/   utilidades de test
packages/
  print-agent/    el agente de impresión (paquete @burgerhause/print-agent)
deploy/           producción: nginx/, systemd/, scripts/ (deploy, backup, restore), env/, postgres/, tests/
e2e/              Playwright: specs, journeys y helpers
docs/
  ops/            runbook de producción, realtime, protocolo e instalación del agente
  superpowers/    specs y plan del MVP
```

## Decisiones clave

- **Dinero en centavos enteros**: nunca hay decimales ni floats en precios, totales ni rendiciones
  (`src/domain/money.ts`).
- **Snapshots**: el pedido guarda nombre y precio de cada producto y modificador al momento de comprar; cambiar el
  menú después no altera pedidos viejos.
- **Una fila `order_items` por unidad**: dos hamburguesas son dos filas, cada una con sus modificaciones; así la
  los tickets se leen unidad por unidad.
- **Idempotencia**: crear pedido (web y mostrador) usa una clave de idempotencia; reintentar tras un error de red
  no duplica el pedido.
- **Advisory locks de Postgres** (`pg_advisory_xact_lock`) serializan la creación de pedidos con la misma clave y la
  asignación de un llamador del mostrador, para que dos ventas no tomen el mismo número.
- **SSE + LISTEN/NOTIFY**: los cambios de estado emiten `pg_notify` dentro de la misma transacción (solo sale si
  hace commit) y llegan a las pantallas de staff sin recargar.
- **Sin borrados duros de datos de negocio** (solo se borran sesiones): usuarios, cadetes, productos y estaciones se desactivan; los pedidos se cancelan y cada
  cambio de estado queda en `order_events`.

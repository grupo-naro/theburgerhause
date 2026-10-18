# The Burger Hause — Diseño técnico Fase 1 (MVP)

Fecha: 2026-10-14 · Estado: pendiente de revisión

## 1. Objetivo y alcance

Reemplazar la app actual (pxw) por un sistema propio en Next.js para una hamburguesería de un solo local.

**Criterio de éxito del MVP:** las 9 PCs (4 mostrador, 5 delivery) operan el ciclo completo de un pedido sin fallas: pedido del cliente → aprobación en caja → comanda impresa automáticamente en la impresora USB de la PC correspondiente → despacho → cadete → rendición de efectivo.

**Dentro de la Fase 1:**
- Menú digital y checkout para clientes.
- Panel de caja, POS de mostrador, despacho, gestión y rendición de cadetes.
- Admin de menú, modificadores, usuarios, estaciones y ajustes.
- Impresión térmica USB mediante Print Agent local.

**Fuera de la Fase 1 (YAGNI):** KDS y stock (Fase 2), pago online, cupones, multi-sucursal, app nativa de cadetes, login de clientes, costo de envío por zona.

## 2. Stack y decisiones

| Tema | Decisión |
|---|---|
| Framework | Next.js 16.4.1 (App Router), React 19.3, Tailwind 4, TypeScript, pnpm |
| Arquitectura | Monolito Next.js. Server Actions para mutaciones; Route Handlers para SSE, uploads y API del agente |
| BD | PostgreSQL local en la VPS |
| ORM | Drizzle (esquema TS, migraciones SQL, sin binarios nativos) |
| Tiempo real | SSE + Postgres `LISTEN/NOTIFY` |
| Impresión | Print Agent Node.js por PC (servicio de Windows), ESC/POS |
| Imágenes | Disco local de la VPS, procesadas con `sharp`, servidas por Nginx |
| Auth | Sesión propia en Postgres, cookie httpOnly |
| Validación | zod |
| Tests | Vitest (dominio e integración), Playwright (flujos críticos) |

**Particularidades de esta versión de Next.js** (leer `node_modules/next/dist/docs/` antes de codificar, según `AGENTS.md`):
- Middleware se llama **Proxy** (`src/proxy.ts`).
- `next.config.ts` tiene `cacheComponents: true` y `partialPrefetching: true`. Las pantallas de staff son dinámicas y se envuelven en `<Suspense>`. El menú público usa `use cache` con invalidación por tag.

## 3. Modelo de datos

Importes en **enteros (centavos)**. Los pedidos guardan snapshots de nombres y precios.

### Menú
- `categories`: id, name, slug, sort, active, image_path.
- `products`: id, category_id, name, description, price, image_path, active, sort. Las "variedades" (Ranchita simple, Melt simple…) son productos dentro de su categoría; no hay árbol de subcategorías.
- `modifier_groups`: id, name.
- `modifiers`: id, group_id, name, `kind` (`remove` | `add` | `swap`), price_delta, kitchen_label (ej. "SIN CHEDDAR", "+ DIPS CHEDDAR", "PAPAS GRANDES"), active, sort.
- `product_modifier_groups`: product_id, group_id.

### Pedidos
- `orders`: id, number (correlativo diario), public_token (128 bits), channel (`web` | `counter`), fulfillment (`delivery` | `takeaway`), status, payment_method (`cash` | `transfer`), payment_status (`pending` | `paid`), customer_name, whatsapp, address, cross_streets, address_notes, pager_number (obligatorio en mostrador), subtotal, delivery_fee, total, cadet_id, approved_by, station_id, created_at, approved_at, delivered_at.
- `order_items`: **una fila por unidad** (2 hamburguesas = 2 filas, con modificaciones independientes). Campos: order_id, product_id, name_snapshot, unit_price_snapshot, notes.
- `order_item_modifiers`: order_item_id, modifier_id, name_snapshot, kitchen_label, kind, price_delta.
- `order_events`: order_id, from_status, to_status, user_id, at. Auditoría.

### Operación
- `users`: id, name, username, password_hash, role (`admin` | `cajera` | `encargada_delivery`), active.
- `sessions`: id, user_id, expires_at, station_id.
- `stations`: id, name, kind (`mostrador` | `delivery`), token_hash, last_seen_at.
- `cadets`: id, name, phone, active.
- `settlements`: id, cadet_id, amount, settled_by, created_at.
- `settlement_orders`: settlement_id, order_id, amount.
- `print_jobs`: id, order_id, station_id, type (`delivery` | `customer`; `kitchen` | `ticket` solo historial / KDS futuro, ver addendum Task 10.2), payload (jsonb), status (`pending` | `printing` | `done` | `failed`), attempts, error, created_at, printed_at.
- `settings`: clave/valor — datos del local, alias/CBU para transferencias, `delivery_fee`.

**Saldo del cadete (calculado, no almacenado):** suma de `total` de pedidos con `cadet_id = X`, `payment_method = cash`, `payment_status = pending`, `status = entregado`. Los pedidos `en_camino` se muestran aparte como "en ruta".

## 4. Máquina de estados

```
pendiente_aprobacion ──aprobar──▶ en_preparacion ──▶ listo_despacho
        │                                              │
     rechazar                          delivery: ──▶ en_camino ──▶ entregado
        ▼                              takeaway: ──▶ para_retirar ──▶ entregado
    cancelado
```

| Transición | Quién | Efectos |
|---|---|---|
| (web) crear → `pendiente_aprobacion` | Cliente | `payment_status = pending` |
| `pendiente_aprobacion → en_preparacion` | Cajera | Transferencia: `paid` ("Aprobado y Pagado"). Efectivo: `pending` ("Aprobado"). Crea los `print_jobs` de la estación que aprobó: Delivery = `delivery` + `customer`, Mostrador = `customer` (sin comanda de cocina; ver addendum Task 10.2) |
| `pendiente_aprobacion → cancelado` | Cajera | Motivo registrado en `order_events` |
| (mostrador) crear → `en_preparacion` | Cajera | `paid`, pager obligatorio, crea `print_jobs` |
| `en_preparacion → listo_despacho` | Despacho (manual en MVP; en Fase 2 lo hace cocina/KDS) | — |
| `listo_despacho → en_camino` | Encargada delivery | Asigna cadete a 1..N pedidos |
| `listo_despacho → para_retirar` | Cajera | Llamado por N° de pager |
| `en_camino → entregado` / `para_retirar → entregado` | Encargada / Cajera | `delivered_at` |
| `en_camino → listo_despacho` | Encargada | Entrega fallida; se desasigna cadete |
| Rendición | Encargada | Ver §6.4 |

Reglas:
- "Aprobado" no es un estado persistente: queda en `order_events`.
- "Cerrado y Rendido" = `entregado` con `payment_status = paid` tras la rendición.
- Toda transición se valida en una función pura de dominio (`canTransition`), con tests.

## 5. Rutas, endpoints y tiempo real

### Páginas
- `(public)`: `/` (menú por categorías + modal de producto), `/carrito`, `/checkout`, `/pedido/[token]`.
- `(staff)`: `/login`, `/estacion`, `/mostrador` (Venta), `/mostrador/pedidos`, `/retiro`, `/delivery` (Gestión Delivery), `/delivery/rendicion`; vistas generales del admin: `/caja`, `/despacho`.
- `(admin)`: `/admin/menu`, `/admin/modificadores`, `/admin/cadetes`, `/admin/usuarios`, `/admin/estaciones`, `/admin/ajustes`.

El carrito vive en el cliente (estado + `localStorage`) y se persiste solo al confirmar.

### Server Actions
Todas validan con zod y llaman `requireRole()`. Cada una corre en una transacción que escribe `order_events` y ejecuta `pg_notify`.

| Acción | Rol | Notas |
|---|---|---|
| `createOrder` | público | Recalcula precios desde la BD; rate limit por IP; honeypot |
| `approveOrder`, `rejectOrder` | cajera | — |
| `createCounterOrder` | cajera | Cobro inmediato, pager obligatorio |
| `markReady` | cajera / encargada | — |
| `assignCadet(orderIds[], cadetId)` | encargada | Asignación múltiple, pasa a `en_camino` |
| `markDelivered`, `returnToDispatch` | encargada / cajera | — |
| `settleCadet(cadetId)` | encargada | Transacción: crea `settlement`, pedidos → `paid`, saldo 0 |
| `reprintJob` | cajera / encargada | Crea nuevo `print_job` |
| CRUD de menú, modificadores, cadetes, usuarios, estaciones, ajustes | admin | — |

### Route Handlers
- `GET /api/events`: SSE para personal con sesión.
- `POST /api/uploads`: imágenes (admin).
- `GET /api/agent/stream`, `POST /api/agent/jobs/[id]/ack`, `POST /api/agent/heartbeat`: `Authorization: Bearer <token de estación>`.
- `GET /api/health`.

### Tiempo real
- Un listener `pg` singleton por proceso (arrancado desde `src/instrumentation.ts`) escucha `orders_changed` y `print_job_created` y reenvía a los streams SSE abiertos.
- Los eventos son livianos (`{orderId, status}`); el cliente refresca sus datos al recibirlos y siempre hace refetch completo al reconectar.
- Keep-alive cada 25 s. Nginx: `proxy_buffering off`, timeout de lectura alto.
- Una sola instancia Node (PM2/systemd). Si hubiera más, cada una escucha por su cuenta.

## 6. Flujos de usuario

### 6.1 Cliente
Menú → categoría → producto → modal (para cantidad N, N configuraciones independientes de quites y agregados) → carrito (desglose de modificaciones, cambiar cantidades, eliminar, volver al menú) → checkout (nombre, WhatsApp, método de pago, tipo de entrega; delivery pide dirección, entre calles y aclaraciones; takeaway muestra datos del local; transferencia muestra alias/CBU) → confirmación con enlace a `/pedido/[token]`.

### 6.2 Caja (pedidos web)
Bandeja en vivo de `pendiente_aprobacion`. Transferencia: verificar acreditación y aprobar (`paid`). Efectivo: aprobar (`pending`). Al aprobar se imprimen los tickets en la estación que aprueba (ver addendum Task 10.2: no hay comanda de cocina). **Cada sector aprueba solo sus pedidos** (addendum Task 10.1): la encargada de delivery (estación Delivery) los de delivery y la cajera (estación Mostrador) los de retiro; el admin, todos. Un pedido ya aprobado se puede cancelar (en preparación, listo o para retirar) con motivo obligatorio, con la misma regla de sector.

### 6.3 Mostrador (POS)
Selección rápida de productos y modificadores → método de cobro → pager obligatorio → confirmar → ticket del cliente impreso (con logo).

### 6.4 Despacho y rendición
- Despacho takeaway: marcar `para_retirar` y llamar al cliente por pager.
- Despacho delivery: seleccionar cadete + N pedidos `listo_despacho` → `en_camino`.
- Rendición: pantalla por cadete con desglose de pedidos en efectivo entregados y total a rendir. Al recibir el efectivo, `settleCadet` deja el saldo en $0.

## 7. Print Agent

- Proceso Node.js por PC, instalado como servicio de Windows. Config: `SERVER_URL`, `STATION_TOKEN`, ancho de papel (58/80 mm). Solo conexiones salientes.
- La usuaria elige estación al iniciar sesión (cookie del dispositivo). Los `print_jobs` se crean con el `station_id` de la PC donde se aprobó o cobró el pedido.
- **Protocolo:**
  1. El agente abre `GET /api/agent/stream`; recibe todos los trabajos `pending` de su estación y luego los nuevos en vivo.
  2. Imprime y llama a `ack` con `done` o `failed` + error.
  3. Un trabajo en `printing` más de 30 s sin ack vuelve a `pending`; tras 3 intentos pasa a `failed`.
  4. Las pantallas de staff alertan los `failed` con botón "Reimprimir" y muestran agentes desconectados (`last_seen_at`).
- **Idempotencia:** el agente recuerda los últimos IDs impresos.
- **Render:** el servidor genera un documento neutro en JSON (bloques de texto con estilo, alineación, tamaño, separador, corte); el agente solo lo traduce a ESC/POS. Las plantillas se cambian sin reinstalar agentes.
- **Comanda de cocina (DIFERIDA a la fase de pantalla KDS, Task 10.2):** items por unidad, modificaciones destacadas (negrita, doble tamaño). El renderer `renderKitchenTicket` y el valor `kitchen` del enum se conservan, pero NO se encola nada. **Ticket del cliente:** logo, precios, total, datos del cliente, N° de llamador y "GRACIAS POR TU COMPRA". **Ticket de delivery:** número, tipo, cliente, teléfono, dirección y referencias, items por unidad con modificaciones, cobro (`Efectivo: cobrar $X`), sin logo.

## 8. Autenticación y seguridad

- Usuario + contraseña (argon2 o scrypt). Sesión en tabla `sessions`, cookie `httpOnly`, `secure`, `sameSite=lax`, expiración deslizante de 12 h, revocable desde admin.
- `proxy.ts` solo hace el chequeo optimista de cookie; la autorización real vive en `requireRole()`.
- Pedidos públicos: rate limit por IP, zod estricto, honeypot, token no enumerable.
- Tokens de agente hasheados; rotables y revocables desde `/admin/estaciones`.

## 9. Imágenes

`POST /api/uploads` valida tipo por magic bytes y límite de 5 MB; `sharp` convierte a webp en 800 px y 200 px y guarda en `/var/lib/burgerhause/uploads/<uuid>.webp`. Nginx sirve `/uploads/` con caché larga. En desarrollo lo sirve un Route Handler. La carpeta entra en el backup.

## 10. Despliegue (Ubuntu, Contabo)

- Nginx (TLS Let's Encrypt) → `next start` bajo systemd/PM2 (una instancia) → PostgreSQL local (puerto 5432 no expuesto).
- `drizzle-kit migrate` en el paso de deploy, antes de reiniciar.
- Variables en `.env` fuera del repo: `DATABASE_URL`, `UPLOAD_DIR` (las sesiones son tokens aleatorios en la base: no hay clave de firma).
- Backups: `pg_dump` diario con retención de 14 días + rsync de `uploads` a destino externo.
- Logs a journald; `/api/health`.

## 11. Estrategia de testing

- **Dominio (Vitest):** máquina de estados, totales con modificadores, saldo de cadete, renderizado de comandas.
- **Integración (Vitest + Postgres de prueba):** Server Actions (aprobar por transferencia/efectivo, asignación múltiple, rendición, idempotencia y reintentos de `print_jobs`).
- **Agente:** impresora simulada que recibe bytes ESC/POS; prueba manual con impresora real como criterio de aceptación.
- **E2E (Playwright):** (1) pedido web → aprobación → job de impresión; (2) venta de mostrador; (3) asignar cadete y rendir.
- TDD para dominio y acciones.

## 11b. Addendum Task 10.1: espacios de trabajo por sector

El tablero único de Despacho se divide por sector. **Mostrador** (cajera): *Venta* (`/mostrador`), *Mostrador* (`/mostrador/pedidos`) y *Retiro en local* (`/retiro`).
**Delivery** (encargada): *Gestión Delivery* (`/delivery`, con pestañas) y *Rendición* (`/delivery/rendicion`). El admin ve todo, más las vistas generales `/caja` y `/despacho`.
Los pedidos web se distribuyen por tipo (delivery solo en estaciones Delivery; retiro solo en estaciones Mostrador), con el filtro en las consultas y `WRONG_SECTOR` en las
acciones (admin exento). La navegación depende del rol y del tipo de estación.

## 12. Preguntas abiertas

1. **Costo de envío:** ¿se cobra en delivery y es fijo o varía por zona? Supuesto actual: valor fijo configurable en `settings.delivery_fee`, por defecto $0.
2. **Sistema operativo y modelo de las impresoras:** se asumió Windows con driver instalado y compatibilidad ESC/POS; confirmar marca y ancho de papel (58/80 mm) de cada estación.
3. **Cadetes sin sistema propio:** el MVP no les da login; confirmar que la encargada registra las entregas por ellos.

## 13. Fuera de alcance — Fase 2

KDS con temporizadores por color y botón "Listo para despacho" desde cocina; ingreso de materia prima; rendición manual de consumo; historial de stock. No se escribe código de Fase 2 hasta cerrar la Fase 1.


## Addendum Task 10.2: rediseño de tickets (sin comanda de cocina, con logo y agradecimiento)

Decisión del dueño: "el ticket de cocina no hace falta porque vamos a tener más adelante la pantalla (KDS); es para el ticket del delivery y del cliente".

- **Trabajos por pedido aprobado**, según el TIPO de estación que aprueba: Delivery → `delivery` (ticket normal para el cadet: número grande, DELIVERY, cliente, teléfono, dirección y referencias, items por unidad con modificaciones, total, `Efectivo: cobrar $X` / `Pago: Transferencia (pagado)`; sin logo) + `customer` (logo, marca, número, items con precios, totales, pago, `LLAMADOR n` en mostrador, `GRACIAS POR TU COMPRA` en negrita antes del corte). Mostrador → solo `customer`. Las ventas de mostrador imprimen solo `customer`.
- **Comanda de cocina: diferida a la Fase 2 / KDS.** `renderKitchenTicket` y el valor `kitchen` de `print_job_type` siguen disponibles para reutilizarlos; hoy nada los encola. `ticket` queda como alias histórico de `customer`.
- **Logo**: nuevo bloque `{ type: "logo" }`; el agente lo traduce a raster ESC/POS `GS v 0` con un bitmap 1-bit embebido (144 px en 58 mm, 192 px en 80 mm, generado desde `public/logo.png`), con caída a texto grande si no hay bitmap. Los agentes anteriores a esta versión fallan el ticket del cliente (documento inválido) hasta actualizarse; los nuevos saltan bloques desconocidos.
- **Reimpresión**: "Ticket cliente", "Ticket delivery" (solo pedidos de delivery) y "Ambos tickets"; `print-agent test-print` imprime el logo y la frase final.

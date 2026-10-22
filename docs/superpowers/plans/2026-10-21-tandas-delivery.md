# Tandas de delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La encargada de delivery puede numerar a mano las tandas de pedidos aprobados, ver cuántos pedidos tiene cada una (aviso si pasa de 3) y asignar una tanda completa a un cadete de una vez desde Despacho.

**Architecture:** Una columna nullable `orders.tanda` (smallint 1–99) con su acción de cambio auditada (evento de pedido) y notificación en vivo con el evento `updated` ya existente. Gestión Delivery/Despacho (el tablero `src/components/despacho/*` que sirve `SectorWorkspacePage which="delivery"`) muestran el campo, el resumen y la agrupación; "Asignar tanda a cadete" reutiliza `assignOrders` (todo o nada) con IDs explícitos y confirmación si la tanda está incompleta.

**Tech Stack:** Next.js 16 (leer `node_modules/next/dist/docs/`), React 19, Drizzle + PostgreSQL (migraciones en `src/db/migrations`; la última existente es `0010_stock_movement_edits.sql`, la nueva es `0011_*`), zod vía `src/lib/zod.ts`, Vitest (unit + `*.int.test.ts`), Playwright (`desktop` 1280x800 y `mobile` Pixel 7).

**Spec:** `docs/superpowers/specs/2026-10-21-tandas-delivery-design.md` (leer también "Aclaraciones").

## Global Constraints

- Textos en español (es-AR); celular primero (objetivos ≥ 44 px) en Gestión Delivery y Despacho; estados con texto, no solo color.
- La tanda es un entero libre 1–99 que escribe la persona; NUNCA se calcula ni se sugiere por dirección o zona. No hay numeración ni reinicio automáticos.
- Se puede poner/cambiar/borrar SOLO en estados `en_preparacion` y `listo_despacho`, solo en pedidos de delivery; cada cambio queda en `order_events` con quién lo hizo. Roles: `encargada_delivery`, `encargado`, `admin` (la cajera y la cocina no editan).
- NO se toca la pantalla de cocina (`/cocina`, `src/components/cocina/*`, `src/lib/orders/kitchen-queries.ts`) ni los tickets/agente de impresión.
- El aviso de más de 3 pedidos por tanda es solo aviso, nunca bloquea. El resumen y el aviso cuentan solo pedidos de delivery en `en_preparacion` y `listo_despacho` (no `en_camino`).
- Asignar una tanda: la acción recibe IDs explícitos de pedidos + número de tanda + cadete; el servidor verifica que cada pedido sigue en esa tanda y en `listo_despacho` (todo o nada, como `assignOrders`); si la tanda tiene pedidos aún no listos pide confirmación explícita antes de despachar.
- Regla de sector y estado existentes se respetan (`WRONG_SECTOR`, máquina de estados en `src/domain/order-status.ts`); toda Server Action nueva se clasifica en `src/lib/security/surface.ts` (`pnpm test:security`) y se regenera `docs/ops/security-surface.md`.
- Una conexión en vivo por página. Commits con rutas explícitas; nunca `.env`, `.superpowers`, `bh.dump`, `test-results`, `perf-reports`, `.uploads*`. Trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. SIN capturas de pantalla (el dueño las revisa a ojo).

## Review Focus

- Pedido que cambia de estado (sale en camino, se cancela, vuelve por entrega fallida) entre que se abre la pantalla y se guarda la tanda: error claro, nada se pisa.
- Dos personas editan la misma tanda a la vez: gana el último sin corromper nada y ambos ven el valor final en vivo.
- Valores inválidos de tanda ("0", "100", "-1", "abc", "1.5", vacío = borrar): rechazo claro, vacío borra la tanda.
- Entrega fallida: el pedido que vuelve a `listo_despacho` conserva su tanda y vuelve a contar en ella.
- Asignar una tanda con un pedido que dejó de estar listo o cambió de tanda entre la selección y el envío: falla sin asignar nada.
- Pedidos de mostrador/retiro y pedidos web de otro sector: no se les puede poner tanda (`WRONG_SECTOR`/validación).

---

### Task 1: Dato y acción de tanda (servidor)

**Files:** modify `src/db/schema.ts` (`orders.tanda`), nueva migración `src/db/migrations/0011_*.sql` (+ meta; patrón de 0009/0010), `src/lib/orders/dispatch-queries.ts` (`DispatchOrder.tanda` y `DispatchBoard`), `src/app/(staff)/despacho/actions.ts`, `src/lib/security/surface.ts`, `docs/ops/security-surface.md`; create `src/lib/orders/tanda.ts`, `src/lib/orders/tanda.test.ts`, `src/lib/orders/tanda.int.test.ts`.

**Interfaces:**
- Produces: columna `orders.tanda smallint null` con `CHECK (tanda IS NULL OR tanda BETWEEN 1 AND 99)`; `parseTanda(input: string | number | null): { ok: true; tanda: number | null } | { ok: false; message: string }` (vacío/`null` → `{ ok: true, tanda: null }`, solo enteros 1–99); `setOrderTanda(db: Db, input: { orderId: number; userId: number; tanda: number | null; sector: Sector | null }): Promise<OrderResult<{ orderId: number; tanda: number | null }>>` — bloquea la fila del pedido, exige `fulfillment = delivery` y estado `en_preparacion` | `listo_despacho` (si no, `failure("INVALID_STATE", …)`), aplica la regla de sector como el resto de transiciones, escribe un evento de pedido (misma estado `from`=`to`, nota "Tanda: 2 (antes: 1)") y notifica `ORDERS_CHANNEL` con `event: "updated"`; `tandaSummary(orders: { id: number; tanda: number | null; status: OrderStatus }[]): { tanda: number; count: number; overLimit: boolean }[]` (puro; cuenta solo `en_preparacion` y `listo_despacho`; `overLimit = count > MAX_TANDA_ORDERS`, `MAX_TANDA_ORDERS = 3`, ordenado por número); `setTandaAction(prev, formData)` en `despacho/actions.ts` (roles `encargada_delivery`, `encargado`, `admin`).
- Consumes: `transitionOrder`/`OrderResult`/`failure` de `src/lib/orders/transition.ts` y la regla de sector de `src/lib/orders/sector.ts` (leerlos para reutilizar el patrón de bloqueo, evento y notificación; si `transitionOrder` no admite `from == to`, escribir el evento directamente en la misma transacción).

- [ ] **Step 1:** RED unit `tanda.test.ts`: `parseTanda("2")`→2, `""`→null, `null`→null, `"0"`, `"100"`, `"-1"`, `"abc"`, `"1.5"`, `"  3 "`(→3) con sus mensajes; `tandaSummary` cuenta solo `en_preparacion`/`listo_despacho`, marca `overLimit` con 4, ignora `en_camino` y los sin tanda, ordena por número. RED int `tanda.int.test.ts`: pone, cambia (evento con valor anterior) y borra la tanda en `en_preparacion` y `listo_despacho`; rechaza en `pendiente_aprobacion`, `en_camino`, `entregado`, `cancelado`, en pedido de mostrador/retiro y con sector equivocado (cajera sobre delivery); el pedido que vuelve de `en_camino` a `listo_despacho` conserva su tanda; 2 cambios concurrentes terminan con un valor válido y dos eventos; la acción rechaza `cajera` y `cocina` antes de tocar la DB y acepta `encargado`. Correr y ver FALLAR.
- [ ] **Step 2:** Implementar migración + schema + `tanda.ts` + acción; exponer `tanda` en `DispatchOrder` y calcular el resumen en `getDispatchBoard` (campo `tandas` del tablero). Clasificar la acción en `surface.ts` y regenerar el doc.
- [ ] **Step 3:** `pnpm lint && pnpm test && pnpm test:int && pnpm test:security && pnpm build`; commit `feat(delivery): tanda number on delivery orders`.

### Task 2: Campo de tanda, resumen y agrupación (Gestión Delivery y Despacho)

**Files:** modify `src/components/despacho/{preparing-card.tsx,delivery-ready-card.tsx,dispatch-board.tsx,lane.tsx,card-parts.tsx}` según corresponda; create `src/components/despacho/tanda-field.tsx` (cliente), `src/components/despacho/tanda-summary.tsx`; create `e2e/tandas.spec.ts`.

**Interfaces:** Consumes `DispatchOrder.tanda`, `DispatchBoard.tandas`, `setTandaAction` (Task 1). `TandaField({ orderId, tanda, canEdit }: …)`: campo numérico (input `inputMode="numeric"`, ≥ 44 px) con etiqueta "Tanda", guarda al salir del campo o con Enter vía `setTandaAction`, vacío borra, "Sin tanda" visible cuando no hay, muestra el error de la acción dentro de la tarjeta. En la tarjeta solo se ve el número de pedido y la dirección real que ya se muestra hoy (SIN etiquetas de zona como "Merlo"/"Barrio") más el campo. `TandaSummary`: chips "Tanda 1: 2 de 3" y aviso en texto ("Tanda 2 tiene 4 pedidos: el máximo recomendado es 3") cuando `overLimit`. En el carril de "Listos" los pedidos de delivery se agrupan por tanda con encabezado por grupo ("Tanda 1 · 2 de 3 listos") y "Sin tanda" como grupo propio; la selección pedido por pedido sigue funcionando.

- [ ] **Step 1:** RED `e2e/tandas.spec.ts` (usuario `encargada_delivery`; proyectos mobile 390x844 y desktop): aprobar 4 pedidos web de delivery, poner tanda 1 a dos, tanda 2 a uno y dejar uno sin tanda; verificar que las tarjetas muestran el número escrito y "Sin tanda"; el resumen "Tanda 1: 2 de 3"; poner una cuarta en la tanda 1 muestra el aviso y deja guardar; borrar el campo vuelve a "Sin tanda"; tanda inválida ("0", "abc") muestra el error y no guarda; una segunda pestaña ve el cambio en vivo sin recargar; en la tarjeta no aparece ninguna etiqueta de zona; sin desborde horizontal a 390 px y 360 px; objetivos ≥ 44 px; la cajera no ve campo editable. FALLA.
- [ ] **Step 2:** Implementar `TandaField`, `TandaSummary`, agrupación del carril de listos y cableado en las tarjetas de preparación y listos de delivery. Pedidos de mostrador/retiro sin campo.
- [ ] **Step 3:** `pnpm lint && pnpm test && pnpm build && pnpm e2e --grep "tandas|despacho|sector-workspaces"` (ambos proyectos); commit `feat(delivery): tanda field, summary and grouping`.

### Task 3: Asignar una tanda completa a un cadete

**Files:** modify `src/lib/orders/dispatch.ts` (solo si hace falta exponer una verificación reutilizable), `src/app/(staff)/despacho/actions.ts`, `src/components/despacho/{assign-bar.tsx,dispatch-board.tsx}`; create `src/lib/orders/assign-tanda.ts` (+ `*.test.ts`/`*.int.test.ts`); extend `e2e/tandas.spec.ts`; modify `src/lib/security/surface.ts`, `docs/ops/security-surface.md`.

**Interfaces:**
- Produces: `assignTanda(db: Db, input: { tanda: number; orderIds: number[]; cadetId: number; userId: number; confirmPartial: boolean; sector: Sector | null }): Promise<OrderResult<{ assigned: number[]; pending: number[] }> | { ok: false; code: "TANDA_INCOMPLETE"; ready: number; total: number }>` — dentro de UNA transacción: bloquea los pedidos pedidos, verifica que todos siguen en esa tanda y en `listo_despacho` (si alguno cambió → falla `CHANGED` sin asignar nada), calcula cuántos pedidos activos de delivery (`en_preparacion` + `listo_despacho`) tiene la tanda; si hay pedidos aún no listos y `!confirmPartial` devuelve `TANDA_INCOMPLETE` sin escribir; si no, delega en la lógica de `assignOrders` (todo o nada, límites de cadete). `assignTandaAction(prev, formData)` con roles `encargada_delivery`, `encargado`, `admin`. UI: cada grupo de tanda en el carril de listos tiene un botón "Asignar tanda a cadete" que abre la selección de cadete (reutilizar `assign-bar`); si hay pedidos de la tanda sin listar muestra "2 de 3 listos" y el botón de confirmación dice "Asignar igual los 2 listos".
- Consumes: `assignOrders` en `src/lib/orders/dispatch.ts`, `getDispatchBoard`, `DispatchBoard.tandas` (Tasks 1–2).

- [ ] **Step 1:** RED int `assign-tanda.int.test.ts`: tanda 1 con 3 listos → asigna los 3 al cadete y salen `en_camino`; tanda 1 con 2 listos y 1 en preparación sin `confirmPartial` → `TANDA_INCOMPLETE {ready:2,total:3}` y nada cambia; con `confirmPartial` asigna los 2 y el tercero conserva su tanda y su estado; un pedido de la lista que cambió de tanda o de estado entre la selección y el envío → `CHANGED` sin asignar ninguno; pedido de mostrador en la lista → rechazo; cadete inactivo → error de `assignOrders`; roles `cajera`/`cocina` rechazados antes de la DB. RED e2e (extender `tandas.spec.ts`): en Despacho el grupo "Tanda 1 · 3 de 3 listos" tiene "Asignar tanda a cadete", elegir cadete asigna los tres de una vez y pasan a "En camino"; con 2 de 3 listos aparece la confirmación "Asignar igual los 2 listos"; la asignación pedido por pedido sigue funcionando; objetivos ≥ 44 px a 390 px. FALLA.
- [ ] **Step 2:** Implementar `assign-tanda.ts`, la acción (clasificada en `surface.ts`, doc regenerado) y la UI de grupo con confirmación.
- [ ] **Step 3:** `pnpm lint && pnpm test && pnpm test:int && pnpm test:security && pnpm build && pnpm e2e --grep "tandas|despacho"` (ambos proyectos); commit `feat(delivery): assign a whole tanda to a cadet`.

### Task 4: Guías, verificación completa

**Files:** modify `docs/guias/guia-encargada-delivery.md`, `docs/guias/uat-prueba-de-aceptacion.md` (escenarios de tanda), `docs/guias/primer-dia.md` si menciona el reparto, `README.md`/`e2e/README.md` si listan pantallas o specs.

- [ ] **Step 1:** Documentar en la guía de la encargada: cómo poner la tanda (a mano, número libre), qué significa el aviso de más de 3, cómo asignar una tanda a un cadete y qué pasa si faltan pedidos listos; aclarar que el ticket no imprime la tanda (se sigue anotando a mano) y que la pantalla de cocina todavía no la muestra. Agregar escenarios al UAT.
- [ ] **Step 2:** Compuertas completas: `pnpm lint`, `pnpm test`, `pnpm test:int`, `pnpm test:security`, `pnpm build`, `pnpm e2e` desde build limpio (ambos proyectos). Reportar fallas con su salida, sin ocultarlas. Sin capturas.
- [ ] **Step 3:** Commit `docs(delivery): tanda guide and UAT`.

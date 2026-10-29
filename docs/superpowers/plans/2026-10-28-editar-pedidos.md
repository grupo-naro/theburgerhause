# Editar pedidos y adicionales Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el personal modifique un pedido: editar libremente mientras está `pendiente_aprobacion`, y agregar productos (adicionales) mientras está `en_preparacion`, con cobro de la diferencia y ticket de cocina aparte.

**Architecture:** Cores sin `next/*` en `src/lib/orders/` (`order-edit.ts`, `addons.ts`) que bloquean la fila del pedido, reutilizan `loadCatalog` + `resolveUnits` + `insertOrderItems` + `orderTotals`, y ajustan stock con un nuevo tipo de movimiento `ajuste_pedido`. Un adicional es una fila en `order_addons`; sus productos se insertan en `order_items` (con `addon_id`) solo al confirmarse, así todo lo que hoy lee `order_items` (tickets, tableros, "Tu pedido", totales) ve solo lo confirmado. Server actions finas + un diálogo de edición que reutiliza el selector de productos del POS.

**Tech Stack:** Next.js 16 (leer `node_modules/next/dist/docs/` antes de tocar APIs de Next), React 19, Drizzle/PostgreSQL, zod vía `src/lib/zod.ts`, Vitest (unit + `*.int.test.ts`), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-28-editar-pedidos-design.md`

## Global Constraints

- Migración nueva = **0013** (la última es 0012). Generar con `pnpm db:generate --name order_addons` y mantener `meta/_journal.json` y snapshot.
- Toda Server Action nueva clasificada en `src/lib/security/surface.ts` con `staffAction(STAFF3, ...)` (admin, encargado, cajera, encargada_delivery; `cocina` NO) y regenerar `docs/ops/security-surface.md` con `UPDATE_SURFACE_DOC=1 pnpm test:security`.
- Sector: mismo chequeo que `approve-order.ts` (`decideSector` + `actorSectorFor`; admin/encargado exentos con `sector: null`).
- Dinero en centavos enteros. El envío (`orders.deliveryFee`) NO se recalcula. `orders.total` = suma de productos confirmados + envío; lo pendiente de pago vive solo en `order_addons`.
- Sin hard deletes de pedidos/adicionales; el historial queda en `order_events` (fila con `fromStatus = toStatus`, nota descriptiva, `userId`) y en `order_addons`.
- Cada operación escribe un `order_events` y hace `notifyInTx(tx, ORDERS_CHANNEL, {orderId, status, event: "updated"})` (el seguimiento del cliente se entera por `order_events.at`).
- Textos es-AR; objetivos táctiles ≥ 44 px; sin capturas de pantalla en la verificación.
- Tests de integración: `pnpm vitest run --config vitest.int.config.mts <ruta>`; unitarios: `pnpm vitest run <ruta>`; e2e: `pnpm e2e <archivo>` (nunca en simultáneo con int; Docker Desktop encendido).

## Review Focus

1. Dos personas operan a la vez, o se agrega/edita justo cuando el pedido pasa a Listo: gana el bloqueo de fila; el perdedor recibe `INVALID_STATE`, nada se escribe.
2. Editar dejando el pedido sin productos: se rechaza (mínimo 1).
3. Agregar la misma bebida dos veces / bebida ya vendida en el pedido: no debe chocar con el índice único de stock.
4. Producto pausado, inactivo o sin stock al agregar o al confirmar: error claro, nada escrito, nada reservado.
5. Doble clic: confirmar dos veces un adicional no descuenta dos veces; reenviar el mismo `idempotencyKey` no crea dos adicionales.
6. Cancelar el pedido con adicionales confirmados devuelve todo el stock; con pendientes, los cancela.

---

### Task 1: Datos y stock (`ajuste_pedido`)

**Files:**
- Modify: `src/db/schema.ts` (enum `stockMovementKind`+`ajuste_pedido`, enum `printJobType`+`additional`, nuevo enum `addonStatus`, tabla `orderAddons`, columna `orderItems.addonId`), nueva migración `src/db/migrations/0013_order_addons.sql` (+ meta).
- Modify: `src/lib/stock/sales.ts`, `src/lib/stock/movements.ts` si hace falta; labels de tipos de movimiento del historial de stock (buscar donde se mapea `devolucion`).
- Test: `src/lib/stock/sales.int.test.ts`, `src/db/schema.int.test.ts`.

**Interfaces:**
- Produces: tabla `orderAddons` (`id`, `orderId`→orders cascade, `seq` smallint, `status` addonStatus `pendiente_pago|confirmado|cancelado`, `units` jsonb (`ResolvedUnit[]` serializado), `subtotal` int, `idempotencyKey` text, `createdBy` users, `createdAt`, `confirmedBy`, `confirmedAt`, `cancelledBy`, `cancelledAt`, `cancelReason` text); índices: unique (`orderId`,`seq`), unique parcial por `idempotencyKey`, check `subtotal >= 0`; `orderItems.addonId` integer nullable → `orderAddons.id` + índice.
- Produces: `adjustStockForOrder(tx: DbTransaction, input: {orderId: number; add: {productId: number}[]; remove: {productId: number}[]; userId: number | null}): Promise<ReserveStockResult>` en `sales.ts`: suma por artículo de stock el delta neto (agregar = consume, quitar = repone), verifica faltante solo para lo que consume (misma regla y mismo resultado `OUT_OF_STOCK` que `reserveStockForOrder`, sin escribir nada si falta), y registra un movimiento `ajuste_pedido` por artículo con `qtyDelta` firmado (no entra en el índice único `stock_movements_order_item_kind_unique`).
- Produces: `returnStockForOrder` devuelve el neto vendido por artículo (`venta` + `ajuste_pedido`), un solo `devolucion` por artículo (si el neto ≤ 0 no escribe); sigue idempotente.

- [ ] **Step 1: Tests (int)** en `sales.int.test.ts`: `adjustStockForOrder agrega una bebida ya vendida sin chocar con el índice único` (venta de 1 Coca, ajuste +1 → stock −2 y dos filas para ese artículo); `adjustStockForOrder repone al quitar` (quitar la Coca → saldo vuelve); `adjustStockForOrder con faltante no escribe nada` (OUT_OF_STOCK, 0 movimientos nuevos); `returnStockForOrder devuelve el neto tras ajustes` (venta 1 + ajuste 2 → devolucion 3); `returnStockForOrder sigue siendo idempotente`. En `schema.int.test.ts`: `order_addons rechaza seq duplicado por pedido` y `order_addons.idempotency_key es único`.
- [ ] **Step 2: Correr y ver fallar.**
- [ ] **Step 3: Implementar** schema + migración 0013 (los `ALTER TYPE ... ADD VALUE` no se usan dentro de la misma migración) + `adjustStockForOrder` + cambio en `returnStockForOrder`. Revisar los CHECK de `stock_movements` (signo por tipo) y adaptarlos para `ajuste_pedido` (cualquier signo, distinto de 0); actualizar toda tabla/`switch` exhaustivo de tipos de movimiento (historial de stock, labels).
- [ ] **Step 4: Correr los tests del Step 1 + `pnpm vitest run --config vitest.int.config.mts src/lib/stock` y `pnpm exec tsc --noEmit`: todo en verde.**
- [ ] **Step 5: Commit** `feat(pedidos): order_addons schema and ajuste_pedido stock adjustments`.

### Task 2: Editar pedido pendiente de aprobación

**Files:**
- Create: `src/lib/orders/order-edit.ts`, `src/lib/orders/order-edit.int.test.ts`
- Modify: `src/lib/orders/order-rows.ts` (`insertOrderItems` acepta `opts?: {addonId?: number}` y lo guarda en `order_items.addon_id`).

**Interfaces:**
- Consumes: `loadCatalog`, `resolveUnits`, `insertOrderItems`, `orderTotals`/`unitTotal` (`src/domain/pricing.ts`), `adjustStockForOrder` (Task 1), `decideSector`/`Sector` (`sector.ts`), `OrderResult`/`failure` (`transition.ts`), `OutOfStockRollback`/`outOfStock()`, `describeUnitIssues`, `notifyInTx`.
- Produces: `editPendingOrder(db: Db, raw: {orderId: number; userId: number; sector: Sector | null; removeItemIds: number[]; addUnits: OrderUnitInput[]}): Promise<OrderResult<{orderId: number; subtotal: number; total: number; menuChanged: boolean}>>`.

- [ ] **Step 1: Tests (int)** con `placeWebOrder`/`seedMenuAndStaff`: `agrega un producto y recalcula subtotal y total sin tocar el envío`; `quita un producto, repone la bebida y recalcula`; `mantiene intactos los precios de los productos que quedan` (cambiar el precio en el menú antes de editar no los toca); `rechaza dejar el pedido sin productos` (VALIDATION); `rechaza si el pedido ya no está pendiente_aprobacion` (INVALID_STATE); `rechaza ids de ítems de otro pedido`; `falta de stock no escribe nada` (OUT_OF_STOCK, pedido idéntico); `respeta el sector` (cajera sobre pedido delivery → WRONG_SECTOR); `escribe un order_events con from=to y la lista de cambios, y notifica "updated"`.
- [ ] **Step 2: Correr y ver fallar.**
- [ ] **Step 3: Implementar** `editPendingOrder`: transacción; bloquear la fila `FOR UPDATE`; sector; exigir `pendiente_aprobacion`; validar `removeItemIds` ⊆ ítems del pedido y que quede ≥ 1 ítem; resolver `addUnits` con `loadCatalog`+`resolveUnits`; borrar los ítems quitados (se permite el borrado de filas en un pedido aún no aprobado; el rastro queda en el evento) ; `insertOrderItems`; `adjustStockForOrder`; recalcular `subtotal` (suma de `unitPriceSnapshot` + `priceDelta` de todos los ítems) y `total = subtotal + deliveryFee`; evento + notify. Los ítems quitados que tengan `productId` nulo no mueven stock.
- [ ] **Step 4: Tests del Step 1 en verde + tsc.**
- [ ] **Step 5: Commit** `feat(pedidos): edit pending orders`.

### Task 3: Ticket de adicional (impresión)

**Files:**
- Modify: `src/domain/print-document.ts`, `src/lib/orders/print-jobs.ts`, `src/lib/orders/printable.ts` (`PrintableItemRow` y `PrintableItem` ganan `addonSeq: number | null`), `src/lib/orders/print-kinds.ts` (`PrintKind` + `"additional"`), `src/lib/orders/caja-queries.ts` (uniones de tipos, `jobKind`, `SAME_KIND`), `src/lib/caja/labels.ts`, `src/components/caja/failed-print-alert.tsx`, `e2e/helpers/agent.ts`.
- Test: `src/domain/print-document.test.ts`, `src/lib/orders/print-jobs.int.test.ts` (o el existente más cercano), `src/lib/orders/caja-queries.int.test.ts`.

**Interfaces:**
- Produces: `renderAdditionalTicket(order: PrintableOrder, addon: {seq: number}): PrintDocument` (texto grande `ADICIONAL {seq} al #{number}`, ítems del adicional con sus `kitchenLabel` y `NOTA:` igual que `renderKitchenTicket`, sin precios).
- Produces: `loadPrintableOrder(tx, orderId, opts?: {addonId?: number})` (con `addonId` solo trae los ítems de ese adicional); `enqueueAddonPrintJobs(tx: DbTransaction, input: {orderId: number; addonId: number; seq: number; stationId: number}): Promise<number[]>` → un job `type: "additional"` en la estación del pedido y, si `hasDeliveryTicket` del pedido, además re-encola el ticket `delivery` con el total actualizado (el cadete llevaba el papel viejo).
- El agente de impresión no cambia (renderiza `blocks` sin mirar `type`).

- [ ] **Step 1: Tests:** `renderAdditionalTicket muestra "ADICIONAL 2 al #23" y solo los ítems del adicional`; `enqueueAddonPrintJobs crea un job additional con los ítems del adicional`; `re-encola el ticket de delivery para pedidos web de delivery y no para retiro`; `un job additional fallido aparece en listFailedPrintJobs y no se oculta por otro adicional reimpreso` (refinar `SAME_KIND` para que incluya el adicional en la comparación).
- [ ] **Step 2: Correr y ver fallar.**
- [ ] **Step 3: Implementar** lo anterior; `insertOrderItems` y los lectores de ítems rellenan `addonSeq` desde `order_addons`. `reprintOrder` sigue imprimiendo el pedido completo (los ítems de adicionales confirmados incluidos).
- [ ] **Step 4: Tests en verde + `pnpm vitest run packages/print-agent` (contrato) + tsc.**
- [ ] **Step 5: Commit** `feat(pedidos): additional kitchen ticket and print kind`.

### Task 4: Adicionales (agregar, confirmar, cancelar)

**Files:**
- Create: `src/lib/orders/addons.ts`, `src/lib/orders/addons.int.test.ts`
- Modify: `src/lib/orders/dispatch.ts` (`markReady` cancela los adicionales pendientes), `src/lib/orders/cancel-order.ts` (cancela los adicionales pendientes; el stock lo devuelve `returnStockForOrder` neto), `src/lib/orders/reject-order.ts` no cambia (no hay adicionales antes de cocina).

**Interfaces:**
- Consumes: Task 1 (tabla, `adjustStockForOrder`), Task 3 (`enqueueAddonPrintJobs`), el patrón de `approve-order.ts` (`paymentVerified` obligatorio para transferencia).
- Produces:
  - `addOrderAddon(db: Db, raw: {orderId: number; userId: number; sector: Sector | null; units: OrderUnitInput[]; idempotencyKey: string}): Promise<OrderResult<{addonId: number; seq: number; status: "confirmado" | "pendiente_pago"; subtotal: number; menuChanged: boolean}>>`. Solo con el pedido `en_preparacion`. Regla de cobro: `necesitaConfirmacion = paymentMethod === "transfer" && channel === "web"`; si no la necesita (efectivo web, o mostrador) se confirma en el acto; si la necesita queda `pendiente_pago` sin tocar stock, items, totales ni cocina.
  - `confirmAddon(db: Db, raw: {addonId: number; userId: number; sector: Sector | null; paymentVerified: boolean}): Promise<OrderResult<{addonId: number; seq: number; menuChanged: boolean}>>`: exige `paymentVerified` (VALIDATION), el pedido `en_preparacion` y el adicional `pendiente_pago`; inserta los ítems con `addonId`, suma `subtotal` y `total` del pedido, `adjustStockForOrder`, `enqueueAddonPrintJobs`, evento + notify. En efectivo web el pedido sigue con `paymentStatus` pendiente; en transferencia/mostrador queda como está.
  - `cancelAddon(db: Db, raw: {addonId: number; userId: number; sector: Sector | null; reason: string | null}): Promise<OrderResult<{addonId: number}>>`: solo `pendiente_pago` → `cancelado`, con evento.
  - `cancelPendingAddons(tx: DbTransaction, orderId: number, userId: number, note: string): Promise<number>` (devuelve cuántos canceló; lo usan `markReady` y `cancelOrder`).
- `seq` = máximo + 1 por pedido, dentro del bloqueo.

- [ ] **Step 1: Tests (int):** `efectivo web: confirma en el acto, suma al total, imprime additional y descuenta bebida`; `mostrador: confirma en el acto sin tocar paymentStatus`; `transferencia: queda pendiente_pago sin ítems, sin stock, sin ticket y total sin cambios`; `confirmAddon exige paymentVerified`; `confirmAddon inserta ítems con addon_id, suma el total y encola additional`; `confirmAddon dos veces no descuenta dos veces` (segunda → INVALID_STATE); `mismo idempotencyKey devuelve el mismo adicional`; `varios adicionales numeran 1, 2`; `misma bebida en dos adicionales no choca con el índice de stock`; `falta de stock al confirmar → OUT_OF_STOCK y sigue pendiente`; `pedido que ya no está en_preparacion → INVALID_STATE`; `markReady cancela los pendientes y deja los confirmados`; `cancelOrder cancela pendientes y devuelve todo el stock neto`; `cancelAddon solo desde pendiente_pago`; `respeta el sector`.
- [ ] **Step 2: Correr y ver fallar.**
- [ ] **Step 3: Implementar** (pedido bloqueado `FOR UPDATE` en cada función; guardar `units` como jsonb validado con zod al leerlo; usar el mismo mapeo de errores que `createOrder`).
- [ ] **Step 4: Tests en verde; correr también `dispatch.int.test.ts` y `cancel-order.int.test.ts`; tsc.**
- [ ] **Step 5: Commit** `feat(pedidos): add-ons to orders in preparation`.

### Task 5: Lecturas y server actions

**Files:**
- Create: `src/app/(staff)/editar-pedido/actions.ts`, `src/app/(staff)/editar-pedido/actions.int.test.ts`
- Modify: `src/lib/orders/dispatch-queries.ts` (`DispatchOrder` gana `addons: {id: number; seq: number; status: "pendiente_pago" | "confirmado"; subtotal: number; items: {name: string; modifiers: string[]; note: string | null}[]}[]` con los pendientes y confirmados, y cada ítem gana `addonSeq`), `src/lib/orders/caja-queries.ts` (ítems con `addonSeq`), `src/lib/security/surface.ts`, `docs/ops/security-surface.md`.

**Interfaces:**
- Produces (todas `"use server"`, patrón `authorize()` de `src/app/(staff)/caja/actions.ts`, `ActionResult<T>`, `invalidateMenu()` si `menuChanged`): `editPendingOrderAction(input: {orderId; removeItemIds: number[]; addUnits: OrderUnitInput[]})`, `addAddonAction(input: {orderId; units: OrderUnitInput[]; idempotencyKey: string})`, `confirmAddonAction(input: {addonId; paymentVerified: boolean})`, `cancelAddonAction(input: {addonId; reason?: string})`. `userId`/`stationId` salen de la sesión, no del input.

- [ ] **Step 1: Tests (int de acciones):** `cocina no puede ejecutar ninguna` (FORBIDDEN); `sin sesión redirige a /login`; `cajera sobre pedido de delivery → WRONG_SECTOR`; `input con userId extra lo ignora`; `addAddonAction con productos pausados devuelve el mensaje de agotado`; `dispatch-queries devuelve el adicional pendiente con sus ítems y subtotal`.
- [ ] **Step 2: Correr y ver fallar.**
- [ ] **Step 3: Implementar** y registrar las cuatro acciones con `staffAction(STAFF3, ...)`; regenerar el doc de superficie.
- [ ] **Step 4: `pnpm test:security`, tests del Step 1 y tsc en verde.**
- [ ] **Step 5: Commit** `feat(pedidos): server actions and read models for order edits`.

### Task 6: Interfaz del personal

**Files:**
- Create: `src/components/orders/order-editor-dialog.tsx`, `src/components/orders/addon-block.tsx` (+ tests de componente si el repo ya los usa para este tipo de pieza).
- Modify: `src/components/caja/order-card.tsx` / `order-actions.tsx` (botón "Editar pedido" en pendientes), `src/components/despacho/preparing-card.tsx` (botón "Agregar productos" y bloque de adicionales; etiqueta "ADICIONAL n" en `card-parts.tsx` `ItemsSummary`), `src/components/staff/sector-workspace.tsx` si hace falta proveer el menú.

**Interfaces:**
- Consumes: Task 5 (acciones y DTOs); selector de productos del POS (`CatalogPanel`, `ConfigureDialog`, `CartProvider`, `MenuProvider`; ver cómo `src/app/(staff)/mostrador/page.tsx` carga el menú) y `toOrderUnits`/`createKeyHolder` de `use-counter-sale.ts`.
- Produces: `OrderEditorDialog({mode: "edit" | "add", orderId: number, items: EditorItem[], open: boolean, onClose: () => void})` donde `EditorItem = {id: number; label: string; total: number; addonSeq: number | null}`; en modo `edit` cada ítem muestra "Quitar" (tachado reversible) y el modo `add` no permite quitar; muestra el total nuevo antes de guardar y, en modo `add` con transferencia web, el aviso "Queda pendiente hasta confirmar la transferencia de $X"; en efectivo "Se cobra $X al entregar" / mostrador "Cobrá $X ahora". `AddonBlock({orderId, addons, onChanged})`: por cada adicional pendiente muestra subtotal, checkbox "Verifiqué la acreditación" (`data-testid="addon-verify"`), botón "Confirmar adicional" (`data-testid="addon-confirm"`) y "Cancelar adicional" (`data-testid="addon-cancel"`).
- Todos los botones ≥ 44 px, usan `useGuardedAction` como el resto, y la `idempotencyKey` de `addAddonAction` se genera una vez por apertura del diálogo.

- [ ] **Step 1: Tests de componente/unitarios** de la lógica pura (cálculo del total nuevo, texto de cobro según método/canal) y e2e en la Task 8.
- [ ] **Step 2: Implementar** diálogo, bloque de adicionales y botones; cuando `markReady` cancela adicionales pendientes, mostrar un aviso "Se canceló el adicional sin pagar" (la acción `markReadyAction` ya devuelve el resultado; extender `data` con `cancelledAddons: number`).
- [ ] **Step 3: `pnpm lint`, tsc y `pnpm vitest run` en verde.**
- [ ] **Step 4: Commit** `feat(pedidos): order editor dialog and add-on controls`.

### Task 7: "Tu pedido" del cliente

**Files:**
- Modify: `src/lib/orders/tracking.ts` (`TrackingOrder` gana `pendingAddons: {seq: number; subtotal: number; lines: {name: string; quantity: number}[]}[]`), `src/components/tracking/order-summary.tsx`, `src/components/tracking/payment-block.tsx`
- Test: `src/lib/orders/tracking.int.test.ts`, `e2e/tracking-addons.spec.ts` (en Task 8)

- [ ] **Step 1: Tests:** `el seguimiento muestra los productos del adicional confirmado y el total nuevo`; `el adicional pendiente aparece aparte como "Pendiente de pago" con su subtotal y sin entrar al total`; `el adicional cancelado no aparece`; `el seguimiento detecta el cambio (updatedAt sube)`.
- [ ] **Step 2: Implementar** (DTO por allow-list; ningún motivo ni id interno nuevo viaja al público). En `payment-block` con transferencia y adicional pendiente: "Te falta pagar $X del adicional; la vendedora te pasa los datos por WhatsApp".
- [ ] **Step 3: Tests y tsc en verde. Commit** `feat(pedidos): show add-ons in order tracking`.

### Task 8: e2e, guías y puertas finales

**Files:**
- Create: `e2e/editar-pedido.spec.ts`
- Modify: guías cajera/encargada/administrador ("Modificar un pedido"), `docs/uat` (casos), `docs/ops/security-surface.md`; la guía de runbook de migraciones (agregar 0013).

- [ ] **Step 1: e2e (desktop y `@mobile`):** cajera edita un pedido pendiente (agrega y quita) y el total de la tarjeta cambia; pedido en efectivo en preparación: agrega una bebida → aparece el ticket "ADICIONAL 1" (job `additional` encolado) y el total sube; transferencia: adicional queda pendiente, confirma con el checkbox → aparece en el pedido y en "Tu pedido"; adicional pendiente + "Listo" → se cancela con aviso; doble clic en confirmar no duplica; encargada de delivery sobre un pedido de retiro → bloqueado; cocina no ve los controles.
- [ ] **Step 2: Escribir las guías y casos UAT.**
- [ ] **Step 3: Puertas completas:** `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm test`, `pnpm test:int`, `pnpm build`, `pnpm e2e` completo; todo verde.
- [ ] **Step 4: Commit** `docs(pedidos): guides, UAT and e2e for order edits`.

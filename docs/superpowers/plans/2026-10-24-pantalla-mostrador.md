# Pantalla de pedidos del mostrador y ticket de cocina Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un televisor en el mostrador que muestra, estilo McDonald's, los números de pedido "En preparación" y "Listo para entregar" (mostrador + web para retirar), y el ticket de cocina vuelve a imprimirse; la pantalla de cocina vieja se elimina.

**Architecture:** Una consulta de solo lectura (`getCounterBoard`) y una página a pantalla completa `/pantalla` alimentada por la conexión en vivo existente más un refresco de seguridad; el ticket de cocina reutiliza el tipo de impresión `kitchen` y su render (ya soportados por el agente 0.2.0) agregándolo a los trabajos de cada puesto. La ruta `/cocina` redirige a `/pantalla` y se retira el código del KDS viejo.

**Tech Stack:** Next.js 16 (leer `node_modules/next/dist/docs/`), React 19, Drizzle/PostgreSQL, Vitest (unit + `*.int.test.ts`), Playwright (`desktop` 1280x800 y `mobile`).

**Spec:** `docs/superpowers/specs/2026-10-24-pantalla-mostrador-design.md` (leer también "Aclaraciones" y "Respuesta posterior del dueño").

## Global Constraints

- Textos en español (es-AR); alto contraste y tipografía muy grande para televisor (1920x1080 y 1280x720); pantalla de SOLO LECTURA, sin botones ni acciones y sin datos personales (solo números de pedido y los dos títulos: "En preparación" y "¡Listo! Retiralo en el mostrador").
- Diseño B: columna "En preparación" a la izquierda (un tercio), columna "¡Listo! …" a la derecha (dos tercios, destacada, números más grandes). Más viejo primero. Si no caben los números: reducir tamaño y, de ser necesario, desplazamiento automático suave (sin scroll manual).
- Aparecen ventas de mostrador (`channel = counter`) y pedidos web para retirar (`channel = web`, `fulfillment = takeaway`). NUNCA pedidos de delivery. "En preparación" = `en_preparacion`; "Listo" = `listo_despacho` o `para_retirar`; se excluyen `pendiente_aprobacion`, `cancelado`, `entregado`, `en_camino`.
- Aviso sonoro ("ding") SOLO la primera vez que un pedido entra en "Listo" (de `en_preparacion` a `listo_despacho`), con interruptor de silencio y aviso discreto hasta que el navegador habilita el audio; resaltado de unos segundos.
- Actualización: una sola conexión en vivo por página (`LiveRefresh`) + refresco de seguridad cada 60 s y al reconectar.
- Ticket de cocina (tipo `kitchen`, render `renderKitchenTicket`): se imprime en la misma impresora de cada puesto. Orden de impresión por id: cocina, cliente, delivery. Mostrador: cocina + cliente; Delivery con pedido web de delivery: cocina + cliente + delivery; otros pedidos en puesto de Delivery: cocina + cliente. Reimpresión: "ambos" conserva su sentido actual (cliente + delivery); "Cocina" es una opción explícita separada; la reimpresión por defecto sigue siendo la del cliente. No se cambia el agente de impresión (0.2.0) salvo que falle el contrato; en ese caso parar y avisar.
- Roles con acceso a `/pantalla`: `cocina`, `cajera`, `encargada_delivery`, `encargado`, `admin`; el usuario `cocina` (sin estación) tiene sesión larga sin vencimiento por inactividad.
- Los datos de umbrales KDS (`kds_*`) se quedan en la base; solo se retira código. Sin migración que borre.
- Toda Server Action nueva/eliminada se refleja en `src/lib/security/surface.ts` (`pnpm test:security`) y se regenera `docs/ops/security-surface.md`.
- Commits con rutas explícitas; nunca `.env`, `.superpowers`, `bh.dump`, `test-results`, `perf-reports`, `.uploads*`. Trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. SIN capturas de pantalla (el dueño revisa a ojo).

## Review Focus

- Un pedido de delivery NUNCA aparece; un pedido cancelado/rechazado/entregado desaparece en vivo; un pedido web para retirar pendiente de aprobación no aparece.
- Pedido que vuelve de "Listo" a `en_preparacion`: vuelve a la columna izquierda sin "ding".
- Dos pedidos listos casi a la vez: ambos suenan/resaltan; 40+ números a la vez: sin desborde ni scroll manual.
- Televisor encendido por días: el refresco de 60 s recupera un evento perdido; reconexión tras corte de red.
- Todo pedido aprobado/confirmado genera su ticket de cocina; el pedido de mostrador sin llamador/ con llamador; nota del cliente con tildes/emoji se imprime sin romper.
- La reimpresión por defecto NO imprime cocina; `/cocina` redirige y no quedan enlaces ni rutas muertas.

---

### Task 1: El ticket de cocina vuelve a imprimirse

**Files:** modify `src/lib/orders/print-kinds.ts` (`PrintKind` suma `"kitchen"`, `PrintWhich` suma `"kitchen"`, `defaultPrintKinds`, `resolvePrintKinds`), `src/lib/orders/print-jobs.ts` (`enqueuePrintJobs`, usa `renderKitchenTicket` de `src/domain/print-document.ts`), `src/lib/orders/reprint.ts` y sus acciones/UI de reimpresión (Caja/Mostrador/Despacho: agregar la opción "Cocina"), cualquier mapa de tipos de ticket en la UI o `print-state.ts`, `src/lib/security/surface.ts` si cambia alguna acción; tests existentes de `print-kinds`, aprobación, mostrador, reimpresión y e2e que cuentan tickets/jobs; docs: `docs/ops/print-agent-protocol.md`, `docs/guias/*` que describen los tickets, el comentario de cabecera de `print-kinds.ts`.

**Interfaces:**
- Produces: `PrintKind = "kitchen" | "delivery" | "customer"`; `defaultPrintKinds(stationKind, order): PrintKind[]` → mostrador: `["kitchen","customer"]`; delivery con `hasDeliveryTicket`: `["kitchen","customer","delivery"]`; delivery sin ticket de delivery: `["kitchen","customer"]`; `resolvePrintKinds(which, stationKind, order)`: `"both"` = el `defaultPrintKinds` SIN `kitchen` (cliente + delivery como hoy); `"kitchen"` = `["kitchen"]`; `enqueuePrintJobs` inserta en el orden fijo kitchen → customer → delivery (el agente imprime por id ascendente).
- Consumes: `renderKitchenTicket(printable)`, `enqueuePrintJobs`, `loadPrintableOrder`, `orderToPrintable`; el contrato del agente (`packages/print-agent/contract.test.ts`) ya cubre el tipo `kitchen`.

- [ ] **Step 1:** RED unit `print-kinds.test.ts`: los arreglos exactos de `defaultPrintKinds` para (mostrador × mostrador-sale), (mostrador × web retiro), (delivery × web delivery), (delivery × web retiro/otro); `resolvePrintKinds("both")` sin cocina; `resolvePrintKinds("kitchen")` = `["kitchen"]` para cualquier pedido y puesto. RED int en los tests existentes de aprobación y mostrador (`approve-order.int.test.ts`, `create-counter-order.int.test.ts` o los que aserten tipos de job): tipos de job en orden de id = kitchen < customer < delivery; reimpresión por defecto = solo customer; reimpresión "kitchen" = un job kitchen; el payload del job kitchen incluye número de pedido, la etiqueta de tipo (MOSTRADOR/RETIRO/DELIVERY), cada unidad con modificadores y la nota. Correr y ver FALLAR.
- [ ] **Step 2:** Implementar los cambios; la UI de reimpresión ofrece "Cliente", "Delivery" (si aplica), "Cliente + delivery" y "Cocina". No tocar el agente.
- [ ] **Step 3:** Actualizar e2e/tests/docs que cuentan tickets (mostrador ahora 2 jobs; delivery 3). `pnpm lint && pnpm test && pnpm test:int && pnpm test:security && pnpm build` y los e2e de impresión/tickets/caja en ambos proyectos (e2e y test:int no a la vez). Commit `feat(print): kitchen ticket prints again, first on every station`.

### Task 2: La pantalla `/pantalla`

**Files:** create `src/lib/orders/counter-board.ts` (+ `counter-board.int.test.ts`, `counter-board.test.ts` para helpers puros), `src/app/(staff)/pantalla/page.tsx`, `src/components/pantalla/{counter-board.tsx,use-ready-chime.ts}` (cliente), `src/lib/pantalla/ready-transitions.ts` (puro, + test); modify `src/lib/auth` / sesión (sesión larga para `cocina`), `src/lib/caja/nav.ts` + `workspaces.ts` (enlace "Pantalla", se abre en pestaña nueva, reemplaza al de "Cocina"; `roleHome("cocina")` = `/pantalla`), `src/proxy.ts` si enumera rutas, `src/lib/security/surface.ts`, `e2e/pantalla.spec.ts`.

**Interfaces:**
- Produces: `getCounterBoard(db: Db, ctx?: { now?: Date }): Promise<{ preparing: { id: number; number: number }[]; ready: { id: number; number: number; readySince: Date }[] }>` (solo ventas de mostrador y web retiro; `preparing` = `en_preparacion` ordenado por antigüedad en ese estado; `ready` = `listo_despacho` | `para_retirar` ordenado por `readySince` ascendente; usa solo eventos de transición reales — `from_status IS DISTINCT FROM to_status` — para la antigüedad); `newlyReady(prev: number[], next: number[], prevPreparing: number[]): number[]` puro: ids que entran a "Listo" desde preparación (los que reaparecen desde `listo_despacho` no suenan); componente `CounterBoard` con layout B; página protegida por `requireSessionOrRedirect(["cocina","cajera","encargada_delivery","encargado","admin"])`, dinámica dentro de `<Suspense>`, fullscreen sin menú ni barra; `LiveRefresh` (una EventSource) + `setInterval` de 60 s con `router.refresh()` y refresco al reconectar/`online`/`visibilitychange`.
- Consumes: `LiveRefresh`, `ORDERS_CHANNEL`, `dispatch-queries`/`kitchen-queries` solo como referencia de patrones (no importar de la cocina vieja), `useSoundPreference` o equivalente existente de la cocina vieja (extraer lo reutilizable a `src/components/pantalla/` antes de que Task 3 borre el código viejo).

- [ ] **Step 1:** RED int `counter-board.int.test.ts`: aparecen mostrador y web-retiro en `en_preparacion`; no aparecen delivery (ni web ni de ningún tipo), `pendiente_aprobacion`, `cancelado`, `entregado`, `en_camino`; `listo_despacho` y `para_retirar` aparecen en `ready`; orden más viejo primero; un evento de reimpresión (mismo estado) no cambia el orden. RED unit `ready-transitions.test.ts`: `newlyReady` solo devuelve ids que estaban en preparación; volver de listo a preparación no suena. RED e2e `pantalla.spec.ts` (1920x1080 y 1280x720; usuario `cocina` y `cajera`): una venta de mostrador cobrada aparece en "En preparación" EN VIVO sin recargar; al marcar "Listo" desde Mostrador pasa a la zona derecha (con resaltado `data-testid` verificable); al marcar entregado desaparece; un pedido web de retiro aparece al aprobarlo; un pedido de delivery no aparece; la pantalla no tiene botones ni enlaces (salvo un único interruptor de sonido discreto), ni nombres/direcciones/importes en el DOM; sin desborde con 40 números; exactamente una EventSource; sesión del usuario `cocina` sin estación abre `/pantalla`; `cocina` no puede abrir `/caja`. FALLA.
- [ ] **Step 2:** Implementar consulta, helpers, componente, página y navegación; sesión larga para `cocina`; aviso de audio hasta el primer toque.
- [ ] **Step 3:** `pnpm lint && pnpm test && pnpm test:int && pnpm test:security && pnpm build && pnpm e2e --grep "pantalla"` (ambos proyectos). Commit `feat(pantalla): counter order board for the TV`.

### Task 3: Retiro de la pantalla de cocina vieja, redirección y guías

**Files:** delete `src/app/(staff)/cocina/{page.tsx,actions.ts,actions.int.test.ts}`, `src/components/cocina/*`, `src/lib/cocina/*`, `src/lib/orders/{kitchen-queries.ts,kitchen-queries.int.test.ts,kitchen-age.ts,kitchen-age.test.ts,undo-ready.ts(+tests)}` (solo lo que nada más use; verificar con búsqueda de imports antes de borrar; `src/lib/modifiers/kitchen-label.ts` es del ticket de cocina y SE QUEDA), `e2e/cocina.spec.ts`; create `src/app/(staff)/cocina/page.tsx` mínima que redirige a `/pantalla`; modify `src/lib/security/surface.ts` (quitar `kitchenReadyAction`/`kitchenUndoAction`), `docs/ops/security-surface.md`, `docs/guias/guia-cocina.md` (reescribir como guía del televisor y del ticket de cocina), `docs/guias/guia-cajera-mostrador.md`, `guia-administrador.md`, `uat-prueba-de-aceptacion.md`, `primer-dia.md`, `README.md`, `e2e/README.md`, `docs/ops/runbook.md` (usuario `cocina` para el televisor).

**Interfaces:** Consumes Tasks 1-2 (la pantalla nueva ya hace falta). Produces: `/cocina` → redirect 307/308 a `/pantalla` (para cualquier rol autenticado; sin sesión va a `/login` como siempre); ningún import roto; las consultas de la cola de impresión y el módulo `dispatch` no dependen de lo retirado.

- [ ] **Step 1:** RED `e2e/pantalla.spec.ts` (extender): `GET /cocina` con sesión de `cocina` termina en `/pantalla`; el menú del personal ya no muestra "Cocina"; no existen las rutas/acciones viejas (`pnpm test:security` verde sin las dos acciones). FALLA.
- [ ] **Step 2:** Antes de borrar, buscar con `grep` todos los usos de cada archivo; borrar lo no usado, conservar lo compartido; redirección; actualizar guías (la de cocina describe el televisor, el significado de las dos zonas, el sonido y cómo iniciar la sesión del usuario `cocina`, y el ticket de cocina).
- [ ] **Step 3:** Compuertas completas: `pnpm lint`, `pnpm test`, `pnpm test:int`, `pnpm test:security`, `pnpm build`, `pnpm e2e` desde build limpio (ambos proyectos). Reportar fallas con su salida, sin ocultarlas. Commit `refactor(cocina): remove the old kitchen screen, /cocina redirects to /pantalla; docs`.

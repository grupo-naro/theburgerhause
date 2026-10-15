# The Burger Hause — Roadmap de implementación Fase 1 (MVP)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar 100% funcional el ciclo completo de pedidos de The Burger Hause (cliente → caja/mostrador → comanda impresa USB → despacho → cadete → rendición) antes de escribir una línea de la Fase 2.

**Architecture:** Monolito Next.js 16 (App Router) con Server Actions, Route Handlers (SSE, uploads, API del agente), PostgreSQL + Drizzle, tiempo real por SSE + `LISTEN/NOTIFY`, y un Print Agent Node.js por PC como paquete separado del workspace pnpm. La lógica de negocio crítica vive en un núcleo de dominio puro (`src/domain`) probado con TDD.

**Tech Stack:** Next.js 16.4.1, React 19.3, Tailwind 4, TypeScript, pnpm, PostgreSQL, Drizzle, zod, sharp, Vitest, Playwright, Nginx + systemd en Ubuntu (Contabo).

**Specs:**
- `docs/superpowers/specs/2026-10-14-the-burger-hause-mvp-design.md` (arquitectura, datos, estados, endpoints, agente)
- `docs/superpowers/specs/2026-10-14-the-burger-hause-ux-design.md` (UX, tokens, pantallas)

**Cómo leer este documento:** es un roadmap por sprints. Los **Sprints 0 y 1** están desarrollados paso a paso (TDD, código y comandos exactos) porque definen los cimientos; la excepción es la Tarea 1.5 (documento de impresión), descrita a nivel de tests y que se expande con código al llegar a ella. Los **Sprints 2 a 9** están definidos a nivel de tarea (archivos, interfaces, tests y criterio de aceptación). Al arrancar cada sprint se expande a pasos de 2–5 minutos con `writing-plans`, usando el código real ya existente, para que los nombres de archivos y tipos coincidan con lo construido.

## Global Constraints

- Gestor de paquetes: **pnpm**. Framework: **Next.js App Router**. Importes en **enteros (centavos)**.
- Antes de escribir código de Next.js, leer la guía correspondiente en `node_modules/next/dist/docs/` (`AGENTS.md`): esta versión tiene cambios incompatibles. Middleware se llama **Proxy** (`src/proxy.ts`); `cacheComponents: true` y `partialPrefetching: true` están activos, así que las pantallas de personal son dinámicas y van dentro de `<Suspense>`.
- Imágenes en el disco de la VPS (`UPLOAD_DIR`), sin S3 ni Cloudinary.
- Los pedidos guardan **snapshots** de nombres y precios; `order_items` tiene **una fila por unidad**.
- Los precios los recalcula siempre el servidor desde la BD; nunca se confía en totales del cliente.
- Estados: `pendiente_aprobacion`, `en_preparacion`, `listo_despacho`, `en_camino`, `para_retirar`, `entregado`, `cancelado`. Pago aparte: `payment_status` = `pending` | `paid`.
- Saldo de cadete **calculado**, no almacenado.
- Toda mutación: validación con zod, `requireRole()` en el servidor, transacción con `order_events` y `pg_notify`.
- Print Agent: solo conexiones salientes; token de estación hasheado; idempotente por `job.id`.
- Paleta y tipografía según el spec de UX (azul `#0557A9`, cheddar `#FFC629`, Baloo 2 + DM Sans).
- Nada de la Fase 2 (KDS, stock) hasta cerrar el Sprint 9.
- Commits frecuentes; mensajes `feat:`, `test:`, `chore:`, `docs:`.

## Review Focus

Modos de falla que el spec implica y que ningún test del spec cubre por sí solo; cada uno tiene su test en la tarea indicada.

1. **Total manipulado desde el cliente** (precio o modificador alterado en el POST): se ignora y se recalcula en el servidor. → Tarea 4.3.
2. **Doble clic o doble envío** en "Confirmar pedido" o "Aprobar": un solo pedido y un solo juego de `print_jobs`. → Tareas 4.3 y 5.2.
3. **Agente desconectado al aprobar:** los trabajos quedan `pending` y se imprimen una sola vez al reconectar. → Tarea 6.2.
4. **Carrito desactualizado:** producto o modificador desactivado entre el carrito y la confirmación devuelve un error claro y no crea pedido. → Tarea 4.3.
5. **Rendición concurrente:** dos PCs rinden al mismo cadete a la vez; el efectivo no se cuenta dos veces. → Tarea 8.3.

---

## Mapa de archivos (estado final de la Fase 1)

```
src/
  proxy.ts                         # chequeo optimista de cookie
  instrumentation.ts               # arranca el listener LISTEN/NOTIFY
  domain/                          # lógica pura, sin I/O  (Sprint 1)
    money.ts  order-status.ts  pricing.ts  cadet-balance.ts  print-document.ts
  db/
    schema.ts  client.ts  seed.ts  migrations/
  lib/
    auth/ (session.ts, password.ts, require-role.ts)
    events/ (listener.ts, bus.ts)
    uploads/ (process-image.ts)
    env.ts
  app/
    (public)/  (staff)/  (admin)/  api/
  components/ui/                   # primitivas con tokens
packages/
  print-agent/                     # servicio Windows (Sprint 6)
docs/superpowers/{specs,plans}/
```

Responsabilidades: `domain` no importa de `db`, `app` ni `lib`. Las Server Actions orquestan: validan (zod) → autorizan → abren transacción → llaman al dominio → escriben → `pg_notify`.

---

## Sprint 0 — Cimientos del proyecto

**Entregable:** el repo corre, testea y muestra una página con la identidad visual de la marca.

### Task 0.1: Herramientas de test y variables de entorno

**Files:**
- Create: `vitest.config.ts`, `.env.example`, `src/domain/smoke.test.ts`
- Modify: `package.json` (scripts), `.gitignore`

**Interfaces:** Produces: `pnpm test` (Vitest, entorno node) con alias `@/` → `src/`.

- [ ] **Step 1: Instalar dependencias de desarrollo**

Run: `pnpm add -D vitest`
Expected: `vitest` aparece en `devDependencies`.

- [ ] **Step 2: Crear `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "packages/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Agregar scripts y excepción de `.gitignore`**

En `package.json`, dentro de `scripts`, agregar `"test": "vitest run"` y `"test:watch": "vitest"`. En `.gitignore`, debajo de `.env*`, agregar la línea `!.env.example` (para poder versionar el ejemplo).

- [ ] **Step 4: Crear `.env.example`**

```
DATABASE_URL=postgres://burgerhause:burgerhause@localhost:5432/burgerhause
SESSION_SECRET=change-me-with-32-random-bytes
UPLOAD_DIR=./.uploads
```

- [ ] **Step 5: Test de humo para verificar el pipeline**

`src/domain/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("pipeline de tests", () => {
  it("ejecuta tests TypeScript", () => {
    expect(1 + 1).toBe(2);
  });
});
```

(El alias `@/` se verifica con el primer test real de la Tarea 1.1.)

Run: `pnpm test`
Expected: PASS (1 test). Después borrar `smoke.test.ts` (ya cumplió su función).

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts .env.example .gitignore package.json pnpm-lock.yaml
git commit -m "chore: add vitest and env example"
```

### Task 0.2: Sistema visual (tokens, fuentes, layout raíz)

**Files:**
- Modify: `src/app/globals.css`, `src/app/layout.tsx`, `src/app/page.tsx`
- Create: `public/brand/logo-512.webp` (versión optimizada del logo)

**Interfaces:** Produces: clases Tailwind `bg-brand-600`, `bg-cheddar-400`, `text-ink`, `bg-bg`, `border-line`, `font-display`, `font-sans`.

- [ ] **Step 1: Leer `src/app/globals.css` y `layout.tsx` actuales**, conservando la primera línea `@import "tailwindcss";` y cualquier configuración propia de esta versión.

- [ ] **Step 2: Reemplazar el contenido de `globals.css` por los tokens del spec de UX**

```css
@import "tailwindcss";

@theme {
  --color-brand-700: #043f7c;
  --color-brand-600: #0557a9;
  --color-brand-300: #62a8f5;
  --color-brand-50: #eaf3fe;
  --color-cheddar-400: #ffc629;
  --color-cheddar-600: #e0a300;
  --color-ink: #0b1f3a;
  --color-ink-muted: #5b6b80;
  --color-bg: #f5f8fc;
  --color-line: #dce5f0;
  --color-state-pending: #f59e0b;
  --color-state-preparing: #0557a9;
  --color-state-ready: #16a34a;
  --color-state-route: #7c3aed;
  --color-state-done: #64748b;
  --color-state-error: #dc2626;
  --font-display: var(--font-baloo), ui-rounded, system-ui, sans-serif;
  --font-sans: var(--font-dm-sans), system-ui, sans-serif;
}

body {
  background: var(--color-bg);
  color: var(--color-ink);
  font-family: var(--font-sans);
}

@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

- [ ] **Step 3: Cargar Baloo 2 y DM Sans en `layout.tsx`**

```tsx
import type { Metadata } from "next";
import { Baloo_2, DM_Sans } from "next/font/google";
import "./globals.css";

const baloo = Baloo_2({ variable: "--font-baloo", subsets: ["latin"], weight: ["600", "700", "800"] });
const dmSans = DM_Sans({ variable: "--font-dm-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "The Burger House 828",
  description: "Pedí online en The Burger House 828",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es-AR" className={`${baloo.variable} ${dmSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
```

- [ ] **Step 4: Optimizar el logo** (de ~1.5 MB a < 60 KB)

Run: `pnpm dlx sharp-cli -i public/logo.png -o public/brand/logo-512.webp resize 512 --format webp`
Si `sharp-cli` falla, usar un script de una línea con `sharp` (ya es dependencia del ecosistema Next). Verificar el tamaño del archivo resultante.

- [ ] **Step 5: Página de prueba de marca en `src/app/page.tsx`**

```tsx
import Image from "next/image";

export default function Home() {
  return (
    <main className="mx-auto flex max-w-md flex-col items-center gap-6 p-8">
      <Image src="/brand/logo-512.webp" alt="The Burger House 828" width={160} height={160} priority />
      <h1 className="font-display text-3xl font-extrabold text-brand-600">The Burger House 828</h1>
      <button className="rounded-full bg-cheddar-400 px-6 py-3 font-bold text-ink">Agregar al pedido</button>
    </main>
  );
}
```

- [ ] **Step 5b: Verificar**

Run: `pnpm lint && pnpm build`
Expected: sin errores. Luego `pnpm dev` y comprobar visualmente logo, tipografías y colores en `http://localhost:3000`.

- [ ] **Step 6: Commit**

```bash
git add public/logo.png public/brand src/app
git commit -m "feat: brand tokens, fonts and optimized logo"
```

### Task 0.3: PostgreSQL local y Drizzle

**Files:**
- Create: `drizzle.config.ts`, `src/db/client.ts`, `src/lib/env.ts`, `docker-compose.yml`
- Modify: `package.json` (scripts `db:generate`, `db:migrate`)

**Interfaces:** Produces: `db` (instancia Drizzle) exportada desde `@/db/client`; `env.DATABASE_URL`, `env.SESSION_SECRET`, `env.UPLOAD_DIR` validadas con zod desde `@/lib/env`.

- [ ] **Step 1:** `pnpm add drizzle-orm pg zod && pnpm add -D drizzle-kit @types/pg`
- [ ] **Step 2:** `docker-compose.yml` con un servicio `postgres:16` (usuario, contraseña y base `burgerhause`, puerto 5432, volumen persistente). Levantar con `docker compose up -d`.
- [ ] **Step 3:** `src/lib/env.ts`: esquema zod que lee `process.env`, falla al arrancar con mensaje claro si falta una variable. Test (`src/lib/env.test.ts`): falla sin `DATABASE_URL`, pasa con las tres variables.
- [ ] **Step 4:** `src/db/client.ts`: pool `pg` singleton (guardado en `globalThis` para sobrevivir al hot reload) y `drizzle(pool)`.
- [ ] **Step 5:** `drizzle.config.ts` apuntando a `src/db/schema.ts` y `src/db/migrations`.
- [ ] **Step 6:** Commit `chore: postgres, drizzle and env validation`.

---

## Sprint 1 — Núcleo de dominio puro (TDD)

**Entregable:** reglas de negocio críticas probadas, sin base de datos ni UI. Es lo que más cuesta corregir si sale mal.

### Task 1.1: Dinero

**Files:** Create `src/domain/money.ts`, `src/domain/money.test.ts`

**Interfaces:** Produces: `formatARS(cents: number): string`, `assertCents(n: number): void`.

- [ ] **Step 1: Test que falla**

```ts
import { describe, expect, it } from "vitest";
import { assertCents, formatARS } from "@/domain/money";

describe("formatARS", () => {
  it("formatea centavos como pesos argentinos", () => {
    expect(formatARS(1_460_000).replace(/\s/g, " ")).toBe("$ 14.600");
  });
  it("formatea cero", () => {
    expect(formatARS(0).replace(/\s/g, " ")).toBe("$ 0");
  });
});

describe("assertCents", () => {
  it("rechaza decimales", () => {
    expect(() => assertCents(10.5)).toThrow("entero");
  });
  it("acepta enteros", () => {
    expect(() => assertCents(1000)).not.toThrow();
  });
});
```

- [ ] **Step 2:** `pnpm test src/domain/money.test.ts` → FAIL (módulo inexistente).
- [ ] **Step 3: Implementar**

```ts
export function assertCents(n: number): void {
  if (!Number.isInteger(n)) {
    throw new Error(`El importe debe ser un entero en centavos, recibido: ${n}`);
  }
}

export function formatARS(cents: number): string {
  assertCents(cents);
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
```

- [ ] **Step 4:** `pnpm test src/domain/money.test.ts` → PASS. Si el formato de `Intl` difiere en el entorno, ajustar el test para comparar solo los dígitos y el separador `14.600`.
- [ ] **Step 5:** Commit `feat(domain): money helpers`.

### Task 1.2: Máquina de estados del pedido

**Files:** Create `src/domain/order-status.ts`, `src/domain/order-status.test.ts`

**Interfaces:** Produces: `type OrderStatus`, `type Fulfillment = "delivery" | "takeaway"`, `ORDER_STATUSES`, `canTransition(from, to, fulfillment): boolean`, `nextStatuses(from, fulfillment): OrderStatus[]`.

- [ ] **Step 1: Test que falla**

```ts
import { describe, expect, it } from "vitest";
import { canTransition, nextStatuses } from "@/domain/order-status";

describe("canTransition", () => {
  it("aprueba un pedido pendiente (ambos tipos de entrega)", () => {
    expect(canTransition("pendiente_aprobacion", "en_preparacion", "delivery")).toBe(true);
    expect(canTransition("pendiente_aprobacion", "en_preparacion", "takeaway")).toBe(true);
  });
  it("permite rechazar solo desde pendiente", () => {
    expect(canTransition("pendiente_aprobacion", "cancelado", "delivery")).toBe(true);
    expect(canTransition("en_preparacion", "cancelado", "delivery")).toBe(false);
  });
  it("delivery va a en_camino, takeaway a para_retirar", () => {
    expect(canTransition("listo_despacho", "en_camino", "delivery")).toBe(true);
    expect(canTransition("listo_despacho", "para_retirar", "delivery")).toBe(false);
    expect(canTransition("listo_despacho", "para_retirar", "takeaway")).toBe(true);
    expect(canTransition("listo_despacho", "en_camino", "takeaway")).toBe(false);
  });
  it("una entrega fallida vuelve a despacho", () => {
    expect(canTransition("en_camino", "listo_despacho", "delivery")).toBe(true);
  });
  it("no se puede saltar etapas", () => {
    expect(canTransition("pendiente_aprobacion", "entregado", "delivery")).toBe(false);
    expect(canTransition("en_preparacion", "en_camino", "delivery")).toBe(false);
  });
  it("estados finales no tienen salida", () => {
    expect(nextStatuses("entregado", "delivery")).toEqual([]);
    expect(nextStatuses("cancelado", "takeaway")).toEqual([]);
  });
});
```

- [ ] **Step 2:** `pnpm test src/domain/order-status.test.ts` → FAIL.
- [ ] **Step 3: Implementar**

```ts
export const ORDER_STATUSES = [
  "pendiente_aprobacion",
  "en_preparacion",
  "listo_despacho",
  "en_camino",
  "para_retirar",
  "entregado",
  "cancelado",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type Fulfillment = "delivery" | "takeaway";

const COMMON: Partial<Record<OrderStatus, readonly OrderStatus[]>> = {
  pendiente_aprobacion: ["en_preparacion", "cancelado"],
  en_preparacion: ["listo_despacho"],
  para_retirar: ["entregado"],
};

const BY_FULFILLMENT: Record<Fulfillment, Partial<Record<OrderStatus, readonly OrderStatus[]>>> = {
  delivery: { listo_despacho: ["en_camino"], en_camino: ["entregado", "listo_despacho"] },
  takeaway: { listo_despacho: ["para_retirar"] },
};

export function nextStatuses(from: OrderStatus, fulfillment: Fulfillment): OrderStatus[] {
  return [...(COMMON[from] ?? []), ...(BY_FULFILLMENT[fulfillment][from] ?? [])];
}

export function canTransition(from: OrderStatus, to: OrderStatus, fulfillment: Fulfillment): boolean {
  return nextStatuses(from, fulfillment).includes(to);
}
```

- [ ] **Step 4:** `pnpm test src/domain/order-status.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat(domain): order status state machine`.

### Task 1.3: Cálculo de totales

**Files:** Create `src/domain/pricing.ts`, `src/domain/pricing.test.ts`

**Interfaces:** Consumes: `assertCents` (1.1). Produces: `type UnitInput = { basePrice: number; modifiers: { priceDelta: number }[] }`, `unitTotal(unit): number`, `orderTotals(units: UnitInput[], deliveryFee: number): { subtotal: number; total: number }`.

- [ ] **Step 1: Test que falla**

```ts
import { describe, expect, it } from "vitest";
import { orderTotals, unitTotal } from "@/domain/pricing";

describe("unitTotal", () => {
  it("suma precio base y agregados", () => {
    expect(unitTotal({ basePrice: 1_400_000, modifiers: [{ priceDelta: 150_000 }, { priceDelta: 0 }] })).toBe(1_550_000);
  });
});

describe("orderTotals", () => {
  it("cada unidad se calcula por separado", () => {
    const units = [
      { basePrice: 1_400_000, modifiers: [{ priceDelta: 150_000 }] },
      { basePrice: 1_400_000, modifiers: [] },
    ];
    expect(orderTotals(units, 0)).toEqual({ subtotal: 2_950_000, total: 2_950_000 });
  });
  it("suma el envío solo al total", () => {
    expect(orderTotals([{ basePrice: 1_000_000, modifiers: [] }], 200_000)).toEqual({
      subtotal: 1_000_000,
      total: 1_200_000,
    });
  });
  it("rechaza importes con decimales", () => {
    expect(() => orderTotals([{ basePrice: 10.5, modifiers: [] }], 0)).toThrow("entero");
  });
  it("un pedido vacío es un error", () => {
    expect(() => orderTotals([], 0)).toThrow("al menos una unidad");
  });
});
```

- [ ] **Step 2:** Ejecutar → FAIL.
- [ ] **Step 3: Implementar**

```ts
import { assertCents } from "@/domain/money";

export type UnitInput = { basePrice: number; modifiers: { priceDelta: number }[] };

export function unitTotal(unit: UnitInput): number {
  assertCents(unit.basePrice);
  return unit.modifiers.reduce((sum, m) => {
    assertCents(m.priceDelta);
    return sum + m.priceDelta;
  }, unit.basePrice);
}

export function orderTotals(units: UnitInput[], deliveryFee: number) {
  if (units.length === 0) throw new Error("El pedido debe tener al menos una unidad");
  assertCents(deliveryFee);
  const subtotal = units.reduce((sum, u) => sum + unitTotal(u), 0);
  return { subtotal, total: subtotal + deliveryFee };
}
```

- [ ] **Step 4:** Ejecutar → PASS. **Step 5:** Commit `feat(domain): pricing totals`.

### Task 1.4: Saldo del cadete

**Files:** Create `src/domain/cadet-balance.ts`, `src/domain/cadet-balance.test.ts`

**Interfaces:** Consumes: `OrderStatus` (1.2). Produces: `type BalanceOrder = { id: number; total: number; paymentMethod: "cash" | "transfer"; paymentStatus: "pending" | "paid"; status: OrderStatus; cadetId: number | null }`, `cadetBalance(orders: BalanceOrder[], cadetId: number): { owed: number; orderIds: number[]; inRoute: number }`.

- [ ] **Step 1: Test que falla**

```ts
import { describe, expect, it } from "vitest";
import { cadetBalance, type BalanceOrder } from "@/domain/cadet-balance";

const o = (p: Partial<BalanceOrder>): BalanceOrder => ({
  id: 1, total: 1_000_000, paymentMethod: "cash", paymentStatus: "pending",
  status: "entregado", cadetId: 7, ...p,
});

describe("cadetBalance", () => {
  it("suma solo efectivo entregado y pendiente del cadete", () => {
    const orders = [
      o({ id: 1, total: 1_000_000 }),
      o({ id: 2, total: 500_000 }),
      o({ id: 3, paymentMethod: "transfer" }),
      o({ id: 4, paymentStatus: "paid" }),
      o({ id: 5, cadetId: 9 }),
      o({ id: 6, status: "cancelado" }),
    ];
    expect(cadetBalance(orders, 7)).toEqual({ owed: 1_500_000, orderIds: [1, 2], inRoute: 0 });
  });
  it("cuenta aparte los pedidos en camino", () => {
    expect(cadetBalance([o({ id: 1, status: "en_camino" })], 7)).toEqual({ owed: 0, orderIds: [], inRoute: 1 });
  });
  it("sin pedidos el saldo es cero", () => {
    expect(cadetBalance([], 7)).toEqual({ owed: 0, orderIds: [], inRoute: 0 });
  });
});
```

- [ ] **Step 2:** Ejecutar → FAIL.
- [ ] **Step 3: Implementar**

```ts
import type { OrderStatus } from "@/domain/order-status";

export type BalanceOrder = {
  id: number;
  total: number;
  paymentMethod: "cash" | "transfer";
  paymentStatus: "pending" | "paid";
  status: OrderStatus;
  cadetId: number | null;
};

export function cadetBalance(orders: BalanceOrder[], cadetId: number) {
  const mine = orders.filter((o) => o.cadetId === cadetId);
  const owing = mine.filter(
    (o) => o.status === "entregado" && o.paymentMethod === "cash" && o.paymentStatus === "pending",
  );
  return {
    owed: owing.reduce((sum, o) => sum + o.total, 0),
    orderIds: owing.map((o) => o.id),
    inRoute: mine.filter((o) => o.status === "en_camino").length,
  };
}
```

- [ ] **Step 4:** Ejecutar → PASS. **Step 5:** Commit `feat(domain): cadet balance`.

### Task 1.5: Documento de impresión (comanda y ticket)

**Files:** Create `src/domain/print-document.ts`, `src/domain/print-document.test.ts`

**Interfaces:** Consumes: `formatARS` (1.1). Produces: tipos `PrintBlock` (`{ type: "text"; text: string; bold?: boolean; size?: 1 | 2; align?: "left" | "center" } | { type: "divider" } | { type: "cut" }`), `PrintDocument = { blocks: PrintBlock[] }`, `PrintableOrder`, `renderKitchenTicket(order): PrintDocument`, `renderCustomerTicket(order): PrintDocument`.

- [ ] **Step 1: Test que falla** — cubre: la comanda de cocina lista una entrada por unidad, con cada `kitchenLabel` en negrita y en mayúsculas; el ticket de cliente incluye precios, total, nombre, WhatsApp y dirección en delivery, o N° de llamador en mostrador; ambos terminan en `{ type: "cut" }`; una unidad sin modificadores no genera bloques de modificación.
- [ ] **Step 2:** Ejecutar → FAIL.
- [ ] **Step 3:** Implementar los dos renderizadores como funciones puras que recorren `order.items[].modifiers[]` y producen bloques; la comanda usa `size: 2` para el número de pedido y `bold: true` para cada `kitchenLabel`.
- [ ] **Step 4:** Ejecutar → PASS. **Step 5:** Commit `feat(domain): kitchen and customer print documents`.

---

## Sprint 2 — Base de datos y autenticación

**Entregable:** esquema completo migrado, datos de prueba y login con roles y selección de estación.

### Task 2.1: Esquema Drizzle y migración inicial
**Files:** Create `src/db/schema.ts`, `src/db/migrations/*`, `src/db/seed.ts`
**Interfaces:** Produces: tablas del §3 del spec (`categories`, `products` con `featured`, `modifier_groups`, `modifiers`, `product_modifier_groups`, `orders`, `order_items`, `order_item_modifiers`, `order_events`, `users`, `sessions`, `stations`, `cadets`, `settlements`, `settlement_orders`, `print_jobs`, `settings` con `accepting_orders`), enums `order_status`, `payment_method`, `payment_status`, `fulfillment`, `channel`, `user_role`, `print_job_status`.
**Tests:** test de integración que migra una base de pruebas vacía y verifica restricciones: `orders.number` único por día (secuencia segura bajo concurrencia, 20 inserciones paralelas sin duplicados), `pager_number` obligatorio si `channel = counter`, claves foráneas.
**Aceptación:** `pnpm db:migrate` deja la base lista; `seed.ts` carga las categorías del cliente, 10 productos de ejemplo, modificadores de ejemplo, 1 admin, 2 estaciones y 3 cadetes.

### Task 2.2: Contraseñas y sesiones
**Files:** Create `src/lib/auth/password.ts`, `src/lib/auth/session.ts`, `src/lib/auth/require-role.ts` y sus tests.
**Interfaces:** Produces: `hashPassword(plain): Promise<string>`, `verifyPassword(plain, hash): Promise<boolean>`, `createSession(userId, stationId?): Promise<{ id: string; expiresAt: Date }>`, `getSession(): Promise<{ user; stationId } | null>`, `requireRole(...roles): Promise<{ user; stationId }>` (lanza si no hay sesión o rol).
**Tests:** hash distinto por llamada y verificación correcta; sesión vencida devuelve `null`; expiración deslizante de 12 h se renueva; `requireRole("admin")` rechaza a una cajera; sesión revocada deja de ser válida.

### Task 2.3: Login, selección de estación y Proxy
**Files:** Create `src/app/(staff)/login/page.tsx`, `src/app/(staff)/login/actions.ts`, `src/proxy.ts`
**Tests:** acción de login con credenciales inválidas devuelve error genérico (sin revelar si el usuario existe); con rol cajera redirige a `/caja`; `proxy.ts` redirige a `/login` sin cookie para rutas `(staff)` y `(admin)` y deja pasar `/` y `/pedido/*`. Leer `node_modules/next/dist/docs/01-app/02-guides/authentication.md` antes de implementar.
**Aceptación:** puedo iniciar sesión como cajera, elegir "Mostrador 1" y ver una página protegida.

---

## Sprint 3 — Administración de menú y operación

**Entregable:** el admin carga el menú real del local sin tocar código.

### Task 3.1: Procesamiento y subida de imágenes
**Files:** Create `src/lib/uploads/process-image.ts`, `src/app/api/uploads/route.ts`, `src/app/uploads/[...path]/route.ts` (solo desarrollo), tests.
**Interfaces:** Produces: `processImage(buffer): Promise<{ large: Buffer; thumb: Buffer }>` (webp 800 px y 200 px), `POST /api/uploads` → `{ path: string }`.
**Tests:** rechaza un `.exe` renombrado a `.jpg` (magic bytes); rechaza > 5 MB; genera dos tamaños; el nombre es UUID; solo rol `admin`.

### Task 3.2: CRUD de categorías y productos
**Files:** `src/app/(admin)/admin/menu/` (page, formularios, `actions.ts`), tests de integración.
**Interfaces:** Produces: acciones `saveCategory`, `saveProduct`, `reorder`, `toggleActive`, `toggleFeatured`; invalidación del caché del menú público con `revalidateTag("menu")`.
**Aceptación:** crear, editar, ordenar, desactivar y marcar destacado un producto con imagen, y ver el cambio en `/`.

### Task 3.3: Modificadores
**Files:** `src/app/(admin)/admin/modificadores/` y tests.
**Interfaces:** Produces: acciones `saveModifierGroup`, `saveModifier` (con `kind`, `priceDelta`, `kitchenLabel`), `linkGroupToProduct`.
**Tests:** `kitchenLabel` se guarda en mayúsculas; un modificador `remove` no puede tener `priceDelta` distinto de 0.

### Task 3.4: Cadetes, usuarios, estaciones y ajustes
**Files:** `src/app/(admin)/admin/{cadetes,usuarios,estaciones,ajustes}/`
**Interfaces:** Produces: acciones `saveCadet`, `saveUser`, `revokeSessions`, `createStation` (devuelve el token **una sola vez**; se guarda solo el hash), `rotateStationToken`, `saveSettings` (datos del local, alias/CBU, `delivery_fee`, `accepting_orders`).
**Tests:** el token se guarda hasheado; rotar invalida el anterior; solo `admin`.

---

## Sprint 4 — Tienda del cliente

**Entregable:** un cliente real puede armar y enviar un pedido desde el celular.

### Task 4.1: Menú público
**Files:** `src/app/(public)/page.tsx`, `src/components/menu/{header,featured-carousel,category-bar,product-card,search}.tsx`, `src/lib/menu/queries.ts`
**Interfaces:** Produces: `getMenu(): Promise<MenuCategory[]>` con `use cache` y `cacheTag("menu")`.
**Aceptación:** barra de categorías *sticky* con scrollspy, buscador instantáneo, destacados, banner de local cerrado cuando `accepting_orders = false`. Revisar `node_modules/next/dist/docs/01-app/01-getting-started/08-caching.md` y la guía de `cacheComponents` antes de implementar.

### Task 4.2: Hoja de producto y carrito (cliente)
**Files:** `src/components/product/product-sheet.tsx`, `src/lib/cart/{store.ts,types.ts}` y tests.
**Interfaces:** Produces: `type CartLine = { productId: number; modifierIds: number[]; note?: string }` (una línea por unidad), `cartReducer`, `groupLines(lines)` (agrupa visualmente líneas idénticas), `cartPreviewTotal(lines, catalog)`.
**Tests (puros):** agregar 2 unidades con modificaciones distintas produce 2 líneas separadas; dos idénticas se agrupan con cantidad 2; "Igual que la 1" copia los `modifierIds`; persistencia en `localStorage` tolera datos corruptos.

### Task 4.3: Checkout y `createOrder`
**Files:** `src/app/(public)/checkout/page.tsx`, `src/app/(public)/checkout/actions.ts`, `src/lib/orders/create-order.ts` y tests de integración.
**Interfaces:** Consumes: `orderTotals` (1.3). Produces: `createOrder(input): Promise<{ publicToken: string }>`; `input` solo contiene `productId`, `modifierIds`, `note` por unidad más datos del cliente (nunca importes).
**Tests (Review Focus 1, 2 y 4):** un POST con precio alterado se ignora y el total sale de la BD; enviar dos veces la misma clave de idempotencia crea un solo pedido; un modificador desactivado o producto inactivo devuelve error claro y no crea nada; delivery sin dirección falla; honeypot lleno se rechaza; el límite de tasa por IP corta ráfagas; `accepting_orders = false` rechaza.

### Task 4.4: Seguimiento `/pedido/[token]`
**Files:** `src/app/(public)/pedido/[token]/page.tsx`
**Aceptación:** línea de tiempo con el estado actual; un token inexistente da 404; no expone datos de otros pedidos.

---

## Sprint 5 — Tiempo real y Caja

**Entregable:** la cajera ve entrar pedidos en vivo, los aprueba y se generan los trabajos de impresión.

### Task 5.1: Bus de eventos (LISTEN/NOTIFY + SSE)
**Files:** `src/instrumentation.ts`, `src/lib/events/{listener,bus}.ts`, `src/app/api/events/route.ts`, tests.
**Interfaces:** Produces: `notify(tx, channel, payload)`, `subscribe(channel, handler): () => void`, `GET /api/events` (SSE con keep-alive de 25 s; solo personal con sesión).
**Tests:** un `notify` dentro de una transacción llega a un suscriptor; si la transacción hace rollback, no llega; el stream se limpia al cerrar la conexión; el listener se reconecta tras cortar la conexión a la BD.
Leer `node_modules/next/dist/docs/01-app/02-guides/instrumentation.md` y `.../15-route-handlers.md` (streaming) antes de implementar.

### Task 5.2: Aprobar y rechazar pedidos + creación de `print_jobs`
**Files:** `src/lib/orders/{approve-order,reject-order}.ts`, `src/app/(staff)/caja/actions.ts`, tests de integración.
**Interfaces:** Consumes: `canTransition` (1.2), `renderKitchenTicket`, `renderCustomerTicket` (1.5), `notify` (5.1). Produces: `approveOrder({ orderId, userId, stationId, paymentVerified: boolean })`, `rejectOrder({ orderId, userId, reason })`.
**Tests (Review Focus 2):** transferencia sin `paymentVerified` se rechaza; transferencia aprobada queda `paid`, efectivo `pending`; aprobar dos veces seguidas crea **un solo** par de `print_jobs`; aprobar un pedido ya cancelado falla; cada transición escribe `order_events`; el `print_job` lleva el `station_id` de quien aprobó.

### Task 5.3: Pantalla de Caja
**Files:** `src/app/(staff)/caja/page.tsx`, `src/components/staff/{order-card,live-refresh,sound-alert}.tsx`
**Aceptación:** al crear un pedido web en otra pestaña, aparece en la bandeja sin recargar, con sonido y destello; la casilla "Verifiqué la acreditación" habilita el botón en transferencias; panel de alertas de impresión fallida con **Reimprimir**.

---

## Sprint 6 — Print Agent

**Entregable:** el pedido aprobado sale en la impresora USB de la PC correcta, y reintenta si el agente estaba caído.

### Task 6.1: Protocolo del servidor para el agente
**Files:** `src/app/api/agent/{stream,heartbeat}/route.ts`, `src/app/api/agent/jobs/[id]/ack/route.ts`, `src/lib/print/{agent-auth,jobs}.ts`, tests.
**Interfaces:** Produces: `authenticateStation(request): Promise<Station>`, `claimPendingJobs(stationId)`, `ackJob(jobId, stationId, { status, error? })`, `requeueStuckJobs(now)` (trabajos `printing` > 30 s vuelven a `pending`; tras 3 intentos pasan a `failed`).
**Tests (Review Focus 3):** token inválido → 401; un agente no puede reconocer trabajos de otra estación; al conectar recibe todos los `pending` de su estación y ninguno de otra; un trabajo reclamado dos veces no se entrega duplicado; `requeueStuckJobs` respeta el límite de 3 intentos; `heartbeat` actualiza `last_seen_at`.

### Task 6.2: Paquete `print-agent`
**Files:** Create `packages/print-agent/{package.json,src/{index,client,escpos,printer}.ts,src/escpos.test.ts}`; Modify `pnpm-workspace.yaml` (agregar `packages: ["packages/*"]` conservando `ignoredBuiltDependencies`).
**Interfaces:** Consumes: `PrintDocument` (1.5), protocolo (6.1). Produces: `toEscPos(doc: PrintDocument, paperWidth: 58 | 80): Buffer`, agente con reconexión con retroceso exponencial, memoria de los últimos 200 `job.id` impresos (idempotencia) y configuración `SERVER_URL`, `STATION_TOKEN`, `PAPER_WIDTH`, `PRINTER_NAME`.
**Tests:** `toEscPos` produce los bytes esperados para texto, negrita, doble tamaño, separador y corte, y respeta el ancho de línea; un `job.id` repetido no se imprime dos veces; con la impresora simulada, un trabajo recibido se imprime y se confirma con `done`; si la impresora falla, confirma `failed` con el error; al caer la conexión el agente reconecta y recibe los pendientes.
**Aceptación:** `pnpm --filter print-agent test` pasa.

### Task 6.3: Instalación como servicio de Windows y guía
**Files:** `packages/print-agent/{install.ps1,README.md}`
**Aceptación:** guía de instalación paso a paso (Node, variables, servicio con arranque automático, cómo ver logs, cómo rotar el token) y prueba manual con una impresora real y una comanda de ejemplo en la PC de pruebas. **Confirmar marca y ancho de papel antes de esta tarea** (pregunta abierta 2 del spec).

---

## Sprint 7 — Mostrador (POS)

**Entregable:** las cajeras toman pedidos presenciales con cobro, llamador e impresión automática.

### Task 7.1: `createCounterOrder`
**Files:** `src/lib/orders/create-counter-order.ts`, `src/app/(staff)/mostrador/actions.ts`, tests.
**Tests:** nace en `en_preparacion` y `paid`; sin `pagerNumber` falla; un llamador ya en uso por otro pedido activo se rechaza; crea los dos `print_jobs` para la estación de la sesión; recalcula precios en el servidor.

### Task 7.2: Pantalla POS
**Files:** `src/app/(staff)/mostrador/page.tsx`, `src/components/pos/{product-grid,ticket-panel,pager-pad,payment-buttons}.tsx`
**Aceptación:** cuadrícula táctil por categoría, selector de modificadores por unidad en formato compacto, teclado numérico para el llamador, "Cobrar e imprimir", atajos de teclado.

---

## Sprint 8 — Despacho, cadetes y rendición

**Entregable:** del "listo" a la rendición del efectivo, sin planillas.

### Task 8.1: Marcar listo y despacho de mostrador
**Files:** `src/lib/orders/transition-order.ts`, `src/app/(staff)/despacho/page.tsx`, acciones `markReady`, `markPickup`, `markDelivered`.
**Tests:** transiciones inválidas se rechazan con `canTransition`; cada una escribe `order_events` y notifica.

### Task 8.2: Asignación múltiple de cadete
**Files:** `src/lib/orders/assign-cadet.ts`, `src/components/dispatch/assign-bar.tsx`, tests.
**Interfaces:** Produces: `assignCadet({ orderIds: number[]; cadetId: number; userId })` atómico: si un pedido no está en `listo_despacho` o no es delivery, no se asigna ninguno.
**Tests:** asignar #1, #2 y #3 a un cadete deja los tres `en_camino`; con uno inválido falla todo; `returnToDispatch` desasigna al cadete.

### Task 8.3: Rendición del cadete
**Files:** `src/lib/settlements/settle-cadet.ts`, `src/app/(staff)/despacho/rendicion/page.tsx`, tests de integración.
**Interfaces:** Consumes: `cadetBalance` (1.4). Produces: `settleCadet({ cadetId, expectedAmount, userId }): Promise<{ settlementId: number }>`; falla si `expectedAmount` no coincide con el saldo actual (evita rendir un monto que cambió).
**Tests (Review Focus 5):** al rendir, los pedidos pasan a `paid` y el saldo queda en 0; dos rendiciones simultáneas del mismo cadete producen **un solo** `settlement` y el segundo recibe un error claro; los pedidos `en_camino` no se incluyen; un monto esperado distinto al real falla; se registra quién rindió.
**Aceptación:** pantalla con saldo por cadete, desglose de pedidos, "Recibí $X" con confirmación y comprobante.

---

## Sprint 9 — Endurecimiento, despliegue y puesta en marcha

**Entregable:** el sistema corre en la VPS, probado de punta a punta con las impresoras reales.

### Task 9.1: Pruebas E2E de los tres flujos críticos
**Files:** `playwright.config.ts`, `e2e/{web-order-to-print,counter-sale,dispatch-and-settle}.spec.ts`
**Tests:** (1) cliente pide → cajera aprueba → existe `print_job` para su estación; (2) venta de mostrador con llamador; (3) asignar tres pedidos a un cadete y rendir hasta saldo $0.

### Task 9.2: Despliegue en Contabo
**Files:** `deploy/{nginx.conf,burgerhause.service,deploy.sh,backup.sh}`, `docs/ops/runbook.md`
**Contenido:** Nginx con TLS y `proxy_buffering off` para `/api/events` y `/api/agent/stream`; servicio systemd de una sola instancia; `drizzle-kit migrate` antes del reinicio; `pg_dump` diario con retención de 14 días y rsync de `uploads`; `/api/health`; runbook con cómo restaurar un backup.
**Aceptación:** restauración de backup probada en una base vacía.

### Task 9.3: Seguridad y rendimiento
**Tests/Checklist:** cabeceras de seguridad, cookies `httpOnly/secure/sameSite`, rate limit verificado, 5432 no expuesto, auditoría Lighthouse móvil de `/` (objetivo: LCP razonable en 4G), prueba de carga de 9 estaciones conectadas por SSE más 30 clientes en la tienda.

### Task 9.4: Prueba de aceptación en el local y salida
**Checklist:** instalar el agente en las 9 PCs; imprimir comanda y ticket reales en cada impresora; una jornada de **operación en paralelo con pxw** (los pedidos se cargan en ambos sistemas); capacitar a cajeras y encargada con una guía de una página; plan de contingencia (si cae el sistema: comandas a mano); cierre del MVP y recién entonces planificar la Fase 2.

---

## Autorrevisión

- **Cobertura del spec:** menú y checkout (4.1–4.3), caja (5.x), POS (7.x), impresión (1.5, 5.2, 6.x), despacho y rendición (8.x), admin (3.x), tiempo real (5.1), auth (2.x), imágenes (3.1), despliegue y backups (9.2), testing (1.x y 9.1), UX y tokens (0.2, 4.x, 5.3, 7.2). Cambios del spec de UX en el modelo (`featured`, `accepting_orders`) incluidos en 2.1.
- **Consistencia de tipos:** `OrderStatus`/`Fulfillment` (1.2) se reutilizan en 1.4, 5.2 y 8.x; `PrintDocument` (1.5) en 5.2 y 6.2; `orderTotals` (1.3) en 4.3 y 7.1; `cadetBalance` (1.4) en 8.3.
- **Pendiente de expandir:** los pasos de 2–5 minutos de los Sprints 2 a 9 se escriben al iniciar cada sprint, sobre el código ya existente.
- **Preguntas abiertas que bloquean tareas:** costo de envío (Tarea 3.4 y 4.3, por defecto $0), modelo y ancho de las impresoras (Tarea 6.3), horarios de atención (Tarea 4.1, por defecto interruptor manual).

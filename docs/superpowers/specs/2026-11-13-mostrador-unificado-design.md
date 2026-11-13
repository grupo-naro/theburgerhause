# Mostrador unificado: los pedidos de la app para retirar entran a Mostrador

Fecha: 2026-11-13. Pedido del dueño.

## Intención

En una simulación de un día cargado (tipo "día de la hamburguesa") nadie miró la pantalla "Retiro en local" y los pedidos de la app para retirar se acumularon. La cajera vive en Venta (la caja) y en Mostrador; una tercera pantalla no se mira. El aviso actual (pitido, contador en el título de la pestaña y número junto al link del menú) no alcanzó.

## Objetivos

- Los pedidos de la app con "retirar en el local" se gestionan en **Mostrador**, junto con las ventas del local, en una sola pantalla.
- Mientras haya pedidos de la app **por aprobar**, en la pantalla de Venta (y en el resto de las pantallas de la cajera, salvo Mostrador) se ve una **franja fija**: "🔔 N pedidos de la app por aprobar · [Ver y aprobar]". El botón lleva a Mostrador. No se puede cerrar: desaparece sola cuando no quedan pedidos por aprobar.
- Cada tarjeta muestra de dónde viene: **"MOSTRADOR"** (venta del local, con su llamador) o **"APP · RETIRA EN LOCAL"** (con el nombre del cliente).

## No-objetivos y anti-objetivos

- **Delivery no cambia**: sigue en su pantalla aparte (Gestión Delivery), porque lo maneja otra persona.
- No se aprueban pedidos de forma automática; aprobar o rechazar sigue siendo manual.
- No cambian los estados de los pedidos, ni los tickets, ni la pantalla de la TV (/pantalla), ni la cocina.
- Falla si: un pedido de la app por aprobar puede pasar desapercibido mientras la cajera está en Venta; se pierde el acceso a Recientes (reimprimir) o al aviso de impresiones fallidas; o la cajera ve pedidos de delivery en Mostrador.

## Decidido por el dueño

1. Delivery queda aparte; lo de retiro se junta con el mostrador en una misma pantalla.
2. Las tarjetas de la app dicen "APP · RETIRA EN LOCAL" (no "delivery", para que no se confunda con envío).
3. Opción B: todo en Mostrador **más** la franja fija de aviso en Venta.

## Enfoques considerados

- **A. Todo en Mostrador, sin aviso extra.** Lo más simple, pero en Venta la cajera solo se entera por el pitido y el título de la pestaña, que es justo lo que falló en la simulación. Descartado.
- **B. Todo en Mostrador + franja fija en Venta.** Elegido por el dueño: ataca la causa (nadie mira otra pantalla) sin depender del sonido.

## Mis decisiones (marcadas para que las corrijas)

- **Pantalla Mostrador (`/mostrador/pedidos`)**, de arriba hacia abajo:
  1. **"Por aprobar"**: los pedidos de la app para retirar que esperan aprobación, con aprobar, rechazar y editar, como hoy en Retiro en local.
  2. **El aviso de impresiones fallidas** de la estación, que hoy está en Retiro en local.
  3. **Las columnas actuales** (En preparación, Listos, Esperando retiro), con ventas del local y pedidos de la app mezclados en orden de llegada.
  4. **"Recientes"**, que hoy está en Retiro en local (desde ahí se reimprime).
- **Retiro en local desaparece del menú** de la cajera, y quien abra `/retiro` (un link viejo o una pestaña guardada) va a parar a `/mostrador/pedidos`.
- **El número de pedidos por aprobar**, que hoy aparece junto a "Retiro en local" en el menú, pasa a aparecer junto a "Mostrador".
- **La franja de Venta se muestra en todas las pantallas de la cajera salvo Mostrador** (Venta, Stock): basta con que esté fuera de Mostrador para que se vea. El pitido y el contador en el título se mantienen.
- **Encargado y admin** ven lo mismo en Mostrador. Sus vistas generales (Vista general y Tablero general) no cambian.
- **Se mantienen las reglas de sector:** la cajera nunca ve ni toca pedidos de delivery.

## Restricciones

- **Next.js 16** trae cambios incompatibles: hay que leer `node_modules/next/dist/docs/` antes de tocar código.
- **Se reutiliza lo que ya existe**: el tablero de despacho, la sección "Por aprobar" y Recientes del espacio de trabajo de Retiro, y el aviso de la barra superior.
- **Una sola conexión en vivo por página.**
- **Textos en español (es-AR)** y botones de al menos 44 px.
- **Seguridad:** toda página o acción nueva o movida se registra en `src/lib/security/surface.ts`.
- **Pruebas de punta a punta que van a cambiar:** las de Retiro en local (`e2e/journey-takeaway.spec.ts` y otras que naveguen a `/retiro`). Hay que actualizarlas, no borrarlas.

## A cargo del constructor

- Cómo componer la página: extender `SectorWorkspacePage` o armar Mostrador con sus piezas.
- El estilo exacto de la franja y de las etiquetas, siguiendo los tokens actuales.
- El orden interno de las tarjetas dentro de cada columna, si hiciera falta afinarlo.

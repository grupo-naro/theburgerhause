# Pantalla de pedidos del mostrador y vuelta del ticket de cocina

Fecha: 2026-10-24. Reemplaza el diseño de la pantalla de cocina del 2026-10-18 (`2026-10-18-pantalla-cocina-design.md`). El dueño aclaró que esa pantalla no iba a estar en la cocina sino en el mostrador, frente al cliente.

## Intención

Un televisor en el mostrador, "tipo McDonald's", que muestra a clientes y personal qué pedidos se están preparando y cuáles están listos para entregar, identificados por el número de pedido. Como la pantalla ya no está en la cocina, la cocina vuelve a recibir un ticket impreso con lo que tiene que preparar.

## Objetivos

- Pantalla de solo lectura, a pantalla completa y sin menús, con dos zonas: "En preparación" (a la izquierda, ocupa un tercio) y "¡Listo! Retiralo en el mostrador" (a la derecha, dos tercios, destacada, con los números más grandes). Se lee desde lejos.
- Muestra el NÚMERO DE PEDIDO (no el del llamador). Aparecen las ventas de mostrador y los pedidos web para retirar en el local (takeaway). Los pedidos de delivery NO aparecen.
- Una venta de mostrador entra en "En preparación" apenas se confirma. Un pedido web para retirar entra cuando se aprueba. Pasa a "Listo" cuando el personal lo marca listo con los botones que ya existen en Mostrador/Retiro. Desaparece cuando se marca entregado.
- Actualización en vivo (sin recargar) por la conexión de tiempo real existente; un aviso sonoro corto ("ding") y un resaltado de unos segundos cuando un número pasa a "Listo", con interruptor para silenciar.
- Vuelve a imprimirse el ticket de cocina para todos los pedidos aprobados/confirmados (mostrador, retiro y delivery): número de pedido, tipo (MOSTRADOR / RETIRO / DELIVERY, con llamador si es mostrador), cada producto por unidad con sus cambios y adicionales (etiquetas de cocina en mayúsculas) y la nota del cliente, y la hora.

## No-objetivos y anti-objetivos

- La pantalla NO tiene botones ni acciones: no marca listo ni entregado.
- No muestra datos personales (nombres, direcciones, teléfonos, importes): solo números de pedido y los dos títulos.
- Se elimina por completo la pantalla de cocina actual (tarjetas con botón "LISTO", "Recién listos", deshacer). No se agregan tandas ni otras funciones a esta pantalla.
- No se cambia el ticket del cliente ni el de delivery, ni el agente de impresión instalado en las 9 PCs si se puede evitar (agentes 0.2.0).
- Falla si: un número de delivery aparece en la pantalla, un pedido cancelado/rechazado sigue visible, un pedido entregado no desaparece, o un pedido queda sin ticket de cocina.

## Decidido por el dueño

1. Pantalla estilo McDonald's con dos zonas "En preparación" y "Listo para entregar"; opción B (la zona de listos más grande y destacada).
2. Muestra el número de pedido.
3. Incluye ventas de mostrador y pedidos web para retirar. Un pedido sale de "Listo" cuando se marca entregado.
4. La cocina recibe de nuevo el ticket impreso.

## Mis decisiones (marcadas para que las corrijas)

- **Ticket de cocina en todos los puestos de impresión:** los puestos de Mostrador imprimen cliente + cocina; los de Delivery imprimen cliente + cocina + delivery (pedidos web de delivery). El de cocina se imprime PRIMERO (para que empiecen a preparar enseguida), luego el del cliente, luego el de delivery (manteniendo "cliente antes que delivery" ya pedido).
- **Estados que cuentan:** "En preparación" = `en_preparacion`; "Listo" = `listo_despacho` o `para_retirar` de pedidos de mostrador/retiro. Se excluyen `pendiente_aprobacion`, `cancelado`, `entregado`, `en_camino` y los pedidos de delivery.
- **Orden:** más viejo primero en cada zona. Si hay más números de los que entran, la pantalla los reduce de tamaño y, si aún no caben, hace un desplazamiento automático suave (sin scroll manual).
- **Acceso:** ruta nueva (el constructor elige el nombre, p. ej. `/pantalla`), protegida por login como el resto del personal. Se reutiliza el usuario de rol `cocina` para dejar el televisor iniciado (sesión larga); `cajera`, `encargada_delivery`, `encargado` y `admin` también pueden abrirla. El rol `cocina` pasa a servir solo para esta pantalla.
- **Fin de la ruta vieja:** `/cocina` redirige a la pantalla nueva; se retira su código (tablero, tarjetas, "recién listos", deshacer, acciones de cocina, ajustes de umbrales KDS no se usan más) en la medida en que nada más dependa de ellos, y se actualizan guías y tests.
- **Sonido:** necesita un primer toque en la página para habilitar el audio del navegador (restricción del navegador); se indica en pantalla con un aviso discreto hasta que se habilita.

## Aclaraciones (llamadas mías tras la revisión del constructor)

- **Quién marca "Listo":** la acción `markReadyAction` y el botón "Listo" de la tarjeta de pedidos en preparación (`src/components/despacho/preparing-card.tsx`) ya existen para el personal de cada sector (cajera en Mostrador/Retiro, encargada en Delivery, encargado y admin). No hace falta acción nueva. Se eliminan `kitchenReadyAction` y `kitchenUndoAction` junto con la pantalla vieja; "volver a preparación" sigue disponible donde ya existía en Mostrador/Despacho (devolver a despacho). La lógica de "deshacer listo" de cocina queda sin uso y se retira si nada más depende de ella.
- **Aviso sonoro:** suena solo la PRIMERA vez que un pedido entra en "Listo" (de `en_preparacion` a `listo_despacho`), no cuando pasa de `listo_despacho` a `para_retirar` (llamado). Un pedido que vuelve de "Listo" a `en_preparacion` simplemente regresa a la zona izquierda.
- **Actualización:** además del evento en vivo, la pantalla hace un refresco de seguridad cada 60 segundos y al reconectar, para que un televisor encendido por días nunca quede desactualizado.
- **Edición de pedidos aprobados:** hoy no existe un flujo que modifique los productos de un pedido ya creado, así que el ticket de cocina se genera solo al crear/aprobar y en reimpresiones explícitas.
- **Reimpresión:** "ambos" mantiene su sentido actual (cliente + delivery); el ticket de cocina se agrega como opción explícita y separada ("Cocina") en la reimpresión, para no duplicar la cocina sin querer. La reimpresión por defecto sigue siendo la del cliente.
- **Sesión del televisor:** si el rol `cocina` no tiene hoy una sesión larga, el constructor la agrega (sin vencimiento por inactividad) y verifica que un usuario `cocina` sin estación pueda abrir la pantalla nueva.
- **Ajustes KDS:** los datos y columnas de umbrales KDS permanecen en la base; solo se retira el código y la pantalla de ajustes que los usa. No hay migración que los borre.

## Restricciones

- Next.js 16 con cambios incompatibles: leer `node_modules/next/dist/docs/`; PostgreSQL + Drizzle; Server Actions clasificadas en `src/lib/security/surface.ts`; una sola conexión en vivo por página (`LiveRefresh`); textos en español (es-AR); alto contraste y tipografía muy grande, pensada para un televisor (1920x1080 y 1280x720).
- El ticket de cocina existía antes (tipo `kitchen`); reutilizar su render si sigue disponible. Los trabajos de impresión que ya están en cola no se alteran. Verificar si el agente instalado (0.2.0) ya acepta ese tipo de ticket: si no lo acepta, avisar antes de cambiar el agente.
- Sin capturas de pantalla en la verificación (el dueño revisa a ojo).

## A cargo del constructor

Consulta de la pantalla (pedidos de mostrador/retiro por estado), componente a pantalla completa y su comportamiento (tamaños, desplazamiento automático, ding, resaltado, interruptor), ruta y permisos, redirección de `/cocina`, retiro del código de la cocina anterior, generación de los trabajos de impresión de cocina en la creación/aprobación y en reimpresiones, orden de tickets, textos exactos, migración si hiciera falta (por ejemplo ajustes), tests unitarios, de integración y e2e, y guías (cajera, encargada, administrador, cocina).

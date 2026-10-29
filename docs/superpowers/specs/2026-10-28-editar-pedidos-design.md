# Editar pedidos: cambios y adicionales después de pedir

Fecha: 2026-10-28. Pedido del dueño.

## Intención

Hay clientes que hacen el pedido online y después escriben por WhatsApp a las vendedoras para modificarlo o agregar algo. Hoy lo resuelven haciendo un segundo pedido o anotando a mano en el papel ("1 coca más"). Eso genera dos tickets, dos envíos, y cosas que la cocina no ve. Queremos que el personal pueda modificar el pedido original dentro del sistema, con reglas claras según el estado, para que haya un solo pedido, un solo envío y la cocina vea todo.

## Objetivos

- Antes de cocina (`pendiente_aprobacion`): el personal edita el pedido libremente (agregar, sacar, cambiar productos, notas y modificadores). El total se recalcula.
- Ya en cocina (`en_preparacion`): el personal solo puede AGREGAR productos al mismo pedido. No puede sacar ni cambiar los que ya estaban. El pedido mantiene su número, su envío y su cadete, y no cambia de estado.
- Lo agregado sale en cocina como un ticket aparte, claramente marcado como adicional del pedido original (ej. "ADICIONAL al #23") con solo lo agregado.
- Cobro de la diferencia, según el método del pedido:
  - Efectivo: se cobra al entregar; lo agregado va directo a cocina.
  - Transferencia: la cajera confirma la transferencia de la diferencia y recién ahí lo agregado va a cocina (coherente con cómo funcionan hoy las transferencias).
- Después de "Listo" (`listo_despacho`, `para_retirar`, `en_camino`, `entregado`) y `cancelado`: no se puede agregar nada. Hay que hacer un pedido nuevo.
- Queda registrado quién agregó o cambió qué y cuándo.

## No-objetivos y anti-objetivos

- El cliente NO edita desde la página; sigue pidiendo por WhatsApp y lo hace el personal. (Decisión mía.)
- Una vez en cocina no se saca ni se cambia nada de lo ya pedido. Solo se agrega.
- No se crea un segundo pedido ni un segundo envío: es el mismo pedido.
- No se cobra dos veces el costo de envío.
- Falla si: el total del pedido no coincide con la suma de sus productos; lo agregado nunca llega a cocina o llega sin estar confirmado el pago; el cliente (sin permiso) puede editar; se puede agregar a un pedido ya listo; dos personas editando a la vez dejan el pedido inconsistente; el ticket adicional se confunde con el original.

## Decidido por el dueño

1. Antes de cocina se puede editar; una vez en cocina no se edita lo existente.
2. Para cambios con el pedido ya en cocina, se agrega al pedido original (no un pedido suelto), y tiene que salir junto con el original (mismo pedido, mismo envío).
3. La diferencia en transferencia se paga por transferencia; en efectivo, en efectivo.

## Mis decisiones (marcadas para que las corrijas)

- Solo personal edita: cajera, encargada de delivery, encargado, administrador.
- Lo agregado a un pedido por transferencia espera la confirmación de la diferencia por la cajera antes de ir a cocina; si es efectivo va directo.
- Un pedido ya en cocina nunca retrocede de estado por una edición.
- Los productos de un adicional sin confirmar (transferencia) no cuentan para el stock ni para la cola de demora hasta ser confirmados.

## Aclaraciones (llamadas mías tras la revisión del constructor)

- **Dinero:** `orders.total` siempre es igual a la suma de los productos confirmados + envío. Los productos adicionales sin confirmar (transferencia) viven aparte, con su propio subtotal y estado "pendiente de pago", y no entran en `total` hasta que la cajera confirma. En efectivo entran al total de inmediato y se cobran al entregar. El método de pago del pedido no cambia.
- **Antes de cocina:** en `pendiente_aprobacion` el pago todavía no está confirmado (la aprobación de la cajera lo confirma), así que editar solo cambia el total. El constructor debe verificar este supuesto contra `approve-order.ts`; si ya hubiera pagos confirmados en ese estado, avisar antes de seguir.
- **Envío fijo:** el costo de envío no se recalcula al editar ni al agregar. No hay descuentos ni cupones que reaplicar (verificar).
- **Todos los tipos de pedido:** aplica a delivery, retiro y mostrador. En retiro/mostrador en efectivo la diferencia se cobra en el mostrador. Mientras el pedido esté `en_preparacion` se puede agregar; desde `listo_despacho` en adelante no.
- **Varios adicionales:** puede haber más de uno por pedido, numerados "ADICIONAL 1", "ADICIONAL 2" al #N, cada uno con su propia confirmación. Se enrutan a las estaciones igual que el pedido original. El pedido no puede pasar a "Listo" mientras haya adicionales confirmados sin terminar; los pendientes de pago no cuentan.
- **Adicional pendiente de pago:** la cajera puede cancelarlo (queda registrado, no se borra). Mientras está pendiente, la cocina no lo ve y "Tu pedido" lo muestra como pendiente.
- **Stock:** se descuenta cuando el adicional se confirma (envía a cocina), con las mismas reglas actuales (productos pausados por stock no se pueden agregar; si falta stock al confirmar, se sigue la regla actual de faltantes).
- **Permisos:** los cuatro roles pueden editar, agregar y confirmar la transferencia de un adicional, sobre cualquier pedido.
- **Cliente:** "Tu pedido" muestra los productos agregados y el total actualizado. Los datos para transferir la diferencia los pasa la vendedora por WhatsApp (no hay aviso automático por WhatsApp).

## Restricciones

- Next.js 16 con cambios incompatibles: leer `node_modules/next/dist/docs/` antes de escribir código; PostgreSQL + Drizzle (próxima migración después de la 0012); zod vía `src/lib/zod.ts`; toda Server Action nueva clasificada en `src/lib/security/surface.ts` y regenerar `docs/ops/security-surface.md`; roles en `src/lib/auth/roles.ts`.
- Modelo actual: `orders` (subtotal, deliveryFee, total, paymentMethod, paymentStatus, status), `order_items` con snapshots de nombre/precio, `order_item_modifiers`, `order_events` (auditoría), `print_jobs` (tickets por estación). Sin hard deletes: el historial se conserva.
- Tiempo real: la cajera, cocina, `/pantalla`, delivery y "Tu pedido" deben reflejar los cambios por los canales existentes.
- Textos en español (es-AR); celular primero (objetivos ≥ 44 px).
- Sin capturas de pantalla en la verificación (el dueño revisa a ojo).

## A cargo del constructor

Modelo de datos (cómo marcar un ítem como adicional y su tanda de confirmación, estado "adicional pendiente de pago"), reglas de recálculo de total y de la diferencia a cobrar, permisos, cómo se ve y se opera en Caja/Mostrador y Delivery, formato del ticket adicional y su impresión (cocina y bebidas según corresponda), impacto en stock (descuento al confirmarse lo agregado), en la demora automática y en "Tu pedido", concurrencia (edición simultánea y carrera con el paso a cocina), tests (unitarios, integración, e2e en celular y escritorio) y guías (cajera, encargada, administrador).

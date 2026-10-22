# Tandas de delivery

Fecha: 2026-10-21. Pedido del dueño, a incluir antes de seguir con el stock.

## Intención

Hoy, cuando entran varios pedidos de delivery, la encargada de delivery los divide en "tandas" mirando las direcciones, y anota el número de tanda a mano con lapicera en el ticket. Esa tanda se respeta desde la cocina hasta que el pedido sale con el cadete. Una tanda es lo que lleva UN cadete en UN viaje (1 a 3 pedidos; más se enfría). Ejemplo: 4 pedidos al mismo barrio pueden ser 2 tandas con 2 cadetes (uno va más lejos, otro más cerca); la zona no define la tanda, la define la persona. El sistema debe reflejar la tanda para que la cocina arme los pedidos juntos y el despacho asigne el cadete de una vez.

## Objetivos

- Poder poner (y cambiar) un número de tanda a cada pedido de delivery ya aprobado, a mano, libremente.
- La cocina ve en cada tarjeta de delivery "TANDA n" en grande en cuanto se carga, en vivo.
- En Despacho, elegir una tanda, elegir al cadete y asignar de una vez todos los pedidos de esa tanda que están listos.
- Aviso (no bloqueo) cuando una tanda supera 3 pedidos, y un resumen de cuántos pedidos tiene cada tanda.

## No-objetivos y anti-objetivos

- La tanda NO se calcula ni se sugiere por dirección o zona: la decisión es siempre manual.
- No hay numeración automática ni reinicio automático: el número es libre.
- El ticket de delivery NO imprime la tanda (ella la sigue anotando a mano). No se cambian los tickets ni el agente de impresión.
- Los pedidos de mostrador y de retiro no tienen tanda.
- No se bloquea nada por superar 3 pedidos: solo aviso.
- Falla si: se pierde la tanda al cambiar de estado, la cocina muestra una tanda vieja tras un cambio, o asignar una tanda a un cadete toca pedidos que no están listos o que son de otra tanda.

## Decidido por el dueño

1. La tanda es un número libre que escribe a mano la encargada de delivery; se carga después de aprobar el pedido.
2. Máximo 3 pedidos por tanda: solo aviso.
3. Mostrar en Gestión Delivery solo el número de pedido y la dirección real (nada de etiquetas de zona como "Merlo" o "Barrio"), más el campo "Tanda"; sin número, "Sin tanda".
4. Cocina: "TANDA n" grande en cada tarjeta de delivery.
5. Despacho: asignar una tanda completa a un cadete de una vez (los pedidos listos); se mantiene poder asignar pedido por pedido.
6. El ticket no imprime la tanda.

## Mis decisiones (marcadas para que las corrijas)

- Se puede cambiar o borrar la tanda de un pedido mientras no esté en camino (`en_camino`) ni entregado ni cancelado; cada cambio queda en el registro de eventos del pedido con quién lo hizo.
- Al asignar una tanda a un cadete solo se toman los pedidos de esa tanda en estado listo para despacho; los demás quedan en la tanda y se asignan cuando estén listos. La asignación respeta el límite y las reglas actuales de asignación múltiple de cadetes (y el aviso de más de 3).
- El valor es un entero positivo (1 a 99); el número no es único por cadete ni por día: la misma tanda "1" puede reutilizarse más tarde, así que el resumen y la asignación consideran solo pedidos activos (no entregados ni cancelados) de delivery.
- Pueden cambiar la tanda: encargada de delivery, encargado y administrador (los roles que hoy gestionan Delivery y despachan); la cocina y la cajera solo la ven.
- La cocina la ve por la misma conexión en vivo que ya usa; una tanda cambiada actualiza la tarjeta sin recargar.

## Aclaraciones (llamadas mías tras la revisión del constructor)

- **Estados donde se puede poner/cambiar la tanda:** solo `en_preparacion` y `listo_despacho` (después de aprobar y antes de salir). No en pendiente de aprobación, ni `en_camino`, entregado, cancelado ni rechazado.
- **Asignar una tanda a un cadete:** la acción recibe los IDs explícitos de los pedidos más el número de tanda y el servidor verifica que cada pedido sigue siendo de esa tanda y está `listo_despacho` (todo o nada, como la asignación actual). Si la tanda tiene pedidos que todavía no están listos (por ejemplo 2 de 3), la pantalla muestra "2 de 3 listos" y pide una confirmación explícita ("Asignar igual los 2 listos") antes de despachar; nunca se despacha un viaje incompleto sin confirmar. Si un pedido cambió de estado o de tanda entre la selección y el envío, la acción falla con un mensaje claro y no asigna nada.
- **Pantalla de Despacho:** los pedidos de delivery listos se agrupan por tanda con un encabezado por grupo ("Tanda 1 · 2 de 3 listos"), "Sin tanda" es su propio grupo, cada grupo con un botón "Asignar tanda a cadete"; la selección pedido por pedido sigue disponible. El aviso de más de 3 se muestra también aquí (solo aviso).
- **Resumen y aviso de más de 3:** cuentan solo los pedidos activos de delivery que todavía no salieron (`en_preparacion` y `listo_despacho`); los `en_camino` no cuentan, así que reutilizar el mismo número más tarde no genera falsos avisos.
- **Entrega fallida:** si un pedido vuelve de `en_camino` a `listo_despacho` conserva su tanda (puede cambiarla); se vuelve a contar en su tanda mientras esté listo.
- **Dónde se ve la tanda:** Gestión Delivery (editable), cocina (solo lectura, "TANDA n") y Despacho. No se agrega a la vista del cadete, a Caja, a tickets ni a reportes.
- **Tiempo real:** un cambio de tanda notifica por la conexión en vivo de pedidos con un tipo de evento nuevo de actualización (el constructor elige el nombre), y la consulta de cocina devuelve la tanda.

## Restricciones

- Next.js 16 con cambios incompatibles: leer `node_modules/next/dist/docs/`; PostgreSQL + Drizzle (la próxima migración después de las del stock); zod vía `src/lib/zod.ts`; toda Server Action nueva se clasifica en `src/lib/security/surface.ts`; la regla de sector (los pedidos de delivery pertenecen al sector delivery) y el modelo de eventos de pedido se respetan; una fila por unidad en `order_items` no se toca.
- Textos en español (es-AR); celular primero (objetivos ≥ 44 px) en Gestión Delivery; la cocina sigue siendo pantalla completa sin menú.
- Una sola conexión en vivo por página.

## A cargo del constructor

Dónde se guarda el número (columna del pedido), la acción para cambiarlo con su evento de auditoría, el campo y el resumen en Gestión Delivery, la etiqueta en la tarjeta de cocina, la acción de asignar una tanda a un cadete reutilizando la asignación múltiple, textos exactos del aviso, y los tests (unitarios, de integración y e2e en celular y escritorio).

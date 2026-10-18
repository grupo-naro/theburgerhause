# Pantalla de cocina (KDS) dentro del MVP

Fecha: 2026-10-18. Decisión del dueño: adelantar a la fase MVP la pantalla de cocina que estaba en Fase 2. Stock y materia prima siguen en Fase 2.

## Intención

Hoy la cocina trabaja con un ticket de papel: lo lee, prepara el pedido completo, lo empaca (bolsa, sello de la marca) y lo deja listo. Desde la tarea 10.2 ya no se imprime comanda de cocina, así que la cocina no tiene de dónde leer. La pantalla reemplaza ese ticket y además deja que la cocina marque "listo" sin pasar por la caja.

## Objetivos

- Una pantalla de cocina que muestre cada pedido en preparación: número, tipo (DELIVERY / MOSTRADOR / RETIRO), tiempo desde que entró, cada producto con sus cambios y adicionales, notas del cliente y número de llamador si es venta de mostrador.
- Que el cocinero o ayudante marque "LISTO" con un toque, y que eso haga lo mismo que el botón "Listo" de hoy en Mostrador / Gestión Delivery.
- Que se vean todos los pedidos juntos, siempre con la etiqueta de tipo bien visible.
- Los botones "Listo" actuales de Mostrador, Retiro y Gestión Delivery siguen funcionando (por si alguien de cocina se olvida).

## No-objetivos y anti-objetivos

- No incluye stock, materia prima ni rendición de consumo (Fase 2).
- No cambia la impresión de tickets de cliente / delivery.
- No debe permitir marcar listo un pedido por error con facilidad: un toque accidental en medio de un turno movido no puede cerrar un pedido que no está.

## Lo decidido por el dueño

- Diseño A: tarjetas con botón "LISTO" grande, ordenadas por antigüedad (la más vieja primero), tipo etiquetado, reloj por colores (verde / amarillo / rojo).
- Todos los tipos mezclados, con etiqueta de tipo.
- Los botones "Listo" existentes se mantienen.

## Mis decisiones (marcadas para que las corrijas)

1. **Ruta y acceso:** `/cocina`. Acceden `cajera`, `encargada_delivery` y `admin` con su usuario, y un rol nuevo `cocina` que solo ve esta pantalla (para dejar una PC o tablet de cocina con un usuario propio, sin acceso a cobros). Una estación no es necesaria porque la cocina no imprime.
2. **Regla de sector:** la cocina puede marcar listo pedidos de cualquier sector (es quien los prepara); el rol `cocina` es la única excepción a la regla de sector, y solo para "listo". Cualquier otra acción sigue protegida.
3. **Qué hace "LISTO":** reutiliza la transición existente de `en_preparacion` a `listo_despacho` (delivery) o la equivalente para mostrador/retiro que ya usan los botones actuales. No se inventa un estado nuevo.
4. **Tiempo y colores:** verde hasta 8 min, amarillo de 8 a 15, rojo desde 15 (valores por defecto editables en Ajustes del admin).
5. **Aviso sonoro** al entrar un pedido nuevo (con interruptor de sonido), usando el mismo mecanismo en vivo que las otras pantallas (una sola conexión de eventos por página).
6. **Deshacer:** tras marcar LISTO queda un aviso "Deshacer" unos segundos, y una franja de "Recién listos" abajo con "Volver a preparación" mientras el pedido no haya sido tomado (asignado a un cadete, entregado o llamado). Se necesita permitir esa transición hacia atrás con auditoría.
7. **Pedidos con varias unidades:** una tarjeta por pedido (no por unidad), con cada unidad numerada y sus cambios por separado. Marcar LISTO cierra el pedido entero.
8. **Pedidos cancelados** después de aprobados (según la cancelación que se agrega en la ronda de arreglos) desaparecen de la pantalla en vivo.
9. **Dispositivo:** pensada para pantalla táctil y también usable con mouse: botones de al menos 56 px, fuente grande, modo oscuro de alto contraste, pantalla completa sin menú de navegación.

## Pendiente del constructor

Detalles de maquetación, textos exactos, y la forma de agrupar adicionales dentro de cada producto (reutilizando las etiquetas de cocina `kitchen_label` que ya se guardan en cada unidad).

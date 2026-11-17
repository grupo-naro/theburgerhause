# Costo de productos y extras, y ganancia en Analíticas

Fecha: 2026-11-17. Pedido del dueño.

## Intención

Hoy cada producto tiene solo su precio de venta. El dueño quiere cargar también el **precio de costo**, así Analíticas le muestra **cuánto ganó**, no solo cuánto facturó. El sistema arranca de cero en producción: todos los productos y extras se van a cargar con su costo. Los datos actuales son ficticios.

## Objetivos

- En el formulario de **producto** (crear y editar) hay un campo **"Precio de costo"** junto al precio de venta.
- En el formulario de **extra/modificador** hay un campo **"Costo"** junto al precio del extra. Un "Sin …" (quitar un ingrediente) no tiene ni precio ni costo.
- Cada venta **guarda el costo de ese momento** (igual que hoy guarda el precio): cambiar un costo después no cambia la ganancia de ventas pasadas.
- En **Analíticas**, detrás del PIN como todo lo demás:
  - Una tarjeta **"Ganancia"** con el monto, el **margen** (ganancia / facturación de productos) y la variación contra el período anterior.
  - En **Top productos**, cada fila muestra además **cuánto ganó** ese producto: "182 u · $ 1.274.000 · gana $ 510.000".
  - Si en el período hubo unidades vendidas **sin costo cargado**, se muestra un aviso: "N unidades sin costo cargado: la ganancia está incompleta".

## No-objetivos y anti-objetivos

- No hay recetas ni costo por ingrediente: el costo es un número que se carga a mano por producto y por extra.
- No se cuenta el envío: el costo de envío lo cobra el cadete y no entra en la ganancia.
- No se agrega ganancia a la tabla de vendedoras ni al mapa de calor.
- Falla si:
  - el costo aparece en algún lugar público (menú de la tienda, carrito, checkout, seguimiento del pedido, tickets) o en cualquier pantalla del personal que no sea admin;
  - el **encargado** ve el costo, o, al guardar un producto o extra (él no ve el campo), **borra o cambia el costo** que había cargado el admin;
  - cambiar un costo cambia la ganancia de ventas que ya ocurrieron;
  - estando bloqueado, Analíticas manda al navegador algún número de ganancia o margen.

## Decidido por el dueño

1. Precio de costo en productos **y en extras** (opción B).
2. El costo **lo ve y lo carga solo el admin**. El encargado sigue editando productos y extras, pero sin ver ese campo.
3. Ganancia en Analíticas: tarjeta de ganancia con margen y comparación, ganancia por producto en el top, aviso de unidades sin costo.
4. **El costo se guarda en cada venta** (no se calcula con el costo actual).
5. Los datos de prueba (ficticios) llevan un costo relativo al precio.

## Enfoques considerados

- **Guardar el costo en cada venta (elegido).** Cada artículo vendido guarda el costo del producto y cada extra el suyo, igual que hoy se guarda el precio. La ganancia de un mes no cambia si después se actualiza un costo, y las ventas de un producto borrado conservan su costo.
- **Calcular con el costo actual del producto (descartado).** Es más simple, pero al cambiar un costo se reescribe la ganancia de todos los meses anteriores, y las ventas de un producto borrado quedan sin costo. Así no se pueden comparar períodos, que es para lo que sirve Analíticas.

## Mis decisiones (marcadas para que las corrijas)

### Datos

- **El costo es opcional (puede quedar vacío).** No lo hago obligatorio porque el encargado puede crear productos sin ver el campo. Un producto sin costo se vende igual; sus ventas simplemente entran en el aviso de "sin costo".
- **Costo cero es un valor válido,** distinto de "sin costo": por ejemplo, un extra que no le cuesta nada al local.
- **Mismas validaciones que el precio:** entero en pesos, no negativo y con el mismo máximo. Se guarda en centavos, como el precio.
- **Costo mayor que el precio:** se permite y se muestra un aviso en el formulario ("El costo es mayor que el precio de venta"), sin bloquear.
- **Qué se guarda en cada venta:** el costo del producto en cada unidad vendida y el costo de cada extra, tomados en el momento en que se arma el pedido. En un adicional, cuando se arma el adicional; si se confirma después, guarda lo que tenía en ese momento. Un adicional que quedó pendiente de antes del cambio (JSON sin costo) queda sin costo. En la edición de un pedido pendiente, las unidades agregadas toman el costo del momento de la edición.
- **Datos de prueba (seed):** el costo de productos y extras con precio es el **40% del precio de venta**, redondeado al peso. Los "Sin …" no tienen costo.

### Cómo se calcula la ganancia

- **Ganancia de una unidad** = precio de la unidad + precios de sus extras − (costo de la unidad + costos de sus extras). Se usan los valores guardados en la venta.
- **Una unidad cuenta en la ganancia solo si tiene costo,** y lo mismo cada uno de sus extras con precio. Si le falta cualquiera de los dos, la unidad entera va al aviso de "sin costo" y no suma ganancia. Así la ganancia nunca se infla por un extra sin costo.
- **Se cuentan los mismos pedidos que en la facturación:** los válidos, no los cancelados ni los que esperan aprobación, y con el mismo corte por día de negocio y la misma comparación hasta la misma hora.
- **Margen** = ganancia / facturación de las unidades con costo. Si esa facturación es cero, se muestra "—".
- **Top productos:** sigue ordenado por unidades. La ganancia es una columna más.
  - Un producto con todas sus unidades con costo muestra "gana $X".
  - Si **solo algunas** de sus unidades tienen costo, muestra la ganancia de esas unidades y aclara "gana $X · N sin costo" (el mismo criterio parcial que la tarjeta Ganancia).
  - Si **ninguna** tiene costo, muestra "sin costo".
- **Extras gratis con costo cargado** (precio 0, por ejemplo una salsa que no se cobra): ese costo **se descuenta** de la ganancia. Un extra gratis **sin** costo no deja la unidad "sin costo"; solo los extras que se cobran tienen que tener costo.

### Quién ve qué

- **En el admin:** el campo de costo solo se muestra al rol `admin`. El servidor no lo manda a la página cuando quien entra es el encargado. Las acciones de guardar producto y extra **ignoran el costo** si quien guarda no es admin, y nunca lo pisan.
- **Consultas del admin que devuelven filas completas:** las de grupos y extras (`listGroupsWithModifiers`, `getModifierForAdmin`) y la de productos no deben dar el costo al encargado. Se excluye la columna o se borra antes de mandar la página.
- **En el resto del sistema:** el costo no viaja al menú público, la caja, el despacho, la pantalla de la TV ni los tickets. Ninguna consulta de esas pantallas lo selecciona.
- **Analíticas bloqueada:** en la tarjeta Ganancia, la columna de ganancia del top y el aviso de "sin costo" se ven `****`, sin enviar ningún número, igual que el resto.

## Restricciones

- **Next.js 16** trae cambios incompatibles: hay que leer `node_modules/next/dist/docs/` antes de tocar código.
- **Base de datos:** PostgreSQL con Drizzle. La próxima migración es la `0018`. Las columnas nuevas admiten vacío (`NULL`), así que las filas existentes quedan "sin costo".
- **Un solo lugar** registra los artículos de cada venta (`insertOrderItems` en `src/lib/orders/order-rows.ts`). Las unidades se resuelven en `resolve-units.ts`, y los adicionales pendientes guardan esas unidades como JSON.
- **Seguridad:** toda acción tocada se registra en `src/lib/security/surface.ts`.
- **Textos** en español (es-AR).

## A cargo del constructor

- Los nombres de las columnas, siguiendo el estilo `*_snapshot` existente.
- Cómo pasar el rol a los formularios de producto y extra para mostrar u ocultar el campo.
- El diseño fino de la tarjeta Ganancia y del aviso, dentro del estilo de Analíticas.

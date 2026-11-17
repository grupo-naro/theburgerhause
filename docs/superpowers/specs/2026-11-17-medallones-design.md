# Medallones de carne en Analíticas

Fecha: 2026-11-17. Pedido del cliente, aprobado por el dueño. Diseño corto.

## Intención

El cliente quiere saber **cuántos medallones de carne se usaron**. Contar hamburguesas no alcanza, porque una simple lleva 1, una doble 2 y una triple 3. Hay productos que no son hamburguesas (por ejemplo una milanesa napolitana con papas, papas solas o bebidas) y no llevan medallones.

## Objetivos

- **Campo nuevo en el producto: "Medallones de carne",** de 0 a 3 y por defecto 0. Lo pueden cargar el admin y el encargado.
- **Cada venta guarda los medallones del producto en ese momento.** Si después se cambia el número de un producto, las ventas pasadas no se alteran.
- **Bloque "Medallones" en Analíticas,** detrás del PIN como todo:
  - el total de medallones del período;
  - la variación contra el período anterior;
  - el desglose de unidades vendidas por cantidad de medallones (1, 2 y 3).

## No-objetivos

- **Los extras no suman medallones:** el cliente no puede pedir un medallón extra.
- **No se compara con la carne de la rendición diaria** de materia prima por ahora; puede venir después.
- **No se descuenta stock automáticamente.**

## Decidido por el dueño

1. **Número por producto, sin importar la categoría.** Lo que no es hamburguesa va en 0.
2. **No hay extras de medallón.**
3. **Se guarda en cada venta,** igual que el costo. Calcularlo con el número actual reescribiría los meses anteriores.
4. **El bloque y su desglose son los aprobados:** "1.284 medallones ▲ 7% · Simple: 412 u · Doble: 301 u · Triple: 90 u".

## Enfoques considerados

- **Guardar los medallones en cada venta (elegido):** cambiar un producto no altera el historial. Es el mismo patrón que el precio y el costo.
- **Calcular con el número actual del producto (descartado):** cambiaría los meses anteriores, y las ventas de un producto borrado quedarían sin dato.

## Mis decisiones

- **Columnas nuevas:**
  - `products.patties`: `smallint NOT NULL DEFAULT 0`, con un control de que esté entre 0 y 3.
  - `order_items.patties_snapshot`: `smallint NOT NULL DEFAULT 0`. Las ventas anteriores quedan en 0. Como se arranca de cero, no afecta.
- **Dónde se guarda en cada venta:** el número viaja por el mismo camino que el costo: catálogo → unidad resuelta → `insertOrderItems`. Un adicional guarda los medallones del momento en que se arma. Un adicional pendiente de antes de este cambio cuenta 0.
- **Qué pedidos cuentan:** los mismos que en la facturación (no cancelados ni pendientes de aprobación), con el mismo corte por día de negocio y la misma comparación hasta la misma hora.
- **Etiquetas del desglose:** "Simple" (1 medallón), "Doble" (2) y "Triple" (3). Los productos con 0 no aparecen.
- **Bloqueado:** el bloque muestra `****` y no manda números al navegador.
- **Lugar en la pantalla:** debajo de los números principales, en el ancho completo, antes del top de productos.
- **Formulario:** un selector de 0 a 3, visible para el admin y el encargado.
- **Datos de prueba:** las hamburguesas simples con 1 medallón, las dobles con 2 y el resto con 0. Al volver a cargarlos solo se completan los que están en 0.

## Restricciones

- Se usa la rama `feature/medallones`, armada sobre `feature/costo-ganancia` porque las dos tocan los mismos archivos.
- La migración es la siguiente a la `0018_costs`.
- El resto de las reglas del proyecto (Next.js 16, Drizzle, registro de seguridad sin cambios de acciones, textos en es-AR) se mantienen.

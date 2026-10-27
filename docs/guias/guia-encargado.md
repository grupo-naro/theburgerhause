# Guía de una página: Encargado

El **encargado** lleva el stock del local. Entra con su usuario y ve las pantallas de trabajo (Venta, Mostrador, Retiro en local, Gestión Delivery, Pantalla), el menú, los modificadores, los cadetes y la sección **Stock** de Administración. **No** ve Usuarios, Estaciones ni Ajustes (son del administrador). Se usa bien desde el **celular**.

El stock reemplaza el papel donde anotabas lo gastado ("19/10: 50 kg de queso cheddar") y la foto al dueño.

## Primer día: cargar el stock inicial

1. **Administración → Stock → Artículos → Nuevo artículo**: **Nombre**, **Tipo** (**Bebida** o **Materia prima**), **Unidad** (kg, u...) y, si querés, el **Mínimo (aviso de Poco)**.
2. Después de crear el artículo, cargá la **Cantidad inicial** y tocá **Guardar stock inicial**. Queda en el historial como ajuste inicial.
3. A cada **bebida** ligala a su producto del menú: **Menú → editar el producto → Artículo de stock**.

Si un producto no tiene artículo ligado, no pasa nada: se vende como siempre, sin control de stock.

## Consumo del día (materia prima)

**Stock → Consumo del día**: escribí al lado de cada artículo lo que se gastó (podés usar coma: 12,5 kg) y tocá **Guardar consumo**. Los casilleros vacíos se ignoran. Podés cargar varias veces en el día; un doble toque no duplica. Si la carga deja el stock en negativo, el sistema avisa y pide confirmar con **Guardar igual**.

## Reponer (cuando llega mercadería)

**Stock → Reponer stock**: elegí el **Artículo**, la **Cantidad**, una nota si querés (por ejemplo "Compra proveedor") y **Cargar ingreso**. Te muestra el saldo nuevo.

## Corregir una carga equivocada

**Stock → Historial** (podés filtrar por artículo): en la carga tocá **Editar**, escribí la **Nueva cantidad** y **Guardar cambio**. La edición **queda registrada** (quién, cuándo y el valor anterior). Nada se borra.

## La alerta "Productos faltantes de stock"

Todo el personal ve arriba una franja **Productos faltantes de stock (N)** cuando algo está en cero o por debajo del mínimo. Tocala y ves el detalle: artículo, cuánto queda y desde cuándo falta. Si no falta nada, la franja no aparece. El televisor del mostrador **no** la muestra.

## Cómo se pausa y vuelve una bebida

- Cada venta (web o mostrador) **descuenta sola** la bebida. La materia prima **no**: esa la cargás vos en el consumo del día.
- Cuando una bebida llega a **cero**, se **pausa sola** en la tienda y en la Venta ("sin stock"). No se puede vender más de lo que hay.
- Cuando **repones**, vuelve a estar disponible sola.
- Si el pedido se **cancela o rechaza**, la bebida vuelve al stock (una sola vez).
- Una bebida desactivada **a mano** en el Menú no se reactiva sola al reponer. Y una pausada por stock cero no se puede activar a mano hasta reponer ("Sin stock: reponé primero").
- La materia prima en cero avisa en la franja, pero **nunca** pausa productos.

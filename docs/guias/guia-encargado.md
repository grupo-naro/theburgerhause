# Guía de una página: Encargado

El **encargado** lleva el stock del local. Entra con su usuario y ve las pantallas de trabajo (Venta, Mostrador, Retiro en local, Gestión Delivery, Pantalla), el menú, los modificadores, los cadetes y la sección **Stock** de Administración. **No** ve Usuarios, Estaciones ni Ajustes (son del administrador). Se usa bien desde el **celular**.

El stock reemplaza el papel donde anotabas lo gastado ("19/10: 50 kg de queso cheddar") y la foto al dueño.

## Primer día: cargar el stock inicial

1. **Administración → Stock → Artículos → Nuevo artículo**: **Nombre**, **Tipo** (**Bebida** o **Materia prima**), **Unidad** (kg, u...) y, si querés, el **Mínimo (aviso de Poco)**.
2. Después de crear el artículo, cargá la **Cantidad inicial** y tocá **Guardar stock inicial**. Queda en el historial como ajuste inicial.
3. A cada **bebida** ligala a su producto del menú: **Menú → editar el producto → Artículo de stock**.

Si un producto no tiene artículo ligado, no pasa nada: se vende como siempre, sin control de stock.

## Rendición de materia prima (cierre del día)

Reemplaza al viejo "Consumo del día": **una sola carga por día**, al cerrar, con todo lo que se usó.

1. **Stock → Rendición de materia prima**. Aparecen todos los artículos de **materia prima** activos, cada uno con su unidad (las bebidas no: se descuentan solas con las ventas).
2. **Fecha a rendir**: viene con la fecha de **hoy**. Si la cargás **a la mañana siguiente**, cambiala por la de **ayer** (sirve cualquier día anterior que no esté cerrado; nunca un día futuro). Debajo ves los últimos días **ya cerrados**; si elegís uno, aparece **Ya cerrada** y no se puede cerrar de nuevo.
3. Escribí al lado de cada artículo lo que se usó (podés usar coma: 12,5 kg). Lo que no se usó, dejalo **vacío**. Tiene que haber al menos una cantidad.
4. Tocá **Cerrar el día**: aparece el **resumen** (la fecha y solo los artículos con cantidad). Si está bien, **Confirmar cierre**; si no, **Volver a editar**. Un doble toque no duplica.
5. Si la rendición deja algún artículo en negativo, el sistema avisa cuál y pide confirmar con **Guardar igual**.

Cada día se cierra **una sola vez**, aunque lo intenten desde dos celulares. Lo cargado queda en el **Historial en el día rendido** (el consumo del viernes cargado el sábado figura en el viernes), con la hora real en que se cargó.

Más abajo, en **Rendiciones cerradas**, ves los dos últimos días cerrados: la fecha, quién la cerró y a qué hora, y la tabla artículo / cantidad / unidad. Para ver otro día (por ejemplo "el viernes pasado"), elegilo en **Ver un día** y tocá **Ver**; si ese día no se cerró, dice **No hay rendición cerrada ese día**.

**Corregir una rendición ya cerrada**: en la rendición tocá **Corregir en el Historial** (abre el Historial de ese día), **Editar** la carga, **Nueva cantidad**, **Guardar cambio**. La rendición muestra siempre la cantidad corregida y la corrección queda registrada (quién, cuándo y el valor anterior). Un día cerrado no se reabre ni se borra.

**El aviso**: mientras la rendición de **hoy** no esté cerrada, arriba de las pantallas de Administración aparece "La última rendición de materia prima cerrada es del jueves 30. Todavía no se cerró la de hoy." con el enlace **Cargar la rendición** (si nunca se cerró ninguna: "Todavía no se cerró ninguna rendición de materia prima."). Desaparece al cerrar el día de hoy. Solo lo ven el encargado y el administrador, en Administración.

## Reponer (cuando llega mercadería)

**Stock → Reponer stock**: elegí el **Artículo**, la **Cantidad**, una nota si querés (por ejemplo "Compra proveedor") y **Cargar ingreso**. Te muestra el saldo nuevo.

## Corregir una carga equivocada

**Stock → Historial** (va ordenado por día; podés filtrar por artículo o elegir un día en **Ver un día**): en la carga tocá **Editar**, escribí la **Nueva cantidad** y **Guardar cambio**. La edición **queda registrada** (quién, cuándo y el valor anterior). Nada se borra.

## La alerta "Productos faltantes de stock"

Todo el personal ve arriba una franja **Productos faltantes de stock (N)** cuando algo está en cero o por debajo del mínimo. Tocala y ves el detalle: artículo, cuánto queda y desde cuándo falta. Si no falta nada, la franja no aparece. El televisor del mostrador **no** la muestra.

## Cómo se pausa y vuelve una bebida

- Cada venta (web o mostrador) **descuenta sola** la bebida. La materia prima **no**: esa la cargás vos en la rendición de materia prima.
- Cuando una bebida llega a **cero**, se **pausa sola** en la tienda y en la Venta ("sin stock"). No se puede vender más de lo que hay.
- Cuando **repones**, vuelve a estar disponible sola.
- Si el pedido se **cancela o rechaza**, la bebida vuelve al stock (una sola vez).
- Una bebida desactivada **a mano** en el Menú no se reactiva sola al reponer. Y una pausada por stock cero no se puede activar a mano hasta reponer ("Sin stock: reponé primero").
- La materia prima en cero avisa en la franja, pero **nunca** pausa productos.

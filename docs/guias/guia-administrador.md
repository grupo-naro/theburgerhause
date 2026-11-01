# Guía de una página: Administrador

El administrador entra con su usuario y cae en **Administración**. En el menú lateral de las pantallas de staff también ve **todas**
las pantallas de trabajo: **Venta**, **Mostrador**, **Retiro en local**, **Gestión Delivery**, **Rendición**, y dos vistas
generales: **Vista general** (`/caja`) y **Tablero general** (`/despacho`). El administrador **no** está limitado por sector.

## Menú de Administración

**Menú · Modificadores · Cadetes · Stock · Usuarios · Estaciones · Ajustes**. (El **encargado** ve Menú, Modificadores, Cadetes y Stock; no ve Usuarios, Estaciones ni Ajustes.)

### Ajustes (`/admin/ajustes`)

![Ajustes](img/admin-ajustes.png)

- **Pedidos online**: **Pausar pedidos** / **Reanudar pedidos**. Pausado, la tienda muestra el cartel "Por el momento no estamos tomando
  pedidos" con los **Horarios**, y no se pueden crear pedidos web nuevos. Úsalo para cerrar el local o frenar una avalancha.
  (La casilla **Recibiendo pedidos online** abajo hace lo mismo; recordá **Guardar ajustes** si la cambiás ahí.)
- **Datos del local**: nombre, dirección, teléfono, WhatsApp (con código de país, ej. 5491155551234), **Horarios** (texto libre).
- **Pago por transferencia**: **Alias** y **CBU / CVU** (22 dígitos). Es lo que ve el cliente al elegir transferencia.
- **Envío y pedidos**: **Costo de envío ($)**, en pesos enteros (0 = sin cargo). **Cierre del día de trabajo**: la hora (Buenos Aires, por defecto **06:00**) en la que
  el número de pedido vuelve a 1. Una venta de las 23:50 y otra de las 00:05 son del mismo día de trabajo; el número reinicia recién a la hora de cierre.
  Cambiarlo no renumera pedidos ya hechos.

- Terminá con **Guardar ajustes**.

### Estaciones (`/admin/estaciones`)

![Estaciones](img/admin-estaciones.png)

- Una estación por PC: **Mostrador 1 a 4** y **Delivery 1 a 5**. **Nueva estación**: **Nombre**, **Tipo** (Mostrador / Delivery), **Crear estación**.
  El tipo decide qué pedidos ve y dónde se imprime: no lo cambies a la ligera. Las estaciones no se eliminan; se pueden **Renombrar**.
- **Generar token** (o **Rotar token**): el token se muestra **una sola vez** ("Guardalo ahora"). Copialo y cargalo en el instalador de la PC
  (`docs/ops/print-agent-install.md`). Rotar corta al instante el agente anterior. **No lo mandes por chat.**
- Cada estación muestra si el agente está conectado o **Nunca conectada**.

### Usuarios (`/admin/usuarios`)

![Usuarios](img/admin-usuarios.png)

Una cuenta por persona: **Nombre**, **Usuario** (3 a 40 caracteres, minúsculas), **Rol** (cajera / encargada de delivery / **cocina** / **encargado** / administrador) y
**Contraseña** (mínimo 8). Desde la lista: **Desactivar** una cuenta (quien se va), **Cerrar sesiones de <usuario>**; al editar, **Nueva contraseña**
(cierra sus sesiones). Siempre tiene que quedar al menos un administrador activo. La cajera solo puede elegir estaciones de Mostrador y la
encargada solo de Delivery. El rol **Cocina** es el login del **televisor del mostrador**: no usa estación, entra directo a `/pantalla` (los números de pedido en preparación y listos), con sesión de 400 días, y no ve cobros ni ninguna otra pantalla (si abre otra URL, vuelve al televisor). Cómo dejarlo en modo kiosco: [Guía de cocina y del televisor](guia-cocina.md).

#### Crear usuario Encargado

1. **Usuarios → Nuevo usuario**: **Nombre**, **Usuario**, **Contraseña** (mínimo 8).
2. **Rol**: **Encargado**. No lleva estación: opera en cualquier sector, como vos, pero sin Usuarios, Estaciones ni Ajustes.
3. **Crear usuario**. Pasale la guía [guia-encargado.md](guia-encargado.md): el primer día él carga el stock inicial.

### Stock (`/admin/stock`)

Vos y el encargado cargan consumo, ingresos y artículos (**Resumen · Consumo del día · Reponer stock · Artículos · Historial**). Las bebidas se descuentan solas y se pausan en cero; ver [guia-encargado.md](guia-encargado.md). Todo el personal ve la franja **Productos faltantes de stock**.

### Cadetes (`/admin/cadetes`)

**Nuevo cadete**: **Nombre**, **Teléfono** (opcional), **Cadete activo (se puede asignar a pedidos)**. No tienen acceso al sistema: la encargada registra por ellos.

### Menú y Modificadores

Ver `docs/guias/carga-del-menu.md` (paso a paso, con capturas).

**Sugerir antes de confirmar**: en el formulario del producto, tildá esta opción para que aparezca como sugerencia cuando el cliente toca **Continuar con el pedido** en el carrito (ideal para bebidas, papas o merchandising que la gente no suele ver). Se muestran hasta 6, en el orden de la carta, sin los que el cliente ya tiene en el pedido; solo una vez por visita y sin interrumpir si no hay ninguno. Un producto pausado o agotado nunca se sugiere.

## Avisar una demora

Si la cocina se atrasa o pasa algo (se pinchó el delivery, falta un ingrediente), podés avisar una demora desde el botón **Demora** de la
barra de arriba (dice **Sin demora** o **+10 min**). Hay dos clases:

- **Automática**: el sistema calcula solo la espera según los pedidos en preparación. No hacés nada; la ves en el panel como "Estimación automática".
- **Manual**: la activás vos y se **suma** a la automática. Los clientes ven una espera más larga.

**Activar**: tocá **Demora**, elegí los minutos extra (**+5** a **+60**), escribí el **motivo** y apretá **Activar demora**. Si ya había una,
la nueva la reemplaza.
**Desactivar**: tocá **Demora** y **Desactivar demora**. Queda registrado quién la activó y quién la sacó.

El **motivo es interno**: lo ve solo el personal, nunca el cliente.

## Modificar un pedido

Cuando un cliente pide un cambio por WhatsApp, el personal modifica **el mismo pedido** (un solo número, un solo envío). Vos podés hacerlo en cualquier sector, en las pantallas de trabajo (**Retiro en local**, **Gestión Delivery** y **Mostrador**), donde tenés los mismos botones que la cajera y la encargada. **Vista general** y **Tablero general** son para supervisar y no tienen esos botones. Las reglas:

- **Antes de aprobar** (lista de pendientes en **Retiro en local**, pestaña **Por aprobar** en **Gestión Delivery**): **Editar pedido** permite quitar y agregar productos libremente. Se recalcula el total; el **envío no cambia**. No puede quedar sin productos.
- **En preparación**: solo **Agregar productos** (no se saca ni se cambia lo que la cocina ya tiene). Cada agregado es un **Adicional 1, 2…** del mismo pedido.
  - **Efectivo** y **ventas de mostrador**: el adicional va directo a la cocina y se cobra al entregar (mostrador: en el momento).
  - **Transferencia**: queda **sin pagar** hasta que quien atiende verifica la acreditación y toca **Confirmar adicional**. Mientras tanto no suma al total, no descuenta stock ni cuenta para la demora automática, y la cocina no lo ve.
- Al confirmarse sale un ticket de cocina aparte que dice **ADICIONAL** con solo lo agregado (y, en delivery, se reimprime el ticket de delivery con el total nuevo). El descuento de stock de bebidas se hace en ese momento; un producto pausado o sin stock no se puede agregar.
- Si el pedido pasa a **Listo** con un adicional sin pagar, se cancela solo (con aviso). Desde **Listo** en adelante y en pedidos cancelados no se puede agregar nada.
- Si se cancela el pedido, el stock de lo agregado vuelve junto con el del resto, y los adicionales sin pagar se cancelan.
- Queda registrado quién modificó o agregó qué y cuándo (historial del pedido). Nada se borra.
- Pueden hacerlo la cajera (retiro y mostrador), la encargada de delivery (delivery), el encargado y vos. El usuario del televisor (**Cocina**) no puede.

Detalle de uso: [cajera](guia-cajera-mostrador.md) y [encargada de delivery](guia-encargada-delivery.md).

## Controles del día a día

- **Abrir / cerrar el local para pedidos web**: Ajustes → **Pausar pedidos** / **Reanudar pedidos**.
- **Bebida sin stock**: se pausa sola al llegar a cero y vuelve al reponer (Stock → **Reponer stock**).
- **Producto agotado**: Menú → **Desactivar** en la fila del producto (deja de verse en la tienda; **Activar** lo vuelve).
- **Impresión**: en **Estaciones** ves si cada agente está conectado; si una PC no imprime, `docs/ops/runbook.md` sección 5.3.
- **Supervisar**: **Vista general** y **Tablero general** muestran todos los sectores a la vez.

## Cosas que NO se hacen desde el sistema (pedir al soporte técnico)

Deploy y rollback, backups y restauración, cerrar todas las sesiones, etiquetar y desplegar una versión, certificados: `docs/ops/runbook.md`.

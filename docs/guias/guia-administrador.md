# Guía de una página: Administrador

El administrador entra con su usuario y cae en **Administración**. En el menú lateral de las pantallas de staff también ve **todas**
las pantallas de trabajo: **Venta**, **Mostrador**, **Retiro en local**, **Gestión Delivery**, **Rendición**, y dos vistas
generales: **Vista general** (`/caja`) y **Tablero general** (`/despacho`). El administrador **no** está limitado por sector.

## Menú de Administración

**Menú · Modificadores · Cadetes · Usuarios · Estaciones · Ajustes**.

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
- **Pantalla de cocina**: **Aviso amarillo** y **Aviso rojo** (minutos): desde cuántos minutos en preparación el reloj de cada pedido se pone amarillo y rojo (por defecto 8 y 15; el rojo tiene que ser mayor que el amarillo).
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

Una cuenta por persona: **Nombre**, **Usuario** (3 a 40 caracteres, minúsculas), **Rol** (cajera / encargada de delivery / **cocina** / administrador) y
**Contraseña** (mínimo 8). Desde la lista: **Desactivar** una cuenta (quien se va), **Cerrar sesiones de <usuario>**; al editar, **Nueva contraseña**
(cierra sus sesiones). Siempre tiene que quedar al menos un administrador activo. La cajera solo puede elegir estaciones de Mostrador y la
encargada solo de Delivery. El rol **Cocina** es para la PC o tablet de la cocina: no usa estación, entra directo a la pantalla de cocina (`/cocina`) y no ve cobros ni ninguna otra pantalla.

### Cadetes (`/admin/cadetes`)

**Nuevo cadete**: **Nombre**, **Teléfono** (opcional), **Cadete activo (se puede asignar a pedidos)**. No tienen acceso al sistema: la encargada registra por ellos.

### Menú y Modificadores

Ver `docs/guias/carga-del-menu.md` (paso a paso, con capturas).

## Controles del día a día

- **Abrir / cerrar el local para pedidos web**: Ajustes → **Pausar pedidos** / **Reanudar pedidos**.
- **Producto agotado**: Menú → **Desactivar** en la fila del producto (deja de verse en la tienda; **Activar** lo vuelve).
- **Impresión**: en **Estaciones** ves si cada agente está conectado; si una PC no imprime, `docs/ops/runbook.md` sección 5.3.
- **Supervisar**: **Vista general** y **Tablero general** muestran todos los sectores a la vez.

## Cosas que NO se hacen desde el sistema (pedir al soporte técnico)

Deploy y rollback, backups y restauración, cerrar todas las sesiones, etiquetar y desplegar una versión, certificados: `docs/ops/runbook.md`.

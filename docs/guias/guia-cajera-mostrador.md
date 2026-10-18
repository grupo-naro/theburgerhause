# Guía de una página: Cajera / Mostrador

Para quien trabaja en una PC de **Mostrador** (Mostrador 1 a 4). Las capturas usan datos de prueba.

## Empezar el turno

1. Abrí la dirección del sistema en el navegador y entrá con **tu usuario y contraseña** (botón **Ingresar**).
2. En **"¿Dónde estás trabajando?"** tocá **tu estación** (por ejemplo "Mostrador 1"). Es la PC y la impresora de la que sale
   el papel. Si te equivocás de estación, usá **Cambiar estación** (arriba, debajo del nombre de la estación).
3. Arriba a la derecha mirá tres señales:
   - **"Impresora lista"** (verde): el programa de impresión de esta PC está conectado. **"Sin agente"** (rojo): no
     va a salir papel hasta que vuelva (ver "Si algo falla").
   - **"En vivo"**: la pantalla se actualiza sola. **"Reconectando…"** o **"Sin conexión"**: se cortó internet.
   - **Sonido**: tocá **Activar sonido** una vez por turno para que suene cuando entra un pedido web nuevo (el navegador lo exige).
4. A la izquierda tenés **tres pantallas**: **Venta**, **Mostrador** y **Retiro en local**.

## 1. Venta en el mostrador (pantalla **Venta**)

![Venta lista para cobrar](img/venta-cobrar.png)

1. Tocá un producto para sumarlo al **Ticket** (una unidad lista, sin cambios). Para quitar ingredientes o agregar
   extras tocá **Personalizar**, elegí y apretá **Agregar al ticket**. Buscá por nombre en **Buscar producto…** (atajo: tecla `/`).
2. En el ticket elegí el **método de pago**: **Efectivo** o **Transferencia**. Con efectivo podés tocar el monto que te dan
   (**Justo $…** o un billete) y la pantalla muestra el **Vuelto**.
3. **Llamador (obligatorio)**: tocá el número en el teclado o usá **Siguiente libre**. Los llamadores ocupados aparecen
   en **En uso** (con el número de pedido); no se puede repetir uno en uso.
4. Si querés, poné el nombre del cliente (**Nombre (opcional)**).
5. Apretá **Cobrar e imprimir · $total** (atajo `Ctrl+Enter`). El botón te dice qué falta: "Agregá productos al ticket",
   "Elegí el método de pago", "Ingresá el llamador".
6. Aparece la confirmación con **Pedido #N** y **Llamador n**:

   ![Confirmación de la venta](img/venta-confirmacion.png)

   Tiene que decir **Impreso ✓** (sale **un** ticket del cliente, con logo y "GRACIAS POR TU COMPRA"). Si dice
   **Esperando la impresora…** esperá unos segundos; si dice **Falló la impresión**, revisá papel/cable y apretá **Reimprimir**.
   Para la próxima venta apretá **Nuevo pedido** (o Enter).

> No sale comanda de cocina impresa: la cocina lee cada pedido en su **pantalla de cocina** y toca **LISTO** (ver [Guía de cocina](guia-cocina.md)). Si la cocina se olvida de tocarlo, vos también podés apretar **Listo** en **Mostrador** o en **Retiro en local**. Desde el menú tenés el enlace **Cocina** para mirar esa pantalla (solo marcás los pedidos de tu sector).

Otros atajos: `Alt+L` limpiar el ticket, `Esc` cerrar.

## 2. Seguir las ventas (pantalla **Mostrador**)

Tres columnas con las ventas de mostrador:

| Columna | Qué hacés |
| --- | --- |
| **En preparación** | Cuando esté lista la comida, tocá **Listo**. |
| **Listos · Mostrador / Retiro** | Llamá al cliente por el llamador y tocá **Llamar / Para retirar**. |
| **Para retirar** | Cuando el cliente retira, tocá **Entregado**. |

![Mostrador](img/mostrador-pedidos.png)

## 3. Pedidos web de retiro (pantalla **Retiro en local**)

Acá llegan **solo** los pedidos web "Retiro en el local" (los de delivery van a la PC de Delivery). Al entrar uno suena el
aviso (si activaste el sonido) y aparece un número rojo en el menú.

![Retiro en local](img/retiro-en-local.png)

**Aprobar**

- **Efectivo**: apretá **Aprobar** ("el cobro queda pendiente": se cobra al entregar).
- **Transferencia**: **primero verificá en tu banco que la plata llegó**, tildá **"Verifiqué la acreditación del pago de $…"** y
  recién ahí se habilita **Aprobar y pagado**. Sin la tilde el botón no funciona.
- Al aprobar, **esta estación imprime el ticket del cliente** y el pedido pasa a **En preparación**.

**Rechazar**: **Rechazar** → elegí un motivo (**Sin stock**, **Zona sin cobertura**, **Pago no acreditado**, **Datos incompletos**) o
escribí uno (mínimo 3 letras) → **Rechazar pedido**. El cliente ve su pedido como cancelado, con ese motivo.

**Cancelar un pedido ya aprobado** (se equivocó la carga, el cliente se arrepintió, no hay stock): en la tarjeta del pedido (**En preparación**, **Listos** o **Para retirar**) tocá
**Cancelar pedido**, elegí un motivo (**Cliente canceló**, **Error de carga**, **Sin stock**, **No se pudo entregar**) o escribí uno (obligatorio, mínimo 3 letras) y confirmá con
**Cancelar pedido**. El pedido sale del tablero, **el llamador queda libre** y no se imprime nada más de ese pedido. La cancelación **no devuelve plata**: si ya se cobró,
el reintegro lo resolvés aparte con el cliente. Una venta ya **Entregada** no se puede cancelar. Sirve igual para anular una venta del mostrador cargada por error.

**Después**: **Listo** → **Llamar / Para retirar** → **Entregado** (igual que en Mostrador). Si el pedido era en **efectivo**, al
tocar **Entregado** aparece **"Cobrá $… antes de entregar"**: recibí la plata, tildá **Cobré $…** y apretá **Entregar pedido**.

**Recientes** (abajo): últimos pedidos con su estado y la marca de impresión (**Impresión: ok / pendiente / falló**) y el botón **Reimprimir**.

## Si algo falla

| Qué pasa | Qué hacés |
| --- | --- |
| Cuadro rojo **"1 impresión falló"** | Revisá papel, tapa, cable y que esté prendida; apretá **Reimprimir**. |
| No salió un ticket y no hay cuadro rojo | **Recientes** → **Reimprimir** en ese pedido → **Ticket cliente**. |
| Sale dos veces | Si reimprimiste "por las dudas", es lo esperado. Si pasa solo, avisá al soporte. |
| **Sin agente** | Esperá 6 minutos (se recupera solo). Si sigue, avisá al soporte. Mientras: reimprimí en otra estación. |
| **Sin conexión** / no carga nada | Seguí con el **plan de contingencia** (pedidos a mano en el block): `docs/guias/plan-contingencia.md`. |

**Importante:** una transferencia **nunca** se aprueba sin ver la plata. Si dudás, **Rechazar → Pago no acreditado**.

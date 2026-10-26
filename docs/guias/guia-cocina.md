# Guía de Cocina y del televisor (una página)

Para el cocinero, el ayudante y quien deja el televisor del mostrador funcionando. Hay **dos cosas** distintas:

- el **ticket de cocina**: el papel que sale impreso y dice qué preparar;
- el **televisor del mostrador** (`/pantalla`): muestra a los clientes **solo los números** de pedido, en preparación y listos. **No** tiene botones ni sirve para marcar nada.

La vieja pantalla de cocina (tarjetas con botón **LISTO**) **ya no existe**: si alguien abre `/cocina`, el sistema lo lleva solo al televisor.

## El ticket de cocina

- Sale **en la misma impresora** del puesto donde se aprobó el pedido (Mostrador o Delivery). No hay una impresora aparte para cocina.
- Sale **primero**: antes del ticket del cliente (y del de delivery). Así podés empezar a preparar enseguida. La cajera o la encargada te lo acercan.
- Dice: **número de pedido**, el tipo (**MOSTRADOR**, **RETIRO** o **DELIVERY**; en mostrador también el **LLAMADOR**), cada producto **por unidad** (si piden 3 hamburguesas, salen 3 líneas, cada una con sus cambios) con los cambios y adicionales **en mayúsculas** ("SIN CHEDDAR", "+ DIPS"), la **nota del cliente** ("bien cocida", "sin sal"…: leela siempre) y la **hora**.
- Sale para **todos** los pedidos aprobados: venta de mostrador, retiro y delivery.

### Si el ticket de cocina no sale

Avisá a la cajera (mostrador) o a la encargada (delivery). Ellas:

1. Miran el **cuadro rojo de la Caja** (alerta de impresión fallida): dice cuál papel falló ("Ticket cocina: Sin papel", por ejemplo). Se arregla el papel / cable / tapa y se aprieta **Reimprimir** ahí mismo.
2. Si no hay cuadro rojo, en el POS (**Mostrador**), **Reimprimir** en el pedido.
3. Desde **Recientes** → **Reimprimir** → **Ticket cocina** (es una opción aparte, para no duplicar la cocina sin querer).

Mientras tanto, la cocina puede leer el pedido en la pantalla de la cajera / encargada (**En preparación**). Plan completo: `plan-contingencia.md`.

## Quién marca "Listo" y "Entregado"

La cocina **no toca ninguna pantalla** para eso. Cuando el pedido está armado, **le avisás a la cajera** (mostrador y retiro) o **a la encargada** (delivery), y ella usa los botones que ya conoce: **Listo** (el pedido pasa a la zona "¡Listo!" del televisor y suena el aviso) y después, cuando el cliente lo retira, **Entregado** (el número desaparece del televisor).

## El televisor del mostrador

Se ve fijo, a pantalla completa, **sin menú ni nombres**: solo números grandes.

- **En preparación** (zona izquierda, más angosta): los pedidos que se están cocinando.
- **¡Listo! Retiralo en el mostrador** (zona derecha, más grande): los pedidos para retirar. Cuando uno pasa a listo **suena un aviso** y su número se resalta un momento.
- **Entran** los pedidos de **mostrador** y de **retiro en local**. Los de **delivery no aparecen** nunca.
- Un pedido **cancelado o rechazado** o ya **entregado** sale solo del televisor.
- Si hay muchos números, se achican y, si igual no caben, la lista **se desplaza sola** despacio. Nadie tiene que tocar nada.
- Arriba/abajo, un cartel **En vivo** significa que se actualiza solo. Si dice **Reconectando…** (se reinició el sistema o se cortó internet), esperá: **vuelve sola**.

### Sonido

El aviso de "Listo" está **activado** por defecto. Hay un único botón discreto para silenciarlo / activarlo. El navegador no deja sonar nada hasta que alguien toca la pantalla **una vez**: mientras no pase, aparece un cartelito abajo a la izquierda. Tocá la pantalla una vez y desaparece. (Con el arranque en modo kiosco de abajo, no hace falta el toque.)

### Cómo dejar el televisor andando

1. En la PC del televisor, abrir el sistema en `/login` y entrar con el usuario **cocina** (el administrador te da usuario y contraseña; no tiene estación). Entra directo a `/pantalla`. Esa sesión **dura 400 días** sin vencer por inactividad; pasado ese plazo, o si el administrador usa "Cerrar sesiones" / cambia la clave, hay que volver a entrar.
2. Para que quede a pantalla completa y con el sonido sin toque (también después de un corte de luz), el administrador lo configura en el inicio automático (ver `docs/ops/runbook.md`, sección 10.1):

   ```text
   chrome.exe --kiosk --autoplay-policy=no-user-gesture-required https://<TU_DOMINIO>/pantalla
   ```

   Sin modo kiosco, alcanza con apretar **F11**.
3. Desactivar la suspensión y el protector de pantalla de esa PC.
4. Cualquier otro usuario del personal (cajera, encargada, encargado, administrador) puede abrir la misma pantalla desde el menú (**Pantalla**, se abre en una pestaña nueva), pero **el televisor usa siempre el usuario cocina**.

El televisor **se recupera solo** si se reinicia el sistema o falla un momento. Si quedara en blanco o con un error del navegador, recargá con **F5**.

## Casos raros

- **Un número desaparece del televisor sin haber sido retirado**: el pedido se canceló.
- **Un pedido no aparece en el televisor**: si es de delivery, es lo normal. Si es de mostrador o retiro, revisá que esté aprobado.
- **Se cae el sistema o internet**: pedidos a mano y papel de contingencia: `plan-contingencia.md`.
- **No sale ningún papel**: avisar a la cajera / encargada (ver arriba).

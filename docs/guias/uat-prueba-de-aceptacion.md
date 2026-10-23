# Prueba de aceptación en el local (UAT)

Guion para hacer **en el local, con las PCs, impresoras e internet reales** y el sistema ya en la VPS. Lo corre una persona de
cada rol, con alguien del soporte al lado. Cada escenario tiene pasos, resultado esperado y una columna **Pasó / Falló** para marcar
(`[ ] OK  [ ] FALLÓ`) con la nota de lo que se vio.

Los escenarios están basados en lo que ya prueban automáticamente los recorridos del sistema (`e2e/journey-*.spec.ts`), pero
**acá se prueba lo que la automatización no puede**: las impresoras reales, las PCs reales, el celular de un cliente, la VPS.

**Antes de empezar**: `docs/guias/checklist-de-salida.md` completo hasta "agentes instalados", el local **abierto a pedidos** durante la prueba (Ajustes →
**Reanudar pedidos**; si todavía no querés clientes reales, **volvé a pausar** al terminar la UAT), y un celular con datos móviles (fuera del wifi del local).
Los pedidos de prueba se **cancelan** (Rechazar con motivo "prueba") o se marcan en la planilla para no mezclarlos con ventas reales.

Roles: **C** cajera (PC Mostrador), **E** encargada (PC Delivery), **A** administrador, **K** cliente (celular), **S** soporte.

## Parte 1: Preparación (A)

| N.º | Escenario | Pasos | Resultado esperado | Pasó / Falló |
| --- | --- | --- | --- | --- |
| P1 | Menú visible | Desde el celular, datos móviles, abrir la dirección pública. | Carga el menú real con fotos y precios correctos; el cartel "Por el momento no estamos tomando pedidos" si está pausado. | [ ] OK  [ ] FALLÓ |
| P2 | Login por rol | Entrar con cada usuario real (cajera, encargada, admin). | Cajera cae en **Venta**, encargada en **Gestión Delivery**, admin en **Administración**. | [ ] OK  [ ] FALLÓ |
| P3 | Estación y sector | Cajera elige estación; probar elegir una de Delivery. Encargada igual con Mostrador. | Cada una solo puede elegir estaciones de su sector. Menú lateral: cajera ve Venta/Mostrador/Retiro en local; encargada ve Gestión Delivery/Rendición. | [ ] OK  [ ] FALLÓ |
| P4 | Indicadores | En cada PC, mirar la barra superior. | **Impresora lista** y **En vivo** en las 9 PCs. | [ ] OK  [ ] FALLÓ |
| P5 | Ticket de prueba por PC | En cada PC `test-print` (`docs/ops/print-agent-install.md` sección 9). | Sale el **logo** arriba, acentos (á é í ó ú ñ ¿ ¡), negrita, tamaño doble, la frase **GRACIAS POR TU COMPRA** y el corte. | [ ] OK  [ ] FALLÓ (anotar modelo) |

## Parte 2: Cajera / Mostrador (C)

| N.º | Escenario | Pasos | Resultado esperado | Pasó / Falló |
| --- | --- | --- | --- | --- |
| C1 | Venta de mostrador en efectivo con llamador | **Venta**: 2 productos (uno con **Personalizar**: quitar un ingrediente), **Efectivo**, tocar el monto recibido, llamador (**Siguiente libre**), nombre, **Cobrar e imprimir**. | Pantalla **Pedido #N / Llamador n**, **Impreso ✓**; sale **un** ticket del cliente con logo, productos con su modificación, total, llamador y GRACIAS POR TU COMPRA. Vuelto correcto. El pedido aparece en **Mostrador → En preparación**. | [ ] OK  [ ] FALLÓ |
| C2 | Llamador en uso | Con la venta C1 todavía abierta en **Mostrador**, otra venta con el **mismo** llamador. | El botón queda deshabilitado con "El llamador n está en uso (pedido #N)"; con otro número funciona. | [ ] OK  [ ] FALLÓ |
| C3 | Venta por transferencia | Venta con **Transferencia**, llamador distinto. | Cobra e imprime igual; el pedido queda pagado. | [ ] OK  [ ] FALLÓ |
| C4 | Del mostrador a la entrega | En **Mostrador**: **Listo** → **Llamar / Para retirar** → **Entregado**. | El pedido pasa por las tres columnas y desaparece de la pantalla; liberó el llamador. | [ ] OK  [ ] FALLÓ |
| C5 | Pedido web de retiro, efectivo | K pide desde el celular "Retiro en el local" + Efectivo. C en **Retiro en local**. | Suena el aviso y aparece en **Pendientes de aprobación** sin recargar, con nombre, productos y total. **Aprobar** imprime **un** ticket del cliente en esta estación y pasa a **En preparación**. K ve "Estamos preparando tu pedido" en su seguimiento (paso actual: Listo). | [ ] OK  [ ] FALLÓ |
| C6 | Entrega con cobro | Seguir C5: **Listo** → **Llamar / Para retirar** → **Entregado**. | Aparece "Cobrá $… antes de entregar"; solo se habilita **Entregar pedido** al tildar **Cobré $…**. K ve "Entregado". | [ ] OK  [ ] FALLÓ |
| C7 | Pedido web de retiro, transferencia | K pide retiro + **Transferencia** (ve alias y CBU). Hacer la transferencia real de monto bajo. | En C el botón **Aprobar y pagado** está **deshabilitado** con "Tildá la verificación del pago para aprobar" hasta tildar **Verifiqué la acreditación…**. Aprobar → imprime y queda pagado. | [ ] OK  [ ] FALLÓ |
| C8 | Rechazo | K pide retiro; C: **Rechazar** → **Pago no acreditado** → **Rechazar pedido**. | Sale de la bandeja; en **Recientes** figura **Cancelado**; K ve el pedido cancelado con el motivo. No se imprime nada. | [ ] OK  [ ] FALLÓ |
| C9 | Separación por sector | K pide un pedido de **Delivery**. | **No aparece** en ninguna pantalla de Mostrador (ni Retiro en local ni Mostrador); sí en la PC de Delivery. | [ ] OK  [ ] FALLÓ |
| C10 | Impresora sin papel / apagada | Sacar el papel (o apagar la impresora) y hacer una venta o aprobar un pedido. | Se reintenta; después de 3 intentos aparece el cuadro rojo **"1 impresión falló"** y **Sin agente · 1 fallida** u otra señal. | [ ] OK  [ ] FALLÓ |
| C11 | Reimpresión | Con el papel repuesto, **Reimprimir** en el cuadro rojo. Luego **Recientes → Reimprimir → Ticket cliente** sobre otro pedido. | Sale **un** papel por cada pedido; el cuadro rojo desaparece; **Impresión: ok**. | [ ] OK  [ ] FALLÓ |

## Parte 3: Encargada de Delivery (E)

| N.º | Escenario | Pasos | Resultado esperado | Pasó / Falló |
| --- | --- | --- | --- | --- |
| E1 | Pedido web de delivery de punta a punta (transferencia) | K arma **desde el celular** un pedido con 2 unidades de una hamburguesa con modificaciones distintas + otro producto, **Delivery**, dirección real de prueba, **Transferencia**. En E: **Por aprobar** → tildar verificación → **Aprobar y pagado**. | El pedido aparece solo, con total (productos + envío). Al aprobar salen **dos papeles** en la estación Delivery, en este orden: primero el **ticket del cliente** (logo, productos con precios, total, GRACIAS POR TU COMPRA) y después el **ticket de delivery** (PEDIDO #N, DELIVERY, cliente, teléfono, dirección y referencias, cada unidad con su modificación, "Pago: Transferencia (pagado)", total; sin logo). No sale comanda de cocina. **Recientes** muestra **Impresión: ok**. | [ ] OK  [ ] FALLÓ |
| E2 | Seguimiento del cliente | K recarga/mira `/pedido/...` durante E1. | Pasa solo por Recibido → Listo → En camino → Entregado según lo que haga E (puede tardar unos segundos). | [ ] OK  [ ] FALLÓ |
| E3 | Preparación y despacho a un cadete | **En preparación → Listo** el pedido de E1. Cargar 2 pedidos en **efectivo** más (por la web) y dejarlos **Listos**. En **Listos / Despacho** tildar los 3, **Elegí un cadete…**, **Asignar a <cadete>**. | La barra muestra "3 pedidos" y **Efectivo a cobrar** = suma de los 2 de efectivo. Pasan a **En camino** agrupados bajo el cadete. K ve "En camino". | [ ] OK  [ ] FALLÓ |
| E4 | Entrega fallida | En **En camino**, en un pedido: **No se pudo entregar** → motivo → **Volver a despacho**. | Vuelve a **Listos / Despacho**; el cadete queda libre de ese pedido. Se puede reasignar. | [ ] OK  [ ] FALLÓ |
| E5 | Entrega y rendición exacta | **Entregado** los pedidos en ruta. **Rendición** → cadete: **A rendir** = suma de los de **efectivo** entregados (la transferencia no suma). Recibir el total exacto → **Confirmar rendición** → **Sí, confirmar**. | **Diferencia: Exacto**; comprobante **Rendición #N**; saldo **$0** y en la lista figura **Al día**. **Imprimir comprobante** sale en la impresora. | [ ] OK  [ ] FALLÓ |
| E6 | Faltante en la rendición | Repetir con otro cadete/pedidos y escribir un monto menor (por ejemplo $250 menos). | **Diferencia: Faltan $250**; la nota pasa a **obligatoria**; sin nota no se confirma; con nota (**Gastó en nafta**) el diálogo muestra **Debe / Recibido / Faltante**; al confirmar el saldo queda en $0 y el comprobante muestra el faltante. | [ ] OK  [ ] FALLÓ |
| E7 | Más de lo debido | En la rendición escribir un monto mayor al que debe. | Dice "No puede ser más que lo que debe rendir" y no deja confirmar. | [ ] OK  [ ] FALLÓ |
| E8 | Rechazo de delivery | K pide delivery; E: **Rechazar** → **Zona sin cobertura**. | Se cancela con motivo, K lo ve; no imprime. | [ ] OK  [ ] FALLÓ |
| E9 | Separación por sector | K pide un pedido de **retiro**. | **No aparece** en Gestión Delivery. | [ ] OK  [ ] FALLÓ |
| E10 | Reimpresión de delivery | En **Recientes**, **Reimprimir → Ticket delivery**, y **Ambos tickets**. | Sale el ticket de delivery (y con "Ambos", los dos). | [ ] OK  [ ] FALLÓ |
| E11 | Poner la tanda | En **Gestión Delivery**, con 4 pedidos aprobados, escribir **1** en el casillero **Tanda** de tres de ellos y **2** en el cuarto. Recargar la página. | Los números quedan guardados; los chips muestran **Tanda 1: … de 3** y **Tanda 2: … de 1**. Borrar el número deja el pedido en **Sin tanda**. | [ ] OK  [ ] FALLÓ |
| E12 | Aviso de más de 3 | Poner la misma tanda a un cuarto pedido. | Sale un aviso amarillo (solo advertencia); se puede seguir guardando y asignando. | [ ] OK  [ ] FALLÓ |
| E13 | Asignar una tanda completa | Con todos los pedidos de una tanda en **Listos / Despacho**, tocar **Asignar tanda a cadete**, elegir cadete y **Asignar tanda a <cadete>**. | Todos pasan a **En camino** con ese cadete; el aviso muestra el **Efectivo a rendir** correcto. | [ ] OK  [ ] FALLÓ |
| E14 | Tanda incompleta | Con una tanda de 3 donde solo 2 están listos, tocar **Asignar tanda a cadete** y elegir cadete. | La barra dice "2 de 3 listos" y el botón **Asignar igual los 2 listos**. Al apretarlo salen los 2 y el tercero **sigue en su tanda**. | [ ] OK  [ ] FALLÓ |
| E15 | Papel y cocina | Aprobar un pedido con tanda y mirar el ticket y la pantalla de cocina. | El ticket **no imprime** la tanda (se anota a mano) y la cocina **no la muestra** (esperado por ahora). | [ ] OK  [ ] FALLÓ |

## Parte 4: Administrador (A) y sistema

| N.º | Escenario | Pasos | Resultado esperado | Pasó / Falló |
| --- | --- | --- | --- | --- |
| A1 | Local cerrado | **Ajustes → Pausar pedidos**. Desde el celular recargar la tienda; intentar pedir. | La tienda muestra "Por el momento no estamos tomando pedidos" con los horarios y no deja confirmar un pedido. Las ventas de **Venta** (mostrador) **siguen funcionando** con los pedidos pausados (pausar frena solo los pedidos web): hacer una venta de prueba y confirmar que se cobra e imprime. | [ ] OK  [ ] FALLÓ |
| A2 | Reabrir | **Reanudar pedidos**. | El cartel desaparece y se puede pedir. | [ ] OK  [ ] FALLÓ |
| A3 | Producto agotado | **Menú → Desactivar** un producto. Mirar la tienda desde el celular. Volver a **Activar**. | Deja de verse (y reaparece al activarlo). | [ ] OK  [ ] FALLÓ |
| A4 | Cambio de precio | Cambiar el precio de un producto y hacer un pedido nuevo. | El pedido nuevo usa el precio nuevo. Los pedidos anteriores no cambian. | [ ] OK  [ ] FALLÓ |
| A5 | Usuario nuevo y baja | Crear un usuario cajera de prueba, entrar con él, luego **Desactivar**. | Entra; después de desactivarlo no puede entrar ("Usuario o contraseña incorrectos"). | [ ] OK  [ ] FALLÓ |
| A6 | Token rotado | **Estaciones → Rotar token** de una estación de prueba (sin agente en producción) y reinstalar con el nuevo. | El agente anterior deja de imprimir; el nuevo vuelve a **Impresora lista**. | [ ] OK  [ ] FALLÓ |
| A7 | Vistas generales | Entrar a **Vista general** y **Tablero general**. | Se ven los pedidos de todos los sectores. | [ ] OK  [ ] FALLÓ |

## Parte 4b: Cocina (O)

Con un usuario de rol **Cocina** en el dispositivo de la cocina (sin estación).

| N.º | Escenario | Pasos | Resultado esperado | Pasó / Falló |
| --- | --- | --- | --- | --- |
| O1 | El pedido llega solo | Con la pantalla de cocina abierta, E aprueba un pedido de **delivery** (2 unidades, una con **Sin cheddar**, con nota) y C aprueba uno de **retiro**. | Aparecen sin recargar, con el cartel **DELIVERY** / **RETIRO**, cada unidad numerada con sus cambios en mayúsculas y la nota resaltada. Suena el aviso si el sonido está activado. | [ ] OK  [ ] FALLÓ |
| O2 | Venta de mostrador | C hace una venta de mostrador (llamador 7). | Aparece con **MOSTRADOR** y **LLAMADOR 7**. | [ ] OK  [ ] FALLÓ |
| O3 | Reloj de colores | Dejar un pedido sin marcar más de 8 y de 15 minutos. | El reloj pasa de verde a amarillo y a rojo; el más viejo está primero. | [ ] OK  [ ] FALLÓ |
| O4 | LISTO | El cocinero toca **LISTO** en el de delivery y en el de mostrador. | Desaparecen de la cocina; el de delivery aparece en **Listos / Despacho** de E y el de mostrador en **Listos** de C, sin recargar. Queda el aviso **Deshacer** unos segundos. | [ ] OK  [ ] FALLÓ |
| O5 | Deshacer | Tocar **Deshacer** en el aviso, o **Volver a preparación** en la franja **Recién listos**. | El pedido vuelve a la cocina. Si C ya llamó al llamador o E ya lo asignó a un cadete, no se puede deshacer y lo dice. | [ ] OK  [ ] FALLÓ |
| O6 | Pedido cancelado | E cancela (con motivo) un pedido que está en la cocina. | Desaparece de la pantalla de cocina sin recargar. | [ ] OK  [ ] FALLÓ |
| O7 | Un solo usuario de cocina | Con el usuario **Cocina** intentar abrir Caja, Retiro, Delivery o Administración. | Solo se ve la pantalla de cocina; ninguna otra. | [ ] OK  [ ] FALLÓ |

## Parte 5: Fallas (S con el local)

| N.º | Escenario | Pasos | Resultado esperado | Pasó / Falló |
| --- | --- | --- | --- | --- |
| F1 | Agente caído | En una PC finalizar `node.exe` (Administrador de tareas). Esperar hasta 6 minutos. | Se marca **Sin agente**; vuelve solo a **Impresora lista**. Lo aprobado mientras tanto sale al volver, una vez cada uno. | [ ] OK  [ ] FALLÓ |
| F2 | Reinicio de PC | Reiniciar una PC sin iniciar sesión; esperar 2 minutos. | **Impresora lista** sin tocar nada. Repetir en las 9. | [ ] OK  [ ] FALLÓ |
| F3 | Internet del local caído | Desconectar internet de una PC; aprobar un pedido desde otra; reconectar. | La PC sin internet muestra **Sin conexión**; al volver todo se actualiza y los tickets pendientes salen **una sola vez**. | [ ] OK  [ ] FALLÓ |
| F4 | Sin papel | Ver C10 y C11 en cada tipo de impresora. | Ver C10 y C11. | [ ] OK  [ ] FALLÓ |
| F5 | Simulacro de papel | Con el sistema "caído" (cerrar el navegador), la cajera toma 3 pedidos en el block. Después cargar lo necesario. | La libreta es suficiente; se sigue el plan de contingencia sin dudas. | [ ] OK  [ ] FALLÓ |
| F6 | Carga | Mantener las 9 PCs abiertas y 5 pedidos casi a la vez. | Nada se cuelga; aparecen todos y se imprimen una vez. | [ ] OK  [ ] FALLÓ |

## Cierre de la UAT

- Escenarios OK: ____ / ____ . Fallidos (con número y nota): ______________________
- Todo **C1, C5, C6, C8, E1, E3, E5, E6, F1, F2** en OK es **condición** para empezar la operación en paralelo (`docs/guias/operacion-en-paralelo.md`).
- Firma del responsable del local: ____________ Firma de soporte: ____________ Fecha: ____________

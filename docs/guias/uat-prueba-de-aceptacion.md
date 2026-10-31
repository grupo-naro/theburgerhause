# Prueba de aceptación en el local (UAT)

Guion para hacer **en el local, con las PCs, impresoras e internet reales** y el sistema ya en la VPS. Lo corre una persona de
cada rol, con alguien del soporte al lado. Cada escenario tiene pasos, resultado esperado y una columna **Pasó / Falló** para marcar
(`[ ] OK  [ ] FALLÓ`) con la nota de lo que se vio.

Los escenarios están basados en lo que ya prueban automáticamente los recorridos del sistema (`e2e/journey-*.spec.ts`), pero
**acá se prueba lo que la automatización no puede**: las impresoras reales, las PCs reales, el celular de un cliente, la VPS.

**Antes de empezar**: `docs/guias/checklist-de-salida.md` completo hasta "agentes instalados", el local **abierto a pedidos** durante la prueba (Ajustes →
**Reanudar pedidos**; si todavía no querés clientes reales, **volvé a pausar** al terminar la UAT), y un celular con datos móviles (fuera del wifi del local).
Los pedidos de prueba se **cancelan** (Rechazar con motivo "prueba") o se marcan en la planilla para no mezclarlos con ventas reales.

Roles: **G** encargado, **C** cajera (PC Mostrador), **E** encargada (PC Delivery), **A** administrador, **K** cliente (celular), **S** soporte.

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
| C1 | Venta de mostrador en efectivo con llamador | **Venta**: 2 productos (uno con **Personalizar**: quitar un ingrediente), **Efectivo**, tocar el monto recibido, llamador (**Siguiente libre**), nombre, **Cobrar e imprimir**. | Pantalla **Pedido #N / Llamador n**, **Impreso ✓**; salen **dos** papeles, en este orden: primero el **ticket de cocina** (PEDIDO #N, MOSTRADOR, LLAMADOR n, cada producto numerado con su cambio en mayúsculas, sin precios) y después el **ticket del cliente** con logo, productos con su modificación, total, llamador y GRACIAS POR TU COMPRA. Vuelto correcto. El pedido aparece en **Mostrador → En preparación** y su número en **En preparación** del televisor (`/pantalla`). | [ ] OK  [ ] FALLÓ |
| C2 | Llamador en uso | Con la venta C1 todavía abierta en **Mostrador**, otra venta con el **mismo** llamador. | El botón queda deshabilitado con "El llamador n está en uso (pedido #N)"; con otro número funciona. | [ ] OK  [ ] FALLÓ |
| C3 | Venta por transferencia | Venta con **Transferencia**, llamador distinto. | Cobra e imprime igual; el pedido queda pagado. | [ ] OK  [ ] FALLÓ |
| C4 | Del mostrador a la entrega | En **Mostrador**: **Listo** → **Llamar / Para retirar** → **Entregado**. | El pedido pasa por las tres columnas y desaparece de la pantalla; liberó el llamador. | [ ] OK  [ ] FALLÓ |
| C5 | Pedido web de retiro, efectivo | K pide desde el celular "Retiro en el local" + Efectivo. C en **Retiro en local**. | Suena el aviso y aparece en **Pendientes de aprobación** sin recargar, con nombre, productos y total. **Aprobar** imprime la **comanda de cocina** y el **ticket del cliente** (en ese orden) en esta estación y pasa a **En preparación**. K ve "Estamos preparando tu pedido" en su seguimiento (paso actual: Listo). | [ ] OK  [ ] FALLÓ |
| C6 | Entrega con cobro | Seguir C5: **Listo** → **Llamar / Para retirar** → **Entregado**. | Aparece "Cobrá $… antes de entregar"; solo se habilita **Entregar pedido** al tildar **Cobré $…**. K ve "Entregado". | [ ] OK  [ ] FALLÓ |
| C7 | Pedido web de retiro, transferencia | K pide retiro + **Transferencia** (ve alias y CBU). Hacer la transferencia real de monto bajo. | En C el botón **Aprobar y pagado** está **deshabilitado** con "Tildá la verificación del pago para aprobar" hasta tildar **Verifiqué la acreditación…**. Aprobar → imprime y queda pagado. | [ ] OK  [ ] FALLÓ |
| C8 | Rechazo | K pide retiro; C: **Rechazar** → **Pago no acreditado** → **Rechazar pedido**. | Sale de la bandeja; en **Recientes** figura **Cancelado**; K ve el pedido cancelado con el motivo. No se imprime nada. | [ ] OK  [ ] FALLÓ |
| C9 | Separación por sector | K pide un pedido de **Delivery**. | **No aparece** en ninguna pantalla de Mostrador (ni Retiro en local ni Mostrador); sí en la PC de Delivery. | [ ] OK  [ ] FALLÓ |
| C10 | Impresora sin papel / apagada | Sacar el papel (o apagar la impresora) y hacer una venta o aprobar un pedido. | Se reintenta; después de 3 intentos aparece el cuadro rojo **"1 impresión falló"** y **Sin agente · 1 fallida** u otra señal. | [ ] OK  [ ] FALLÓ |
| C11 | Reimpresión | Con el papel repuesto, **Reimprimir** en el cuadro rojo. Luego **Recientes → Reimprimir → Ticket cliente** sobre otro pedido. | Sale **un** papel por cada pedido (si falló también el ticket de cocina, el cuadro rojo lo reimprime junto con el del cliente); el cuadro rojo desaparece; **Impresión: ok**. | [ ] OK  [ ] FALLÓ |

## Parte 3: Encargada de Delivery (E)

| N.º | Escenario | Pasos | Resultado esperado | Pasó / Falló |
| --- | --- | --- | --- | --- |
| E1 | Pedido web de delivery de punta a punta (transferencia) | K arma **desde el celular** un pedido con 2 unidades de una hamburguesa con modificaciones distintas + otro producto, **Delivery**, dirección real de prueba, **Transferencia**. En E: **Por aprobar** → tildar verificación → **Aprobar y pagado**. | El pedido aparece solo, con total (productos + envío). Al aprobar salen **tres papeles** en la estación Delivery, en este orden: primero la **comanda de cocina** (PEDIDO #N, DELIVERY, cada producto numerado con su cambio en mayúsculas, sin precios), después el **ticket del cliente** (logo, productos con precios, total, GRACIAS POR TU COMPRA) y después el **ticket de delivery** (PEDIDO #N, DELIVERY, cliente, teléfono, dirección y referencias, cada unidad con su modificación, "Pago: Transferencia (pagado)", total; sin logo). **Recientes** muestra **Impresión: ok**. | [ ] OK  [ ] FALLÓ |
| E2 | Seguimiento del cliente | K recarga/mira `/pedido/...` durante E1. | Pasa solo por Recibido → Listo → En camino → Entregado según lo que haga E (puede tardar unos segundos). | [ ] OK  [ ] FALLÓ |
| E3 | Preparación y despacho a un cadete | **En preparación → Listo** el pedido de E1. Cargar 2 pedidos en **efectivo** más (por la web) y dejarlos **Listos**. En **Listos / Despacho** tildar los 3, **Elegí un cadete…**, **Asignar a <cadete>**. | La barra muestra "3 pedidos" y **Efectivo a cobrar** = suma de los 2 de efectivo. Pasan a **En camino** agrupados bajo el cadete. K ve "En camino". | [ ] OK  [ ] FALLÓ |
| E4 | Entrega fallida | En **En camino**, en un pedido: **No se pudo entregar** → motivo → **Volver a despacho**. | Vuelve a **Listos / Despacho**; el cadete queda libre de ese pedido. Se puede reasignar. | [ ] OK  [ ] FALLÓ |
| E5 | Entrega y rendición automática | **Entregado** los pedidos en ruta de un cadete (al menos uno en efectivo y uno por transferencia). Después entrar a **Rendición**. | Al tocar **Entregado** el pedido en efectivo pasa a pagado solo. En **Rendición** el cadete figura **Al día** ($0) y en el historial hay una rendición por cada pedido en efectivo (nota "Rendición automática al entregar"). La transferencia no genera rendición. | [ ] OK  [ ] FALLÓ |
| E6 | Faltante en la rendición | Solo con efectivo pendiente de antes (el Entregado nuevo rinde solo): si no hay, saltear E6 y E7. En **Rendición** escribir un monto menor (por ejemplo $250 menos). | **Diferencia: Faltan $250**; la nota pasa a **obligatoria**; sin nota no se confirma; con nota (**Gastó en nafta**) el diálogo muestra **Debe / Recibido / Faltante**; al confirmar el saldo queda en $0 y el comprobante muestra el faltante. | [ ] OK  [ ] FALLÓ |
| E7 | Más de lo debido | En la rendición escribir un monto mayor al que debe. | Dice "No puede ser más que lo que debe rendir" y no deja confirmar. | [ ] OK  [ ] FALLÓ |
| E8 | Rechazo de delivery | K pide delivery; E: **Rechazar** → **Zona sin cobertura**. | Se cancela con motivo, K lo ve; no imprime. | [ ] OK  [ ] FALLÓ |
| E9 | Separación por sector | K pide un pedido de **retiro**. | **No aparece** en Gestión Delivery. | [ ] OK  [ ] FALLÓ |
| E10 | Reimpresión de delivery | En **Recientes**, **Reimprimir → Ticket delivery**, **Cliente + delivery** y **Ticket cocina**. | Sale el ticket de delivery; con "Cliente + delivery", el del cliente y el de delivery (sin el de cocina); con "Ticket cocina", solo el ticket de cocina. | [ ] OK  [ ] FALLÓ |
| E11 | Poner la tanda | En **Gestión Delivery**, con 4 pedidos aprobados, escribir **1** en el casillero **Tanda** de tres de ellos y **2** en el cuarto. Recargar la página. | Los números quedan guardados; los chips muestran **Tanda 1: … de 3** y **Tanda 2: … de 1**. Borrar el número deja el pedido en **Sin tanda**. | [ ] OK  [ ] FALLÓ |
| E12 | Aviso de más de 3 | Poner la misma tanda a un cuarto pedido. | Sale un aviso amarillo (solo advertencia); se puede seguir guardando y asignando. | [ ] OK  [ ] FALLÓ |
| E13 | Asignar una tanda completa | Con todos los pedidos de una tanda en **Listos / Despacho**, tocar **Asignar tanda a cadete**, elegir cadete y **Asignar tanda a <cadete>**. | Todos pasan a **En camino** con ese cadete; el aviso muestra el **Efectivo a rendir** correcto. | [ ] OK  [ ] FALLÓ |
| E14 | Tanda incompleta | Con una tanda de 3 donde solo 2 están listos, tocar **Asignar tanda a cadete** y elegir cadete. | La barra dice "2 de 3 listos" y el botón **Asignar igual los 2 listos**. Al apretarlo salen los 2 y el tercero **sigue en su tanda**. | [ ] OK  [ ] FALLÓ |
| E15 | Papel y cocina | Aprobar un pedido con tanda y mirar el ticket de cocina. | El ticket **no imprime** la tanda (se anota a mano) y la cocina no la ve (esperado por ahora). | [ ] OK  [ ] FALLÓ |

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

## Parte 4b: Ticket de cocina y televisor del mostrador (O)

Con el usuario de rol **Cocina** iniciado en el televisor (sin estación) y el ticket de cocina en cada impresora.

| N.º | Escenario | Pasos | Resultado esperado | Pasó / Falló |
| --- | --- | --- | --- | --- |
| O1 | El ticket de cocina sale primero | E aprueba un pedido de **delivery** (2 unidades, una con **Sin cheddar**, con nota) y C aprueba uno de **retiro**. | En cada puesto sale primero el **ticket de cocina** (número, tipo DELIVERY / RETIRO, cada unidad con sus cambios en mayúsculas, la nota y la hora), después el del cliente (y en delivery, el de delivery). Mismo papel e impresora que los otros tickets. | [ ] OK  [ ] FALLÓ |
| O2 | Venta de mostrador | C hace una venta de mostrador (llamador 7). | Sale el ticket de cocina con **MOSTRADOR** y **LLAMADOR 7**. En el televisor aparece su número en **En preparación**, sin recargar. | [ ] OK  [ ] FALLÓ |
| O3 | Retiro en el televisor, delivery no | Mirar el televisor con los pedidos de O1 y O2. | Aparecen los números del retiro y del mostrador. El de **delivery no aparece** nunca. | [ ] OK  [ ] FALLÓ |
| O4 | Listo suena y se resalta | C aprieta **Listo** en el pedido de mostrador. | Su número pasa a **¡Listo! Retiralo en el mostrador** (zona grande), suena el aviso y se resalta un momento. Si el navegador no dejaba sonar, un toque en la pantalla lo habilita. | [ ] OK  [ ] FALLÓ |
| O5 | Entregado | C llama el llamador y aprieta **Entregado** (cobrando si era efectivo). | El número desaparece del televisor sin recargar. | [ ] OK  [ ] FALLÓ |
| O6 | Pedido cancelado | E o C cancela (con motivo) un pedido en preparación. | Su número desaparece del televisor sin recargar. | [ ] OK  [ ] FALLÓ |
| O7 | Ticket de cocina que no sale | Sacar el papel de una impresora y aprobar un pedido. | La Caja muestra el cuadro rojo "Ticket cocina: Sin papel"; con papel repuesto, **Reimprimir** lo imprime. También funciona **Recientes → Reimprimir → Ticket cocina**. | [ ] OK  [ ] FALLÓ |
| O8 | Un solo usuario de televisor | Con el usuario **Cocina** intentar abrir Caja, Retiro, Delivery, Administración o `/cocina`. | Siempre vuelve al televisor (`/pantalla`); no hay botones ni menú. | [ ] OK  [ ] FALLÓ |
| O9 | Se recupera solo | Con el local cerrado, reiniciar el sistema (`sudo systemctl restart burgerhause`). | El televisor muestra **Reconectando…** y vuelve solo con los números correctos. | [ ] OK  [ ] FALLÓ |

## Parte 4c: Stock y rol Encargado (G = encargado)

Con el usuario **Encargado** (sin estación) y una bebida de prueba ligada a un artículo con stock **2**.

| N.º | Escenario | Pasos | Resultado esperado | Pasó / Falló |
| --- | --- | --- | --- | --- |
| G1 | Alcance del encargado | G entra y mira el menú lateral y las pantallas de Administración. | Ve Menú, Modificadores, Cadetes y Stock; **no** ve Usuarios, Estaciones ni Ajustes (por URL tampoco abren). | [ ] OK  [ ] FALLÓ |
| G2 | Stock inicial | **Stock → Artículos → Nuevo artículo** (una bebida y una materia prima), **Guardar stock inicial**. | Aparecen en **Resumen** con su saldo y estado **Ok**; el **Historial** muestra el ajuste inicial. | [ ] OK  [ ] FALLÓ |
| G3 | Consumo del día | **Consumo del día**: 12,5 kg a la materia prima, **Guardar consumo**; doble toque. | "Consumo guardado"; el saldo baja una sola vez (12,5, no 25). | [ ] OK  [ ] FALLÓ |
| G4 | Reponer | **Reponer stock**: artículo, cantidad, nota, **Cargar ingreso**. | Muestra el saldo nuevo; figura en el historial. | [ ] OK  [ ] FALLÓ |
| G5 | Editar una carga | **Historial** → **Editar** un consumo → **Nueva cantidad** → **Guardar cambio**. | El saldo se corrige y la fila muestra la edición con el valor anterior. | [ ] OK  [ ] FALLÓ |
| G6 | Stock en negativo | Cargar un consumo mayor al saldo. | Avisa "en negativo"; solo se guarda con **Guardar igual**; el estado pasa a **Agotado**. | [ ] OK  [ ] FALLÓ |
| G7 | Bebida se descuenta y se pausa | K compra 2 de la bebida de prueba (web) y C vende 1 más. | Cada venta descuenta sola; al llegar a cero la bebida sale de la tienda y de **Venta** ("sin stock"); si otro se llevó la última, el checkout lo avisa. | [ ] OK  [ ] FALLÓ |
| G8 | Cancelación devuelve | C o E cancela un pedido con la bebida. | La bebida vuelve al stock una sola vez y, si estaba pausada, vuelve a venderse. | [ ] OK  [ ] FALLÓ |
| G9 | Reponer reactiva | **Reponer stock** de la bebida en cero. | Vuelve a la tienda y a **Venta**. Una bebida desactivada a mano antes **no** se reactiva. | [ ] OK  [ ] FALLÓ |
| G10 | Alerta para todos | Con algo en cero, mirar C, E, A y G. | Franja **Productos faltantes de stock (N)** con detalle (artículo, saldo, desde cuándo). Se va al reponer. El televisor `/pantalla` **no** la muestra. | [ ] OK  [ ] FALLÓ |
| G11 | Lista de solo lectura | C y E abren **Stock**; cocina abre `/stock`. | Ven saldos y estados, sin botones para cargar. | [ ] OK  [ ] FALLÓ |
| G12 | Producto sin artículo | Vender un producto sin artículo ligado. | Se vende normal, sin control de stock. | [ ] OK  [ ] FALLÓ |

## Parte 4d: Modificar un pedido y adicionales (M)

Para los casos con bebida, usar la bebida de prueba del stock (G2). Los pedidos de prueba se cancelan al terminar.

| N.º | Escenario | Pasos | Resultado esperado | Pasó / Falló |
| --- | --- | --- | --- | --- |
| M1 | Editar antes de aprobar | K pide retiro en efectivo con 3 productos. C en **Retiro en local**: **Editar pedido** → **Quitar** uno, agregar otro → mirar **Total nuevo** → **Guardar cambios**. | El total de la tarjeta coincide con el **Total nuevo**; K lo ve igual en su seguimiento. No salió ningún papel. Al aprobar, el ticket de cocina y el del cliente muestran lo nuevo. | [ ] OK  [ ] FALLÓ |
| M2 | No queda vacío | En M1, **Quitar** todos los productos. | Avisa que el pedido no puede quedar sin productos y **Guardar cambios** no funciona; **Deshacer** lo habilita de nuevo. | [ ] OK  [ ] FALLÓ |
| M3 | Delivery: el envío no cambia | E edita un pedido de delivery (quita un producto). | El total baja solo por el producto; el **costo de envío** queda igual. | [ ] OK  [ ] FALLÓ |
| M4 | Adicional en efectivo | Pedido web en efectivo aprobado (**En preparación**). C o E: **Agregar productos** → una bebida → **Agregar al pedido**. | El cuadro decía "Se cobra $… al entregar". La tarjeta muestra **Adicional 1** y el total sube. En la cocina sale un papel **ADICIONAL** con solo la bebida (en delivery, además, el ticket de delivery con el total nuevo, encabezado **TICKET ACTUALIZADO - reemplaza al anterior (incluye ADICIONAL 1)**). La bebida baja del stock. | [ ] OK  [ ] FALLÓ |
| M5 | Adicional por transferencia | Pedido web por transferencia aprobado. **Agregar productos** → algo → guardar. | Queda **Adicional 1 · sin pagar**; el total **no** cambia, no sale papel en la cocina y el stock no baja. K ve **Adicional pendiente de pago** y el total anterior. | [ ] OK  [ ] FALLÓ |
| M6 | Confirmar la transferencia | Seguir M5: hacer la transferencia real de la diferencia, tildar **Verifiqué la acreditación**, tocar **Confirmar adicional** (probar un doble toque). | Sin la tilde el botón no funciona. Se suma **una sola vez** al total, sale **un** papel ADICIONAL y baja el stock una vez. K ve el producto en **Tu pedido** y el total nuevo en unos segundos. | [ ] OK  [ ] FALLÓ |
| M7 | Listo con adicional sin pagar | Repetir M5 y, sin confirmar, tocar **Listo**. | Aparece "Se canceló el adicional sin pagar"; el pedido sale sin eso y el total no cambia. K ya no ve el bloque pendiente. | [ ] OK  [ ] FALLÓ |
| M8 | Cancelar un adicional | Repetir M5 y tocar **Cancelar adicional**. | Desaparece de la tarjeta; no se cobra ni se imprime nada. | [ ] OK  [ ] FALLÓ |
| M9 | Venta de mostrador | En **Mostrador**, una venta en **En preparación**: **Agregar productos** → algo. | El cuadro dice "Cobrá $… ahora"; se confirma de inmediato, suma al total y sale el papel ADICIONAL. | [ ] OK  [ ] FALLÓ |
| M10 | Papel del adicional | Sacar el papel y agregar un adicional; después reponer. | Cuadro rojo con **Ticket adicional**; **Reimprimir adicional 1** lo imprime. | [ ] OK  [ ] FALLÓ |
| M11 | Límites | Con un pedido en **Listo**, buscar cómo agregarle algo. Probar que E no pueda tocar un pedido de retiro y C uno de delivery. Entrar con el usuario **Cocina**. | En **Listo** no hay botón **Agregar productos**. Cada una solo ve y modifica los pedidos de su sector. El usuario **Cocina** no tiene ningún botón de edición. | [ ] OK  [ ] FALLÓ |
| M12 | Producto sin stock | Con una bebida en cero, intentar agregarla a un pedido. | No se puede elegir ("Sin stock"); si se agotó justo antes de guardar, avisa con un mensaje y no se cambia nada. | [ ] OK  [ ] FALLÓ |
| M13 | Cancelar un pedido con adicionales | Pedido con un adicional confirmado y uno sin pagar: **Cancelar pedido**. | El stock de todo vuelve una sola vez y el adicional sin pagar queda cancelado. | [ ] OK  [ ] FALLÓ |

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
- Todo **C1, C5, C6, C8, E1, E3, E5, E6, G2, G7, G9, F1, F2** en OK es **condición** para empezar la operación en paralelo (`docs/guias/operacion-en-paralelo.md`).
- Firma del responsable del local: ____________ Firma de soporte: ____________ Fecha: ____________

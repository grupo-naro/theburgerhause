# Plan de operación en paralelo con el sistema actual (pxw)

Objetivo: comprobar con pedidos reales, durante **una jornada completa como mínimo**, que el sistema nuevo hace lo mismo que el actual
sin sorpresas, **sin riesgo para el local**. Durante la prueba **el sistema que manda (el que vale para cocina, cobro y caja) sigue siendo pxw**.
El sistema nuevo se carga en paralelo y se compara.

## Condiciones para empezar

- UAT hecha y con los escenarios críticos en OK (`docs/guias/uat-prueba-de-aceptacion.md`, cierre).
- `docs/guias/checklist-de-salida.md` completo (impresoras reales probadas en las 9 PCs, backups verificados, monitoreo).
- Personal capacitado con las guías de una página y la tarjeta "Primer día".
- Plan de contingencia entregado y block en cada puesto.
- Alguien de soporte presente en el local durante toda la jornada (idealmente en el horario pico).

## Cómo se opera (la jornada)

| Quién | Qué hace |
| --- | --- |
| Cajera (venta de mostrador) | Cobra y registra en **pxw como siempre**; **después** carga la misma venta en **Venta** del sistema nuevo (mismos productos, pago y llamador). |
| Pedidos web nuevos | Los clientes siguen usando la tienda actual (pxw). Los pedidos que entran por pxw se **cargan a mano** en el sistema nuevo: el personal los registra como venta de mostrador (retiro) o el soporte hace pedidos de prueba espejo desde la tienda nueva para cubrir el flujo web. **No** se abre la tienda nueva al público todavía (dejar **Pausar pedidos** hasta el cierre de la prueba, salvo pedidos de prueba controlados). |
| Encargada | Despacha y rinde con **pxw como fuente de verdad**; en el sistema nuevo carga los pedidos de delivery espejo y los despacha y rinde igual. |
| Impresoras | Sale el papel de **pxw para la cocina y el cliente** (lo que ya se usa). Los papeles del sistema nuevo se comparan y se tiran/descartan (o se guardan 5 como muestra). |
| Soporte | Anota cada diferencia en la planilla de abajo y mide tiempos. |

Nota para decidir con el responsable: la forma exacta de duplicar los pedidos web (a mano, o pedidos espejo hechos por soporte) depende de
cómo hoy llegan en pxw; no está definida en el sistema. Elegirla antes del primer día y escribirla acá: `__________________`.

## Qué se compara al cierre del día

| Control | Cómo | Criterio de aceptación |
| --- | --- | --- |
| Cantidad de pedidos | Contar por tipo (mostrador, retiro, delivery) en ambos | Igual, salvo los de la libreta explicados |
| Total cobrado por método | Suma efectivo y transferencias en ambos | Diferencia **$0** (o explicada una a una) |
| Rendición de cadetes | Lo que rindió cada cadete vs. lo que dice el sistema nuevo | Coinciden; todo faltante tiene nota |
| Tickets | Revisar 10 papeles: productos, modificaciones, dirección, total | Sin errores de contenido; acentos y logo bien |
| Impresión | Chips **Impresión: ok** vs. alertas rojas del día | Cada falla tuvo causa y solución; ninguna pérdida de pedido |
| Tiempos | Cuánto tarda cobrar+imprimir, aprobar+imprimir | El personal lo considera igual o mejor que pxw |
| Disponibilidad | Cortes de **Sin conexión / Sin agente** y su duración | Sin caída de más de 15 minutos sin recuperación |
| Soporte y personal | Opinión de cajeras y encargada | Se sienten cómodas; lista de mejoras anotada |

## Planilla de diferencias (una fila por problema)

| Hora | Puesto / PC | Pedido (pxw / nuevo) | Qué pasó | Gravedad (bloquea / molesta / menor) | Quién lo resuelve | Resuelto |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | |

## Criterios para pasar al sistema nuevo (go / no-go)

**Go** (todos): total cobrado coincide; rendiciones coinciden; ninguna pérdida de pedidos; ninguna falla de impresión sin solución en el momento;
personal conforme; backup del día verificado (`check-backup.sh` = `BACKUP_FRESH`).

**No-go** (cualquiera): diferencia de dinero sin explicación; un pedido perdido o duplicado; una PC que no imprime y no se arregla;
una caída larga sin contingencia que funcione. Se corrige y se repite la jornada.

## Después de un "go"

1. Elegir un día de baja demanda para el cambio, con soporte presente.
2. Dejar pxw **disponible en modo consulta** al menos una semana (para buscar datos viejos y como respaldo si hubiera que volver).
3. **Reanudar pedidos** en Ajustes y cambiar el enlace público (redes, WhatsApp) al sistema nuevo.
4. Primera semana: revisión diaria 5 minutos (`/api/health`, backup, planilla de problemas).
5. Recién con la semana estable: cierre del MVP y planificación de la **Fase 2** (pantalla de cocina y stock). No se escribe código de Fase 2 antes.

## Plan de vuelta atrás (si hay que volver a pxw)

Mientras pxw siga disponible, volver es **dejar de usar el sistema nuevo**: **Pausar pedidos**, apuntar redes al sistema anterior, trabajar con pxw y el
block. Los pedidos hechos en el sistema nuevo siguen guardados (no se pierden). Anotar la causa en la planilla.

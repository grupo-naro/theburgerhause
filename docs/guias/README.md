# Guías para el local: capacitación y puesta en marcha

Documentos en castellano rioplatense, para el personal del local y para quien acompaña la salida. Las capturas (`img/`) se tomaron de la
versión actual del sistema con datos de prueba (los nombres de clientes y productos son ficticios).

| Documento | Para quién | Cuándo |
| --- | --- | --- |
| [Guía Cajera / Mostrador](guia-cajera-mostrador.md) | Cajeras (PCs de Mostrador) | Capacitación y consulta diaria |
| [Guía Encargada de Delivery](guia-encargada-delivery.md) | Encargada (PCs de Delivery) | Capacitación y consulta diaria |
| [Guía de Cocina](guia-cocina.md) | Cocinero / ayudante (ticket de cocina y televisor) | Capacitación y consulta diaria |
| [Guía Administrador](guia-administrador.md) | Dueño / administrador | Configuración y control |
| [Tarjeta "Primer día"](primer-dia.md) | Todo el personal | Imprimir y pegar en cada PC |
| [Carga del menú real](carga-del-menu.md) | Administrador | Antes de abrir |
| [Prueba de aceptación (UAT)](uat-prueba-de-aceptacion.md) | Un integrante por rol + soporte | En el local, con impresoras reales |
| [Plan de contingencia](plan-contingencia.md) | Personal y soporte | Entregar antes de salir; consultar ante fallas |
| [Operación en paralelo con pxw](operacion-en-paralelo.md) | Responsable del local y soporte | Una jornada antes del cambio |
| [Checklist de salida (go-live)](checklist-de-salida.md) | Soporte técnico y dueño | De la VPS a la apertura |

Orden sugerido de la puesta en marcha: **checklist de salida** (secciones 1 a 7) → **carga del menú** → **UAT** → **capacitación** (guías y tarjeta) →
**operación en paralelo** → **go / no-go** → apertura. Guías técnicas relacionadas: `docs/ops/runbook.md` (servidor) y
`docs/ops/print-agent-install.md` (impresión en las 9 PCs).

## Qué está verificado y qué no

- Los nombres de pantallas, rutas y botones de estas guías se contrastaron con el código y con los tests de recorrido del sistema (`e2e/`).
- **Sin verificar todavía** (puntos explícitos del checklist): la impresora definitiva en las 9 PCs (marca, ancho, página de códigos, corte, tiempo), el
  instalador con permisos de Administrador en Windows real, la VPS real (certbot, systemd, firewall), la copia remota de backups.
- Cómo se duplican los pedidos web durante la operación en paralelo depende de cómo llegan hoy en pxw: se define con el responsable antes de empezar.
- **Pausar pedidos** frena solo los pedidos web: las ventas de mostrador (pantalla **Venta**) siguen funcionando (verificado en el código: la venta de mostrador no consulta ese interruptor).
- **Cocina**: recibe el **ticket de cocina** impreso de cada pedido (sale primero, en la misma impresora que el ticket del cliente) y avisa a la cajera / encargada cuando está armado; ellas marcan **Listo** y **Entregado**. El **televisor del mostrador** (`/pantalla`, usuario con rol **Cocina**) muestra solo los números en preparación y listos. Procedimiento en [guia-cocina.md](guia-cocina.md). El dispositivo del televisor y dónde se coloca lo decide el local; sin verificar con el dispositivo real: tamaño de pantalla, sonido del navegador y pantalla completa.

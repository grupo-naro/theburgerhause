# Stock: bebidas y materia prima (Fase 2) y rol Encargado

Fecha: 2026-10-19. Primera pieza de la siguiente etapa, ya con el MVP terminado.

## Intención

Hoy el encargado anota a mano en papel un reporte diario de lo gastado (ej. "19/10: 50 kg de queso cheddar"), le saca una foto y se la manda al dueño. No hay control de lo que entra, ni aviso de lo que falta. Se quiere llevar ese control dentro del sistema, con el celular como dispositivo principal (ver [admin mobile](2026-10-18-admin-mobile-ux-design.md)).

## Objetivos

- Un stock por artículo (bebidas y materia prima como carne picada, pan de hamburguesa, queso cheddar), con unidad (kg, unidades, etc.).
- El encargado (o el administrador) carga a mano el consumo diario y los ingresos/compras. Reemplaza el papel y la foto.
- Las bebidas se descuentan solas con cada venta (web y mostrador). La materia prima NO se descuenta sola.
- Una bebida que llega a cero se pausa sola en el menú web y en el POS, y vuelve a estar disponible cuando se repone.
- Una alerta visible para todo el personal: "Productos faltantes de stock", que al tocarla muestra el detalle (artículo, stock actual, desde cuándo falta). Incluye también la materia prima que esté en cero o bajo el mínimo, pero esa nunca pausa productos.
- Historial: cada ingreso, consumo y edición queda registrado con fecha, quién lo hizo, nota opcional y el valor anterior si fue una edición.
- Un rol nuevo `encargado`.

## No-objetivos y anti-objetivos

- No hay descuento automático de materia prima, ni recetas, proveedores, costos ni compras con precio.
- No hay analíticas ni reportes en esta pieza (el encargado no las verá cuando existan).
- No hay combos ni promos con bebida (el negocio no los tiene): cada bebida se vende como producto aparte.
- Falla si: se vende una bebida con stock cero, se descuenta dos veces por un pedido (reintentos, doble toque), un pedido cancelado deja el stock descontado, o una carga equivocada no se puede corregir ni deja rastro.

## Decidido por el dueño

1. **Carga manual del consumo diario**, dentro del sistema, por el encargado o el administrador. Hoy se mantiene así (no automático para materia prima).
2. **Reponer ingresos:** lo hacen el encargado y el administrador.
3. **Bebidas automáticas:** cada bebida se descuenta sola; al llegar a cero se pausa en el menú y en el POS, y se avisa.
4. **Alerta en pantalla del sistema, para todos.** Se titula "Productos faltantes de stock" y al tocarla muestra el detalle. Incluye materia prima faltante pero no bloquea productos.
5. **Las cargas se pueden editar** (por encargado o administrador); la edición queda registrada.
6. **Rol `encargado`:** maneja Mostrador, Delivery y Cocina, entra al admin completo y al stock. No tiene acceso a analíticas cuando existan.
7. **Pantallas** (maquetadas en celular, aprobadas): lista de stock con estado Ok/Poco/Agotado; "Consumo del día" con un campo de cantidad por artículo y "Guardar consumo"; "Reponer stock" con artículo, cantidad, nota y "Cargar ingreso".

## Mis decisiones (marcadas para que las corrijas)

- El administrador y el encargado crean artículos y definen el mínimo de aviso "Poco". Al empezar se carga el stock inicial de cada artículo (ajuste inicial) con una entrada registrada en el historial.
- Cada artículo tiene tipo `bebida` o `materia_prima`. Solo las bebidas se ligan a un producto del menú (1 producto ↔ 1 artículo, 1 unidad vendida = 1 unidad de stock).
- Si un pedido se cancela (incluida la cancelación después de aprobado), las bebidas vuelven al stock una sola vez.
- El descuento se hace al confirmarse la venta (pedido creado/aprobado según corresponda al flujo existente: mostrador y web), de forma atómica y con idempotencia, de modo que no se pueda vender más de lo que hay ni descontar dos veces.
- Cuando el stock de una bebida es cero el producto queda no disponible (mismo mecanismo que el pausado manual de productos); al reponer vuelve a estar disponible. Si un administrador la había pausado a mano antes, no se reactiva sola (se distingue "pausa por stock" de "pausa manual").
- Las faltantes de materia prima aparecen en la alerta cuando están en cero o bajo el mínimo; "Poco" = por debajo del mínimo del artículo.
- Las cantidades admiten decimales para kg (ej. 12,5 kg) y enteros para unidades.
- El consumo se carga por fecha (por defecto hoy) y no puede dejar el stock en negativo sin confirmación explícita (a definir por el constructor como mensaje claro).
- Acceso del rol `encargado`: sin acceso a las futuras analíticas; el resto como se describió.

## Aclaraciones (llamadas mías tras la revisión del constructor)

- **Cuándo se descuenta un pedido web:** al CREARSE el pedido (reserva), de forma atómica; el rechazo o la cancelación (también tras aprobar) devuelve la bebida una sola vez. Así nunca se aprueba un pedido sin stock y el checkout rechaza con mensaje claro si la última unidad ya se la llevó otro. Costo si me equivoco: pedidos falsos podrían agotar una bebida hasta que se rechacen (los pedidos web ya requieren aprobación y tienen límite por IP). Ventas de mostrador descuentan al confirmarse la venta.
- **Regla de sector del encargado:** opera como el administrador (aprueba, cancela y despacha en cualquier sector) y no necesita estación asignada. Los permisos de seguridad se registran en `surface.ts`.
- **Consumo del día:** cada "Guardar consumo" crea un movimiento de consumo por cada artículo con cantidad cargada (los campos vacíos se ignoran). Se pueden hacer varias cargas el mismo día. Un reenvío o doble toque no duplica (clave de idempotencia por envío). "Editar" modifica un movimiento ya guardado y registra el valor anterior.
- **Pausa por stock vs. pausa manual:** una bebida pausada por stock cero no se puede reactivar a mano mientras su stock sea cero (mensaje: "Sin stock: reponé primero"); una pausa manual previa no se reactiva sola al reponer.
- **Bebidas sin artículo ligado:** el vínculo es opcional; un producto sin vínculo no tiene control de stock y sigue como hoy. El formulario de producto permite ligarlo a un artículo de tipo bebida.
- **Editar una carga puede dejar el stock negativo:** se permite con confirmación explícita ("esto deja el stock en −N"); si queda en cero o menos, la bebida se pausa por stock.

## Restricciones

- Stack existente: Next.js 16 (leer `node_modules/next/dist/docs/`, cambios incompatibles), PostgreSQL + Drizzle con migraciones, zod vía `src/lib/zod.ts`, Server Actions clasificadas en `src/lib/security/surface.ts`, roles en `src/lib/auth/roles.ts`, SSE `LiveRefresh` para tiempo real (una sola conexión por página), Vitest + tests `*.int.test.ts` + Playwright.
- Dinero en centavos y reglas existentes de pedidos (una fila por unidad, snapshots, claves de idempotencia, locks consultivos, sin borrados duros). El stock sigue el mismo espíritu: movimientos inmutables (libro de movimientos), el stock actual se deriva o se mantiene transaccionalmente con ellos; las ediciones registran el valor anterior.
- Textos en español (es-AR); celular primero (objetivos ≥ 44 px); estados con texto, no solo color.
- Autorización en el servidor primero; el rol `encargado` debe pasar la regla de sector donde corresponda (Mostrador, Delivery, Cocina).
- Los pedidos de bebidas en vuelo no se rompen: la lógica de pausa por stock debe coexistir con carritos ya armados (ver "A cargo del constructor").

## A cargo del constructor

Modelo de datos (artículos, movimientos, vínculo producto-artículo), cómo se evita vender con stock cero (validación en checkout y en el POS con mensaje claro si otro cliente se llevó la última unidad), cómo se integra con el flujo de confirmación y cancelación de pedidos, textos exactos, estructura de pantallas y navegación (sección "Stock" en el admin y acceso para encargado/cajera/encargada de delivery a la lista de solo lectura y a la alerta), migración del rol `encargado`, semilla y tests (incluido e2e en móvil).

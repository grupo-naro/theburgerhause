# Analíticas: facturación, productos, horarios y vendedoras (con PIN)

Fecha: 2026-11-07. Pedido del dueño.

## Intención

El dueño quiere ver cómo le va al local sin armar planillas: cuánto factura, qué hamburguesas se venden, qué días y horarios se vende más y cómo rinde cada vendedora. Todo sale de datos que el sistema ya guarda (pedidos, ítems con snapshot de nombre y precio, eventos de estado, quién cargó/aprobó cada pedido). Como la sesión de admin puede quedar abierta en una compu del local, los números quedan ocultos (`****`) hasta ingresar un PIN del local, y el desbloqueo dura 15 minutos.

## Objetivos

- Nueva sección **"Analíticas"** en el panel de administración, en `/admin/analiticas`, visible **solo para el rol `admin`** (no `encargado`).
- Selector de período: **Hoy / Semana / Mes / Personalizado** (rango de fechas desde–hasta).
- Cuatro bloques (maqueta aprobada):
  1. **Números principales:** facturación, cantidad de pedidos, ticket promedio, cancelados (cantidad y monto). Cada uno con la variación % contra el período anterior.
  2. **Top productos:** unidades vendidas y facturación por producto.
  3. **Mapa de calor día de la semana × hora:** cantidad de pedidos.
  4. **Vendedoras:** pedidos, facturación y ticket promedio por persona.
- **PIN del local**: uno solo, configurable en Ajustes. Sin PIN ingresado la pantalla se ve igual pero todos los números se muestran como `****` y el mapa de calor queda oculto. Con el PIN correcto se desbloquea por **15 minutos**; se muestra la cuenta regresiva y un botón **"Bloquear ya"**.

## No-objetivos y anti-objetivos

- No hay margen/ganancia por producto (no existe costo ni receta por producto).
- No hay analíticas de operación (tiempos de cocina/delivery, cadetes) ni de clientes (recurrentes, inactivos): quedan para una segunda etapa.
- No hay exportación a Excel/PDF en esta versión.
- No hay gráficos de evolución diaria en esta versión (solo los cuatro bloques).
- Falla si:
  - los números llegan al navegador estando bloqueado (el `****` tiene que ser real, no CSS ni JS que oculte datos ya enviados);
  - un `encargado`, cajera u otro rol puede ver la pantalla o sus datos;
  - un pedido de la 1 AM cuenta en el día calendario equivocado (debe contar en su día de negocio);
  - los pedidos cancelados o los web no aprobados suman en la facturación;
  - el PIN se puede adivinar probando sin límite.

## Decidido por el dueño

1. Arrancar con los cuatro bloques recomendados (números principales, top productos, día × hora, vendedoras).
2. Solo administradores.
3. PIN para que, si queda la sesión abierta, se vea la pantalla pero con los números en `****`.
4. Una vez desbloqueado dura 15 minutos.
5. Un solo PIN del local, configurado en Ajustes.
6. Para definir o cambiar el PIN en Ajustes se pide la **contraseña del admin que está logueado** (así alguien con la sesión abierta no puede poner su propio PIN, y si el dueño olvida el PIN lo cambia con su contraseña).
7. Maqueta aprobada: barra con selector de período y estado del candado; estado bloqueado con campo de PIN arriba y `****` en todos los valores (nombres de productos y vendedoras visibles); estado desbloqueado con cuenta regresiva "🔓 14:32 · Bloquear ya", cuatro tarjetas de KPIs con ▲/▼ %, top productos y mapa de calor lado a lado, tabla de vendedoras abajo.

## Mis decisiones (marcadas para que las corrijas)

### Período y comparación
- **Día de negocio:** todo se agrupa por `orders.business_date` (ya respeta el `business_day_cutoff` de Ajustes, default 06:00). La hora del mapa de calor es la hora de `created_at` en `America/Argentina/Buenos_Aires`.
- **Período por defecto:** Semana.
- **Hoy** = el día de negocio actual; compara contra **el mismo día de la semana anterior** (sábado vs. sábado pasado).
- **Semana** = lunes a domingo de la semana actual (hasta hoy); compara contra los **mismos días** de la semana anterior (lun–hoy vs. lun–mismo día pasado), para no comparar una semana a medias contra una completa.
- **Mes** = del 1 a hoy; compara contra el mismo tramo del mes anterior (1 al mismo día; si el mes anterior es más corto, hasta su último día).
- **Personalizado** = rango desde–hasta inclusive (máximo 366 días); compara contra el rango de igual largo inmediatamente anterior.
- **Día en curso, comparación hasta la misma hora:** si el período incluye el día de negocio actual (Hoy, y el último día de Semana/Mes), el día equivalente del período anterior se cuenta solo hasta la misma hora transcurrida desde el inicio de su día de negocio (filtrando por `created_at`), para no comparar un día a medias contra uno completo. Personalizado que termina hoy se trata igual.
- Si el período anterior no tiene datos, la variación se muestra como "—" (no "∞%").
- El período elegido va en la URL (query string) para que recargar o compartir el link mantenga la vista.

### Qué cuenta como venta
- **Pedido válido:** estado distinto de `pendiente_aprobacion` y `cancelado` (o sea `en_preparacion`, `listo_despacho`, `en_camino`, `para_retirar`, `entregado`). No importa `payment_status`: un pedido aprobado y no cobrado todavía cuenta como venta.
- **Facturación** = suma de `orders.total` de pedidos válidos (incluye costo de envío y adicionales confirmados, que ya actualizan el total). Se muestra en pesos (los montos están en centavos).
- **Pedidos** = cantidad de pedidos válidos. **Ticket promedio** = facturación / pedidos.
- **Cancelados** = pedidos en estado `cancelado` con `business_date` en el período: cantidad y suma de `total`. Los web rechazados antes de aprobarse también terminan en `cancelado` y cuentan acá.

### Top productos
- Sobre `order_items` de pedidos válidos. Cada fila es una unidad. Facturación de la unidad = `unit_price_snapshot` + suma de `price_delta` de sus modificadores.
- Agrupa por `product_id`; si es NULL (producto borrado) agrupa por `name_snapshot`. El nombre mostrado es el actual del producto si existe, si no el snapshot.
- Ordenado por unidades (desempate por facturación); muestra los **10** primeros.
- Filtro opcional por **categoría** (default: todas), para poder ver solo hamburguesas.

### Mapa de calor
- Filas: lunes a domingo (día de la semana de `business_date`). Columnas: horas de `created_at` en Buenos Aires, mostrando solo el rango de horas que tiene al menos un pedido en el período (en orden de la jornada: empezando en la hora de corte, ej. 19…02).
- Valor: cantidad de pedidos válidos. Intensidad de color relativa al máximo del período; cada celda muestra el número al pasar el mouse/tocar.

### Vendedoras
- Atribución por `orders.approved_by`: en mostrador es quien cargó el pedido; en web es quien lo aprobó.
- Columnas: nombre, pedidos, facturación, ticket promedio, **adicionales** (cantidad de `order_addons` confirmados con `confirmed_by` = esa persona, en pedidos **válidos** del período).
- La plata de los adicionales queda dentro de la facturación de quien tiene el pedido (`approved_by`), no se reparte al que confirmó el adicional. La columna "adicionales" es solo un conteo.
- Aparecen todas las personas con pedidos atribuidos en el período (incluye admin/encargado si cargaron pedidos), ordenadas por facturación. Usuarios desactivados también aparecen (son historia).
- Pedidos con `approved_by` NULL (usuario borrado) se agrupan en "Sin asignar".

### PIN
- Se guarda **hasheado** (mismo `scrypt` de `src/lib/auth/password.ts`) en `settings` con la clave `analytics_pin_hash`. Nunca se muestra.
- En Ajustes hay un bloque propio **"PIN de analíticas"** (formulario y acción separados del resto de Ajustes): PIN nuevo (4 a 6 dígitos), confirmación y **contraseña del admin logueado**. Sin contraseña correcta no se guarda. Aplica también la primera vez (cuando no hay PIN). Los intentos con contraseña incorrecta usan el mismo límite que el desbloqueo. Muestra si hay PIN configurado o no.
- **Sin PIN configurado:** la pantalla queda bloqueada y en lugar del campo muestra "Configurá el PIN en Ajustes" con link.
- **Desbloqueo por sesión:** se guarda en la sesión del servidor (columna nueva `sessions.analytics_unlocked_until timestamptz`). Desbloquear en la compu no desbloquea el celular. Cerrar sesión lo termina.
- **Vencimiento:** 15 minutos fijos desde el desbloqueo (no se renueva con el uso). Al vencer, en el próximo request vuelve a `****`; la cuenta regresiva del navegador, al llegar a 0, recarga la vista.
- **"Bloquear ya"** pone `analytics_unlocked_until` en NULL.
- **Intentos:** máximo **5 intentos fallidos cada 15 minutos** por usuario, con el rate limiter en memoria existente (`src/lib/rate-limit.ts`), igual que el login. Al pasarse: "Demasiados intentos, probá en X min".
- **Cambiar el PIN** en Ajustes no cierra los desbloqueos vigentes (vencen solos a los 15 min).

### Seguridad del bloqueo
- Las consultas de analíticas se ejecutan **solo** si la sesión está desbloqueada. Bloqueado, el servidor renderiza la misma estructura sin ningún número, porcentaje ni dato del mapa de calor. Los nombres visibles **no salen de ninguna consulta de ventas** y van en **orden alfabético** (el orden por ranking revelaría quién vende más): hasta 10 productos activos (de la categoría filtrada) y los usuarios activos con rol `cajera`.
- Cada page/action valida rol `admin` por su cuenta (el layout no alcanza, como en el resto del panel).
- Registrar la ruta y la acción nueva en la superficie de seguridad (`src/lib/security/surface.ts`) como el resto de las rutas.

## Lo que queda para quien lo construya

- Estructura de componentes, consultas SQL/Drizzle y si se usa una consulta por bloque o una combinada.
- Índices nuevos si hacen falta (por ejemplo sobre `orders.business_date`).
- Librería o no para el mapa de calor (preferentemente sin agregar dependencias: es una grilla).
- Diseño visual fino dentro del estilo del panel actual (tokens existentes, versión mobile).
- Textos de los estados vacíos ("No hay ventas en este período").

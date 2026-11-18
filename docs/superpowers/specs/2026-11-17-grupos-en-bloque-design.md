# Asignar grupos de extras a muchos productos a la vez

Fecha: 2026-11-17. Pedido del dueño. Diseño corto.

## Intención

Cada producto ya elige qué grupos de extras ofrece ("Quitar (hamburguesas)", "Quitar (milanesas)"…), y la tienda muestra solo esos. El dueño quiere que una milanesa napolitana no ofrezca "Sin cheddar". Con más de 100 productos, asignarlos uno por uno desde cada producto es inviable.

## Objetivos

- En la pantalla de cada **grupo de extras** (`/admin/modificadores/grupos/[id]`), una sección **"Productos que lo ofrecen"**:
  - todos los productos, agrupados por categoría y en el orden del menú, cada uno con una casilla;
  - en cada categoría, el botón **"Marcar toda la categoría"**, que alterna con "Desmarcar toda la categoría";
  - un botón **"Guardar"** que deja asignado el grupo exactamente a los productos marcados (agrega y quita), todo de una vez.
- Al **crear un producto nuevo**, cuando se elige la categoría, los grupos vienen premarcados. Se premarcan los grupos que comparten **todos** los demás productos de esa categoría (los que todos tienen, no los de un producto puntual). Se pueden cambiar antes de guardar.

## No-objetivos

- No cambia cómo funciona hoy: cada producto sigue teniendo su propia lista de grupos. No hay herencia por categoría.
- No cambia la tienda ni la caja: siguen mostrando los grupos de cada producto.

## Enfoques considerados

- **A. Grupos por categoría** (descartado): cambia el funcionamiento actual y obliga a resolver excepciones por producto.
- **B. Asignación en bloque desde el grupo** (elegido por el dueño): reutiliza el funcionamiento actual. Las excepciones se resuelven desmarcando ese producto.

## Mis decisiones

- **Quién puede hacerlo:** los mismos que hoy editan extras (admin y encargado).
- **Productos inactivos:** aparecen en la lista con la marca "(pausado)", para no perder su asignación al guardar.
- **Guardar es una sola operación de todo o nada:** reemplaza la lista de productos del grupo. Si un producto fue borrado mientras tanto, se ignora.
- **Al terminar:** se refresca el menú público, igual que hoy cuando cambia un producto.
- **Premarcado:** si la categoría todavía no tiene productos, no se premarca nada. Solo aplica al **crear**; al editar un producto no se cambia nada solo.
- **La acción nueva** queda registrada en `src/lib/security/surface.ts` como acción de admin/encargado.

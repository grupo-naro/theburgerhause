# Admin optimizado para celular (UX)

Fecha: 2026-10-18. Pedido del dueño: casi toda la operativa se va a hacer desde el celular (también desde computadora, pero menos), así que el área de administración (`/admin/*`) debe estar pensada primero para celular. Alcance: SOLO el admin. Mostrador, Delivery, Caja y Cocina quedan como están.

## Intención

El admin hoy está pensado para escritorio: tablas de 960–1056 px con 5 botones chicos por fila y un menú que esconde secciones. Desde el celular la tarea más frecuente (pausar o activar un producto) queda fuera de pantalla y los botones se aprietan mal.

## Objetivos

- Poder pausar/activar un producto con un toque, con el pulgar, sin deslizar de costado.
- Navegar entre las 6 secciones (Menú, Modificadores, Cadetes, Usuarios, Estaciones, Ajustes) sin que ninguna quede escondida.
- Ninguna pantalla del admin con scroll horizontal de página a 360–430 px de ancho.
- Objetivos táctiles de al menos 44 px de alto en celular.
- En computadora (md y más) todo se ve y funciona como hoy.

## No-objetivos y anti-objetivos

- No se agregan pantallas (ni reportes, ni ventas, ni dashboard), no se cambian datos, reglas ni permisos.
- No se toca el área de personal (Mostrador, Delivery, Caja, Cocina).
- No debe quedar una versión de escritorio peor que la actual, ni perder ninguna acción hoy disponible (destacar, subir/bajar, editar, activar/desactivar).
- Falla si un tap accidental ejecuta algo irreversible: las acciones destructivas conservan su confirmación actual.

## Decidido por el dueño

1. **Navegación:** en celular, botón ☰ arriba que abre un panel lateral con las 6 secciones (opción B de las maquetas).
2. **Lista de productos:** tarjetas con foto chica, nombre, precio, botón grande Activo/Pausado, botón "Editar" y menú "⋯" para lo secundario (destacar, subir, bajar) (opción A).

## Mis decisiones (marcadas para que las corrijas)

- La barra superior del admin queda fija al bajar (sticky), con ☰ y el nombre de la sección; el panel incluye un enlace de vuelta al área de personal ("Volver a caja" / Administración ↔ operación) y "Cerrar sesión".
- Pausar/activar no pide confirmación (se revierte con otro toque).
- Modificadores, Usuarios y Cadetes usan el mismo patrón de tarjetas en celular (por debajo de `md`); en `md+` siguen las tablas.
- Botones: en celular, mínimo 44 px de alto vía los componentes compartidos (`Button`, `ActionButton`); casillas y opciones de formularios con fila táctil de 44 px; campos de texto a 16 px para que iOS no haga zoom.
- Punto de quiebre: el actual (`md`, 768 px).

## Aclaraciones (llamadas mías tras la revisión del constructor)

- **Alcance por tamaño:** la barra fija, el ☰ y el panel solo existen por debajo de `md`. Desde `md` el shell y el menú lateral quedan exactamente como hoy.
- **Volver al área de personal:** el panel incluye un enlace al inicio del rol del usuario (el mismo destino que ya usa el área de personal para ir y volver de "Administración"); "Cerrar sesión" ya existe en el encabezado y se muestra también en el panel, sin cambiar permisos.
- **Menú "⋯" de producto:** contiene Destacar/Quitar destacado, Subir y Bajar. Subir se deshabilita en el primero de su categoría y Bajar en el último. Lo destacado se indica con un texto "Destacado" en la tarjeta, no solo con color. El "⋯" tiene el mismo comportamiento accesible que el panel (Escape, toque fuera, foco, `aria-expanded`).
- **Tarjetas de Modificadores, Usuarios y Cadetes:** acción principal visible = la más frecuente de esa entidad (Activar/Desactivar y Editar); el resto, en "⋯". Las acciones destructivas conservan exactamente su confirmación actual. Cada grupo de modificadores es una tarjeta con sus opciones listadas dentro, apiladas.
- **Activo/Pausado:** llama a la acción de servidor existente de activar/desactivar, con estado de espera y mensaje de error. Es la misma acción de hoy.
- **Foto:** si un producto no tiene imagen, se muestra un recuadro neutro. No se cambia la consulta si la imagen ya viene en los datos de la fila; si no viniera, agregarla es la única excepción permitida a "no cambiar datos".
- **Alcance de los tamaños táctiles:** los 44 px y los 16 px de texto se aplican solo dentro del admin (clase o variante propia del admin), para no alterar Mostrador, Delivery, Caja y Cocina.
- **Verificación:** e2e con la semilla de pruebas de siempre y capturas a 390 px y 1280 px.

## Restricciones

- Next.js 16 con cambios incompatibles: leer `node_modules/next/dist/docs/` antes de escribir código. Tailwind 4, tokens en `src/app/globals.css`. Textos en español (es-AR).
- Reutilizar componentes de `src/components/ui/*`; el patrón de navegación del personal (`src/components/staff/staff-nav.tsx`) sirve de referencia.
- Los tests e2e de admin existentes deben seguir pasando en proyectos "desktop" y "mobile"; si el cambio de tabla a tarjetas altera selectores, se actualizan los tests sin debilitarlos.
- Accesibilidad: el panel ☰ con foco atrapado, cierre con Escape y toque fuera, `aria-expanded`/`aria-controls`; estados con texto, no solo color.

## Hallazgos de la revisión (punto de partida)

- `src/app/(admin)/admin/admin-shell.tsx` y `admin-nav.tsx`: tira horizontal de 6 links, ~36 px, no fija; Estaciones y Ajustes quedan ocultos a 375 px.
- `menu/_components/category-section.tsx` y `product-row.tsx`: tabla `min-w-[60rem]`, 5 botones `sm` de ~28 px.
- `modificadores/_components/group-card.tsx`: tabla `min-w-[66rem]`.
- Usuarios y Cadetes: ocultan columnas pero las acciones siguen apretadas.
- `src/components/ui/button.tsx` (`sm` ~28 px) y `action-button.tsx`; checkboxes `size-4` en formularios.
- Estaciones y Ajustes ya son aceptables en celular.
- No hay e2e de layout móvil del admin; existen proyectos Playwright "desktop" (1280x800) y "mobile" (Pixel 7).

## A cargo del constructor

Estructura exacta de componentes, animación del panel, cómo se agrupan acciones en el "⋯", textos, y tests (incluir un e2e de admin en móvil: sin desborde horizontal a 390 px, ☰ abre y cierra, pausar un producto desde la tarjeta, todas las secciones alcanzables, objetivos ≥ 44 px). Verificar con capturas a 390 px y 1280 px y mirarlas.

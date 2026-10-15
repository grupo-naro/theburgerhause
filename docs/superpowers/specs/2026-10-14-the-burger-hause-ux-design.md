# The Burger Hause — Diseño UX y sistema visual (Fase 1)

Fecha: 2026-10-14 · Estado: pendiente de revisión
Complementa a `2026-10-14-the-burger-hause-mvp-design.md` (arquitectura y datos).

## 1. Dirección visual

**Fiel a la marca + acento cheddar.** Evolución reconocible de la tienda actual (azul dominante, fondo claro), con la mascota del logo (`public/logo.png`) como protagonista y un acento cálido para las acciones de compra.

Referencias analizadas: logo (círculo azul, texto blanco redondeado y grueso, mascota cartoon retro, paleta monocromática) y la tienda online actual (header azul, carrusel de destacados, buscador, 17 categorías en texto, lista a 2 columnas con contador `- 0 +` por tarjeta).

### Problemas de la tienda actual que este diseño corrige
| Problema | Solución |
|---|---|
| 17 categorías como texto en 4 filas empujan los productos fuera de pantalla | Barra horizontal *sticky* de chips con scroll lateral y *scrollspy* |
| Contador por tarjeta impide configurar cada unidad por separado | Hoja de producto con configuración por unidad (§3.4) |
| El carrito es solo un total en el header | Barra inferior fija con cantidad y total + carrito completo |
| Miniaturas de ~100 px en 2 columnas | Una columna en celular con foto grande; 2–3 columnas en escritorio |

## 2. Tokens de diseño

Definidos como variables CSS (Tailwind 4 `@theme`) en `src/app/globals.css`. Los hex azules son estimados del logo y se afinan con el muestreo real del archivo antes de implementar.

### Color
| Token | Valor | Uso |
|---|---|---|
| `--color-brand-700` | `#043F7C` | Hover/pressed de primario |
| `--color-brand-600` | `#0557A9` | Header, botones primarios, chip activo, links |
| `--color-brand-300` | `#62A8F5` | Detalles, bordes suaves, ilustraciones |
| `--color-brand-50` | `#EAF3FE` | Fondos suaves, chips inactivos |
| `--color-cheddar-400` | `#FFC629` | Botón "Agregar", ofertas, badges de precio. Texto sobre él: tinta |
| `--color-cheddar-600` | `#E0A300` | Hover/pressed del acento |
| `--color-ink` | `#0B1F3A` | Texto principal |
| `--color-ink-muted` | `#5B6B80` | Texto secundario (descripciones) |
| `--color-surface` | `#FFFFFF` | Tarjetas |
| `--color-bg` | `#F5F8FC` | Fondo de página |
| `--color-line` | `#DCE5F0` | Bordes y separadores |

**Estados de pedido (panel de personal)**
| Estado | Color |
|---|---|
| `pendiente_aprobacion` | Ámbar `#F59E0B` |
| `en_preparacion` | Azul `#0557A9` |
| `listo_despacho` | Verde `#16A34A` |
| `en_camino` / `para_retirar` | Violeta `#7C3AED` |
| `entregado` | Gris `#64748B` |
| `cancelado` / error de impresión | Rojo `#DC2626` |

Reglas: el color nunca es el único indicador (siempre va con texto o icono); contraste mínimo AA (azul 600 sobre blanco y tinta sobre cheddar lo cumplen).

### Tipografía (`next/font/google`)
- Display (títulos, precios, números de pedido): **Baloo 2** 700/800, cercana a la tipografía redondeada del logo.
- Texto e interfaz: **DM Sans** 400/500/700.
- Escala móvil: 12 / 14 / 16 (base) / 20 / 28 / 36. En panel de personal, base 16 y botones principales a 18.

### Forma y movimiento
- Radio: 12 px tarjetas, 999 px chips y botones. Sombra suave, sin bordes gruesos.
- Movimientos cortos (150–250 ms): apertura de la hoja de producto, aparición de la barra de carrito, destello al agregar.
- Se respeta `prefers-reduced-motion`.
- Áreas táctiles mínimas de 44 px (48 px en paneles de personal).

## 3. Tienda del cliente (mobile-first)

### 3.1 Estructura de la página `/`
1. **Header** (azul 600): logo circular 40 px + "The Burger House 828", botón buscar y botón carrito con contador.
2. **Destacados:** carrusel horizontal de productos marcados como destacados, con precio en badge cheddar. Requiere `products.featured` (booleano) — adición menor al modelo de datos.
3. **Buscador** con filtrado instantáneo.
4. **Barra de categorías sticky:** chips con scroll horizontal; el chip activo cambia al hacer scroll (*scrollspy*) y al tocar un chip la página se desplaza a la sección.
5. **Secciones por categoría:** título en display + productos.
6. **Pie:** datos del local, horarios y accesos a ubicación, Instagram y WhatsApp.
7. **Barra de pedido inferior** (aparece con ≥1 ítem): "Ver pedido · 3 · $43.700".

### 3.2 Tarjeta de producto
Foto (relación 4:3 en celular, 1:1 en escritorio), nombre en display, descripción en 2 líneas, precio en azul y botón circular cheddar "+". **Toda la tarjeta abre la hoja de producto**; no hay contador en la tarjeta.

### 3.3 Estados de la tienda
- Local cerrado o pedidos pausados: banner superior y botones deshabilitados con el motivo. Requiere `settings.accepting_orders` (adición menor).
- Producto no disponible: tarjeta atenuada con etiqueta "Sin stock".
- Carga con *skeletons*; error de red con reintento.

### 3.4 Hoja de producto (configuración por unidad)
*Bottom sheet* en celular, modal centrado en escritorio.
- Cabecera: foto, nombre, descripción, precio base.
- **Selector de cantidad** (1–10).
- **Una sección por unidad** ("Hamburguesa 1", "Hamburguesa 2"…), en acordeón; la primera abierta. Cada una contiene los grupos de modificadores del producto:
  - **Quitar** (casillas): Sin cheddar, Sin lechuga, Sin tomate…
  - **Agregar** (casillas con precio): + Dips de cheddar, + Salsa tasty en papas, Agregar tomate…
  - **Cambiar** (opción única): Cambiar a papas grandes…
- Atajo **"Igual que la 1"** en cada unidad siguiente: copia la configuración de la primera.
- Campo de notas por unidad, colapsado.
- **Pie fijo:** botón cheddar "Agregar al pedido · $X" con el total dinámico (base + deltas × unidades).
- Si el producto no tiene modificadores, la hoja es mínima (cantidad + agregar).

### 3.5 Carrito
- Panel lateral en escritorio y pantalla completa en celular.
- Ítems **agrupados visualmente** cuando producto y modificaciones son idénticos (con contador `- n +`); si difieren, aparecen separados. Cada ítem muestra sus modificaciones como chips ("Sin cheddar", "+ Dips") y tiene **Editar** y **Quitar**.
- "Seguir pidiendo" vuelve al menú conservando el scroll.
- Subtotal, envío (si aplica) y total.
- Carrito persistido en `localStorage`; si un producto cambió de precio o se desactivó, se avisa antes de confirmar.

### 3.6 Checkout (una sola página, secciones numeradas)
1. **Entrega:** control segmentado Delivery / Retiro en local.
   - Delivery: dirección, entre calles, aclaraciones del lugar.
   - Retiro: muestra la dirección del local con enlace al mapa.
2. **Tus datos:** nombre completo y WhatsApp (con máscara y validación).
3. **Pago:** tarjetas seleccionables Efectivo / Transferencia.
   - Transferencia: muestra alias/CBU con botón "Copiar" y aviso "Un cajero verificará tu pago antes de preparar el pedido".
4. **Resumen** (sticky en escritorio, colapsable en celular) y botón **"Confirmar pedido · $X"**.
- Validación en línea; errores en el campo; el botón muestra estado de envío para evitar doble pedido.

### 3.7 Confirmación y seguimiento (`/pedido/[token]`)
Número de pedido grande, línea de tiempo con los estados (Recibido → Aprobado → En preparación → Listo → En camino/Para retirar → Entregado), actualizada en vivo. Resumen del pedido y botón para escribir por WhatsApp al local. Si está `cancelado`, se muestra claro y con contacto.

## 4. Paneles de personal (escritorio, táctil y teclado)

Barra superior común: nombre de estación, **indicador de impresora** (verde/rojo según `last_seen_at` y trabajos `failed`), indicador de conexión en vivo, usuario y cerrar sesión. Navegación lateral por rol.

### 4.1 Caja `/caja`
- Lista en vivo de pedidos `pendiente_aprobacion` ordenados por antigüedad, con **sonido y destello** al llegar uno nuevo y tiempo transcurrido.
- Tarjeta: número, hora, tipo de entrega, ítems (por unidad, con modificaciones destacadas), total y método de pago.
- **Transferencia:** casilla obligatoria "Verifiqué la acreditación" antes de habilitar **Aprobar y pagado**.
- **Efectivo:** botón **Aprobar** (cobro pendiente).
- **Rechazar** pide motivo.
- Alerta persistente de impresión fallida con **Reimprimir**.

### 4.2 Mostrador / POS `/mostrador`
- Izquierda: pestañas de categorías y cuadrícula de productos con fotos y botones grandes. Derecha: ticket en curso.
- Mismo selector de modificadores por unidad, en formato compacto.
- **Cobro:** botones Efectivo / Transferencia, luego **teclado numérico en pantalla para el N° de llamador** (obligatorio) y **Cobrar e imprimir**.
- Atajos de teclado: buscar producto, cobrar, limpiar ticket.

### 4.3 Despacho `/despacho`
- Dos carriles: **Mostrador** (pedidos `listo_despacho`/`para_retirar` con el N° de llamador muy grande y botón "Llamar / Entregado") y **Delivery**.
- Delivery: lista de pedidos `listo_despacho` con casillas; al seleccionar, aparece una **barra de acción inferior** "Asignar 3 pedidos a [selector de cadete]" → `en_camino`.
- Sección "En ruta" por cadete con sus pedidos y acciones Entregado / Volver a despacho.

### 4.4 Rendición `/despacho/rendicion`
- Lista de cadetes con **saldo pendiente** destacado y cantidad de pedidos en ruta.
- Detalle del cadete: tabla de pedidos entregados en efectivo con su monto y total a rendir.
- **"Recibí $X"** abre una confirmación que repite el monto; al confirmar, el saldo queda en $0 y se muestra el comprobante de la rendición.

### 4.5 Admin
Tablas simples con edición en panel lateral. Para el menú: arrastrar para ordenar, subida de imagen con vista previa, activar/desactivar y marcar destacado.

## 5. Accesibilidad y rendimiento
- Contraste AA, foco visible, etiquetas en todos los controles, hojas y modales con trampa de foco y cierre con Esc.
- Imágenes `next/image` desde `/uploads`, con tamaños responsivos y *lazy loading*; la imagen del primer destacado con prioridad.
- El logo actual pesa ~1.5 MB: se exporta una versión optimizada (SVG o PNG/WebP < 60 KB) para header y favicon.
- Menú público con `use cache`; hoja de producto y carrito como componentes cliente aislados.

## 6. Cambios al modelo de datos derivados de este documento
- `products.featured` (boolean) para el carrusel.
- `settings.accepting_orders` (boolean) y horarios, para el banner de local cerrado.
- Ninguno cambia la arquitectura aprobada.

## 7. Preguntas abiertas
1. ¿Hay tipografía oficial de la marca, además de la del logo? Si no, se usa Baloo 2 + DM Sans.
2. ¿Tienen fotos de todos los productos? Sin foto, la tarjeta usa un placeholder con la mascota.
3. ¿Quieren horarios de atención y cierre automático de pedidos, o un interruptor manual?

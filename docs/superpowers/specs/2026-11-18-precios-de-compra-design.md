# Precios de compra en las reposiciones — diseño

Fecha: 2026-11-18 · Tamaño: cambio chico/mediano (una columna, un campo, una pestaña).

## Intención

Al reponer stock (bebidas o materia prima) el admin quiere anotar **cuánto costó cada unidad** (el kilo, la botella, el litro)
y que el sistema calcule el total del ingreso (20 kg × $2.000 = $40.000). Con el tiempo, ver **cuánto fue subiendo** cada
cosa: "el queso subió 20% respecto de la compra anterior". Es un dato para el dueño: más información en el sistema.

## Objetivos

- Campo **Precio unitario** opcional en "Reponer stock", con el **total calculado en vivo** (cantidad × precio).
- Pestaña nueva **"Precios de compra"** dentro de Stock (al lado de Historial): por artículo, el último precio y el %
  contra la compra anterior; debajo, cada compra con fecha, cantidad × precio = total, % vs la anterior y quién la cargó.
  Filtro por artículo.
- **Solo el admin** carga y ve precios. El encargado sigue reponiendo como hoy, sin campo de precio ni pestaña.

## No-objetivos

- Proveedores, facturas, varias cosas en una compra (fue el enfoque B, descartado por ahora).
- Actualizar solo el costo de los productos del menú a partir de estas compras.
- Resumen de gasto en Analíticas.
- Precios en el Historial actual (lo ve el encargado): sigue igual.

## Enfoques

- **A. Precio en la misma reposición (elegido).** Columna `unit_price` en `stock_movements`, solo para `ingreso`. La
  pestaña lee esos movimientos. Si se corrige la cantidad en el Historial, el total se recalcula solo. Imposible que
  compra y stock se desfasen.
- B. Tabla de compras aparte enganchada al movimiento: sirve para proveedor/factura, más trabajo y riesgo de desfase.
  Descartado: no se van a cargar proveedores pronto.
- C. Guardar solo el último precio por artículo: pierde el historial, que es justo lo que se quiere. Descartado.

## Diseño

- **Datos.** `stock_movements.unit_price integer NULL` en **centavos por unidad entera** (por kg, por l, por u).
  Check: `unit_price IS NULL OR (kind = 'ingreso' AND unit_price > 0)`. Migración nueva, sin backfill (lo viejo queda sin precio).
- **Total** = `round(qty_delta (milli) × unit_price / 1000)` centavos, calculado al mostrar (no se guarda).
- **% vs anterior** = contra la compra **con precio** inmediatamente anterior del mismo artículo (por fecha de negocio
  y luego id). Sin anterior → sin %. Se muestra con ▲ / ▼ / "=" y un decimal como mucho.
- **Reponer.** El campo aparece solo si el usuario es admin; formato pesos argentinos como el resto ("1.500" o "1500,50").
  `registerIngresoAction` sigue siendo de encargado, pero si llega `unitPrice` y el usuario **no** es admin se rechaza
  ("Solicitud inválida."); vacío = sin precio.
- **Corregir/agregar precio después.** En la pestaña, el admin puede editar el precio de una compra (o ponérselo a una
  reposición que quedó sin precio, desde el filtro "sin precio" del artículo). Acción admin, registrada en la
  superficie de seguridad.
- **Pestaña.** `/admin/stock/precios`, admin-only (el encargado no ve el link ni puede entrar). Agrupada por artículo,
  artículos ordenados por la compra más reciente; mobile-first como el resto de Stock.
- **Movimientos anulados** (cantidad editada a 0) no cuentan para el % ni se listan.

## Queda para quien construye

Nombres, componentes, consultas y paginación de la lista (empezar con las últimas ~12 compras por artículo y "ver más").

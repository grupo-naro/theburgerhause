# Demora: tiempo estimado automático y aviso manual

Fecha: 2026-10-26. Pedido del dueño.

## Intención

Hoy no hay forma de avisar al cliente que los pedidos van a tardar más. Hay dos causas de demora: por demanda (ej. el día de la hamburguesa, más de 50 pedidos a la vez y la cocina se satura) y externas a la cocina (se pinchó un delivery, faltó personal). El sistema debe mostrar al cliente un tiempo estimado realista: calcularlo solo según la carga, y permitir que las vendedoras agreguen una demora manual cuando pasa algo que el sistema no puede ver.

## Objetivos

- Calcular automáticamente un tiempo estimado (en rango, ej. "45–55 min") a partir de cuánto tardaron en salir los últimos pedidos y cuántos pedidos hay en preparación ahora.
- Permitir a una persona del personal activar una demora manual: minutos extra + motivo. Queda activa hasta que alguien del personal la desactive (no se apaga sola).
- Mostrar al cliente el tiempo estimado (automático + minutos extra manuales) en el menú, antes de pedir, y en "Tu pedido". Con demora se destaca en naranja; sin demora se muestra tranquilo, en gris.
- Aplica a todos los tipos de pedido (mostrador, retiro, delivery).
- Registrar quién activó y desactivó la demora manual y cuándo.

## No-objetivos y anti-objetivos

- El motivo NUNCA se muestra al cliente: solo al personal.
- La demora no bloquea, no pausa ni rechaza pedidos: solo informa.
- No se agrega al ticket ni a la pantalla `/pantalla` del mostrador.
- La demora manual no se apaga sola por tiempo.
- Falla si: el cliente ve el motivo, la demora queda "pegada" tras desactivarla (caché del menú), el tiempo mostrado salta de forma errática con pocos datos, o una persona sin permiso puede activarla.

## Decidido por el dueño

1. Dos tipos: automática (por demanda) y manual (causas externas).
2. La manual la cargan las vendedoras: minutos extra (ej. 10) y motivo; la desactivan a mano.
3. El cliente ve solo el tiempo, no el motivo.
4. Se muestra en todos los tipos de pedido.
5. Maquetas aprobadas (menú con cartel naranja, "Tu pedido" con el tiempo arriba de los pasos, panel de la vendedora con demora automática, campos, "Activar demora" y "Desactivar demora" con quién y a qué hora).
6. El cálculo automático se hace mirando lo que tardaron los últimos pedidos y cuántos hay en preparación.

## Mis decisiones (marcadas para que las corrijas)

- **Cálculo automático:** tiempo de cocina = promedio (o mediana) de lo que tardaron los últimos pedidos entre aprobación y "Listo", ajustado por cuántos pedidos hay en preparación ahora. Con pocos datos usa un tiempo base configurable en Ajustes. Se muestra como rango. El tiempo exacto de la fórmula lo define el constructor.
- **Cuenta final:** tiempo mostrado = automático + minutos extra de la demora manual.
- **Delivery:** al tiempo de cocina se le suma un margen fijo de viaje, configurable en Ajustes.
- **Quién la activa:** vendedoras (cajera), encargada de delivery, encargado y administrador.
- **Una sola demora manual activa a la vez** (activar otra reemplaza a la anterior, con registro).
- **Minutos extra:** opciones rápidas de a 5 (5, 10, 15, 20…) con tope razonable.
- **Dónde se ve el panel de la vendedora:** en Caja/Mostrador, visible también en Delivery para la encargada.
- **Rango mostrado:** redondeado de a 5 minutos.

## Restricciones

- Next.js 16 con cambios incompatibles: leer `node_modules/next/dist/docs/`; PostgreSQL + Drizzle (próxima migración después de la 0011); zod vía `src/lib/zod.ts`; toda Server Action nueva clasificada en `src/lib/security/surface.ts` y regenerar `docs/ops/security-surface.md`; roles en `src/lib/auth/roles.ts`.
- Tiempo real: actualizar menú y "Tu pedido" por los canales existentes (una sola conexión en vivo por página); cuidar la caché del menú (`invalidateMenu()` o equivalente) para que activar/desactivar se refleje.
- Textos en español (es-AR); celular primero (objetivos ≥ 44 px) en el panel de la vendedora.
- Sin hard deletes: el historial de demoras se conserva.
- Sin capturas de pantalla en la verificación (el dueño revisa a ojo).

## A cargo del constructor

Modelo de datos (demora manual con motivo, minutos, quién y cuándo; ajustes de tiempo base y margen de delivery), fórmula exacta y consulta del tiempo automático (ventana de pedidos, manejo de pocos datos y de picos), acciones activar/desactivar con permisos, dónde exactamente va el panel, componente del cartel en el menú y en "Tu pedido", invalidación de caché y tiempo real, textos exactos, tests (unitarios, de integración y e2e en celular y escritorio) y guías (cajera, encargada, administrador).

## Aclaraciones (llamadas mías tras la revisión del constructor)

- **Qué se mide:** el tiempo de cocina va desde el evento de entrada a `en_preparacion` hasta el evento de salida a `listo_despacho` (o `para_retirar`), tomado del registro de eventos de pedido existente; no se necesita migración para eso. La carga actual es la cantidad de pedidos en `en_preparacion` (todos los tipos, una sola cocina, valor global). Los eventos del mismo estado (ej. cambio de tanda) no cuentan. No incluye el tiempo del cadete, así que el margen de delivery no se cuenta dos veces.
- **Fórmula:** la define el constructor, con estas reglas: usa la mediana de los últimos pedidos (ventana y mínimo de datos a definir; por debajo del mínimo usa el tiempo base), suma un recargo por la cola actual, tiene tope máximo y se suaviza para que no salte. Debe verificarse con un caso de más de 50 pedidos a la vez: el resultado debe ser alto pero creíble, no absurdo.
- **Rango:** centrado en el valor calculado, de ±5 min, redondeado de a 5.
- **Cuándo se pone naranja:** cuando hay demora manual activa, o cuando el tiempo automático supera el tiempo base por más de 10 minutos (umbral fijo). Si no, se muestra en gris.
- **"Tu pedido":** el tiempo se calcula en vivo y se actualiza si se activa o desactiva una demora después de hacer el pedido. Solo se muestra mientras el pedido no está listo, entregado ni cancelado.
- **Motivo:** texto libre, obligatorio, hasta 120 caracteres. Solo lo ven los usuarios del personal con acceso al panel; nunca viaja a las páginas públicas (menú y "Tu pedido" reciben solo los minutos). La pantalla `/pantalla` no lo muestra.
- **Tope de minutos extra:** 60 min, en pasos de 5.
- **Ajustes:** el tiempo base y el margen de delivery los edita solo el administrador (como el resto de Ajustes). Valores iniciales sugeridos si el dueño no indica otros: base 25 min, margen de delivery 15 min.
- **Reemplazo:** activar una demora con otra ya activa cierra la anterior (registrando quién) y abre la nueva: dos filas en el historial.
